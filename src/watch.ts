/**
 * `tokenwatch watch` — ingest usage from coding-agent session logs (read-only).
 * Supported: Claude Code (~/.claude/projects), OpenAI Codex CLI (~/.codex/sessions).
 * No proxy, no config inside the agents: we tail their JSONL transcripts.
 */
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename, dirname, relative, sep } from 'node:path';
import { homedir } from 'node:os';
import { findPrice } from './pricing.js';

interface OutEvent {
  ts: number;
  model: string;
  provider?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  feature: string;
  customerId?: string;
}

interface FileCtx {
  project?: string;
  model?: string;
  cwd?: string;
}

const seen = new Set<string>();

function parseClaudeLine(line: string, ctx: FileCtx): OutEvent | null {
  if (!line.includes('"assistant"') || !line.includes('"usage"')) return null;
  let o: any;
  try { o = JSON.parse(line); } catch { return null; }
  if (o?.type !== 'assistant') return null;
  const m = o.message;
  const u = m?.usage;
  if (!u) return null;
  const id = m.id ?? o.uuid;
  if (id) {
    if (seen.has(id)) return null;
    seen.add(id);
  }
  const model: string = m.model ?? 'unknown';
  if (model.includes('synthetic')) return null;
  const p = findPrice(model);
  const inT = u.input_tokens || 0;
  const outT = u.output_tokens || 0;
  const cacheRead = u.cache_read_input_tokens || 0;
  const cc5 = u.cache_creation ? (u.cache_creation.ephemeral_5m_input_tokens || 0) : (u.cache_creation_input_tokens || 0);
  const cc1 = u.cache_creation ? (u.cache_creation.ephemeral_1h_input_tokens || 0) : 0;
  // Anthropic cache pricing: read 0.1x, 5m write 1.25x, 1h write 2x of input price.
  const costUsd = p ? (inT * p.input + outT * p.output + cacheRead * p.input * 0.1 + cc5 * p.input * 1.25 + cc1 * p.input * 2) / 1e6 : 0;
  return {
    ts: o.timestamp ? Date.parse(o.timestamp) : Date.now(),
    model,
    provider: 'anthropic',
    inputTokens: inT + cacheRead + cc5 + cc1,
    outputTokens: outT,
    costUsd,
    feature: 'claude-code',
    customerId: ctx.project,
  };
}

function parseCodexLine(line: string, ctx: FileCtx): OutEvent | null {
  if (!line.includes('"model"') && !line.includes('token_count') && !line.includes('"cwd"')) return null;
  let o: any;
  try { o = JSON.parse(line); } catch { return null; }
  const pl = o?.payload;
  if (!pl) return null;
  if (typeof pl.model === 'string' && pl.model) ctx.model = pl.model;
  if (typeof pl.cwd === 'string' && pl.cwd) ctx.cwd = basename(pl.cwd);
  if (pl.type !== 'token_count') return null;
  const u = pl.info?.last_token_usage;
  if (!u) return null;
  const inT = u.input_tokens || 0;
  const cached = u.cached_input_tokens || 0;
  const outT = u.output_tokens || 0;
  if (!inT && !outT) return null;
  const model = ctx.model ?? 'gpt-5.5';
  const p = findPrice(model);
  // OpenAI cached input is ~0.1x of input price; cached is a subset of input_tokens.
  const costUsd = p ? Math.max(0, ((inT - cached) * p.input + cached * p.input * 0.1 + outT * p.output) / 1e6) : 0;
  return {
    ts: o.timestamp ? Date.parse(o.timestamp) : Date.now(),
    model,
    provider: 'openai',
    inputTokens: inT,
    outputTokens: outT,
    costUsd,
    feature: 'codex',
    customerId: ctx.cwd,
  };
}

interface Source {
  name: string;
  root: string;
  parse: (line: string, ctx: FileCtx) => OutEvent | null;
  projectFromPath: boolean;
}

const SOURCES: Source[] = [
  { name: 'claude-code', root: join(homedir(), '.claude', 'projects'), parse: parseClaudeLine, projectFromPath: true },
  { name: 'codex', root: join(homedir(), '.codex', 'sessions'), parse: parseCodexLine, projectFromPath: false },
];

