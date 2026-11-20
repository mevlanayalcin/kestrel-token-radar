// Local replica of the token-radar-01 gate (7 rows) plus cross-checks that board.json, data.js
// and the screenshots tell one story. Run: node tools/verify.mjs <snapshot.json> <output_dir>
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

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

// ---------------------------------------------------------------- cross-checks: board vs data vs shots
const dataScript = read('data.js');
const data = JSON.parse(dataScript.replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
ok('cross: data.js rows count = board rows', data.rows.length === rows.length, `${data.rows.length}`);
ok('cross: data.js kpis match board', data.kpis.board === rows.length && data.kpis.watchlist === snapshot.watchlist.length && data.kpis.watchlist_ranked === snapshot.watchlist.length, `board ${data.kpis.board}, watchlist ${data.kpis.watchlist}`);
ok('cross: sum implied matches', data.kpis.total_implied_usd === rows.reduce((n, r) => n + r.implied_value_usd, 0));
const bySlug = new Map(rows.map((r) => [r.slug, r]));
let stepMismatch = 0, implMismatch = 0, evMismatch = 0, verdictMismatch = 0;
const F = data.fit, MD = data.model, GS = data.gas_usd;
let monoBad = 0;
const rnd = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
for (const d of data.rows) {
  const b = bySlug.get(d.slug);
  if (!b) { stepMismatch++; continue; }
  const rebuilt = d.steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`).map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
  if (JSON.stringify(rebuilt) !== JSON.stringify(b.farm_steps)) stepMismatch++;
  // the page's implied: exp of the rounded-feature dot product with the shipped coefficients
  const logv = d.x.reduce((acc, v, j) => acc + F.beta[j] * ((v - F.mu[j]) / F.sd[j]), F.ybar);
  // plus the record offset: growth (clamped 7d) and seasoning (time with no token)
  const g = (MD.growth_elasticity * Math.min(MD.growth_cap_pct, Math.max(-MD.growth_cap_pct, d.change_7d ?? 0))) / 100;
  const sea = Math.log(1 - MD.season_depth * Math.exp(-(d.age_days ?? MD.unknown_age_days) / MD.season_days));
  if (Math.max(1, Math.round(Math.exp(logv + (g + sea)))) !== b.implied_value_usd) implMismatch++;
  if ((d.change_7d ?? 0) < 0 && g >= 0) monoBad++;
  // the page's farm EV: the same rounded pipeline as lib/model.ts
  const farmed = d.chains.slice(0, 1);
  const gas = rnd(MD.tx_count * farmed.reduce((a, c) => a + (GS[c] ?? MD.gas_default_usd), 0), 2);
  let hold = d.age_days === null ? MD.hold_unknown_days : MD.hold_default_days;
  if (d.age_days !== null) for (const [cap, dy] of MD.hold_by_age_days) if (d.age_days < cap) { hold = dy; break; }
  const gm = (MD.drop_band_lo + MD.drop_band_hi) / 2;
  const gross = rnd(100 * gm * (d.implied_value_usd / d.tvl_usd) * MD.capture_factor, 2);
  const netPct = (dep) => rnd((100 * rnd((dep * gross) / 100 - rnd(gas + MD.bridge_usd + rnd(dep * MD.opportunity_cost_annum * (hold / 365), 2), 2), 2)) / dep, 2);
  const p1 = netPct(MD.deposit_usd[0]);
  const verdict = p1 >= MD.farm_net_pct ? 'FARM' : p1 >= MD.thin_net_pct ? 'THIN' : 'SKIP';
  if (p1 !== b.net_ev_pct_1000 || netPct(MD.deposit_usd[1]) !== b.net_ev_pct_5000 || netPct(MD.deposit_usd[2]) !== b.net_ev_pct_25000 || hold !== b.farm.hold_days || gas !== b.farm.gas_usd) evMismatch++;
  if (verdict !== b.verdict) verdictMismatch++;
}
ok('cross: data.js farm steps rebuild board.json steps 100%', stepMismatch === 0, `${stepMismatch} mismatches`);
ok('cross: a falling 7d TVL never raises a value', monoBad === 0, `${monoBad} rows`);
ok('cross: page recomputation yields board implied for every row', implMismatch === 0, `${implMismatch} mismatches`);
ok('cross: farm EV recomputes to the shipped dollars for every row', evMismatch === 0, `${evMismatch} mismatches`);
ok('cross: FARM/THIN/SKIP verdicts recompute for every row', verdictMismatch === 0, `${verdictMismatch} mismatches`);
ok('cross: segments are only watchlist/emerging', data.rows.every((d) => d.segment === 'watchlist' || d.segment === 'emerging') && data.rows.filter((d) => d.segment === 'watchlist').length === snapshot.watchlist.length);
ok('cross: verdict kpis match the rows', ['farm', 'thin', 'skip'].every((k) => data.kpis[k] === rows.filter((r) => r.verdict === k.toUpperCase()).length), `F${data.kpis.farm} T${data.kpis.thin} S${data.kpis.skip}`);
ok('cross: tokenized comps never on the board', data.live.every((l) => !covered.has(l.slug)));
ok('cross: board rows all record no token', data.rows.every((d) => !data.live.some((l) => l.slug === d.slug)));
ok('cross: every row names traded anchor comps', data.rows.every((d) => d.anchor_comps.length >= 2 && d.anchor_comps.every((a) => data.live.some((l) => l.slug === a.slug && l.mcap_usd === a.mcap_usd))));
ok('cross: dollar bands bracket the mid for every row', data.rows.every((d) => d.implied_low_usd <= d.implied_value_usd && d.implied_value_usd <= d.implied_high_usd));
ok('cross: fit validates 87 comps LOO and 3 walk-forward folds', F.loo.metrics.n === 87 && F.n_comps === 87 && F.wf.folds.length === 3 && F.wf.pooled.n === 50);
const shrink = F.baselines.find((b) => b.name.startsWith('shrink-median'));
ok('cross: regression beats the hand-set baselines on LOO R2', F.loo.metrics.r2 > shrink.metrics.r2 && F.loo.metrics.r2 > 0, `model ${F.loo.metrics.r2} vs shrink-median ${shrink.metrics.r2}`);
ok('cross: nested LOO reported over all 87 comps', F.nested.metrics.n === 87 && F.nested.same_lam >= 0 && F.nested.same_lam <= 87, `nested R2 ${F.nested.metrics.r2}, same triple in ${F.nested.same_lam} folds`);
ok('cross: dashboard source under the 64,000-byte budget', totalBytes < 64000, `${totalBytes} bytes`);
const fnl = data.kpis;
ok('cross: the 758-protocol funnel adds up exactly', fnl.comps + fnl.tokenized_no_mcap + fnl.tokenized_small_mcap + fnl.watchlist_ranked + fnl.aside_above + fnl.excluded_below + fnl.emerging === fnl.total, `${fnl.total} classified`);
ok('cross: every set-aside carries an exact reason', data.aside.every((a) => a.reason.length > 20 && a.name.length > 0 && slugs.has(a.slug)) && data.aside.length === fnl.aside_above + fnl.excluded_below);

// ---------------------------------------------------------------- determinism (optional second run)
if (outDir2) {
  const b2 = readFileSync(join(outDir2, 'board.json'));
  const d2 = readFileSync(join(outDir2, 'dossier.json'));
  ok('determinism: board.json byte-identical across runs', Buffer.compare(readFileSync(join(out, 'board.json')), b2) === 0);
  ok('determinism: dossier.json byte-identical across runs', Buffer.compare(written, d2) === 0);
}

console.log(`\n${fail.length === 0 ? 'ALL GATE CHECKS PASS' : fail.length + ' FAILURES: ' + fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
