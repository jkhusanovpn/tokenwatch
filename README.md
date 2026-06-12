# TokenWatch

**Know where your LLM money goes.** Zero-config cost & quality monitor for indie AI builders: one-line SDK, local dashboard, per-feature/per-customer attribution, and a budget kill-switch so an agent loop can never surprise you with a 5-figure bill.

- No proxy in your request path — your calls go straight to the provider, telemetry is sent async on the side
- Single process, SQLite, zero native dependencies — `npx tokenwatch serve` and you're done
- Flat and simple, built for solo devs and small teams (not another per-seat enterprise platform)

## Quickstart

```bash
# 1. Start the server + dashboard (http://localhost:4318)
npx tokenwatch serve

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

## Status / roadmap

v0.1 (MVP): TS + Python SDKs (OpenAI + Anthropic wrappers), streaming usage capture (TS), local server + dashboard, budgets, webhook alerts, kill-switch.

Next: Python streaming capture, cost regression alerts (per-feature spike detection), hosted version, quality evals.