function* findJsonl(dir: string): Generator<string> {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* findJsonl(p);
    else if (e.name.endsWith('.jsonl')) yield p;
  }
}

export interface WatchOptions {
  endpoint: string;
  apiKey?: string;
  backfill: boolean;
  once: boolean;
  intervalMs: number;
  statePath?: string;
}

interface WatchState { offsets: Record<string, number>; seen: string[] }

export async function startWatch(opts: WatchOptions): Promise<void> {
  const statePath = opts.statePath ?? join(homedir(), '.tokenwatch', 'watch-state.json');
  mkdirSync(dirname(statePath), { recursive: true });
  let state: WatchState = { offsets: {}, seen: [] };
  if (existsSync(statePath)) {
    try { state = JSON.parse(readFileSync(statePath, 'utf8')); } catch { /* fresh start */ }
  }
  for (const id of state.seen) seen.add(id);
  const ctxByFile = new Map<string, FileCtx>();

  const active = SOURCES.filter((s) => existsSync(s.root));
  if (active.length === 0) {
    console.error('tokenwatch watch: no supported agent logs found (~/.claude/projects, ~/.codex/sessions)');
    return;
  }
  console.log(`watching: ${active.map((s) => s.name).join(', ')}  →  ${opts.endpoint}${opts.backfill ? '  (backfill)' : ''}`);

  const scan = async (): Promise<void> => {
    const events: OutEvent[] = [];
    for (const src of active) {
      for (const file of findJsonl(src.root)) {
        let size: number;
        try { size = statSync(file).size; } catch { continue; }
        let offset = state.offsets[file];
        if (offset === undefined) {
          offset = opts.backfill ? 0 : size;
          state.offsets[file] = offset;
          if (offset === size) continue;
        }
        if (size <= offset) continue;
        let ctx = ctxByFile.get(file);
        if (!ctx) {
          ctx = { project: src.projectFromPath ? relative(src.root, file).split(sep)[0] : undefined };
          ctxByFile.set(file, ctx);
          // When starting mid-file, recover per-file context (model/cwd) from the head.
          if (offset > 0 && src.name === 'codex') {
            try {
              const headFd = openSync(file, 'r');
              const head = Buffer.alloc(Math.min(65536, size));
              readSync(headFd, head, 0, head.length, 0);
              closeSync(headFd);
              for (const l of head.toString('utf8').split('\n').slice(0, 80)) src.parse(l, ctx);
            } catch { /* best effort */ }
          }
        }
        let text: string;
        try {
          const fd = openSync(file, 'r');
          const buf = Buffer.alloc(size - offset);
          readSync(fd, buf, 0, buf.length, offset);
          closeSync(fd);
          text = buf.toString('utf8');
        } catch { continue; }
        const lastNl = text.lastIndexOf('\n');
        if (lastNl === -1) continue;
        for (const line of text.slice(0, lastNl).split('\n')) {
          const ev = src.parse(line, ctx);
          if (ev) events.push(ev);
        }
        state.offsets[file] = offset + Buffer.byteLength(text.slice(0, lastNl + 1), 'utf8');
      }
    }
    if (events.length > 0) {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
      for (let i = 0; i < events.length; i += 500) {
        const res = await fetch(`${opts.endpoint}/v1/events`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ events: events.slice(i, i + 500) }),
        });
        if (!res.ok) throw new Error(`ingest failed: HTTP ${res.status}`);
      }
      const total = events.reduce((s, e) => s + e.costUsd, 0);
      console.log(`+${events.length} events ($${total.toFixed(2)} API-value) ingested`);
    }
    state.seen = [...seen].slice(-20000);
    writeFileSync(statePath, JSON.stringify(state));
  };

  await scan();
  if (!opts.once) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await new Promise((r) => setTimeout(r, opts.intervalMs));
      await scan().catch((err) => console.error('tokenwatch watch:', err?.message ?? err));
    }
  }
}
