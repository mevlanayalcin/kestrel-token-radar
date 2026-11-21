// Local replica of the token-radar-01 gate (7 rows) plus cross-checks that board.json, data.js
// and the screenshots tell one story. Run: node tools/verify.mjs <snapshot.json> <output_dir>
import { readFileSync, readdirSync, lstatSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';
import { createRequire } from 'node:module';
const KM = createRequire(import.meta.url)('../dashboard/model.js');
const MODEL = KM.M;

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
ok('dossier text: source untruncated, 0 lines cut', !/Cut at|of this file's \d+ lines not shown|left out/.test(dossier.text), `${Buffer.byteLength(dossier.text)} of 65536 bytes`);
ok('dossier: cover is 01 (first by name)', dossier.cover === 0 && dossier.images[0].name.startsWith('01-board-overview'));
ok('dossier: dashboard source files all shown whole', files.every((f) => dossier.text.includes(`### ${f}`) && dossier.text.includes(readFileSync(join(dashDir, f), 'utf8'))), files.join(', '));

// ---------------------------------------------------------------- cross-checks: board vs data.js, rebuilt independently
const data = JSON.parse(read('data.js').replace(/^window\.RADAR=/, '').replace(/;\s*$/, ''));
const F = data.fit, OD = data.odds, MD = MODEL;
const bySlug = new Map(rows.map((r) => [r.slug, r]));
const snapBy = new Map(snapshot.protocols.map((p) => [p.slug, p]));
const rnd = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const clampv = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ageOf = (p) => (p.listed_at === null ? null : Math.max(0, Math.round((Date.parse(`${snapshot.as_of}T00:00:00Z`) - Date.parse(`${p.listed_at}T00:00:00Z`)) / 86400000)));
const cat = (p) => p.category ?? 'Uncategorized';
// Implied value from the snapshot's own TVL, category, 7d change and listing age, and the shipped fit, written out
// by hand: anchor + b0 (log TVL - mu0)/sd0 - b0 (log(1+g)/2)/sd0 + b1 (pass - mu1)/sd1 + b2 (1 - e^(-age/730) - mu2)/sd2.
const fdvOf = (p) => {
  const age = ageOf(p), half = 0.5 * Math.log1p(Math.max(p.change_7d ?? 0, -95) / 100), sea = 1 - Math.exp(-(age ?? MD.unknown_age) / MD.season_days);
  const z = (j, v) => F.beta[j] * ((v - F.mu[j]) / F.sd[j]);
  const terms = [F.ybar, z(0, Math.log(p.tvl_usd)), (-F.beta[0] * half) / F.sd[0], z(1, KM.PASS.has(cat(p)) ? 1 : 0), z(2, sea)];
  return Math.max(1, Math.round(Math.exp(terms.reduce((a, v) => a + v, 0))));
};
// Campaign odds rebuilt by hand: the launch curve month by month, P(by t) = (F(a+t) - F(a)) / (1 - F(a)), and the diluted season share.
const campOf = (p) => {
  const age = ageOf(p), u = age === null ? 1 : 0, a = age ?? MD.unknown_age, c = OD.cat_logit[cat(p)] ?? OD.prior_logit;
  const col = (t, aa) => ({ 'log age': rnd(Math.log((aa + MD.age_pad) / 365), 6), undated: u, 'category rate': rnd(c, 6), 'log TVL': rnd(Math.log(p.tvl_usd), 4), 'log chains': rnd(Math.log(Math.max(1, p.chains.length)), 4), '7d growth': clampv(p.change_7d ?? 0, -30, 30) / 100 })[t];
  const Fx = (aa) => 1 / (1 + Math.exp(-OD.terms.map((t) => col(t, aa)).reduce((s, v, j) => s + OD.beta[j] * ((v - OD.mu[j]) / OD.sd[j]), OD.b0)));
  const weeks = age === null ? MD.window_undated : (MD.windows.find(([cap]) => age < cap) ?? [0, MD.window_old])[1], D = weeks * 7, prior = Math.min(age ?? MD.prior_cap, MD.prior_cap), f0 = Fx(a);
  let prev = f0, cum = 0, ss = 0, p12 = 0;
  for (let k = 1; k <= MD.credit_months; k++) { const f = Fx(a + MD.month * k), pm = (f - prev) / Math.max(1e-9, 1 - f0), t = MD.month * (k - 0.5); cum += pm; ss += (pm * Math.min(D, t)) / (prior + t); prev = f; if (k === 12) p12 = cum; }
  return { p12: rnd(clampv(p12, 0, 1), 4), p24: rnd(clampv(cum, 0, 1), 4), ss: rnd(ss, 6), weeks };
};
// The two-outcome tier rebuilt by hand.
const dq = [0.25, 0.5, 0.75].map((q) => { const v = KM.DROPS.map((d) => d[1]).sort((a, b) => a - b), i = (v.length - 1) * q, lo = Math.floor(i); return rnd(v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (i - lo), 2); });
const tier = (f, deposit) => {
  const P = Math.round(f.tvl <= MD.pool_ref ? f.tvl : MD.pool_ref * (f.tvl / MD.pool_ref) ** MD.pool_gamma), days = f.weeks * 7, per = (q) => ((dq[q] / 100) * f.share * f.fdv[q] * f.ss) / P;
  const gas = rnd((MD.tx_base + Math.ceil(f.weeks / MD.tx_per_weeks)) * f.gas_tx, 2), carry = rnd(deposit * ((MD.benchmark + f.prem - f.apy) / 100) * (days / 365), 2), cost = gas + f.bridge + carry;
  const ann = (n) => rnd((((100 * n) / deposit) * 365) / days, 2);
  const net = [0, 1, 2].map((q) => rnd(rnd(deposit * per(q), 2) - cost, 2)), netIf = [0, 1, 2].map((q) => rnd(rnd((deposit * per(q)) / Math.max(1e-9, f.p24), 2) - cost, 2));
  const apr = net.map(ann);
  return { net, roi: net.map((n) => rnd((100 * n) / deposit, 2)), apr, aprIf: netIf.map(ann), verdict: apr[1] >= MD.farm_apr && apr[0] >= MD.farm_p25 ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP' };
};
let implBad = 0, tierBad = 0, stepBad = 0, oddsBad = 0, oddsRange = 0, evBad = 0, aprBad = 0, tierN = 0;
for (const d of data.rows) {
  const b = bySlug.get(d.slug), p = snapBy.get(d.slug);
  if (!b) { implBad++; continue; }
  if (fdvOf(p) !== b.implied_value_usd || d.fdv !== b.implied_value_usd) implBad++;
  const c = campOf(p);
  if (c.p12 !== b.p_token_12m || c.p24 !== b.p_token_24m || c.ss !== b.season_share || c.p24 !== d.f.p24 || c.weeks !== d.f.weeks) oddsBad++;
  if (!(c.p12 > 0 && c.p12 < 1 && c.p24 > 0 && c.p24 < 1 && c.p12 <= c.p24)) oddsRange++;
  if (b.risk_adj_value_usd !== Math.max(1, Math.round(b.implied_value_usd * c.p24))) evBad++;
  for (const dep of MD.tiers) {
    const t = tier(d.f, dep), k = KM.farmTier(d.f, dep);
    tierN++;
    if (t.verdict !== b.verdict_by_deposit[dep] || t.roi[1] !== b.net_roi_p50_pct_by_deposit[dep] || t.apr[1] !== b.net_apr_p50_pct_by_deposit[dep] || t.verdict !== d.b[dep][0] || t.apr[1] !== d.b[dep][1] || k.verdict !== t.verdict || k.apr.join() !== t.apr.join()) tierBad++;
    if (t.aprIf[1] !== b.net_apr_if_token_p50_pct_by_deposit[dep] || t.apr[1] > t.aprIf[1] + 1e-9) aprBad++;
  }
  const rebuilt = d.steps.map((s) => `${s.action} Cost: ${s.cost}. Time: ${s.time}.`).map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
  if (JSON.stringify(rebuilt) !== JSON.stringify(b.farm_steps)) stepBad++;
}
ok('cross: data.js rows = board rows', data.rows.length === rows.length, String(data.rows.length));
ok('cross: implied value rebuilt from snapshot TVL, category, 7d change and age with the shipped fit, every row', implBad === 0, `${rows.length - implBad}/${rows.length}`);
ok('cross: P(12m), P(24m), season share and farm window rebuilt from snapshot fields + shipped launch curve, every row', oddsBad === 0, `${rows.length - oddsBad}/${rows.length}`);
ok('cross: every P(token) strictly inside (0, 1) and P12 <= P24', oddsRange === 0, `P12 ${Math.min(...rows.map((r) => r.p_token_12m))}..${Math.max(...rows.map((r) => r.p_token_12m))}, P24 ${Math.min(...rows.map((r) => r.p_token_24m))}..${Math.max(...rows.map((r) => r.p_token_24m))}`);
ok('cross: two-outcome verdict, p50 ROI and APR rebuilt by hand = board = KM.farmTier, all rows x 3 tiers', tierBad === 0, `${tierN - tierBad}/${tierN}`);
ok('cross: if-token APR rebuilt, never below the blended APR', aprBad === 0, `${aprBad} mismatches`);
ok('cross: risk-adj value = implied FDV x P(24m), every row', evBad === 0, `${evBad} mismatches`);
ok('cross: farm steps rebuild board.json steps', stepBad === 0, `${stepBad} mismatches`);
{
  const U = snapshot.protocols.map((p) => { const a = ageOf(p); return { s: p.slug, n: p.name, c: cat(p), t: p.tvl_usd, g: p.change_7d, a, ch: p.chains.length, l: a === null ? null : p.listed_at, k: p.mcap_usd === null && p.gecko_id === null && p.symbol === null ? 0 : 1, m: p.mcap_usd }; });
  const v = KM.fitValueModel(U), o = KM.fitLaunchOdds(U, { terms: OD.terms, lam: OD.lam });
  ok('refit: value model refit from the raw snapshot = shipped coefficients, LOO, walk-forward and ledger', JSON.stringify(v) === JSON.stringify(F), `LOO R2 ${v.loo.r2} rho ${v.loo.rho}, WF R2 ${v.wf.pooled.r2} rho ${v.wf.pooled.rho}`);
  ok('refit: launch curve refit + 758 LOO refits from the raw snapshot = shipped', JSON.stringify([o.beta, o.b0, o.loo, o.calib]) === JSON.stringify([OD.beta, OD.b0, OD.loo, OD.calib]), `AUC ${o.loo.auc}`);
  // Shipped vs every ledger row on the six held-out scores (higher R2/rho, lower |e|); a tie is within 0.005.
  const W = F.wf.pooled, ship = [F.loo.r2, F.loo.rho, -F.loo.l1, W.r2, W.rho, -W.l1], lose = [];
  for (const t of F.ledger) [t.r2, t.rho, -t.l1, t.wr2, t.wrho, -t.wl1].forEach((x, j) => { if (x > ship[j] + 0.005) lose.push(`${t.name}#${j}`); });
  ok('ledger: shipped is best or tied (0.005) on every out-of-time score vs every row', !lose.some((l) => /#[345]$/.test(l)), lose.join(', ') || 'no row beats it');
  ok('ledger: dropping TVL, the family, 7d growth or age loses on LOO R2, LOO rho and all three walk-forward scores', F.ledger.slice(0, 5).filter((_, i) => i !== 3).every((t) => t.r2 < F.loo.r2 && t.rho < F.loo.rho && t.wr2 < W.r2 && t.wrho < W.rho && t.wl1 > W.l1), F.ledger.slice(0, 5).map((t) => `${t.name} ${t.r2}/${t.wrho}`).join('; '));
  ok('odds: Brier skill > 0 in every walk-forward cohort', OD.wf.folds.every((f) => f.m.bss > 0), OD.wf.folds.map((f) => f.m.bss).join(', '));
  console.log('INFO  ledger rows beating shipped beyond 0.005 (blind LOO only): ' + (lose.join(', ') || 'none'));
}
ok('cross: odds model validated blind (LOO AUC > 0.5, Brier beats base rate, walk-forward AUC > 0.5)', OD.loo.auc > 0.5 && OD.loo.brier < OD.loo.base_brier && OD.wf.pooled.auc > 0.5, `LOO AUC ${OD.loo.auc} Brier ${OD.loo.brier} vs ${OD.loo.base_brier}; WF AUC ${OD.wf.pooled.auc}`);
ok('cross: log TVL elasticity non-negative', F.elasticity >= 0, String(F.elasticity));
ok('cross: verdict counts match board per tier', MD.tiers.every((dep) => ['FARM', 'THIN', 'SKIP'].every((v) => data.verdicts[dep][v] === rows.filter((r) => r.verdict_by_deposit[dep] === v).length)), MD.tiers.map((dep) => `${dep}:${data.verdicts[dep].FARM}/${data.verdicts[dep].THIN}/${data.verdicts[dep].SKIP}`).join(' '));
ok('cross: watchlist rows all present in data.js', data.rows.filter((d) => d.seg === 'W').length === snapshot.watchlist.length);
const fn = data.funnel;
ok('cross: the funnel adds up to every protocol', fn.comps + fn.token_other + fn.watchlist + fn.emerging + fn.aside_above + fn.screened_below === fn.total && fn.total === snapshot.protocols.length);
{
  const A = data.U, dc = (k) => A.filter((a) => a.d === k).map((a) => a.s).sort();
  const once = A.length === snapshot.protocols.length && new Set(A.map((a) => a.s)).size === A.length && A.every((a) => slugs.has(a.s));
  const comp = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd >= MD.comp_min && p.tvl_usd >= MD.comp_min).map((p) => p.slug).sort();
  const ranked = [...dc('W'), ...dc('E')].sort(), boardSl = rows.map((r) => r.slug).sort();
  const tokenK = dc('K').every((s) => { const p = snapBy.get(s); return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null; });
  const asideOk = [...dc('A'), ...dc('X')].every((s) => { const p = snapBy.get(s); return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; });
  const counts = { W: fn.watchlist, E: fn.emerging, C: fn.comps, K: fn.token_other, A: fn.aside_above, X: fn.screened_below };
  ok('accounting: 758/758, every snapshot protocol in exactly one disposition with a reason', once && A.every((a) => a.why.length >= 20), `${A.length}/${snapshot.protocols.length}`);
  ok('accounting: disposition counts = funnel', Object.entries(counts).every(([k, n]) => dc(k).length === n), Object.entries(counts).map(([k, n]) => `${k}${n}`).join(' '));
  ok('accounting: W = watchlist, W+E = board rows, C = comps, K tokened, A/X untokened', JSON.stringify(dc('W')) === JSON.stringify([...snapshot.watchlist].sort()) && JSON.stringify(ranked) === JSON.stringify(boardSl) && JSON.stringify(dc('C')) === JSON.stringify(comp) && tokenK && asideOk);
  ok('accounting: held-out token probability in (0, 1) for all 758', A.every((a) => a.pt > 0 && a.pt < 1));
}
ok('cross: every board row records no token', rows.every((r) => { const p = snapBy.get(r.slug); return p.mcap_usd === null && p.gecko_id === null && p.symbol === null; }));
ok('cross: bands bracket the mid', rows.every((r) => r.implied_low_usd <= r.implied_value_usd && r.implied_value_usd <= r.implied_high_usd));
let bkBad = 0;
const bkInfo = [];
for (const dep of MD.tiers) {
  const { picks, ...b } = KM.basket(data.rows, dep), s = data.baskets[dep];
  const sleeve = dep / MD.sleeves, ps = s.slugs.map((x) => data.rows.find((r) => r.slug === x));
  const sleeveOk = ps.every((r) => tier(r.f, sleeve).verdict === 'FARM');
  const perCat = ps.reduce((a, r) => ((a[r.cat] = (a[r.cat] || 0) + 1), a), {});
  const distinct = new Set(ps.map((r) => r.f.chain)).size === ps.length && Object.values(perCat).every((n) => n <= MD.cat_max);
  const sum = rnd(ps.reduce((a, r) => a + tier(r.f, sleeve).net[1], 0), 2);
  if (JSON.stringify(b) !== JSON.stringify(s) || !sleeveOk || !distinct || ps.length > MD.sleeves || (dep >= 10000 && ps.length !== MD.sleeves) || sum !== s.net) bkBad++;
  bkInfo.push(`${dep}:${ps.length} net ${s.net}`);
}
ok('cross: farm basket per tier rebuilds (sleeve math summed independently); FARM sleeves, distinct home chains, <= 2 per category, 4 sleeves at $10k and $50k', bkBad === 0, bkInfo.join(' '));
ok('cross: dashboard source <= 65,000 bytes (whole inside the 65,536-byte dossier text)', totalBytes <= 65000, `${totalBytes} bytes`);

// ---------------------------------------------------------------- determinism (optional second run)
if (outDir2) {
  const b2 = readFileSync(join(outDir2, 'board.json'));
  const d2 = readFileSync(join(outDir2, 'dossier.json'));
  ok('determinism: board.json byte-identical across runs', Buffer.compare(readFileSync(join(out, 'board.json')), b2) === 0);
  ok('determinism: dossier.json byte-identical across runs', Buffer.compare(written, d2) === 0);
}

console.log(`\n${fail.length === 0 ? 'ALL GATE CHECKS PASS' : fail.length + ' FAILURES: ' + fail.join('; ')}`);
process.exit(fail.length === 0 ? 0 : 1);
