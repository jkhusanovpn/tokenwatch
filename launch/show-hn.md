# Show HN draft

**Title:** Show HN: TokenWatch – LLM cost monitor with a budget kill-switch (one process, SQLite)

**Text:**

I'm a solo builder, and after Helicone went into maintenance mode (post-acquisition) and Langfuse's self-host grew to ClickHouse+Postgres+Redis+S3, I wanted something simpler for one question: where is my LLM money going, per feature and per customer — and how do I make an agent loop physically unable to overspend?

TokenWatch is `npx tokenwatch-sdk serve` (one process, Node's built-in SQLite) plus a one-line client wrapper for OpenAI/Anthropic in TS or Python (the Python SDK is stdlib-only). No proxy in the request path — telemetry ships async. Set a monthly budget: 80% fires a webhook, 100% makes wrapped calls throw BudgetExceededError instead of spending.

v0.1, MIT. The pricing table covers June-2026 models and is overridable. Streaming usage is captured via stream.tee() so your stream is untouched.

Things I'd love feedback on: the no-proxy tradeoff (you lose request bodies, keep reliability), whether kill-switch-as-exception is the right ergonomics, and what "quality regression" detection should look like for a tool this small.

https://github.com/jkhusanovpn/tokenwatch

---

*Notes for posting: submit 14:00-16:00 UTC on a weekday (Tue-Thu best); stay in the thread for the first 3-4 hours and answer everything; don't ask for upvotes anywhere (HN detects voting rings).*
