# Reddit drafts

## r/LocalLLaMA

**Title:** I built a one-process LLM cost monitor after Helicone went into maintenance mode (SQLite, no proxy, tracks Claude Code/Codex spend too, MIT)

**Text:**

Like a lot of you I just want to know where my API money goes per feature/customer without standing up ClickHouse+Postgres+Redis+S3 (Langfuse self-host) or betting on another VC tool that gets acquired and frozen (RIP Helicone).

So: TokenWatch. `npx tokenwatch-sdk serve` → dashboard on localhost, SQLite file, done. One-line wrapper for OpenAI/Anthropic clients (TS or Python — the Python SDK is stdlib-only, zero deps). No proxy in the request path, telemetry ships async.

Three things this crowd might care about specifically:
- **It tracks your coding agents.** `tokenwatch watch` tails Claude Code (~/.claude) and Codex (~/.codex) session logs read-only — backfilling my own history surfaced ~$900 of agent spend I had zero visibility into.
- **Local models are first-class.** Drop a `~/.tokenwatch/pricing.json` with your own $/token (or $0 for local) — vLLM/llama.cpp/Ollama runs still get latency/error/volume attribution, and unknown models are flagged instead of silently counted as $0.
- **Budget kill-switch.** Monthly budget → 80% fires a webhook, 100% makes wrapped calls throw instead of spending. Agent loops can't out-spend you while you sleep. There's also an MCP server so an agent can check its own budget before a long run.

MIT, local-first, prices auto-refresh from a static JSON (no reinstall). Would love feedback from people running local + API hybrid setups: https://github.com/jkhusanovpn/tokenwatch

---

## r/SideProject

**Title:** Validated a niche on Tuesday, shipped to npm on Thursday — TokenWatch, an LLM cost monitor with a budget kill-switch

**Text:**

The niche found me: both indie-friendly LLM observability tools got acquired this year — Helicone is now in maintenance mode (16k+ orgs stranded), Langfuse's self-host needs a 4-service stack. Meanwhile everyone's running AI agents, and agents are great at turning a $4k budget into an $11k bill via one uncapped loop.

Before writing code I validated: search demand (the "Helicone alternative" wave is live right now), willingness to pay ($19–79/mo proven by incumbents' pricing), and competition (two other indies already moved in — so I optimized for speed and simplicity).

The product: `npx tokenwatch-sdk serve` + a one-line client wrapper. Cost per feature and per customer, latency, error rates, and a monthly budget that fires a webhook at 80% and hard-blocks calls at 100%. It also tails Claude Code/Codex session logs to track agent spend, and ships an MCP server so an agent can check its own budget before an expensive run.

A week from empty folder to four shipped pieces (SDK, dashboard, agent-log watcher, MCP server) on npm. MIT/open-source; monetization plan is a hosted version later if there's traction. Built largely with AI coding agents, which felt fitting.

GitHub: https://github.com/jkhusanovpn/tokenwatch — brutal feedback welcome, especially on what would make you pay for the cloud version.

---

*Notes: r/LocalLLaMA — лучше в будний день, утро по US; не постить оба сабреддита в один час. Отвечать на каждый комментарий. Не дублировать текст слово в слово между сабреддитами (модераторы видят кросспост-спам).*
