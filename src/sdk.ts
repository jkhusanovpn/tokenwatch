import { computeCostUsd, registerPricing } from './pricing.js';

export { registerPricing };

export interface Tags {
  feature?: string;
  customerId?: string;
}

export interface TrackEvent extends Tags {
  ts?: number;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd?: number;
  latencyMs?: number;
  status?: 'ok' | 'error';
  errorType?: string;
}

export interface InitOptions {
  /** TokenWatch server URL. Default: $TOKENWATCH_URL or http://localhost:4318 */
  endpoint?: string;
  /** API key, if the server requires one ($TOKENWATCH_API_KEY). */
  apiKey?: string;
  /** Tags applied to every event (overridable per wrapper/track call). */
  defaults?: Tags;
  /** When true, wrapped calls throw BudgetExceededError once the monthly budget is spent. */
  enforceBudget?: boolean;
}

export class BudgetExceededError extends Error {
  constructor(spentUsd: number, budgetUsd: number) {
    super(`TokenWatch: monthly budget exceeded ($${spentUsd.toFixed(2)} of $${budgetUsd.toFixed(2)}). Call blocked.`);
    this.name = 'BudgetExceededError';
  }
}

const config: Required<Pick<InitOptions, 'endpoint' | 'defaults' | 'enforceBudget'>> & { apiKey?: string } = {
  endpoint: process.env.TOKENWATCH_URL ?? 'http://localhost:4318',
  apiKey: process.env.TOKENWATCH_API_KEY,
  defaults: {},
  enforceBudget: false,
};

export function init(opts: InitOptions): void {
  if (opts.endpoint) config.endpoint = opts.endpoint.replace(/\/$/, '');
  if (opts.apiKey !== undefined) config.apiKey = opts.apiKey;
  if (opts.defaults) config.defaults = opts.defaults;
  if (opts.enforceBudget !== undefined) config.enforceBudget = opts.enforceBudget;
}

// --- event queue -----------------------------------------------------------

let queue: TrackEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

export function track(event: TrackEvent): void {
  const ev: TrackEvent = {
    ts: Date.now(),
    status: 'ok',
    ...config.defaults,
    ...event,
  };
  ev.costUsd ??= computeCostUsd(ev.model, ev.inputTokens, ev.outputTokens);
  queue.push(ev);
  if (queue.length >= 25) void flush();
  else if (!timer) {
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, 2000);
    timer.unref?.();
  }
}

export async function flush(): Promise<void> {
  if (queue.length === 0) return;
  const batch = queue;
  queue = [];
  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (config.apiKey) headers.authorization = `Bearer ${config.apiKey}`;
    const res = await fetch(`${config.endpoint}/v1/events`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: batch }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    // Re-queue (bounded) so a transient outage doesn't lose data.
    queue = batch.concat(queue).slice(0, 1000);
    if (process.env.TOKENWATCH_DEBUG) console.error('[tokenwatch] flush failed:', err);
  }
}

// --- budget guard ----------------------------------------------------------

export interface GuardState {
  blocked: boolean;
  spentMonthUsd: number;
  budgetUsd: number | null;
}

let guardCache: { state: GuardState; at: number } | null = null;

export async function guardBudget(): Promise<GuardState> {
  const res = await fetch(`${config.endpoint}/v1/guard`);
  if (!res.ok) throw new Error(`TokenWatch guard check failed: HTTP ${res.status}`);
  return (await res.json()) as GuardState;
}

async function checkBudgetCached(): Promise<GuardState | null> {
  if (guardCache && Date.now() - guardCache.at < 30_000) return guardCache.state;
  try {
    const state = await guardBudget();
    guardCache = { state, at: Date.now() };
    return state;
  } catch {
    return null; // fail open: never break the user's app because the monitor is down
  }
}

// --- client wrappers --------------------------------------------------------

type AnyFn = (...args: any[]) => any;

interface UsageNumbers {
  inputTokens: number;
  outputTokens: number;
}

function extractUsage(result: any): UsageNumbers {
  const u = result?.usage ?? {};
  return {
    // OpenAI chat completions / Anthropic + OpenAI responses API
    inputTokens: u.prompt_tokens ?? u.input_tokens ?? 0,
    outputTokens: u.completion_tokens ?? u.output_tokens ?? 0,
  };
}

