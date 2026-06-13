/**
 * Loads model prices at CLI startup, newest-wins precedence:
 *   built-in seed  <  remote pricing.json (cached)  <  local override file
 *
 * Kept separate from pricing.ts (and the SDK) so wrapped client calls never
 * touch the network or filesystem. Fails open: any error falls back to cache,
 * then to the built-in table — pricing is never a reason startup breaks.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { mergePricing, type ModelPrice } from './pricing.js';

export const DEFAULT_PRICING_URL = 'https://jkhusanovpn.github.io/tokenwatch/pricing.json';

interface PricingFile {
  updated?: string;
  currency?: string;
  models: Record<string, ModelPrice>;
}

export interface LoadPricingOptions {
  url?: string; // default: $TOKENWATCH_PRICING_URL or DEFAULT_PRICING_URL
  remote?: boolean; // default true; false = built-in + local override only
  cacheDir?: string; // default ~/.tokenwatch
  timeoutMs?: number; // default 3000
}

export interface PricingLoadResult {
  source: 'remote' | 'cache' | 'builtin';
  remoteModels: number;
  overrideModels: number;
  updated?: string;
}

function parse(json: string): PricingFile | null {
  try {
    const obj = JSON.parse(json);
    if (obj && obj.models && typeof obj.models === 'object') return obj as PricingFile;
  } catch {
    /* ignore */
  }
  return null;
}

export async function loadPricing(opts: LoadPricingOptions = {}): Promise<PricingLoadResult> {
  const cacheDir = opts.cacheDir ?? join(homedir(), '.tokenwatch');
  const cachePath = join(cacheDir, 'pricing-cache.json');
  const overridePath = join(cacheDir, 'pricing.json');
  const url = opts.url ?? process.env.TOKENWATCH_PRICING_URL ?? DEFAULT_PRICING_URL;
  const remote = opts.remote !== false && process.env.TOKENWATCH_NO_REMOTE_PRICING !== '1';

  const result: PricingLoadResult = { source: 'builtin', remoteModels: 0, overrideModels: 0 };

  // 1. Remote (cached). Network failure → fall back to last good cache.
  if (remote) {
    let file: PricingFile | null = null;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 3000);
      const res = await fetch(url, { signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      file = parse(text);
      if (file) {
        mkdirSync(dirname(cachePath), { recursive: true });
        writeFileSync(cachePath, text);
        result.source = 'remote';
      }
    } catch {
      if (existsSync(cachePath)) {
        file = parse(readFileSync(cachePath, 'utf8'));
        if (file) result.source = 'cache';
      }
    }
    if (file) {
      result.remoteModels = mergePricing(file.models);
      result.updated = file.updated;
    }
  }

  // 2. Local override (highest precedence) — user-maintained private/local models.
  if (existsSync(overridePath)) {
    const file = parse(readFileSync(overridePath, 'utf8'));
    if (file) result.overrideModels = mergePricing(file.models);
  }

  return result;
}
