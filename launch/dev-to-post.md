# Helicone is in maintenance mode. So I built the lightweight alternative I wanted.

*(dev.to draft — tags: #ai #opensource #llm #observability)*

If you were using Helicone to track your LLM costs, you've probably seen the news: after the Mintlify acquisition in March, it's officially in **maintenance mode**. Feature development has stopped. 16,000+ organizations are quietly looking around. Langfuse — the other indie-friendly option — was acquired by ClickHouse in January, and self-hosting it means running ClickHouse + Postgres + Redis + S3. To look at your own API bill.

Meanwhile the problem is getting worse, not better. We're all running agents now, and agents have a special talent: an uncapped recursive loop can turn a $4k/month budget into an $11.2k bill in three weeks ([real story](https://dodopayments.com/blogs/price-ai-wrapper)). The provider dashboards tell you *what* you spent. Not *where*, not *which feature*, not *which customer*.

So I built **TokenWatch** — the tool I wanted as a solo AI builder:

```bash
npx tokenwatch-sdk serve   # dashboard on localhost:4318. That's the whole setup.
```

```ts
import { wrapAnthropic, init } from 'tokenwatch-sdk';

const claude = wrapAnthropic(new Anthropic(), { feature: 'summarize', customerId: 'acme' });
init({ enforceBudget: true });
```

Every call — streaming included — is now tracked: model, tokens, cost, latency, errors, attributed to features and customers.

## Design decisions (a.k.a. my complaints about the incumbents)

**1. No proxy in your request path.** Your calls go straight to OpenAI/Anthropic; telemetry ships async on the side. A monitoring tool should never be the reason your product is down.

**2. One process, SQLite, zero native deps.** It uses Node's built-in `node:sqlite`. No Docker compose with four services. Your usage data stays on your machine.

**3. A budget kill-switch, not just a budget chart.** Set a monthly budget: at 80% your webhook fires, at 100% wrapped calls throw `BudgetExceededError` instead of spending more. Watching a dashboard doesn't stop an agent loop at 3am — an exception does.

**4. Margin attribution, not traces.** Tracing UIs are built for debugging. Most of the time I have a simpler question: *which feature is losing money and which customer is profitable?* Cost by feature and by customer is the default view, not a saved query.

**5. Python SDK with literally zero dependencies.** Standard library only. `wrap_openai(client)` and you're done.

## What it's not

It's not a tracing platform, it's not an eval suite, and it won't replace Langfuse for a 50-person team that lives in traces. It's the 80% tool for the solo builder and small team: where is the money going, is quality degrading, and stop the bleeding automatically.

It's MIT-licensed and v0.1 — built in public, partly *with* AI agents (Claude Code wrote a lot of it, which felt appropriately recursive for a tool that monitors AI spend). Feedback, issues, and brutal honesty welcome.

**GitHub:** https://github.com/jkhusanovpn/tokenwatch

*What's your current setup for tracking LLM costs — and has an agent ever surprised you with a bill?*
