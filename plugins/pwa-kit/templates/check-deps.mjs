// Compares the versions listed in vendor/README.md with the latest on the npm registry.  node tools/check-deps.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const rows = [...readFileSync(join(root, 'vendor/README.md'), 'utf8').matchAll(/^\|\s*([\w@./-]+)\s*\|\s*([\d.]+)\s*\|/gm)];
let behind = 0;
for (const [, name, have] of rows) {
  try {
    const r = await fetch('https://registry.npmjs.org/' + name + '/latest');
    const latest = (await r.json()).version;
    const ok = latest === have;
    if (!ok) behind++;
    console.log((ok ? 'OK     ' : 'OUTDATED') + ' ' + name + ' ' + have + (ok ? '' : ' -> ' + latest));
  } catch (e) { console.log('ERROR  ' + name + ': ' + e.message); behind++; }
}
process.exit(behind ? 1 : 0);
