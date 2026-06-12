# X/Twitter launch thread draft

**1/**
Helicone: maintenance mode (acquired).
Langfuse: needs ClickHouse+Postgres+Redis+S3 to self-host (acquired too).

Indie AI builders lost both lightweight options for "where is my LLM money going" in 3 months.

So I built TokenWatch. One process. SQLite. MIT.

**2/**
The problem it solves is real:

→ provider dashboards show WHAT you spent, not WHERE
→ agents + uncapped loops = $4k budgets turning into $11.2k bills
→ nobody can tell which feature loses money and which customer is profitable

**3/**
Setup is the whole pitch:

npx tokenwatch-sdk serve

…and one line in your code:

const claude = wrapAnthropic(new Anthropic(), { feature: 'chat', customerId: 'acme' })

Every call tracked: cost, tokens, latency, errors. By feature. By customer. Streaming included.

**4/**
My favorite part: the budget kill-switch.

Set a monthly budget →
80%: webhook fires
100%: calls throw BudgetExceededError instead of spending

A dashboard doesn't stop an agent loop at 3am. An exception does.

**5/**
Design choices:
🚫 no proxy in your request path (monitoring ≠ point of failure)
📦 node:sqlite, zero native deps
🐍 Python SDK = stdlib only, zero dependencies
🔓 MIT, local-first, your data stays yours

**6/**
It's v0.1 and I'm building in public. A lot of it was written with Claude Code — an AI agent helping build the tool that stops AI agents from overspending. Felt right.

Star it, break it, tell me what's missing:
https://github.com/jkhusanovpn/tokenwatch
