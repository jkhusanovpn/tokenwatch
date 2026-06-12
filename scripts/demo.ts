/**
 * Seeds the local TokenWatch server with 30 days of realistic synthetic events
 * (through the real SDK path), so the dashboard has something to show.
 *
 *   npm run demo
 */
import { init, track, flush } from '../src/sdk.js';

init({ endpoint: process.env.TOKENWATCH_URL ?? 'http://localhost:4318' });

const MODELS = [
  { model: 'claude-fable-5', provider: 'anthropic', weight: 0.15, avgIn: 3200, avgOut: 900 },
  { model: 'claude-opus-4-8', provider: 'anthropic', weight: 0.25, avgIn: 2800, avgOut: 750 },
  { model: 'gpt-5.5', provider: 'openai', weight: 0.25, avgIn: 2500, avgOut: 700 },
  { model: 'gemini-3.5-flash', provider: 'google', weight: 0.2, avgIn: 1800, avgOut: 500 },
  { model: 'deepseek-v4', provider: 'deepseek', weight: 0.15, avgIn: 2000, avgOut: 600 },
];
const FEATURES = ['chat', 'summarize', 'doc-search', 'autotag'];
const CUSTOMERS = ['acme', 'globex', 'initech', 'umbrella', 'stark', 'wayne', 'hooli', 'piedpiper'];

function pickModel() {
  let r = Math.random();
  for (const m of MODELS) {
    if ((r -= m.weight) <= 0) return m;
  }
  return MODELS[0];
}
const jitter = (avg: number) => Math.max(20, Math.round(avg * (0.3 + Math.random() * 1.6)));

const DAYS = 30;
const now = Date.now();
let count = 0;

for (let day = DAYS - 1; day >= 0; day--) {
  // Slight growth trend + weekday variation.
  const dayStart = now - day * 86_400_000;
  const calls = Math.round((25 + (DAYS - day) * 1.5) * (0.7 + Math.random() * 0.6));
  for (let i = 0; i < calls; i++) {
    const m = pickModel();
    const isError = Math.random() < 0.02;
    track({
      ts: dayStart - Math.floor(Math.random() * 86_400_000 * 0.9),
      model: m.model,
      provider: m.provider,
      inputTokens: isError ? 0 : jitter(m.avgIn),
      outputTokens: isError ? 0 : jitter(m.avgOut),
      latencyMs: jitter(isError ? 4000 : 1800),
      feature: FEATURES[Math.floor(Math.random() * FEATURES.length)],
      customerId: CUSTOMERS[Math.floor(Math.random() * CUSTOMERS.length)],
      status: isError ? 'error' : 'ok',
      errorType: isError ? (Math.random() < 0.5 ? 'RateLimitError' : 'APIConnectionError') : undefined,
    });
    count++;
    if (count % 25 === 0) await flush();
  }
}
await flush();
console.log(`Seeded ${count} demo events across ${DAYS} days.`);
