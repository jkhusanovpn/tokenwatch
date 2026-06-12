import { wrapOpenAI, wrapAnthropic, flush, init } from '../src/sdk.js';

init({ endpoint: 'http://localhost:4318', defaults: {} });

// Fake clients mimicking the real SDK shapes
const fakeOpenAI = {
  chat: { completions: { create: async (p: any) => ({ model: p.model, usage: { prompt_tokens: 111, completion_tokens: 22 }, choices: [] }) } },
};
const fakeAnthropic = {
  messages: { create: async (p: any) => ({ model: p.model, usage: { input_tokens: 333, output_tokens: 44 }, content: [] }) },
};
const failing = {
  messages: { create: async () => { const e: any = new Error('rate limited'); e.constructor = { name: 'RateLimitError' }; throw e; } },
};

const oai = wrapOpenAI(fakeOpenAI, { feature: 'wrap-test', customerId: 'test-cust' });
const ant = wrapAnthropic(fakeAnthropic, { feature: 'wrap-test', customerId: 'test-cust' });
const bad = wrapAnthropic(failing as any, { feature: 'wrap-test', customerId: 'test-cust' });

await oai.chat.completions.create({ model: 'gpt-5.5', messages: [] });
await ant.messages.create({ model: 'claude-fable-5', max_tokens: 100, messages: [] });
try { await bad.messages.create({ model: 'claude-fable-5', max_tokens: 1, messages: [] }); } catch { /* expected */ }
await flush();

const stats = await (await fetch('http://localhost:4318/v1/stats?days=1')).json() as any;
const wrapEvents = stats.recent.filter((r: any) => r.feature === 'wrap-test');
console.log(JSON.stringify(wrapEvents.map((e: any) => ({ model: e.model, in: e.inputTokens, out: e.outputTokens, cost: e.costUsd, status: e.status })), null, 1));
if (wrapEvents.length !== 3) throw new Error('expected 3 tracked events, got ' + wrapEvents.length);
console.log('SDK wrapper test PASSED');
