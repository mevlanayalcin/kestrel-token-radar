// Local replica of the token-radar-01 gate (7 rows) plus cross-checks that board.json, data.js
// and the screenshots tell one story. Run: node tools/verify.mjs <snapshot.json> <output_dir>
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
import { basket } from '../lib/model.ts';

const [, , snapshotPath, outDir, outDir2] = process.argv;
const fail = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
  if (!cond) fail.push(name);
};

const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const slugs = new Set(snapshot.protocols.map((p) => p.slug));
const out = outDir;
const read = (p) => readFileSync(join(out, p), 'utf8');

// ---------------------------------------------------------------- 1 dashboard_files
const dashDir = join(out, 'dashboard');
const files = readdirSync(dashDir).filter((n) => !n.startsWith('.'));
const totalBytes = files.reduce((n, f) => n + statSync(join(dashDir, f)).size, 0);
const nameOk = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
ok('dashboard_files: index.html + .css + .js present', files.includes('index.html') && files.some((f) => f.endsWith('.css')) && files.some((f) => f.endsWith('.js')));
ok('dashboard_files: <= 400 files, <= 4 MiB', files.length <= 400 && totalBytes <= 4 * 1024 * 1024, `${files.length} files, ${totalBytes} bytes`);
ok('dashboard_files: every name legal', files.every((f) => nameOk.test(f) && lstatSync(join(dashDir, f)).isFile()));

const URL = /https?:\/\//i;
const html = read('dashboard/index.html');
const attrUrls = [...html.matchAll(/<[^>]*\s(?:href|src|action|poster|data|srcset|style)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)]
  .filter((m) => URL.test(m[1])).map((m) => m[0].slice(0, 80));
ok('dashboard_files: no http(s) in HTML attributes', attrUrls.length === 0, attrUrls.join(' | '));
const styleBodies = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join('\n');
ok('dashboard_files: no http(s) in <style> body', !URL.test(styleBodies));
const cssFiles = files.filter((f) => f.endsWith('.css'));
ok('dashboard_files: no http(s) in CSS files', cssFiles.every((f) => !URL.test(read('dashboard/' + f))));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const specRe = /(?:^|[\s;{(])(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]|require\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const badSpecs = [];
for (const f of jsFiles) {
  const src = read('dashboard/' + f);
  for (const m of src.matchAll(specRe)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (URL.test(spec)) badSpecs.push(`${f}: ${spec}`);
  }
}
ok('dashboard_files: no http(s) import/require specifier', badSpecs.length === 0, badSpecs.join(' | '));

// ---------------------------------------------------------------- 2 board_file
const boardBytes = statSync(join(out, 'board.json')).size;
const board = JSON.parse(read('board.json'));
const rows = Array.isArray(board) ? board : board.rows;
ok('board_file: rows is an array of 100..4000', Array.isArray(rows) && rows.length >= 100 && rows.length <= 4000, String(rows.length));
ok('board_file: <= 8 MiB', boardBytes <= 8 * 1024 * 1024, `${boardBytes} bytes`);
ok('board_file: every slug is a snapshot protocol', rows.every((r) => slugs.has(r.slug)));
ok('board_file: slugs unique', new Set(rows.map((r) => r.slug)).size === rows.length);
ok('board_file: names non-empty', rows.every((r) => typeof r.name === 'string' && r.name.length > 0));
ok('board_file: ranks positive integers', rows.every((r) => Number.isInteger(r.rank) && r.rank > 0));
ok('board_file: implied positive integer <= 1e14', rows.every((r) => Number.isInteger(r.implied_value_usd) && r.implied_value_usd > 0 && r.implied_value_usd <= 100_000_000_000_000));

// ---------------------------------------------------------------- 3 sorted_by_value
const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
ok('sorted_by_value: ranks exactly 1..N', ranks.every((v, i) => v === i + 1));
const ordered = [...rows].sort((a, b) => a.rank - b.rank);
let mono = true;
for (let i = 1; i < ordered.length; i++) if (ordered[i].implied_value_usd > ordered[i - 1].implied_value_usd) mono = false;
ok('sorted_by_value: implied non-increasing with rank', mono);
ok('sorted_by_value: not all one value', new Set(rows.map((r) => r.implied_value_usd)).size > 1);

// ---------------------------------------------------------------- 4 coverage
const covered = new Set(rows.map((r) => r.slug));
const missing = snapshot.watchlist.filter((s) => !covered.has(s));
ok('coverage: every watchlist slug present', missing.length === 0, missing.join(', '));

// ---------------------------------------------------------------- 5 farm_steps
const stepIssues = [];
for (const r of rows) {
  if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) { stepIssues.push(`${r.slug}: count`); continue; }
  for (const s of r.farm_steps) if (typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600) stepIssues.push(`${r.slug}: ${String(s).trim().length}`);
  if (r.farm_steps.some((s) => !/Cost:/.test(s) || !/Time:/.test(s))) stepIssues.push(`${r.slug}: lacks cost/time tag`);
}
const counts = new Set(rows.map((r) => r.farm_steps.length));
ok('farm_steps: 3..12 per row, each 20..600 chars, each with cost + time', stepIssues.length === 0, [...counts].join(','));
const minStep = Math.min(...rows.flatMap((r) => r.farm_steps.map((s) => s.trim().length)));
const maxStep = Math.max(...rows.flatMap((r) => r.farm_steps.map((s) => s.trim().length)));
ok('farm_steps: observed length range inside 20..600', minStep >= 20 && maxStep <= 600, `${minStep}..${maxStep}`);

// ---------------------------------------------------------------- 6 screenshots
const shotDir = join(out, 'screenshots');
const shots = readdirSync(shotDir).filter((n) => !n.startsWith('.') && statSync(join(shotDir, n)).isFile());
ok('screenshots: 3 or 4 images', shots.length >= 3 && shots.length <= 4, String(shots.length));
const shotIssues = [];
for (const n of shots) {
  const p = join(shotDir, n);
  const b = readFileSync(p);
  const png = b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
  const jpg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  let w = 0, h = 0;
  if (png) { w = b.readUInt32BE(16); h = b.readUInt32BE(20); }
  else if (jpg) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xc3) { h = b.readUInt16BE(i + 5); w = b.readUInt16BE(i + 7); break; }
      i += 2 + b.readUInt16BE(i + 2);
    }
  }
  const long = Math.max(w, h), short = Math.min(w, h);
  if (!(png || jpg)) shotIssues.push(`${n}: not PNG/JPEG`);
  if (b.length > 512 * 1024) shotIssues.push(`${n}: ${b.length} bytes`);
  if (long > 1440) shotIssues.push(`${n}: long ${long}`);
  if (short < 800) shotIssues.push(`${n}: short ${short}`);
}
ok('screenshots: whole PNG/JPEG, <= 512 KiB, long <= 1440, short >= 800', shotIssues.length === 0, shotIssues.join(' | '));

