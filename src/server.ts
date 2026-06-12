import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { createRequire } from 'node:module';
import { computeCostUsd } from './pricing.js';
import { dashboardHtml } from './dashboard.js';

// Lazy-require node:sqlite so its ExperimentalWarning fires after our suppressor
// (static `import 'node:sqlite'` emits the warning during module linking).
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  model TEXT NOT NULL,
  provider TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER,
  feature TEXT,
  customer_id TEXT,
  status TEXT NOT NULL DEFAULT 'ok',
  error_type TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

interface IncomingEvent {
  ts?: number;
  model?: string;
  provider?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs?: number;
  feature?: string;
  customerId?: string;
  status?: string;
  errorType?: string;
}

export function createApp(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const insertStmt = db.prepare(
    `INSERT INTO events (ts, model, provider, input_tokens, output_tokens, cost_usd, latency_ms, feature, customer_id, status, error_type)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  const getSetting = (key: string): string | null => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row?.value ?? null;
  };
  const setSetting = (key: string, value: string) =>
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);

  const startOfMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };

  const monthSpend = (): number => {
    const row = db.prepare('SELECT COALESCE(SUM(cost_usd), 0) AS total FROM events WHERE ts >= ?').get(startOfMonth()) as { total: number };
    return row.total;
  };

  const budgetUsd = (): number | null => {
    const v = getSetting('monthlyBudgetUsd');
    return v ? Number(v) : null;
  };

  function maybeFireBudgetAlerts(): void {
    const budget = budgetUsd();
    const webhook = getSetting('webhookUrl');
    if (!budget || !webhook) return;
    const spent = monthSpend();
    const monthKey = new Date().toISOString().slice(0, 7);
    for (const threshold of [0.8, 1.0]) {
      if (spent < budget * threshold) continue;
      const alertKey = `alerted_${threshold}_${monthKey}`;
      if (getSetting(alertKey)) continue;
      setSetting(alertKey, String(Date.now()));
      fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'tokenwatch',
          alert: threshold >= 1.0 ? 'budget_exceeded' : 'budget_80_percent',
          spentUsd: Number(spent.toFixed(4)),
          budgetUsd: budget,
          month: monthKey,
        }),
      }).catch(() => {});
    }
  }

  const app = new Hono();

  // Optional bearer auth for ingestion when TOKENWATCH_API_KEY is set.
  app.use('/v1/events', async (c, next) => {
    const required = process.env.TOKENWATCH_API_KEY;
    if (required && c.req.header('authorization') !== `Bearer ${required}`) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    await next();
  });

  app.post('/v1/events', async (c) => {
    const body = await c.req.json<{ events?: IncomingEvent[] }>().catch(() => null);
    if (!body?.events || !Array.isArray(body.events)) {
      return c.json({ error: 'expected { events: [...] }' }, 400);
    }
    db.exec('BEGIN');
    try {
      for (const e of body.events) {
        if (!e || typeof e.model !== 'string') continue;
        const inputTokens = Number(e.inputTokens) || 0;
        const outputTokens = Number(e.outputTokens) || 0;
        insertStmt.run(
          Number(e.ts) || Date.now(),
          e.model,
          e.provider ?? null,
          inputTokens,
          outputTokens,
          typeof e.costUsd === 'number' ? e.costUsd : computeCostUsd(e.model, inputTokens, outputTokens),
          e.latencyMs != null ? Number(e.latencyMs) : null,
          e.feature ?? null,
          e.customerId ?? null,
          e.status === 'error' ? 'error' : 'ok',
          e.errorType ?? null
        );
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    maybeFireBudgetAlerts();
    return c.json({ ok: true, ingested: body.events.length });
  });

  app.get('/v1/stats', (c) => {
    const days = Math.max(1, Math.min(365, Number(c.req.query('days')) || 30));
    const since = Date.now() - days * 86_400_000;

    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd),0) AS costUsd, COUNT(*) AS calls,
                COALESCE(SUM(input_tokens),0) AS inputTokens, COALESCE(SUM(output_tokens),0) AS outputTokens,
                AVG(latency_ms) AS avgLatencyMs, COALESCE(SUM(status = 'error'),0) AS errors
         FROM events WHERE ts >= ?`
      )
      .get(since) as Record<string, number>;

    const groupBy = (col: string) =>
      db
        .prepare(
          `SELECT COALESCE(${col}, '(untagged)') AS name, SUM(cost_usd) AS costUsd, COUNT(*) AS calls,
                  SUM(input_tokens + output_tokens) AS tokens
           FROM events WHERE ts >= ? GROUP BY name ORDER BY costUsd DESC LIMIT 25`
        )
        .all(since);

    const daily = db
      .prepare(
        `SELECT date(ts / 1000, 'unixepoch') AS day, SUM(cost_usd) AS costUsd, COUNT(*) AS calls
         FROM events WHERE ts >= ? GROUP BY day ORDER BY day`
      )
      .all(since);

    const recent = db
      .prepare(
        `SELECT ts, model, provider, input_tokens AS inputTokens, output_tokens AS outputTokens,
                cost_usd AS costUsd, latency_ms AS latencyMs, feature, customer_id AS customerId, status, error_type AS errorType
         FROM events ORDER BY ts DESC LIMIT 50`
      )
      .all();

    return c.json({
      periodDays: days,
      totals,
      byModel: groupBy('model'),
      byFeature: groupBy('feature'),
      byCustomer: groupBy('customer_id'),
      daily,
      recent,
      month: { spentUsd: monthSpend(), budgetUsd: budgetUsd() },
    });
  });

  app.get('/v1/guard', (c) => {
    const budget = budgetUsd();
    const spent = monthSpend();
    return c.json({
      blocked: budget != null && budget > 0 && spent >= budget,
      spentMonthUsd: spent,
      budgetUsd: budget,
    });
  });

  app.get('/v1/settings', (c) =>
    c.json({ monthlyBudgetUsd: budgetUsd(), webhookUrl: getSetting('webhookUrl') })
  );

  app.post('/v1/settings', async (c) => {
    const body = await c.req.json<{ monthlyBudgetUsd?: number | null; webhookUrl?: string | null }>().catch(() => null);
    if (!body) return c.json({ error: 'invalid json' }, 400);
    if ('monthlyBudgetUsd' in body) setSetting('monthlyBudgetUsd', body.monthlyBudgetUsd ? String(body.monthlyBudgetUsd) : '');
    if ('webhookUrl' in body) setSetting('webhookUrl', body.webhookUrl ?? '');
    return c.json({ ok: true });
  });

  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/', (c) => c.html(dashboardHtml));

  return { app, db };
}

export function startServer(opts: { port: number; dbPath: string }) {
  const { app } = createApp(opts.dbPath);
  const server = serve({ fetch: app.fetch, port: opts.port });
  (server as any).on?.('error', (err: NodeJS.ErrnoException) => {
    if (err?.code === 'EADDRINUSE') {
      console.error(
        `\nTokenWatch: port ${opts.port} is already in use.\n` +
          `Probably another TokenWatch is running — open http://localhost:${opts.port} to check,\n` +
          `or start on a different port:  tokenwatch serve --port ${opts.port + 1}\n`
      );
      process.exit(1);
    }
    throw err;
  });
  console.log(`TokenWatch running → http://localhost:${opts.port}  (db: ${opts.dbPath})`);
  return server;
}
