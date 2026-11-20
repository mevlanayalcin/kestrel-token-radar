// Local replica of the token-radar-01 gate (7 rows) plus cross-checks that board.json, data.js
// and the screenshots tell one story. Run: node tools/verify.mjs <snapshot.json> <output_dir>
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
import { basket, MODEL } from '../lib/model.ts';

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
  const cost = gas + f.bridge + carry;
  const evIf = [0, 1, 2].map((q) => rnd(deposit * per(q), 2));
  const net = evIf.map((e) => rnd(rnd(f.p * e, 2) - cost, 2));
  const roi = net.map((n) => rnd((100 * n) / deposit, 2));
  const apr = roi.map((x) => rnd((x * 365) / days, 2));
  const aprIf = evIf.map((e) => rnd((((100 * rnd(e - cost, 2)) / deposit) * 365) / days, 2));
  return { net, roi, apr, aprIf, verdict: apr[1] >= MD.farm_apr && apr[0] >= MD.farm_p25_apr ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP' };
};
// Launch odds rebuilt from the snapshot's own fields and the shipped logistic: P = (F(a+H) - F(a)) / (1 - F(a)).
const OD = data.odds, snapBy = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const ageOf = (p) => (p.listed_at === null ? null : Math.max(0, Math.round((Date.parse(`${snapshot.as_of}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / 86400000)));
const oddsOf = (p) => {
  const age = ageOf(p), u = age === null ? 1 : 0, a = age ?? MD.unknown_age_days, cat = p.category ?? 'Uncategorized';
  const col = (t, aa) => ({ 'log age': rnd(Math.log((aa + MD.odds_age_pad_days) / 365), 6), undated: u, 'category rate': rnd(OD.cat_logit[cat] ?? OD.prior_logit, 6), 'log TVL': rnd(Math.log(p.tvl_usd), 4), 'log chains': rnd(Math.log(Math.max(1, p.chains.length)), 4), '7d growth': clampv(p.change_7d ?? 0, -MD.growth_cap_pct, MD.growth_cap_pct) / 100 })[t];
  const Fx = (aa) => 1 / (1 + Math.exp(-OD.terms.map((t) => col(t, aa)).reduce((s, v, j) => s + OD.beta[j] * ((v - OD.mu[j]) / OD.sd[j]), OD.b0)));
  const fa = Fx(a), fb = Fx(a + OD.horizon_days);
  return rnd(clampv((fb - fa) / Math.max(1e-9, 1 - fa), 0, 1), 4);
};
let oddsBad = 0, oddsRange = 0, evBad = 0, aprBad = 0;
for (const d of data.rows) {
  const b = bySlug.get(d.slug);
  if (!b) { implBad++; continue; }
  const base = d.x.reduce((a, v, j) => a + F.beta[j] * ((v - F.mu[j]) / F.sd[j]), F.ybar);
  const g = (F.k * clampv(d.chg ?? 0, -MD.growth_cap_pct, MD.growth_cap_pct)) / 100;
  const sea = Math.log(1 - F.d * Math.exp(-(d.age ?? MD.unknown_age_days) / F.T));
  if (Math.max(1, Math.round(Math.exp(base + g + sea))) !== b.implied_value_usd || d.fdv !== b.implied_value_usd) implBad++;
  if ((d.chg ?? 0) < 0 && g >= 0) monoBad++;
  const pt = oddsOf(snapBy.get(d.slug));
  if (pt !== b.p_token_12m || pt !== d.f.p) oddsBad++;
  if (!(pt > 0 && pt < 1)) oddsRange++;
  if (b.risk_adj_value_usd !== Math.max(1, Math.round(b.implied_value_usd * pt))) evBad++;
  for (const dep of MD.tiers) {
    const t = tier(d.f, dep);
    if (t.verdict !== b.verdict_by_deposit[dep] || t.roi[1] !== b.net_roi_p50_pct_by_deposit[dep] || t.apr[1] !== b.net_apr_p50_pct_by_deposit[dep] || t.verdict !== d.b[dep][0] || t.apr[1] !== d.b[dep][1]) tierBad++;
    if (t.aprIf[1] !== b.net_apr_if_token_p50_pct_by_deposit[dep] || t.apr[1] > t.aprIf[1] + 1e-9) aprBad++;
  }
  const rebuilt = d.steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`).map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
  if (JSON.stringify(rebuilt) !== JSON.stringify(b.farm_steps)) stepBad++;
}
ok('cross: data.js rows = board rows', data.rows.length === rows.length, String(data.rows.length));
ok('cross: implied FDV recomputes from shipped coefficients for every row', implBad === 0, `${implBad} mismatches`);
ok('cross: two-outcome verdict, p50 ROI and risk-adj APR recompute for every row at all 3 tiers', tierBad === 0, `${rows.length * MD.tiers.length - tierBad}/${rows.length * MD.tiers.length} match`);
ok('cross: if-token APR recomputes and is never below the blended APR', aprBad === 0, `${aprBad} mismatches`);
ok('cross: P(token) rebuilt from snapshot fields + shipped logistic for every row', oddsBad === 0, `${rows.length - oddsBad}/${rows.length} match`);
ok('cross: every P(token) strictly inside (0, 1)', oddsRange === 0, `range ${Math.min(...rows.map((r) => r.p_token_12m))}..${Math.max(...rows.map((r) => r.p_token_12m))}`);
ok('cross: risk-adj value = implied FDV x P(token) for every row', evBad === 0, `${evBad} mismatches`);
ok('cross: odds model validated blind (LOO AUC > 0.5, Brier beats base rate, walk-forward AUC > 0.5)', OD.loo.auc > 0.5 && OD.loo.brier < OD.loo.base_brier && OD.wf.pooled.auc > 0.5, `LOO AUC ${OD.loo.auc} Brier ${OD.loo.brier} vs ${OD.loo.base_brier}; WF AUC ${OD.wf.pooled.auc}`);
ok('cross: farm steps rebuild board.json steps', stepBad === 0, `${stepBad} mismatches`);
ok('cross: record terms sign-constrained (k > 0, d > 0) and a falling TVL never raises a value', F.k > 0 && F.d > 0 && monoBad === 0);
ok('cross: log TVL elasticity non-negative', F.elasticity >= 0, String(F.elasticity));
ok('cross: verdict counts match board per tier', MD.tiers.every((dep) => ['FARM', 'THIN', 'SKIP'].every((v) => data.verdicts[dep][v] === rows.filter((r) => r.verdict_by_deposit[dep] === v).length)));
ok('cross: watchlist rows all present in data.js', data.rows.filter((d) => d.seg === 'W').length === snapshot.watchlist.length);
const fn = data.funnel;
ok('cross: the funnel adds up to every protocol', fn.comps + fn.token_other + fn.watchlist + fn.emerging + fn.aside_above + fn.screened_below === fn.total && fn.total === snapshot.protocols.length);
{
  const A = data.all, dc = (k) => A.filter((a) => a.d === k).map((a) => a.s).sort();
  const once = A.length === snapshot.protocols.length && new Set(A.map((a) => a.s)).size === A.length && A.every((a) => slugs.has(a.s));
  const comp = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd >= MODEL.comp_min_usd && p.tvl_usd >= MODEL.comp_min_usd).map((p) => p.slug).sort();
  const ranked = [...dc('W'), ...dc('E')].sort(), boardSl = rows.map((r) => r.slug).sort();
  const tokenK = dc('K').every((s) => { const p = snapBy.get(s); return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null; });
  const asideOk = [...dc('A'), ...dc('X')].every((s) => { const p = snapBy.get(s); return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; });
  const counts = { W: fn.watchlist, E: fn.emerging, C: fn.comps, K: fn.token_other, A: fn.aside_above, X: fn.screened_below };
  ok('accounting: 758/758, every snapshot protocol in exactly one disposition with a reason', once && A.every((a) => a.why.length >= 20), `${A.length}/${snapshot.protocols.length}`);
  ok('accounting: disposition counts = funnel', Object.entries(counts).every(([k, n]) => dc(k).length === n), Object.entries(counts).map(([k, n]) => `${k}${n}`).join(' '));
  ok('accounting: W = watchlist, W+E = board rows, C = comps, K tokened, A/X untokened', JSON.stringify(dc('W')) === JSON.stringify([...snapshot.watchlist].sort()) && JSON.stringify(ranked) === JSON.stringify(boardSl) && JSON.stringify(dc('C')) === JSON.stringify(comp) && tokenK && asideOk);
  ok('accounting: held-out token probability in (0, 1) for all 758', A.every((a) => a.pt > 0 && a.pt < 1));
}
ok('cross: traded comps never on the board', data.comps.every((c) => !rows.some((r) => r.name === c.name && snapshot.protocols.find((p) => p.slug === r.slug).mcap_usd !== null)));
ok('cross: every board row records no token', rows.every((r) => { const p = snapshot.protocols.find((x) => x.slug === r.slug); return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }));
ok('cross: bands bracket the mid', rows.every((r) => r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd));
ok('cross: model beats median-multiple baselines on LOO R2', F.loo.r2 > 0 && F.baselines.slice(1).every((b) => F.loo.r2 > b.metrics.r2), `LOO ${F.loo.r2}`);
let bkBad = 0;
const bkInfo = [];
for (const dep of MD.tiers) {
  const b = basket(data.rows.map((r) => ({ slug: r.slug, cat: r.cat, f: r.f })), dep, MD), s = data.baskets[dep];
  const picks = s.slugs.map((x) => data.rows.find((r) => r.slug === x));
  const sleeveOk = picks.every((r) => tier(r.f, dep / MD.basket_n).verdict === 'FARM');
  const perCat = picks.reduce((a, r) => ((a[r.cat] = (a[r.cat] || 0) + 1), a), {});
  const distinct = new Set(picks.map((r) => r.f.chain)).size === picks.length && Object.values(perCat).every((n) => n <= MD.basket_cat_max);
  const sum = rnd(picks.reduce((a, r) => a + tier(r.f, dep / MD.basket_n).net[1], 0), 2);
  if (JSON.stringify(b) !== JSON.stringify(s) || !sleeveOk || !distinct || picks.length > MD.basket_n || (dep >= 10000 && picks.length !== MD.basket_n) || sum !== s.net_p50) bkBad++;
  bkInfo.push(`${dep}:${picks.length}`);
}
ok('cross: farm basket per tier rebuilds (sleeve math summed independently); FARM sleeves, distinct home chains, <= 2 per category, 4 sleeves at $10k and $50k', bkBad === 0, bkInfo.join(' '));
ok('cross: dashboard source <= 63,500 bytes', totalBytes <= 63500, `${totalBytes} bytes`);

// ---------------------------------------------------------------- determinism (optional second run)
if (outDir2) {
  const b2 = readFileSync(join(outDir2, 'board.json'));
  const d2 = readFileSync(join(outDir2, 'dossier.json'));
  ok('determinism: board.json byte-identical across runs', Buffer.compare(readFileSync(join(out, 'board.json')), b2) === 0);
  ok('determinism: dossier.json byte-identical across runs', Buffer.compare(written, d2) === 0);
}

console.log(`\n${fail.length === 0 ? 'ALL GATE CHECKS PASS' : fail.length + ' FAILURES: ' + fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
