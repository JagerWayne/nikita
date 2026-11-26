// PWA verifier (static checks + headless Chromium run).   node verify-pwa.mjs <app-dir> [--sub my-app] [--port 8130]
// Needs Playwright (preinstalled in Claude Code cloud sessions). Exit code 1 if any check fails.
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, extname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const args = process.argv.slice(2);
const root = resolve(args.find((a) => !a.startsWith('--')) || '.');
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const sub = opt('sub', 'app'), port = +opt('port', 8130);
const rows = [];
const check = (name, ok, note = '') => { rows.push({ name, ok, note }); };
const read = (f) => readFileSync(join(root, f), 'utf8');

// ---- static checks -------------------------------------------------------------------------------------------
const html = existsSync(join(root, 'index.html')) ? read('index.html') : '';
check('index.html exists', !!html);
let manifest = {};
try { manifest = JSON.parse(read('manifest.webmanifest')); check('manifest parses', true); } catch (e) { check('manifest parses', false, e.message); }
for (const k of ['name', 'short_name', 'start_url', 'scope', 'display', 'background_color', 'theme_color', 'icons']) check('manifest.' + k, !!manifest[k]);
check('manifest start_url/scope relative', manifest.start_url === './' && manifest.scope === './', `${manifest.start_url} ${manifest.scope}`);
check('manifest has maskable icon', (manifest.icons || []).some((i) => /maskable/.test(i.purpose || '')));
const png = (f) => { const b = readFileSync(join(root, f)); return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), alpha: b[25] === 6 || b[25] === 4 }; };
for (const i of manifest.icons || []) {
  const f = i.src.replace(/^\.\//, '');
  if (!existsSync(join(root, f))) { check('icon ' + i.src, false, 'missing'); continue; }
  const d = png(f), want = i.sizes;
  check('icon ' + i.src, `${d.w}x${d.h}` === want && (!/maskable/.test(i.purpose || '') || !d.alpha), `${d.w}x${d.h}${d.alpha ? ' has alpha' : ''}`);
}
if (existsSync(join(root, 'icons/apple-touch-icon.png'))) { const d = png('icons/apple-touch-icon.png'); check('apple-touch-icon 180x180 opaque', d.w === 180 && d.h === 180 && !d.alpha, `${d.w}x${d.h}${d.alpha ? ' alpha' : ''}`); } else check('apple-touch-icon exists', false);
for (const t of ['rel="manifest"', 'rel="apple-touch-icon"', 'name="theme-color"', 'viewport-fit=cover', 'apple-mobile-web-app-capable']) check('head: ' + t, html.includes(t));
check('no root-relative URLs (href="/ src="/)', !/(?:href|src)=["']\/(?!\/)/.test(html));
check('no CDN/unpinned script', !/(?:cdn\.|unpkg\.com|@latest)/.test(html), 'libraries must be vendored');
const files = {};
try { new Function('self', read('js/boot/files.js'))(files); } catch (e) { check('js/boot/files.js loads', false, e.message); }
const list = files.APP_FILES || [];
check('APP_FILES not empty', list.length > 0);
const missing = list.filter((f) => !existsSync(join(root, f)));
check('every APP_FILES entry exists', !missing.length, missing.join(', '));
const upper = list.filter((f) => f !== f.toLowerCase());
check('file names lowercase', !upper.length, upper.join(', '));
try {
  const s = {}; new Function('self', read('js/boot/sizes.js'))(s);
  const bad = list.filter((f) => f !== 'js/boot/sizes.js' && existsSync(join(root, f)) && s.APP_SIZES[f] !== statSync(join(root, f)).size);
  check('sizes.js matches files on disk', !bad.length, bad.length ? 'run make-sizes.mjs: ' + bad.join(', ') : '');
} catch (e) { check('sizes.js present', false, 'run make-sizes.mjs'); }
const ver = (read('js/boot/version.js').match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/) || [])[1];
check('APP_VERSION defined', !!ver, ver);
const sw = existsSync(join(root, 'sw.js')) ? read('sw.js') : '';
check('sw.js exists, no leftover __PREFIX__', !!sw && !sw.includes('__PREFIX__'));
const prefix = (sw.match(/const PREFIX = '([^']+)'/) || [])[1];

// ---- browser run ---------------------------------------------------------------------------------------------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css' };
const server = createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (!u.startsWith('/' + sub + '/')) { res.writeHead(404); return res.end(); }   // proves nothing is requested from the domain root
  let f = join(root, u.slice(sub.length + 2) || 'index.html');
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'max-age=3600' });
  res.end(readFileSync(f));
}).listen(port);
let chromium;
try { chromium = createRequire(process.cwd() + '/')('playwright').chromium; } catch { chromium = createRequire(execSync('npm root -g').toString().trim() + '/')('playwright').chromium; }
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 844, height: 390 } });
  const page = await ctx.newPage();
  const errs = [], bad404 = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('response', (r) => { if (r.status() === 404) bad404.push(r.url()); });
  const url = `http://localhost:${port}/${sub}/`;
  await page.goto(url);
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);
  check('page loads from sub-folder, no 404s', !bad404.length, bad404.slice(0, 3).join(', '));
  check('no uncaught page errors', !errs.length, errs.slice(0, 2).join(' | '));
  check('service worker controls the page', await page.evaluate(() => !!navigator.serviceWorker.controller));
  const caches = await page.evaluate(async () => { const o = {}; for (const k of await self.caches.keys()) o[k] = (await (await self.caches.open(k)).keys()).map((r) => new URL(r.url).pathname); return o; });
  const names = Object.keys(caches);
  check(`exactly one cache ${prefix || ''}<version>`, names.length === 1 && (!prefix || names[0] === prefix + ver), names.join(', '));
  if (names.length) {
    const have = new Set(caches[names[0]].map((p) => p.replace('/' + sub + '/', '')));
    const lack = list.filter((f) => !have.has(f));
    check('cache holds every APP_FILES entry', !lack.length, lack.join(', '));
  }
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1500);
  check('offline reload works', (await page.title()).length > 0 && (await page.content()).length > 500);
  check('no page errors offline', !errs.length, errs.slice(-1)[0] || '');
} catch (e) { check('browser run', false, e.message); }
await browser.close(); server.close();

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name.padEnd(w) + (r.note ? '  ' + r.note : ''));
const failed = rows.filter((r) => !r.ok).length;
console.log(`\n${rows.length - failed}/${rows.length} passed`);
process.exit(failed ? 1 : 0);