// ---------------------------------------------------------------- 7 dossier_matches
const expected = buildDossier(out, { text_max_bytes: 65536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } });
const written = readFileSync(join(out, 'dossier.json'));
ok('dossier_matches: byte for byte buildDossier(output)', Buffer.compare(Buffer.from(expected), written) === 0, `${written.length} bytes`);
ok('dossier_matches: <= 1.5 MiB', written.length <= 1.5 * 1024 * 1024);
const dossier = JSON.parse(written.toString('utf8'));
ok('dossier text: <= 65,536 bytes', Buffer.byteLength(dossier.text) <= 65536, `${Buffer.byteLength(dossier.text)} bytes`);
ok('dossier text: source untruncated', !/Cut at|of this file's \d+ lines not shown|left out/.test(dossier.text));
ok('dossier: cover is 01 (first by name)', dossier.cover === 0 && dossier.images[0].name === '01-board-overview.jpg');
ok('dossier: dashboard source files all shown whole', ['app.css', 'app.js', 'index.html'].every((f) => dossier.text.includes(`### ${f}`)));

// ---------------------------------------------------------------- cross-checks: board vs data.js
const data = JSON.parse(read('data.js').replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
const F = data.fit, MD = data.model;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const rnd = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const clampv = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
let implBad = 0, tierBad = 0, stepBad = 0, monoBad = 0;
const tier = (f, deposit) => {
  const dq = data.drop_q, prior = Math.min(f.age ?? MD.prior_season_cap_days, MD.prior_season_cap_days), days = f.weeks * 7, ts = days / (days + prior);
  const per = (q) => ((dq[q] / 100) * f.share * f.fdv[q] * ts) / f.tvl;
  const gas = rnd((MD.tx_base + Math.ceil(f.weeks / MD.tx_per_weeks)) * f.gas_tx, 2);
  const carry = rnd(deposit * ((MD.benchmark_apy + f.prem - f.apy) / 100) * (days / 365), 2);
  const roi = [0, 1, 2].map((q) => rnd((100 * rnd(rnd(deposit * per(q), 2) - gas - f.bridge - carry, 2)) / deposit, 2));
  const apr = roi.map((x) => rnd((x * 365) / days, 2));
  return { roi, verdict: apr[1] >= MD.farm_apr && apr[0] >= MD.farm_p25_apr ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP' };
};
for (const d of data.rows) {
  const b = bySlug.get(d.slug);
  if (!b) { implBad++; continue; }
  const base = d.x.reduce((a, v, j) => a + F.beta[j] * ((v - F.mu[j]) / F.sd[j]), F.ybar);
  const g = (F.k * clampv(d.chg ?? 0, -MD.growth_cap_pct, MD.growth_cap_pct)) / 100;
  const sea = Math.log(1 - F.d * Math.exp(-(d.age ?? MD.unknown_age_days) / F.T));
  if (Math.max(1, Math.round(Math.exp(base + g + sea))) !== b.implied_value_usd || d.fdv !== b.implied_value_usd) implBad++;
  if ((d.chg ?? 0) < 0 && g >= 0) monoBad++;
  for (const dep of MD.tiers) { const t = tier(d.f, dep); if (t.verdict !== b.verdict_by_deposit[dep] || t.roi[1] !== b.net_roi_p50_pct_by_deposit[dep]) tierBad++; }
  const rebuilt = d.steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`).map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
  if (JSON.stringify(rebuilt) !== JSON.stringify(b.farm_steps)) stepBad++;
}
ok('cross: data.js rows = board rows', data.rows.length === rows.length, String(data.rows.length));
ok('cross: implied FDV recomputes from shipped coefficients for every row', implBad === 0, `${implBad} mismatches`);
ok('cross: farm verdict and p50 ROI recompute for every row and tier', tierBad === 0, `${tierBad} mismatches`);
ok('cross: farm steps rebuild board.json steps', stepBad === 0, `${stepBad} mismatches`);
ok('cross: record terms sign-constrained (k > 0, d > 0) and a falling TVL never raises a value', F.k > 0 && F.d > 0 && monoBad === 0);
ok('cross: log TVL elasticity non-negative', F.elasticity >= 0, String(F.elasticity));
ok('cross: verdict counts match board per tier', MD.tiers.every((dep) => ['FARM', 'THIN', 'SKIP'].every((v) => data.verdicts[dep][v] === rows.filter((r) => r.verdict_by_deposit[dep] === v).length)));
ok('cross: watchlist rows all present in data.js', data.rows.filter((d) => d.seg === 'W').length === snapshot.watchlist.length);
const fn = data.funnel;
ok('cross: the funnel adds up to every protocol', fn.comps + fn.token_other + fn.watchlist + fn.emerging + fn.aside_above + fn.screened_below === fn.total && fn.total === snapshot.protocols.length);
ok('cross: traded comps never on the board', data.comps.every((c) => !rows.some((r) => r.name === c.name && snapshot.protocols.find((p) => p.slug === r.slug).mcap_usd !== null)));
ok('cross: every board row records no token', rows.every((r) => { const p = snapshot.protocols.find((x) => x.slug === r.slug); return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }));
ok('cross: bands bracket the mid', rows.every((r) => r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd));
ok('cross: model beats median-multiple baselines on LOO R2', F.loo.r2 > 0 && F.baselines.slice(1).every((b) => F.loo.r2 > b.metrics.r2), `LOO ${F.loo.r2}`);
let bkBad = 0;
for (const dep of MD.tiers) {
  const b = basket(data.rows.map((r) => ({ slug: r.slug, cat: r.cat, f: r.f })), dep, MD), s = data.baskets[dep];
  const picks = s.slugs.map((x) => data.rows.find((r) => r.slug === x));
  const sleeveOk = picks.every((r) => tier(r.f, dep / MD.basket_n).verdict === 'FARM');
  const distinct = new Set(picks.map((r) => r.f.chain)).size === picks.length && new Set(picks.map((r) => r.cat)).size === picks.length;
  if (JSON.stringify(b) !== JSON.stringify(s) || !sleeveOk || !distinct || picks.length !== MD.basket_n) bkBad++;
}
ok('cross: farm basket per tier rebuilds, 4 FARM sleeves on distinct chains and categories', bkBad === 0, `${bkBad} bad tiers`);
ok('cross: dashboard source under 64,000 bytes', totalBytes < 64000, `${totalBytes} bytes`);

// ---------------------------------------------------------------- determinism (optional second run)
if (outDir2) {
  const b2 = readFileSync(join(outDir2, 'board.json'));
  const d2 = readFileSync(join(outDir2, 'dossier.json'));
  ok('determinism: board.json byte-identical across runs', Buffer.compare(readFileSync(join(out, 'board.json')), b2) === 0);
  ok('determinism: dossier.json byte-identical across runs', Buffer.compare(written, d2) === 0);
}

console.log(`\n${fail.length === 0 ? 'ALL GATE CHECKS PASS' : fail.length + ' FAILURES: ' + fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
