#!/usr/bin/env node
import './suppress-warnings.js';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { startServer } from './server.js';
import { startWatch } from './watch.js';
import { runMcp } from './mcp.js';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const command = wantsHelp ? 'help' : args[0] && !args[0].startsWith('-') ? args[0] : 'serve';

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}
const has = (name: string): boolean => args.includes(`--${name}`);

if (command === 'serve') {
  const port = Number(flag('port') ?? process.env.TOKENWATCH_PORT ?? process.env.PORT ?? 4318);
  const dbPath = flag('db') ?? process.env.TOKENWATCH_DB ?? join(homedir(), '.tokenwatch', 'tokenwatch.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  startServer({ port, dbPath });
  if (has('watch')) {
    void startWatch({
      endpoint: `http://localhost:${port}`,
      apiKey: process.env.TOKENWATCH_API_KEY,
      backfill: has('backfill'),
      once: false,
      intervalMs: Number(flag('interval') ?? 5000),
    });
  }
} else if (command === 'mcp') {
  const dbPath = flag('db') ?? process.env.TOKENWATCH_DB ?? join(homedir(), '.tokenwatch', 'tokenwatch.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  runMcp(dbPath, '0.3.0');
} else if (command === 'watch') {
  void startWatch({
    endpoint: (flag('endpoint') ?? process.env.TOKENWATCH_URL ?? 'http://localhost:4318').replace(/\/$/, ''),
    apiKey: process.env.TOKENWATCH_API_KEY,
    backfill: has('backfill'),
    once: has('once'),
    intervalMs: Number(flag('interval') ?? 5000),
  });
} else {
  console.log(`tokenwatch — LLM cost & quality monitor

Usage:
  tokenwatch serve [--port 4318] [--db ~/.tokenwatch/tokenwatch.db] [--watch] [--backfill]
  tokenwatch watch [--endpoint http://localhost:4318] [--backfill] [--once] [--interval 5000]
  tokenwatch mcp   [--db ~/.tokenwatch/tokenwatch.db]   # MCP server (stdio) for AI agents

watch ingests usage from coding-agent session logs (read-only, no proxy):
  Claude Code  ~/.claude/projects/**/*.jsonl
  Codex CLI    ~/.codex/sessions/**/*.jsonl
--backfill processes existing history; default tracks new usage only.

Env:
  TOKENWATCH_PORT, TOKENWATCH_DB, TOKENWATCH_URL, TOKENWATCH_API_KEY`);
}
