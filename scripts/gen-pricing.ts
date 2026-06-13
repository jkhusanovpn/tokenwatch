/**
 * Generates the canonical pricing.json from the built-in table into docs/ and site/
 * (served by GitHub Pages). Run after editing src/pricing.ts, then commit + push —
 * every running TokenWatch picks up the new prices on next start. No npm release needed.
 *
 *   npx tsx scripts/gen-pricing.ts 2026-06-13
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { builtinPricing } from '../src/pricing.js';

const updated = process.argv[2] ?? '';
if (!/^\d{4}-\d{2}-\d{2}$/.test(updated)) {
  console.error('Pass an ISO date: npx tsx scripts/gen-pricing.ts 2026-06-13');
  process.exit(1);
}

const payload =
  JSON.stringify(
    { updated, currency: 'usd_per_1m_tokens', models: builtinPricing() },
    null,
    2
  ) + '\n';

for (const dir of ['docs', 'site']) {
  mkdirSync(join(process.cwd(), dir), { recursive: true });
  writeFileSync(join(process.cwd(), dir, 'pricing.json'), payload);
}
console.log(`Wrote pricing.json (${Object.keys(builtinPricing()).length} models, updated ${updated}) to docs/ and site/`);
