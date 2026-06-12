/**
 * `tokenwatch mcp` — MCP server (stdio) exposing TokenWatch data to AI agents.
 * Hand-rolled JSON-RPC over newline-delimited stdio: zero extra dependencies.
 * Reads/writes the same SQLite database as `tokenwatch serve` (WAL — safe concurrently).
 */
import { createInterface } from 'node:readline';
import { createRequire } from 'node:module';
import { SCHEMA } from './schema.js';
import { computeCostUsd } from './pricing.js';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const TOOLS = [
  {
    name: 'get_spend_summary',
    description:
      'Summarize LLM spend recorded by TokenWatch: total cost/calls/tokens plus cost broken down by model, feature, and customer. Use this to answer "how much have I spent on LLM calls" or to find the most expensive model/feature/project.',
    inputSchema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Lookback window in days (default 30, max 365)' },
      },
    },
  },
  {
    name: 'check_budget',
    description:
      'Check the monthly LLM budget before starting expensive LLM work: spent this month (USD), budget, percent used, and blocked (true = budget exhausted, kill-switch active, wrapped SDK calls will throw). If percent used is high, warn the user before proceeding.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'track_usage',
    description:
      'Record one LLM call into TokenWatch (model, token counts, optional feature/customer tags). Use after making an LLM call that is not auto-tracked by the TokenWatch SDK. Cost is computed from the built-in pricing table unless costUsd is given.',
    inputSchema: {
      type: 'object',
      required: ['model', 'inputTokens', 'outputTokens'],
      properties: {
        model: { type: 'string', description: 'Model id, e.g. claude-fable-5, gpt-5.5' },
        inputTokens: { type: 'number' },
        outputTokens: { type: 'number' },
        feature: { type: 'string', description: 'What the call was for, e.g. "summarize"' },
        customerId: { type: 'string', description: 'Tenant/project attribution' },
        costUsd: { type: 'number', description: 'Override the computed cost (USD)' },
      },
    },
  },
];

export function runMcp(dbPath: string, version: string): void {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);

  const startOfMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
  };
  const round = (v: number) => Math.round(v * 10000) / 10000;

  function spendSummary(days: number) {
    const since = Date.now() - Math.max(1, Math.min(365, days || 30)) * 86_400_000;
    const totals = db
      .prepare(
        `SELECT COALESCE(SUM(cost_usd),0) AS costUsd, COUNT(*) AS calls,
                COALESCE(SUM(input_tokens+output_tokens),0) AS tokens,
                COALESCE(SUM(status='error'),0) AS errors
         FROM events WHERE ts >= ?`
      )
      .get(since) as Record<string, number>;
    const group = (col: string) =>
      (db
        .prepare(
          `SELECT COALESCE(${col},'(untagged)') AS name, SUM(cost_usd) AS costUsd, COUNT(*) AS calls
           FROM events WHERE ts >= ? GROUP BY name ORDER BY costUsd DESC LIMIT 10`
        )
        .all(since) as Array<{ name: string; costUsd: number; calls: number }>)
        .map((r) => ({ ...r, costUsd: round(r.costUsd) }));
    return {
      periodDays: days || 30,
      totalCostUsd: round(totals.costUsd),
      calls: totals.calls,
      tokens: totals.tokens,
      errors: totals.errors,
      byModel: group('model'),
      byFeature: group('feature'),
      byCustomer: group('customer_id'),
    };
  }

  function checkBudget() {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('monthlyBudgetUsd') as { value: string } | undefined;
    const budgetUsd = row?.value ? Number(row.value) : null;
    const spent = (db.prepare('SELECT COALESCE(SUM(cost_usd),0) AS t FROM events WHERE ts >= ?').get(startOfMonth()) as { t: number }).t;
    return {
      spentMonthUsd: round(spent),
      budgetUsd,
      percentUsed: budgetUsd ? Math.round((spent / budgetUsd) * 100) : null,
      blocked: budgetUsd != null && budgetUsd > 0 && spent >= budgetUsd,
    };
  }

  function trackUsage(a: any) {
    if (typeof a?.model !== 'string' || typeof a?.inputTokens !== 'number' || typeof a?.outputTokens !== 'number') {
      throw new Error('track_usage requires model (string), inputTokens (number), outputTokens (number)');
    }
    const cost = typeof a.costUsd === 'number' ? a.costUsd : computeCostUsd(a.model, a.inputTokens, a.outputTokens);
    db.prepare(
      `INSERT INTO events (ts, model, input_tokens, output_tokens, cost_usd, feature, customer_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ok')`
    ).run(Date.now(), a.model, a.inputTokens, a.outputTokens, cost, a.feature ?? null, a.customerId ?? null);
    return { ok: true, costUsd: round(cost) };
  }

  function callTool(name: string, args: any) {
    let result: unknown;
    if (name === 'get_spend_summary') result = spendSummary(Number(args?.days) || 30);
    else if (name === 'check_budget') result = checkBudget();
    else if (name === 'track_usage') result = trackUsage(args);
    else throw new Error(`Unknown tool: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 1) }] };
  }

  function handle(method: string, params: any): unknown {
    switch (method) {
      case 'initialize':
        return {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'tokenwatch', version },
        };
      case 'ping':
        return {};
      case 'tools/list':
        return { tools: TOOLS };
      case 'tools/call':
        return callTool(params?.name, params?.arguments ?? {});
      default: {
        const err: any = new Error(`Method not found: ${method}`);
        err.rpcCode = -32601;
        throw err;
      }
    }
  }

  const write = (obj: unknown) => process.stdout.write(JSON.stringify(obj) + '\n');
  const rl = createInterface({ input: process.stdin });
  rl.on('line', (raw) => {
    const line = raw.trim();
    if (!line) return;
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.id === undefined || msg.id === null) return; // notification — no response
    try {
      write({ jsonrpc: '2.0', id: msg.id, result: handle(msg.method, msg.params) });
    } catch (err: any) {
      write({ jsonrpc: '2.0', id: msg.id, error: { code: err?.rpcCode ?? -32603, message: String(err?.message ?? err) } });
    }
  });
  console.error(`tokenwatch mcp: ready (db: ${dbPath})`); // stderr — stdout is the protocol channel
}
