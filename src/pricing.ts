/**
 * USD per 1M tokens. Prices as of June 2026 — verify against provider pricing
 * pages before relying on exact numbers; override via registerPricing().
 */
export interface ModelPrice {
  input: number;
  output: number;
}

const PRICING: Record<string, ModelPrice> = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 },
  'gpt-5.5-pro': { input: 30, output: 180 },
  'gpt-5.5': { input: 5, output: 30 },
  'gpt-5.4': { input: 5, output: 30 },
  'gpt-5.3': { input: 5, output: 30 },
  'gemini-3.5-flash': { input: 1.5, output: 9 },
  'gemini-3.1-pro': { input: 2, output: 12 },
  'grok-4.3': { input: 1.25, output: 2.5 },
  'deepseek-v4': { input: 0.3, output: 0.87 },
  'glm-5': { input: 0.6, output: 1.92 },
  'kimi-k2.6': { input: 0.6, output: 2.5 },
};

let keysByLength = Object.keys(PRICING).sort((a, b) => b.length - a.length);

/** Add or override pricing for a model (substring match against the model id). */
export function registerPricing(model: string, price: ModelPrice): void {
  PRICING[model.toLowerCase()] = price;
  keysByLength = Object.keys(PRICING).sort((a, b) => b.length - a.length);
}

export function findPrice(model: string): ModelPrice | undefined {
  const m = model.toLowerCase();
  const key = keysByLength.find((k) => m.includes(k));
  return key ? PRICING[key] : undefined;
}

/** True when the model is in the pricing table (so its cost is real, not a silent $0). */
export function isPriced(model: string): boolean {
  return findPrice(model) !== undefined;
}

/** Returns cost in USD, or 0 if the model is unknown (track it anyway). */
export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = findPrice(model);
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}
