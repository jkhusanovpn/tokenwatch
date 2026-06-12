# Reddit drafts

## r/LocalLLaMA

**Title:** I built a one-process LLM cost monitor after Helicone went into maintenance mode (SQLite, no proxy, MIT)

**Text:**

Like a lot of you I just want to know where my API money goes per feature/customer without standing up ClickHouse+Postgres+Redis+S3 (Langfuse self-host) or betting on another VC tool that gets acquired and frozen (RIP Helicone).

So: TokenWatch. `npx tokenwatch-sdk serve` → dashboard on localhost, SQLite file, done. One-line wrapper for OpenAI/Anthropic clients (TS or Python — the Python SDK is stdlib-only, zero deps). No proxy in the request path, telemetry ships async. Custom/local models work via `registerPricing()` + manual `track()` — if you're running vLLM/llama.cpp you can track at $0 and still get latency/error/volume attribution.

The feature I actually built it for: monthly budget with a kill-switch. 80% → webhook, 100% → wrapped calls throw instead of spending. Agent loops can't out-spend you while you sleep.

MIT, v0.1, local-first. Would love feedback from people tracking local + API hybrid setups: https://github.com/jkhusanovpn/tokenwatch

---

## r/SideProject

**Title:** Validated a niche on Tuesday, shipped to npm on Thursday — TokenWatch, an LLM cost monitor with a budget kill-switch

**Text:**

The niche found me: both indie-friendly LLM observability tools got acquired this year — Helicone is now in maintenance mode (16k+ orgs stranded), Langfuse's self-host needs a 4-service stack. Meanwhile everyone's running AI agents, and agents are great at turning a $4k budget into an $11k bill via one uncapped loop.

Before writing code I validated: search demand (the "Helicone alternative" wave is live right now), willingness to pay ($19–79/mo proven by incumbents' pricing), and competition (two other indies already moved in — so I optimized for speed and simplicity).

The product: `npx tokenwatch-sdk serve` + a one-line client wrapper. Cost per feature and per customer, latency, error rates, and a monthly budget that fires a webhook at 80% and hard-blocks calls at 100%.

v0.1 is MIT/open-source; monetization plan is a hosted version later if there's traction. Built largely with AI coding agents, which felt fitting.

GitHub: https://github.com/jkhusanovpn/tokenwatch — brutal feedback welcome, especially on what would make you pay for the cloud version.

---

*Notes: r/LocalLLaMA — лучше в будний день, утро по US; не постить оба сабреддита в один час. Отвечать на каждый комментарий. Не дублировать текст слово в слово между сабреддитами (модераторы видят кросспост-спам).*
