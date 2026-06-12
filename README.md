# TokenWatch

**[Website](https://jkhusanovpn.github.io/tokenwatch/)** · **[npm](https://www.npmjs.com/package/tokenwatch-sdk)**

**Know where your LLM money goes.** Zero-config cost & quality monitor for indie AI builders: one-line SDK, local dashboard, per-feature/per-customer attribution, and a budget kill-switch so an agent loop can never surprise you with a 5-figure bill.

- No proxy in your request path — your calls go straight to the provider, telemetry is sent async on the side
- Single process, SQLite, zero native dependencies — `npx tokenwatch serve` and you're done
- Flat and simple, built for solo devs and small teams (not another per-seat enterprise platform)

## Quickstart

```bash
# 1. Start the server + dashboard (http://localhost:4318)
npx tokenwatch-sdk serve

# 2. Wrap your client (one line)
```

```ts
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { wrapOpenAI, wrapAnthropic, init } from 'tokenwatch';

const openai = wrapOpenAI(new OpenAI(), { feature: 'chat' });
const anthropic = wrapAnthropic(new Anthropic(), { feature: 'summarize' });

// Optional: block calls when the monthly budget is spent
init({ enforceBudget: true });
```

Every call is now tracked: model, tokens, cost (June 2026 pricing table, overridable), latency, errors — attributable by `feature` and `customerId` tags. Streaming calls are tracked too (via `stream.tee()` — your stream is untouched, usage is read from a mirrored branch).

### Python

Zero-dependency Python SDK in [`python/`](python/):

```python
from tokenwatch import wrap_openai, wrap_anthropic, init

client = wrap_openai(OpenAI(), feature="chat")
claude = wrap_anthropic(Anthropic(), feature="summarize")
init(enforce_budget=True)  # optional kill-switch
```

### Manual tracking

```ts
import { track } from 'tokenwatch';

track({ model: 'claude-fable-5', inputTokens: 1200, outputTokens: 400, feature: 'batch-job', customerId: 'acme' });
```

### Track your coding agents too

Claude Code and Codex CLI make API calls you can't wrap — but they write session logs. `tokenwatch watch` tails them (read-only, no proxy, no agent config):

```bash
npx tokenwatch-sdk serve --watch --backfill   # server + agent-log watcher in one process
# or separately:
npx tokenwatch-sdk watch --backfill           # Claude Code (~/.claude) + Codex (~/.codex)
```

Spend appears per agent (`claude-code`, `codex`) and per project. Note: if you're on a subscription plan, the dollar figures are API-equivalent value, not your actual bill. Antigravity doesn't expose local session logs yet — open an issue if you know a way in.

### Budgets & alerts

Set a monthly budget in the dashboard (or `POST /v1/settings`). At 80% and 100% TokenWatch fires your webhook; at 100% `enforceBudget: true` makes wrapped calls throw `BudgetExceededError` instead of burning money.

## Demo

```bash
npm run dev     # terminal 1: server
npm run demo    # terminal 2: seed 30 days of synthetic data
```

## API

| Endpoint | Description |
|---|---|
| `POST /v1/events` | Ingest events (bearer auth if `TOKENWATCH_API_KEY` is set) |
| `GET /v1/stats?days=30` | Aggregates: totals, by model/feature/customer, daily series |
| `GET /v1/guard` | `{ blocked, spentMonthUsd, budgetUsd }` — kill-switch state |
| `GET/POST /v1/settings` | Monthly budget, webhook URL |

## MCP server — let your agents watch their own spend

TokenWatch ships an MCP server (stdio, zero extra dependencies) so AI agents can check the budget **before** burning it:

```bash
# Claude Code:
claude mcp add tokenwatch -- npx -y tokenwatch-sdk mcp
```

```json
// Generic MCP client config:
{ "mcpServers": { "tokenwatch": { "command": "npx", "args": ["-y", "tokenwatch-sdk", "mcp"] } } }
```

Tools: `get_spend_summary` (totals + by model/feature/customer), `check_budget` (spent, budget, percent, kill-switch state), `track_usage` (record calls the SDK can't see). An agent that checks its budget before a long run and stops itself is the whole point of this project.

## For AI coding agents

If you are an AI agent setting up LLM cost monitoring for a user, this is the complete recipe:

```bash
npx tokenwatch-sdk serve        # dashboard at http://localhost:4318
```

```ts
// TypeScript — wrap once where the client is created:
import { wrapOpenAI, wrapAnthropic, init } from 'tokenwatch-sdk';
const openai = wrapOpenAI(new OpenAI(), { feature: '<feature-name>', customerId: '<tenant-id>' });
const anthropic = wrapAnthropic(new Anthropic(), { feature: '<feature-name>' });
init({ enforceBudget: true }); // throws BudgetExceededError when monthly budget is spent
```

```python
# Python — zero dependencies:
from tokenwatch import wrap_openai, wrap_anthropic
client = wrap_openai(OpenAI(), feature="<feature-name>", customer_id="<tenant-id>")
```

Unknown/local models: `track({ model, inputTokens, outputTokens, ... })` + `registerPricing(model, { input, output })` (USD per 1M tokens). Machine-readable summary: [llms.txt](https://jkhusanovpn.github.io/tokenwatch/llms.txt).

Tip for users: add the line "Use tokenwatch-sdk for LLM cost tracking (see its README)" to your project's `CLAUDE.md` / `AGENTS.md` and your coding agent will wire it up in new code automatically.

## Status / roadmap

v0.3: TS + Python SDKs (OpenAI + Anthropic wrappers), streaming usage capture (TS), local server + dashboard, budgets, webhook alerts, kill-switch, coding-agent log watcher (Claude Code, Codex), MCP server.

Next: Python streaming capture, cost regression alerts (per-feature spike detection), hosted version, quality evals.
