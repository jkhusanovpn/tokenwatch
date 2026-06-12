# Шпаргалка для ответов на комментарии (HN/Reddit/X)

Формат: вопрос → суть по-русски → готовый ответ по-английски. Отвечайте своими словами, можно короче — честность и скорость важнее полировки. Признавать «good point, will fix» — лучший ответ на справедливую критику.

---

**1. «Чем это отличается от Langfuse/LiteLLM/Datadog?»**
Суть: мы не конкурируем с трейсингом — мы про деньги и простоту.
> Different job. Langfuse is great for tracing/debugging at team scale — but self-hosting it means ClickHouse+Postgres+Redis+S3. TokenWatch answers a narrower question (where does the money go, per feature/customer) with one process and a SQLite file. If you live in traces, use Langfuse. If you just want cost attribution + a budget kill-switch, that's us.

**2. «Без прокси вы не видите тела запросов — это же минус?»**
Суть: осознанный трейдофф, надёжность дороже.
> Deliberate tradeoff. A proxy sees more but becomes a point of failure in your request path — when your monitoring is down, your product is down. We take the SDK-wrapper path: calls go straight to the provider, telemetry ships async. You lose request bodies, you keep reliability. For debugging bodies, use provider logs or a tracing tool.

**3. «Kill-switch как исключение — спорная эргономика, почему не лимит на стороне провайдера?»**
Суть: провайдерские лимиты грубые (на весь аккаунт), наш — точечный.
> Provider budgets are account-wide and mostly alert-only. The exception gives you a programmable stop at the app layer: catch BudgetExceededError, degrade gracefully (smaller model, cached answer, "try later"). Fail-open by design: if the TokenWatch server is down, calls pass through — monitoring should never take your app down.

**4. «Стриминг через tee() — а если пользователь не дочитает поток?»**
Суть: знаем, краевой случай, в роадмапе.
> Good catch — if the consumer abandons the stream early, the mirrored branch may also not complete; we then record what usage arrived (or nothing). Known limitation of v0.1, on the roadmap. PRs welcome.

**5. «Цены моделей захардкожены — они же меняются каждый месяц»**
Суть: таблица переопределяемая, признаём боль.
> True, and it's the eternal pain of this category. The table ships with June-2026 prices, registerPricing() overrides anything, and unknown models are tracked at $0 (visible, flagged) rather than guessed. Auto-updating pricing from a registry is on the roadmap.

**6. «SQLite не масштабируется» / «а что при 1M событий в день?»**
Суть: наша аудитория — соло и малые команды, для них SQLite с запасом.
> For the target user (solo dev / small team) SQLite handles years of events without breaking a sweat — it's WAL-mode, indexed, and a million events is ~100MB. If you're at the scale where SQLite hurts, you're the Langfuse/Datadog customer, and that's fine.

**7. «Почему я должен верить, что вас тоже не купят и не заморозят?»**
Суть: не обещать невозможного, апеллировать к MIT и простоте.
> You shouldn't trust promises — Helicone's users had promises too. What you get instead: MIT license, a codebase small enough to read in an evening (~1.5k lines), zero proprietary infrastructure, and your data in a SQLite file you own. Worst case, you fork it and lose nothing.

**8. «Это же обёртка на 500 строк, я такое за вечер напишу»**
Суть: классика HN; соглашаться и улыбаться.
> You probably could! That's kind of the point — it's deliberately small. The value isn't algorithmic novelty, it's that it exists, works, and you don't have to maintain your own version. (Also: half of HN's favorite tools started as "I could write this in a weekend.")

**9. «Built with Claude Code — то есть AI-слоп?»**
Суть: не оправдываться, факты.
> AI wrote a lot of the code; a human chose the architecture, the tradeoffs (no-proxy, fail-open, SQLite), tested everything end-to-end, and ships fixes. Judge the tool by whether it works — clean-room install is one command: npx tokenwatch-sdk serve.

**10. «А Python/Gemini/local models/OpenRouter?»**
Суть: что есть — говорим, чего нет — в роадмап.
> Python SDK is in the box (stdlib-only, zero deps). Gemini/OpenRouter wrappers aren't wrapped yet — track() works for anything today, native wrappers are roadmap. Local models: registerPricing() with your $/token (or $0) gives you latency/error/volume attribution.

---

## Правила поведения в треде
- Отвечать на ВСЁ в первые 3-4 часа, даже на грубое — вежливо и коротко.
- Не спорить дольше двух реплик. «Fair point» — и дальше.
- Не просить апвоты нигде и никогда (бан-механика HN).
- Если вопрос непонятен — кидайте мне, разберём вместе.