/** Pull usage out of stream events across providers (Anthropic message_start/delta, OpenAI chunks/responses). */
async function consumeStreamUsage(stream: AsyncIterable<any>, provider: string, params: any, tags: Tags, t0: number): Promise<void> {
  let inputTokens = 0;
  let outputTokens = 0;
  let model: string = params?.model ?? 'unknown';
  try {
    for await (const ev of stream) {
      const u = ev?.usage ?? ev?.message?.usage ?? ev?.response?.usage;
      if (u) {
        // max(): Anthropic message_delta usage is cumulative; OpenAI sends usage once in the final chunk.
        inputTokens = Math.max(inputTokens, u.input_tokens ?? u.prompt_tokens ?? 0);
        outputTokens = Math.max(outputTokens, u.output_tokens ?? u.completion_tokens ?? 0);
      }
      model = ev?.model ?? ev?.message?.model ?? ev?.response?.model ?? model;
    }
    track({ model, provider, inputTokens, outputTokens, latencyMs: Date.now() - t0, ...tags });
  } catch (err: any) {
    track({
      model, provider, inputTokens, outputTokens,
      latencyMs: Date.now() - t0,
      status: 'error',
      errorType: err?.constructor?.name ?? 'Error',
      ...tags,
    });
  }
}

function instrument(fn: AnyFn, self: unknown, provider: string, tags: Tags): AnyFn {
  return async function tracked(params: any, ...rest: any[]) {
    if (config.enforceBudget) {
      const state = await checkBudgetCached();
      if (state?.blocked) throw new BudgetExceededError(state.spentMonthUsd, state.budgetUsd ?? 0);
    }
    // Streaming: tee the stream — hand one branch back untouched, read usage from the other.
    if (params && typeof params === 'object' && params.stream) {
      const t0 = Date.now();
      const stream = await fn.call(self, params, ...rest);
      if (typeof stream?.tee === 'function') {
        const [mine, theirs] = stream.tee();
        void consumeStreamUsage(mine, provider, params, tags, t0);
        return theirs;
      }
      return stream; // unknown stream shape — pass through untracked
    }
    const t0 = Date.now();
    try {
      const result = await fn.call(self, params, ...rest);
      const usage = extractUsage(result);
      track({
        model: result?.model ?? params?.model ?? 'unknown',
        provider,
        ...usage,
        latencyMs: Date.now() - t0,
        ...tags,
      });
      return result;
    } catch (err: any) {
      track({
        model: params?.model ?? 'unknown',
        provider,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - t0,
        status: 'error',
        errorType: err?.constructor?.name ?? 'Error',
        ...tags,
      });
      throw err;
    }
  };
}

function wrapPaths<T extends object>(obj: T, paths: string[][], provider: string, tags: Tags): T {
  const heads = new Map<string, string[][]>();
  for (const [head, ...rest] of paths) {
    if (!heads.has(head)) heads.set(head, []);
    heads.get(head)!.push(rest);
  }
  return new Proxy(obj, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      const key = String(prop);
      const rests = heads.get(key);
      if (rests) {
        if (rests.some((r) => r.length === 0) && typeof value === 'function') {
          return instrument(value as AnyFn, target, provider, tags);
        }
        if (value && typeof value === 'object') {
          return wrapPaths(value, rests, provider, tags);
        }
      }
      return typeof value === 'function' ? (value as AnyFn).bind(target) : value;
    },
  }) as T;
}

/** Wrap an `openai` client: chat.completions.create and responses.create are tracked. */
export function wrapOpenAI<T extends object>(client: T, tags: Tags = {}): T {
  return wrapPaths(client, [['chat', 'completions', 'create'], ['responses', 'create']], 'openai', tags);
}

/** Wrap an `@anthropic-ai/sdk` client: messages.create is tracked. */
export function wrapAnthropic<T extends object>(client: T, tags: Tags = {}): T {
  return wrapPaths(client, [['messages', 'create']], 'anthropic', tags);
}
