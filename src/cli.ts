#!/usr/bin/env node
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { startServer } from './server.js';

const args = process.argv.slice(2);
const wantsHelp = args.includes('--help') || args.includes('-h');
const command = wantsHelp ? 'help' : args[0] && !args[0].startsWith('-') ? args[0] : 'serve';

function flag(name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

if (command === 'serve') {
  const port = Number(flag('port') ?? process.env.TOKENWATCH_PORT ?? process.env.PORT ?? 4318);
  const dbPath = flag('db') ?? process.env.TOKENWATCH_DB ?? join(homedir(), '.tokenwatch', 'tokenwatch.db');
  mkdirSync(dirname(dbPath), { recursive: true });
  startServer({ port, dbPath });
} else {
  console.log(`tokenwatch — LLM cost & quality monitor

Usage:
  tokenwatch serve [--port 4318] [--db ~/.tokenwatch/tokenwatch.db]

Env:
  TOKENWATCH_PORT, TOKENWATCH_DB, TOKENWATCH_API_KEY (require bearer auth for ingestion)`);
}
