/** Verifies streaming usage capture via stream.tee() against a running server. */
import { wrapAnthropic, flush, init } from '../src/sdk.js';

init({ endpoint: process.env.TOKENWATCH_URL ?? 'http://localhost:4318' });

function makeStream(events: any[]): any {
  const gen = (async function* () {
    for (const e of events) yield e;
  })();
  const stream: any = gen;
  stream.tee = () => [makeStream(events), makeStream(events)];
  return stream;
}

// Anthropic-shaped stream events: input usage in message_start, cumulative output in message_delta.
const events = [
  { type: 'message_start', message: { model: 'claude-fable-5', usage: { input_tokens: 500, output_tokens: 1 } } },
  { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } },
  { type: 'message_delta', usage: { output_tokens: 80 } },
];

const fake = { messages: { create: async (_p: any) => makeStream(events) } };
const client = wrapAnthropic(fake as any, { feature: 'stream-test', customerId: 'test-cust' });

const stream = await client.messages.create({ model: 'claude-fable-5', stream: true, max_tokens: 100, messages: [] });
let received = 0;
for await (const _ of stream) received++;
if (received !== 3) throw new Error(`consumer got ${received}/3 events — tee broke the user-facing stream`);

await new Promise((r) => setTimeout(r, 200)); // let the background consumer finish
await flush();

const stats = (await (await fetch('http://localhost:4318/v1/stats?days=1')).json()) as any;
const ev = stats.recent.find((r: any) => r.feature === 'stream-test');
console.log('captured:', JSON.stringify(ev));
if (!ev || ev.inputTokens !== 500 || ev.outputTokens !== 80) throw new Error('streaming usage not captured correctly');
const expectedCost = (500 * 10 + 80 * 50) / 1_000_000;
if (Math.abs(ev.costUsd - expectedCost) > 1e-9) throw new Error(`cost ${ev.costUsd} != expected ${expectedCost}`);
console.log('Streaming test PASSED');
