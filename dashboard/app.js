'use strict';
// Kestrel Token Radar v7 (kestrel-8): renders window.RADAR (data.js, built by main.ts from the sealed
// snapshot). valuation(), odds(), farmTier() and basket() mirror lib/model.ts line for line, and
// integrity() proves on boot that every row recomputes to board.json.

const R = window.RADAR, M = R.model, F = R.fit, O = R.odds;
const S = { tier: 10000, tab: 'board', q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1, open: null, aq: '', ad: 'all' };
const TABS = [['board', 'Board'], ['audit', 'All 758 / Audit'], ['method', 'Methodology']];
const HISTORY = [['R3 group ridge', 0.153, 0.106, 0.216], ['v4 growth/age offsets', 0.133, 0.091, 0.183], ['v5 pass-through family', 0.207, 0.203, 0.396]];
const DISP = { W: 'Watchlist, ranked', E: 'Emerging, ranked', C: 'Traded comp', K: 'Token, outside comps', A: 'Set aside ≥ floor', X: 'Screened < floor' };

// ---------------------------------------------------------------- format
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const rd = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
function usd(n, dp) {
  const a = Math.abs(n), s = n < 0 ? '−$' : '$';
  if (a >= 1e9) return s + (a / 1e9).toFixed(dp ?? 2) + 'B';
  if (a >= 1e6) return s + (a / 1e6).toFixed(dp ?? 1) + 'M';
  if (a >= 1e4) return s + (a / 1e3).toFixed(dp ?? 1) + 'k';
  return s + (a >= 100 ? a.toFixed(0) : a.toFixed(2));
}
const pc = (n, dp = 1) => { const v = rd(n, dp); return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%'; };
const pp = (p) => Math.round(100 * p) + '%';
const usd0 = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const tl = (d) => '$' + d / 1000 + 'k';
const sign = (n) => { const v = rd(n, 1); return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; };
const ageTxt = (a) => (a === null ? 'undated' : a < 365 ? Math.max(1, Math.round(a / 30)) + ' mo' : (a / 365).toFixed(1) + ' y');
const pill = (v) => `<span class="pill ${v}">${v}</span>`;
const short = (n) => { const s = n.replace(/ (Financial|Protocol|Capital|Network|Finance|Money|Labs|Curation|Vaults|Pooling|by Wintermute|Earn)$/, ''); return s.length <= 12 ? s : s.split(' ')[0]; };
const carry = (r) => rd(M.benchmark_apy + r.route.prem - r.route.apy, 2);
const f3 = (x) => x.toFixed(3);

// ---------------------------------------------------------------- the models, as the page recomputes them

/** Implied FDV if a token launches: ybar + Σ b·z(x), plus the sign-constrained record terms. */
function valuation(r) {
  const terms = r.x.map((v, j) => F.beta[j] * ((v - F.mu[j]) / F.sd[j]));
  const base = terms.reduce((a, t) => a + t, F.ybar);
  const growth = (F.k * clamp(r.chg ?? 0, -M.growth_cap_pct, M.growth_cap_pct)) / 100;
  const season = Math.log(1 - F.d * Math.exp(-(r.age ?? M.unknown_age_days) / F.T));
  return { base, growth, season, terms, fdv: Math.max(1, Math.round(Math.exp(base + growth + season))) };
}

/** Launch odds: the fitted launch curve F at age a and a + H, then P = (F(a+H) − F(a)) / (1 − F(a)). */
const COL = { 'log age': (r, a) => rd(Math.log((a + M.odds_age_pad_days) / 365), 6), undated: (r, a, u) => u, 'category rate': (r) => rd(O.cat_logit[r.cat] ?? O.prior_logit, 6),
  'log TVL': (r) => rd(Math.log(r.tvl), 4), 'log chains': (r) => rd(Math.log(Math.max(1, r.chains.length)), 4), '7d growth': (r) => clamp(r.chg ?? 0, -M.growth_cap_pct, M.growth_cap_pct) / 100 };
const curve = (x) => 1 / (1 + Math.exp(-x.reduce((a, v, j) => a + O.beta[j] * ((v - O.mu[j]) / O.sd[j]), O.b0)));
function odds(r, age = r.age) {
  const u = r.age === null ? 1 : 0, a = age ?? M.unknown_age_days;
  const fa = curve(O.terms.map((t) => COL[t](r, a, u))), fb = curve(O.terms.map((t) => COL[t](r, a + O.horizon_days, u)));
  return { fa, fb, p: rd(clamp((fb - fa) / Math.max(1e-9, 1 - fa), 0, 1), 4) };
}

/** One deposit, two outcomes: token ships (odds p, drop paid) or not (no drop); costs paid either way. */
function farmTier(f, deposit) {
  const dq = R.drop_q;
  const prior = Math.min(f.age ?? M.prior_season_cap_days, M.prior_season_cap_days);
  const days = f.weeks * 7;
  const tshare = days / (days + prior);
  const perDollar = (q) => ((dq[q] / 100) * f.share * f.fdv[q] * tshare) / f.tvl;
  const txs = M.tx_base + Math.ceil(f.weeks / M.tx_per_weeks);
  const gas = rd(txs * f.gas_tx, 2);
  const carryRate = ((M.benchmark_apy + f.prem - f.apy) / 100) * (days / 365);
  const carry = rd(deposit * carryRate, 2);
  const cost = gas + f.bridge + carry;
  const ann = (n) => rd((((100 * n) / deposit) * 365) / days, 2);
  const ev_if = [0, 1, 2].map((q) => rd(deposit * perDollar(q), 2));
  const ev = ev_if.map((e) => rd(f.p * e, 2));
  const net_if = ev_if.map((e) => rd(e - cost, 2)), net_none = rd(-cost, 2);
  const net = ev.map((e) => rd(e - cost, 2));
  const roi = net.map((n) => rd((100 * n) / deposit, 2));
  const apr = roi.map((x) => rd((x * 365) / days, 2));
  const edge = f.p * perDollar(1) - carryRate;
  const verdict = apr[1] >= M.farm_apr && apr[0] >= M.farm_p25_apr ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP';
  return { deposit, ev_if, ev, gas, bridge: f.bridge, carry, net_if, net_none, net, roi, apr, apr_if: net_if.map(ann), apr_none: ann(net_none), txs, tshare, breakeven: edge > 0 ? Math.ceil((gas + f.bridge) / edge) : null, verdict, whale: deposit > M.whale_tvl_share * f.tvl };
}
const T = (r, d = S.tier) => ((r._t ??= {})[d] ??= farmTier(r.f, d));

/** The diversified basket: equal sleeves, greedy by sleeve-size p50 APR, one per home chain, ≤ 2 per category. */
function basket(total) {
  const sl = total / M.basket_n;
  const c = R.rows.map((r, i) => ({ r, i, t: farmTier(r.f, sl) })).filter((x) => x.t.verdict === 'FARM').sort((a, b) => b.t.apr[1] - a.t.apr[1] || a.i - b.i);
  const p = [], ch = new Set(), ca = {};
  for (const x of c) {
    if (p.length >= M.basket_n) break;
    if (ch.has(x.r.f.chain) || (ca[x.r.cat] ?? 0) >= M.basket_cat_max) continue;
    ch.add(x.r.f.chain); ca[x.r.cat] = (ca[x.r.cat] ?? 0) + 1; p.push(x);
  }
  const sum = (g) => rd(p.reduce((a, x) => a + g(x.t), 0), 2);
  return { p, sl, net: sum((t) => t.net[1]), p25: sum((t) => t.net[0]), costs: sum((t) => t.gas + t.bridge), carry: sum((t) => t.carry), apr: p.length ? rd(p.reduce((a, x) => a + x.t.apr[1], 0) / p.length, 2) : 0, any: 1 - p.reduce((a, x) => a * (1 - x.r.f.p), 1) };
}

/** Boot-time proof: every protocol accounted once, every row's FDV, odds and three verdicts = board, signs hold. */
function integrity() {
  const by = R.all.reduce((a, x) => ((a[x.d] = (a[x.d] || 0) + 1), a), {});
  const live = R.rows.filter((r) => valuation(r).fdv === r.fdv && odds(r).p === r.f.p && M.tiers.every((d) => T(r, d).verdict === r.b[d][0] && T(r, d).apr[1] === r.b[d][1])).length;
  let mono = 0;
  for (const r of R.rows) {
    const v = r.fdv, c = r.chg ?? 0, older = (r.age ?? M.unknown_age_days) + 90;
    mono += (valuation({ ...r, chg: c + 5 }).fdv >= v) + (valuation({ ...r, chg: c - 5 }).fdv <= v) + (valuation({ ...r, age: older }).fdv >= v) + (odds(r, older).p <= r.f.p);
  }
  const fn = R.funnel, parts = [by.W, by.E, by.C, by.K, by.A, by.X];
  return { by, acc: parts.reduce((a, n) => a + (n || 0), 0), wl: R.rows.filter((r) => r.seg === 'W').length, live, mono, ok: by.W === fn.watchlist && by.E === fn.emerging && by.C === fn.comps && by.K === fn.token_other && by.A === fn.aside_above && by.X === fn.screened_below };
}
const I = integrity();

// ---------------------------------------------------------------- filters and sort
const CATS = [...new Set(R.rows.map((r) => r.cat))].sort();
const CHAINS = Object.entries(R.rows.reduce((a, r) => ((a[r.f.chain] = (a[r.f.chain] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([c]) => c);
const KEYS = { r: (r) => r.r, name: (r) => r.name.toLowerCase(), tvl: (r) => r.tvl, chg: (r) => r.chg ?? -1e9, p: (r) => r.f.p, fdv: (r) => r.fdv, apr: (r) => T(r).apr[1], be: (r) => T(r).breakeven ?? 1e12, v: (r) => ['FARM', 'THIN', 'SKIP'].indexOf(T(r).verdict) };
const vOk = (r) => S.v === 'all' || (S.v === 'EV' ? T(r).verdict !== 'SKIP' : T(r).verdict === S.v);
function view() {
  const q = S.q.trim().toLowerCase();
  const rows = R.rows.filter((r) => (S.seg === 'all' || r.seg === S.seg) && vOk(r) && (S.cat === 'all' || r.cat === S.cat) &&
    (S.chain === 'all' || r.f.chain === S.chain) && (!q || (r.name + ' ' + r.slug + ' ' + r.cat + ' ' + r.chains.join(' ')).toLowerCase().includes(q)));
  const k = KEYS[S.sort];
  return rows.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : a.r - b.r) * S.dir);
}

// ---------------------------------------------------------------- shell
function header() {
  const v = R.rows.reduce((a, r) => ((a[T(r).verdict] += 1), a), { FARM: 0, THIN: 0, SKIP: 0 }), tvl = R.rows.reduce((a, r) => a + r.tvl, 0);
  const best = R.rows.reduce((b, r) => (T(r).apr[1] > T(b).apr[1] ? r : b), R.rows[0]);
  const W = R.rows.filter((r) => r.seg === 'W'), wv = W.reduce((a, r) => ((a[T(r).verdict] += 1), a), { FARM: 0, THIN: 0, SKIP: 0 });
  const ok = (c) => `<b class="${c ? 'ck' : 'bad'}">${c ? '✓' : '✗'}</b>`, n = R.rows.length;
  $('#top').innerHTML = `<div class="brand"><div><h1><b>KESTREL</b> Token Launch Radar</h1>
    <p>Every pre-token protocol in the sealed DefiLlama snapshot, priced if it launches (ridge on ${F.n_comps} traded comps), weighted by its odds of launching within 12 months (logistic launch curve on all ${O.n} protocols), then netted to a two-outcome farm verdict.</p></div>
    <div class="cap" role="group" aria-label="Capital per farm"><span>Capital per farm</span>${M.tiers.map((d, i) => `<button data-tier="${d}" class="${d === S.tier ? 'on' : ''}">${tl(d)}<small>${['retail', 'active', 'whale'][i]}</small></button>`).join('')}</div>
    <div class="stamp">${esc(R.version)} · snapshot ${R.as_of}<br>${R.funnel.total} protocols → ${n} ranked</div></div>
  <div class="strip">${ok(I.acc === R.funnel.total && I.ok)} <span><b>${I.acc}/${R.funnel.total}</b> protocols accounted, each once</span>${ok(I.wl === R.funnel.watchlist)} <span><b>${I.wl}/${R.funnel.watchlist}</b> watchlist ranked</span>${ok(I.live === n)} <span><b>${I.live}/${n}</b> rows: FDV, P(token) and 3-tier two-outcome verdicts recomputed live = board.json</span>${ok(I.mono === 4 * n)} <span><b>${I.mono}/${4 * n}</b> monotone sign checks</span></div>
  ${S.tab !== 'board' ? '' : `<div class="kpis">
    <div class="kpi"><label>Watchlist covered</label><b>${I.wl}<i>/${R.funnel.watchlist}</i></b><span>${wv.FARM} FARM · ${wv.THIN} THIN · ${wv.SKIP} SKIP at ${tl(S.tier)}</span></div>
    <div class="kpi"><label>Ranked pre-token</label><b>${n}<i> of ${R.funnel.total}</i></b><span>${R.funnel.watchlist} watchlist + ${R.funnel.emerging} emerging</span></div>
    <div class="kpi"><label>Untokened TVL ranked</label><b>${usd(tvl)}</b><span>risk-adj value ${usd(R.rows.reduce((a, r) => a + r.fdv * r.f.p, 0))}</span></div>
    <div class="kpi wide"><label>Verdicts at ${tl(S.tier)}</label><b><em class="FARM">${v.FARM}</em> · <em class="THIN">${v.THIN}</em> · <em class="SKIP">${v.SKIP}</em></b>
      <div class="mix">${['FARM', 'THIN', 'SKIP'].map((k) => `<i class="${k}" style="flex:${v[k]}"></i>`).join('')}</div></div>
    <div class="kpi"><label>Best risk-adj farm</label><b class="${sign(T(best).apr[1])}">${pc(T(best).apr[1])}</b><span>${esc(best.name)} · P(token) ${pp(best.f.p)}</span></div>
    <div class="kpi"><label>Held-out models</label><b>R² ${F.loo.r2.toFixed(3)}<i> · AUC ${O.loo.auc.toFixed(2)}</i></b><span>LOO value + odds · walk-fwd ρ ${F.wf.pooled.rho.toFixed(2)}</span></div>
  </div>`}`;
  $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}${k === 'board' ? ` <small>${n}</small>` : ''}</button>`).join('') +
    `<span class="note">P(token) = odds of a token within ${O.horizon_days / 30.4 | 0} months · net APR = blended over both outcomes</span>`;
}

function filters(n) {
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<div class="filters">
    <input id="q" type="search" placeholder="Search protocols" value="${esc(S.q)}" aria-label="Search">
    <select id="seg" aria-label="Segment">${opt('all', 'All segments', S.seg)}${opt('W', 'Watchlist (40)', S.seg)}${opt('E', `Emerging (${R.funnel.emerging})`, S.seg)}</select>
    <div class="chips" role="group" aria-label="Verdict">${[['all', 'All'], ['FARM', 'FARM'], ['THIN', 'THIN'], ['SKIP', 'SKIP'], ['EV', 'p50 > 0']].map(([v, l]) => `<button data-v="${v}" class="${v} ${S.v === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    <select id="cat" aria-label="Category">${opt('all', 'All categories', S.cat)}${CATS.map((c) => opt(c, c, S.cat)).join('')}</select>
    <select id="chain" aria-label="Home chain">${opt('all', 'All home chains', S.chain)}${CHAINS.map((c) => opt(c, c, S.chain)).join('')}</select>
    <button id="reset" class="ghost">Reset</button><span class="count"><b>${n}</b> of ${R.rows.length}</span></div>`;
}

// ---------------------------------------------------------------- board
const LO = Math.log(1e6), HI = Math.log(3e8);
const bx = (v) => clamp(((Math.log(v) - LO) / (HI - LO)) * 100, 0, 100);
function board() {
  const rows = view();
  const th = (k, l, cls = '') => `<th class="${cls}${S.sort === k ? ' sorted' : ''}" data-sort="${k}" aria-sort="${S.sort === k ? (S.dir > 0 ? 'ascending' : 'descending') : 'none'}">${l}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const body = rows.map((r) => {
    const t = T(r), c = r.chg ?? 0;
    return `<tr data-slug="${r.slug}" tabindex="0"><td class="rk">${r.r}</td>
      <td class="pn"><b>${esc(r.name)}</b><span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCH' : 'EMERG'}</span><small>${esc(r.cat)} · ${esc(r.f.chain)}${r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''} · ${ageTxt(r.age)}</small></td>
      <td class="n">${usd(r.tvl)}</td><td class="n"><span class="trend ${sign(c)}">${c > 0 ? '▲' : c < 0 ? '▼' : '•'} ${Math.abs(c).toFixed(1)}%</span></td>
      <td class="pt"><b>${pp(r.f.p)}</b><div class="pbar"><i style="width:${100 * r.f.p}%"></i></div></td>
      <td class="fdv"><b>${usd(r.fdv)}</b><small>${usd(r.lo, 0)}–${usd(r.hi, 0)}</small><div class="band"><i style="left:${bx(r.lo)}%;width:${bx(r.hi) - bx(r.lo)}%"></i><u style="left:${bx(r.fdv)}%"></u></div></td>
      <td class="n apr"><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>if token ${pc(t.apr_if[1])}</small></td>
      <td class="n dim">${t.breakeven === null ? '—' : usd0(t.breakeven)}</td><td class="vc">${pill(t.verdict)}</td></tr>`;
  }).join('');
  const side = S.v === 'FARM' ? basketCard() + breakdown(rows) : setups(rows) + coverage();
  return `<div class="cols"><section class="panel tablewrap">${filters(rows.length)}
    <table class="grid" id="grid"><thead><tr>${th('r', '#', 'rk')}${th('name', 'Protocol')}${th('tvl', 'TVL', 'n')}${th('chg', '7d', 'n')}${th('p', 'P(token)')}${th('fdv', 'Implied FDV · Q25–Q75')}${th('apr', `Risk-adj net APR @${tl(S.tier)}`, 'n')}${th('be', 'Break-even', 'n')}${th('v', 'Verdict', 'vc')}</tr></thead>
    <tbody>${body || '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table>
    <p class="foot">Implied FDV is the launch value if a token ships; rank follows it. Risk-adj net APR = P(token) × p50 airdrop − gas − bridge − carry, annualized over the farm window; "if token" is the same farm when the token ships. FARM: risk-adj p50 ≥ ${M.farm_apr}% a year above the ${M.benchmark_apy}% benchmark and route risk premium, and p25 ≥ ${M.farm_p25_apr}%. THIN: positive p50. Click a row for its plan.</p></section>
    <aside class="side">${side}</aside></div>`;
}

function setups(rows) {
  const top = rows.filter((r) => T(r).verdict === 'FARM').sort((a, b) => T(b).apr[1] - T(a).apr[1]).slice(0, 5);
  return `<section class="panel bk"><h3>Top farm setups in view <small>risk-adj p50 net APR · ${tl(S.tier)}</small></h3>
    ${top.length ? `<ol class="bkl">${top.map((r) => `<li data-slug="${r.slug}"><b>${esc(r.name)}</b><small>${esc(r.cat)} · ${esc(r.f.chain)} · break-even ${usd0(T(r).breakeven)}</small><em class="pos">${pc(T(r).apr[1])}</em><span>P ${pp(r.f.p)}</span></li>`).join('')}</ol>` : `<p class="empty">No FARM row at ${tl(S.tier)} in this view.</p>`}</section>`;
}

function basketCard() {
  const b = basket(S.tier), ship = R.baskets[S.tier], ok = ship && JSON.stringify(b.p.map((x) => x.r.slug)) === JSON.stringify(ship.slugs) && b.net === ship.net_p50;
  return `<section class="panel bk"><h3>Portfolio allocator <small>${b.p.length} × ${usd0(b.sl)} · ${ok ? '= data.js ✓' : '≠ data.js ✗'}</small></h3>
    <div class="bkk"><div><label>Net APR</label><b class="${sign(b.apr)}">${pc(b.apr)}</b></div><div><label>p50 profit</label><b class="${sign(b.net)}">${usd0(b.net)}</b><small>p25 ${usd0(b.p25)}</small></div>
      <div><label>Gas+bridge</label><b>${usd0(b.costs)}</b><small>carry ${usd0(b.carry)}</small></div><div><label>≥1 launch</label><b>${pp(b.any)}</b><small>in 12 months</small></div></div>
    ${b.p.length ? `<ol class="bkl">${b.p.map((x) => `<li data-slug="${x.r.slug}"><b>${esc(x.r.name)}</b><small>${esc(x.r.cat)} · ${esc(x.r.f.chain)} · P ${pp(x.r.f.p)} · ${x.r.f.weeks} wk</small><em class="pos">${pc(x.t.apr[1])}</em><span>${usd0(x.t.net[1])}</span></li>`).join('')}</ol>` : `<p class="empty">No FARM sleeve at ${usd0(b.sl)}.</p>`}
    <p class="mini">Greedy by risk-adj APR at the sleeve's own size, FARM rows only, one sleeve per home chain and at most ${M.basket_cat_max} per category.</p></section>`;
}

function breakdown(rows) {
  const bars = (key, l, k) => { const e = Object.entries(rows.reduce((a, r) => ((a[key(r)] = (a[key(r)] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k), mx = Math.max(1, ...e.map((x) => x[1]));
    return `<h3 class="sub">${l}</h3>${e.map(([k, n]) => `<div class="hb"><span>${esc(k)}</span><i style="width:${(100 * n) / mx}%"></i><b>${n}</b></div>`).join('')}`; };
  return `<section class="panel"><h3>FARM in view <small>${rows.length} rows at ${tl(S.tier)}</small></h3>${bars((r) => r.cat, 'By category', 4)}${bars((r) => r.f.chain, 'By home chain', 5)}</section>`;
}

function coverage() {
  const W = R.rows.filter((r) => r.seg === 'W'), free = W.filter((r) => carry(r) <= 0), act = W.filter((r) => r.x[1] === 0);
  return `<section class="panel"><h3>Watchlist coverage <small>${W.length}/${R.funnel.watchlist} ranked · ${tl(S.tier)}</small></h3>
    <div class="matrix">${W.map((r) => `<button data-slug="${r.slug}" class="${T(r).verdict}${free.includes(r) ? ' fo' : ''}${r.x[1] === 0 ? ' ac' : ''}" title="#${r.r} ${esc(r.name)} · ${usd(r.fdv)} · P ${pp(r.f.p)} · ${pc(T(r).apr[1])}">${esc(short(r.name))}</button>`).join('')}</div>
    <p class="mini"><b class="fo">◆ ${free.length} zero-carry</b>: base yield covers benchmark + premium, so the no-token outcome costs only gas. <b class="ac">▲ ${act.length} own-fee</b>: usage earns points. Large vaults spread a drop over billions of TVL.</p></section>`;
}

// ---------------------------------------------------------------- drawer
function openDrawer(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  S.open = slug;
  const v = valuation(r), o = odds(r), t = T(r), ts = M.tiers.map((d) => T(r, d));
  const fac = [['Comp at sample mean (exp ȳ)', Math.exp(F.ybar)], [`× TVL ${usd(r.tvl)} (elasticity ${F.elasticity.toFixed(2)})`, Math.exp(v.terms[0])], [`× ${r.x[1] ? 'Pass-through' : 'Own-fee'} family (${esc(r.cat)})`, Math.exp(v.terms[1])],
    [`× 7-day growth ${pc(r.chg ?? 0)} (k ${F.k})`, Math.exp(v.growth)], [`× Seasoning ${ageTxt(r.age)}, no token (d ${F.d})`, Math.exp(v.season)]];
  const row = (l, fn, cls = '') => `<tr class="${cls}"><td>${l}</td>${ts.map((x) => `<td class="n${x.deposit === S.tier ? ' cur' : ''}">${fn(x)}</td>`).join('')}</tr>`;
  const sec = (l) => `<tr class="sec"><td colspan="4">${l}</td></tr>`;
  const d = $('#drawer');
  d.innerHTML = `<header class="dh"><div><h2>${esc(r.name)} <span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCHLIST' : 'EMERGING'}</span></h2>
      <p>rank <b>#${r.r}</b> of ${R.rows.length} by implied FDV · ${esc(r.cat)} · home chain <b>${esc(r.f.chain)}</b>${r.chains.length > 1 ? ` (+${r.chains.length - 1})` : ''} · TVL <b>${usd(r.tvl)}</b> · 7d <b class="${sign(r.chg ?? 0)}">${pc(r.chg ?? 0)}</b> · ${ageTxt(r.age)} tracked, no token</p></div>
    <div class="dk"><div><label>Implied FDV</label><b>${usd(r.fdv)}</b><small>Q25–Q75 ${usd(r.lo)}–${usd(r.hi)}</small></div><div><label>P(token) 12 mo</label><b>${pp(r.f.p)}</b><small>risk-adj ${usd(r.fdv * r.f.p)}</small></div><div><label>Risk-adj APR @${tl(S.tier)}</label><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>if token ${pc(t.apr_if[1])}</small></div>${pill(t.verdict)}<button class="ghost" id="close" aria-label="Close">Close ✕</button></div></header>
  <div class="dgrid"><div>
    <h3>Valuation waterfall <small>${v.fdv === r.fdv ? '✓ recomputed = board' : '✗'}</small></h3>
    <table class="wf">${fac.map(([l, x], i) => `<tr><td>${l}</td><td class="n ${i && x < 1 ? 'neg' : i ? 'pos' : ''}">${i ? '×' + x.toFixed(3) : usd(x)}</td></tr>`).join('')}
      <tr class="tot"><td>= Implied FDV · ${(r.fdv / r.tvl).toFixed(2)}× TVL</td><td class="n">${usd(r.fdv)}</td></tr></table>
    <p class="mono">exp(${F.ybar.toFixed(3)} ${v.terms.map((x) => (x < 0 ? '− ' : '+ ') + Math.abs(x).toFixed(3)).join(' ')} ${v.growth < 0 ? '−' : '+'} ${Math.abs(v.growth).toFixed(3)} − ${Math.abs(v.season).toFixed(3)}) = ${v.fdv.toLocaleString('en-US')} ${v.fdv === r.fdv ? '✓ board' : '✗'}</p>
    <h3>Peer comps <small>FDV or mcap per $ of TVL</small></h3>${peers(r)}
    <h3>Launch odds <small>${o.p === r.f.p ? '✓ recomputed = board' : '✗'}</small></h3>
    <div class="odds"><div><label>Peers token by now</label><b>${pp(o.fa)}</b><small>F(${ageTxt(r.age)})</small></div><div><label>…by +12 months</label><b>${pp(o.fb)}</b><small>F(age + 1 y)</small></div><div><label>P(token)</label><b class="cy">${pp(o.p)}</b><small>conditional</small></div></div>
    <p class="mini">(${pp(o.fb)} − ${pp(o.fa)}) ÷ (100% − ${pp(o.fa)}): of look-alike protocols still without a token at this age, the share that issue one within a year, from the fitted launch curve on ${esc(r.cat)}, ${usd(r.tvl)} TVL and age.</p>
    <h3>Cost and risk checklist <small>at ${tl(S.tier)}</small></h3>
    <div class="mono4">${[['Gas', `${usd(t.gas)} · ${t.txs} tx on ${esc(r.f.chain)}`], ['Bridge', r.f.bridge ? usd(r.f.bridge) + ' off Ethereum' : 'none, Ethereum'], ['Carry', `${M.benchmark_apy} + ${r.route.prem} − ${r.route.apy}% base = ${usd(t.carry)}`], ['If no token', usd(t.net_none)], ['Main risk', esc(r.route.risk)], ['Size', t.whale ? '&gt; 1% of TVL: scale down' : 'under 1% of TVL']].map(([k, x]) => `<div><span>${k}</span><b>${x}</b></div>`).join('')}</div>
  </div><div>
    <h3>Two-outcome economics <small>${r.f.weeks}-week farm window</small></h3>
    <table class="mt fe"><tr><th></th>${ts.map((x) => `<th class="n${x.deposit === S.tier ? ' cur' : ''}">${tl(x.deposit)}</th>`).join('')}</tr>
      ${row(`Gas ${t.txs} tx + bridge`, (x) => '−' + usd(x.gas + x.bridge))}${row(`Carry ${carry(r)}%/yr`, (x) => (x.carry > 0 ? '−' : '+') + usd(Math.abs(x.carry)))}
      ${sec(`A · Token ships · ${pp(r.f.p)}`)}${row('Airdrop, p50', (x) => usd(x.ev_if[1]))}${row('Net APR if token', (x) => `<b class="${sign(x.apr_if[1])}">${pc(x.apr_if[1])}</b>`)}
      ${sec(`B · No token · ${pp(1 - r.f.p)}`)}${row('Net: no drop, costs', (x) => `<b class="${sign(x.net_none)}">${usd(x.net_none)}</b>`)}${row('Net APR, no token', (x) => `<span class="${sign(x.apr_none)}">${pc(x.apr_none)}</span>`)}
      ${sec('Blended expectation')}${row('Expected drop, p50', (x) => usd(x.ev[1]))}${row('Net, p50', (x) => `<b class="${sign(x.net[1])}">${usd(x.net[1])}</b>`)}${row('Risk-adj APR, p50', (x) => `<b class="${sign(x.apr[1])}">${pc(x.apr[1])}</b>`, 'hi')}
      ${row('p25 … p75', (x) => `<small>${pc(x.apr[0], 0)} … ${pc(x.apr[2], 0)}</small>`)}${row('Break-even', (x) => (x.breakeven === null ? '—' : usd0(x.breakeven)))}${row('Verdict', (x) => pill(x.verdict) + (x.whale ? '<br><small class="warn">&gt;1% of TVL</small>' : ''))}</table>
    <h3>Sensitivity <small>net APR by deposit, both outcomes blended</small></h3>${sens(r.f)}
    <p class="mini">Drop p50 = ${R.drop_q[1]}% of supply (median of 12 launches) × ${r.f.share} route share × FDV × ${(100 * t.tshare).toFixed(0)}% of the season.${carry(r) <= 0 ? ` Zero carry: the ${r.route.apy}% base APY covers benchmark + premium, so outcome B costs only gas.` : ''}</p>
  </div><div>
    <h3>Farm plan on ${esc(r.f.chain)} <small>${r.steps.length} steps, cost and time each</small></h3>
    <ol class="plan">${r.steps.map((s) => `<li><p>${esc(s.action)}</p><span><i>Cost</i>${esc(s.cost)}</span> <span><i>Time</i>${esc(s.time)}</span></li>`).join('')}</ol>
  </div></div>`;
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;
  $('#close').onclick = closeDrawer;
}
function closeDrawer() { S.open = null; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }

/** The row's implied FDV/TVL beside its three traded anchors' mcap/TVL on one log axis (0.01× to 30×). */
function peers(r) {
  const list = [{ n: r.name, m: r.fdv / r.tvl, me: 1 }].concat(r.anchors.map((a) => ({ n: a.name, m: a.mult })));
  const W = 318, L = 122, X = (m) => L + ((Math.log10(clamp(m, 0.01, 30)) + 2) / Math.log10(3000)) * (W - L - 44);
  const nm = (s) => (s.length <= 20 ? s : s.slice(0, 20).replace(/\s+\S*$/, ''));
  return `<svg class="chart peer" viewBox="0 0 ${W} ${list.length * 22 + 20}" role="img" aria-label="Peer multiples">${[0.01, 0.1, 1, 10].map((m) => `<line x1="${X(m)}" x2="${X(m)}" y1="4" y2="${list.length * 22 + 4}" class="gl"/><text x="${X(m)}" y="${list.length * 22 + 16}" text-anchor="middle">${m}×</text>`).join('')}
    ${list.map((p, i) => `<text x="6" y="${i * 22 + 18}" class="${p.me ? 'me' : ''}">${esc(nm(p.n))}</text><rect x="${L}" y="${i * 22 + 8}" width="${Math.max(2, X(p.m) - L)}" height="13" rx="2" class="${p.me ? 'me' : 'pr'}"/><text x="${X(p.m) + 4}" y="${i * 22 + 18}" class="v">${p.m.toFixed(2)}×</text>`).join('')}</svg>`;
}

/** Risk-adj net APR p25/p50/p75 and the if-token p50 against deposit ($100 to $100k, log x), FARM bar and break-even. */
function sens(f) {
  const W = 440, H = 176, L = 38, B = 22, R0 = 86, xs = [], n = 48;
  for (let i = 0; i <= n; i++) xs.push(100 * 1000 ** (i / n));
  const ts = xs.map((d) => farmTier(f, d)), t = farmTier(f, S.tier);
  const pts = ts.map((x) => [x.apr[0], x.apr[1], x.apr[2], x.apr_if[1]]);
  const lo = Math.max(-30, Math.min(...pts.map((p) => p[0]), -2)), hi = Math.max(M.farm_apr * 3, Math.max(...pts.map((p) => p[3])) * 1.25 + 6);
  const X = (d) => L + (Math.log(d / 100) / Math.log(1000)) * (W - L - R0), Y = (v) => 8 + ((hi - clamp(v, lo, hi)) / (hi - lo)) * (H - B - 8);
  const col = ['#8a97ab', '#38bdf8', '#8a97ab', '#c4b5fd', '#22c55e'], nm = ['p25', 'p50', 'p75', 'if token', 'FARM bar'];
  const tags = [0, 1, 2, 3, 4].map((q) => ({ q, y: Y(q < 4 ? pts[n][q] : M.farm_apr) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < 5; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + 14);
  const line = (q) => `<polyline fill="none" stroke="${col[q]}" stroke-width="${q === 1 ? 2.2 : 1.2}" ${q === 1 ? '' : `stroke-dasharray="${q === 3 ? '1 3' : '3 3'}"`} points="${xs.map((d, i) => X(d).toFixed(1) + ',' + Y(pts[i][q]).toFixed(1)).join(' ')}"/>`;
  const ticks = [0, M.farm_apr, Math.floor(hi / 10) * 10].concat(Y(lo) - Y(0) > 14 ? [Math.ceil(lo)] : []).filter((v, i, a) => a.indexOf(v) === i && v < hi && (v === 0 || Math.abs(Y(v) - Y(M.farm_apr)) > 12 || v === M.farm_apr));
  const be = t.breakeven ? X(clamp(t.breakeven, 100, 1e5)) : 0;
  return `<svg class="chart sens" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net APR sensitivity to deposit size">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R0 + 4}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : v === M.farm_apr ? 'bar' : 'gl'}"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}%</text>`).join('')}
    ${M.tiers.map((d) => `<line x1="${X(d)}" x2="${X(d)}" y1="8" y2="${H - B}" class="${d === S.tier ? 'cur' : 'gl'}"/><text x="${X(d)}" y="${H - 8}" text-anchor="middle">${tl(d)}</text>`).join('')}
    ${line(3)}${line(0)}${line(2)}${line(1)}${tags.map(({ q, y }) => `<text x="${W - R0 + 8}" y="${y + 3}" style="fill:${col[q]}">${nm[q]} ${q < 4 ? pc(pts[n][q], 0) : M.farm_apr + '%'}</text>`).join('')}
    ${be ? `<line x1="${be}" x2="${be}" y1="8" y2="${H - B}" class="be"/><text x="${be + (be > W / 2 ? -4 : 4)}" y="18" text-anchor="${be > W / 2 ? 'end' : 'start'}" class="lbl be">break-even ${usd0(t.breakeven)}</text>` : ''}</svg>`;
}

// ---------------------------------------------------------------- audit: all 758
function audit() {
  const q = S.aq.trim().toLowerCase(), by = I.by, keys = Object.keys(DISP);
  const rows = R.all.filter((a) => (S.ad === 'all' || a.d === S.ad) && (!q || (a.n + ' ' + a.s + ' ' + a.c).toLowerCase().includes(q)));
  return `<section class="panel"><h3>The whole snapshot, accounted for <small>${I.acc}/${R.funnel.total} protocols, each in exactly one bucket ${I.acc === R.funnel.total && I.ok ? '✓' : '✗'}</small></h3>
    <div class="funnel">${keys.map((k) => `<i class="${k}" style="flex:${by[k] || 0}">${by[k] || 0}</i>`).join('')}</div>
    <div class="filters au"><input id="aq" type="search" placeholder="Search all ${R.all.length} protocols" value="${esc(S.aq)}" aria-label="Search all protocols">
      <div class="chips" role="group" aria-label="Disposition"><button data-ad="all" class="${S.ad === 'all' ? 'on' : ''}">All ${R.all.length}</button>${keys.map((k) => `<button data-ad="${k}" class="${S.ad === k ? 'on' : ''}"><i class="dot ${k}"></i>${DISP[k]} ${by[k] || 0}</button>`).join('')}</div><span class="count"><b>${rows.length}</b> shown</span></div>
    <div class="scroll"><table class="mt au"><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th>Disposition</th><th class="n">Held-out F</th><th>Exact reason</th></tr>
    ${rows.map((a) => `<tr${a.d === 'W' || a.d === 'E' ? ` data-slug="${a.s}" class="lnk"` : ''}><td><b>${esc(a.n)}</b></td><td>${esc(a.c)}</td><td class="n">${usd(a.t)}</td><td><span class="disp ${a.d}">${DISP[a.d]}</span></td><td class="n">${pp(a.pt)}</td><td class="why">${esc(a.why)}</td></tr>`).join('')}</table></div>
    <p class="mini">Held-out F: the launch curve's blind leave-one-out odds that a protocol like this one carries a token at its age. Ranked rows open their plan.</p></section>`;
}

// ---------------------------------------------------------------- methodology
function scatter(points, o) {
  const { W, H, x0, x1, y0, y1, xl, yl, fx, fy } = o, L = 50, B = 30;
  const X = (v) => L + ((fx(v) - x0) / (x1 - x0)) * (W - L - 18), Y = (v) => 8 + ((y1 - fy(v)) / (y1 - y0)) * (H - B - 8);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yl)} against ${esc(xl)}">${o.grid(X, Y, L, W, H - B)}${(o.extra || (() => ''))(X, Y)}
    ${points.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 3.2}" class="${p.c}"><title>${esc(p.t)}</title></circle>`).join('')}
    <text x="${(W + L) / 2}" y="${H - 3}" text-anchor="middle" class="ax">${xl}</text><text x="11" y="${(H - B) / 2}" transform="rotate(-90 11 ${(H - B) / 2})" text-anchor="middle" class="ax">${yl}</text></svg>`;
}
function method() {
  const fn = R.funnel, lo = F.loo_points;
  const logGrid = (X, Y, L, W, b) => { let g = ''; for (let e = 7; e <= 10; e++) g += `<line x1="${X(10 ** e)}" x2="${X(10 ** e)}" y1="8" y2="${b}" class="gl"/><text x="${X(10 ** e)}" y="${b + 13}" text-anchor="middle">${usd(10 ** e, 0)}</text><line x1="${L}" x2="${W - 10}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" class="gl"/><text x="${L - 5}" y="${Y(10 ** e) + 3}" text-anchor="end">${usd(10 ** e, 0)}</text>`; return g; };
  const band = (X, Y) => `<polygon points="${X(2e6)},${Y(4e6)} ${X(2e10)},${Y(4e10)} ${X(2e10)},${Y(1e10)} ${X(2e6)},${Y(1e6)}" class="band2"/><line x1="${X(2e6)}" y1="${Y(2e6)}" x2="${X(2e10)}" y2="${Y(2e10)}" class="diag"/>`;
  const l10 = Math.log10, sc = scatter(lo.map((p) => ({ x: p.pred_usd, y: p.mcap_usd, c: Math.abs(p.resid) <= Math.LN2 ? 'in' : 'out', t: `${p.name}: blind ${usd(p.pred_usd)} vs actual ${usd(p.mcap_usd)}` })),
    { W: 440, H: 230, x0: 6.6, x1: 10.2, y0: 6.6, y1: 10.2, fx: l10, fy: l10, xl: 'blind LOO predicted FDV (log)', yl: 'actual mcap (log)', grid: logGrid, extra: band });
  const pGrid = (X, Y, L, W, b) => [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${X(v)}" x2="${X(v)}" y1="8" y2="${b}" class="gl"/>${v ? `<text x="${X(v)}" y="${b + 13}" text-anchor="middle">${pp(v)}</text>` : ''}<line x1="${L}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 5}" y="${Y(v) + 3}" text-anchor="end">${pp(v)}</text>`).join('');
  const cal = scatter(O.calib.map((c) => ({ x: c.pred, y: c.obs, c: 'cal', r: 3 + c.n / 40, t: `${c.n} protocols: predicted ${pp(c.pred)}, observed ${pp(c.obs)}` })),
    { W: 440, H: 190, x0: 0, x1: 1, y0: 0, y1: 1, fx: (v) => v, fy: (v) => v, xl: 'held-out predicted token rate, by quintile', yl: 'observed', grid: pGrid,
      extra: (X, Y) => `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="diag"/><polyline fill="none" class="cl" points="${O.calib.map((c) => X(c.pred).toFixed(1) + ',' + Y(c.obs).toFixed(1)).join(' ')}"/>` });
  const coef = [['log TVL', F.beta[0] / F.sd[0], `×${(10 ** (F.beta[0] / F.sd[0])).toFixed(2)} per 10× TVL`, '≥ 0', true], ['pass-through family', F.beta[1] / F.sd[1], `×${F.pass_mult.toFixed(2)} when TVL is routed capital`, 'free', true],
    ['7-day growth k', F.k, `free fit ${F.free_growth.toFixed(2)} → held in [0.25, 1]`, '≥ 0.25', F.k > 0], ['seasoning depth d', F.d, `free fit ${F.free_age.toFixed(2)} → held in [0.15, 0.5]`, '≥ 0.15', F.d > 0]];
  const mx = Math.max(...coef.map((c) => Math.abs(c[1]))), n = R.rows.length, mono = I.mono === 4 * n;
  const drops = R.drops.slice().sort((a, b) => b[1] - a[1]), DW = 440, bw = (DW - 20) / drops.length, DY = (s) => 84 - (s / 32) * 74;
  const ob = O.terms.map((t, j) => [t, O.beta[j] / O.sd[j]]), parts = [['W', fn.watchlist], ['E', fn.emerging], ['C', fn.comps], ['K', fn.token_other], ['A', fn.aside_above], ['X', fn.screened_below]];
  const st = (l, v, m = '') => `<div><label>${l}</label><b>${v}</b>${m && `<small>${m}</small>`}</div>`;
  return `<div class="mgrid">
  <section class="panel"><h3>Valuation model <small>ridge on ${F.n_comps} traded comps, λ ${F.lam}</small></h3>
    <pre class="eq">log FDV = ${F.ybar.toFixed(3)} + ${f3(F.beta[0] / F.sd[0])}·(log TVL − ${F.mu[0].toFixed(2)})
        ${F.beta[1] / F.sd[1] < 0 ? '−' : '+'} ${f3(Math.abs(F.beta[1] / F.sd[1]))}·(pass − ${F.mu[1].toFixed(2)})
        + ${F.k}·clamp(chg7d, ±30%)
        + log(1 − ${F.d}·e^(−age/${F.T}d))</pre>
    <h3 class="sub">Coefficients and their signs <small>enforced</small></h3>
    ${coef.map(([nm, b, note, box, ok]) => `<div class="cf"><span>${nm}<small>${note}</small></span><div class="cfb"><i class="${b < 0 ? 'neg' : 'pos'}" style="width:${(48 * Math.abs(b)) / mx}%;${b < 0 ? 'right:50%' : 'left:50%'}"></i></div><b>${f3(b)}</b><em>${box} ${ok ? '✓' : '✗'}</em></div>`).join('')}
    <h3 class="sub">Monotonicity proof <small>rechecked live on all ${n} rows</small></h3>
    <div class="mono4">${[['+5pp 7-day growth never lowers FDV', 0], ['−5pp never raises FDV', 1], ['+90 days with no token never lowers FDV', 2], ['+90 days with no token never raises P(token)', 3]].map(([l]) => `<div><span>${l}</span><b class="${mono ? 'pos' : 'neg'}">${mono ? n + '/' + n + ' ✓' : '✗'}</b></div>`).join('')}</div>
    <p class="mini">${I.mono}/${4 * n} checks pass (${mono ? '100' : (100 * I.mono / (4 * n)).toFixed(1)}%). Cost of the sign box: LOO R² ${f3(F.loo.r2)} vs ${f3(F.baselines[0].metrics.r2)} with the record terms off.</p>
    <h3 class="sub">Airdrop calibration <small>community share of supply, 12 launches</small></h3>
    <svg class="chart" viewBox="0 0 ${DW} 118" role="img" aria-label="Airdrop shares">${R.drop_q.map((q, i) => `<line x1="10" x2="${DW - 10}" y1="${DY(q)}" y2="${DY(q)}" class="${i === 1 ? 'bar' : 'gl'}"/>`).join('')}<text x="${DW - 12}" y="16" text-anchor="end" class="lbl farm">p25 / p50 / p75 = ${R.drop_q.join(' / ')}%</text>
      ${drops.map(([nm, s], i) => `<rect x="${10 + i * bw + 3}" y="${DY(s)}" width="${bw - 6}" height="${84 - DY(s)}" rx="2" class="dr"/><text x="${10 + i * bw + bw / 2}" y="${DY(s) - 3}" text-anchor="middle" class="v">${s}</text><text x="${10 + i * bw + bw / 2}" y="${97 + (i % 2) * 14}" text-anchor="middle">${esc(nm.replace(/ S1$/, ''))}</text>`).join('')}</svg></section>
  <section class="panel"><h3>Blind LOO: predicted vs actual FDV <small>${F.n_comps} refits · green within 2×</small></h3>${sc}
    <div class="stats">${st('LOO R²', f3(F.loo.r2))}${st('Nested R²', f3(F.nested.r2))}${st('LOO ρ', f3(F.loo.rho))}${st('Walk-fwd ρ', f3(F.wf.pooled.rho))}</div>
    <h3 class="sub">Held-out P(token) calibration <small>${O.n} protocols · LOO by quintile</small></h3>${cal}
    <div class="stats">${st('LOO Brier', f3(O.loo.brier), `base rate ${f3(O.loo.base_brier)}`)}${st('Log-loss', f3(O.loo.logloss), 'LOO')}${st('ROC-AUC', f3(O.loo.auc), 'LOO')}${st('WF AUC', f3(O.wf.pooled.auc), 'out-of-time')}</div>
    <p class="mini">Launch curve: logistic, λ ${O.lam}, on ${ob.map(([t, b]) => `${t} ${b >= 0 ? '+' : '−'}${Math.abs(b).toFixed(2)}`).join(' · ')} (per unit; category rate = empirical-Bayes logit, m ${O.m}). P(token) = (F(a+1y) − F(a)) ÷ (1 − F(a)).</p></section>
  <section class="panel"><h3>Walk-forward by listing date <small>train older, predict newer</small></h3>
    <table class="mt"><tr><th>Value · test cohort</th><th class="n">n</th><th class="n">R²</th><th class="n">ρ</th></tr>
    ${F.wf.folds.map((f) => `<tr><td>${f.from} → ${f.to}</td><td class="n">${f.train_n}/${f.test_n}</td><td class="n">${f3(f.metrics.r2)}</td><td class="n">${f3(f.metrics.rho)}</td></tr>`).join('')}
    <tr class="tot"><td>Pooled out-of-time</td><td class="n">${F.wf.pooled.n}</td><td class="n">${f3(F.wf.pooled.r2)}</td><td class="n">${f3(F.wf.pooled.rho)}</td></tr></table>
    <table class="mt gap"><tr><th>Odds · test cohort</th><th class="n">n</th><th class="n">AUC</th><th class="n">Brier skill</th></tr>
    ${O.wf.folds.map((f) => `<tr><td>${f.from} → ${f.to}</td><td class="n">${f.train_n}/${f.test_n}</td><td class="n">${f3(f.metrics.auc)}</td><td class="n">${pc(100 * f.metrics.bss, 0)}</td></tr>`).join('')}
    <tr class="tot"><td>Pooled out-of-time</td><td class="n">${O.wf.pooled.n}</td><td class="n">${f3(O.wf.pooled.auc)}</td><td class="n">${pc(100 * O.wf.pooled.bss, 0)}</td></tr></table>
    <h3 class="sub">Version ablation <small>same data, blind</small></h3>
    <table class="mt"><tr><th>Model</th><th class="n">LOO R²</th><th class="n">Nested</th><th class="n">WF ρ</th><th class="n">P AUC</th></tr>${HISTORY.map(([nm, a, b, c]) => `<tr><td>${nm}</td><td class="n">${f3(a)}</td><td class="n">${f3(b)}</td><td class="n">${f3(c)}</td><td class="n dim">P ≡ 1</td></tr>`).join('')}
    <tr class="tot"><td>v7 ${esc(R.version)}</td><td class="n">${f3(F.loo.r2)}</td><td class="n">${f3(F.nested.r2)}</td><td class="n">${f3(F.wf.pooled.rho)}</td><td class="n">${f3(O.loo.auc)}</td></tr></table>
    <p class="mini">v7 searched ${F.features.length} value designs (incl. log TVL² and the category token rate of 758 peers) and ${O.designs.length} odds designs; a term ships only if it beats on both held-out tests. Kept: ${esc(O.terms.join(', '))}.</p>
    <h3 class="sub">${parts.reduce((a, p) => a + p[1], 0)} / ${fn.total} accounting <small>${I.acc === fn.total && I.ok ? 'each protocol once ✓' : '✗'}</small></h3>
    <div class="acc">${parts.map(([k, v]) => `<div><i class="dot ${k}"></i><b>${v}</b><small>${DISP[k]}</small></div>`).join('')}</div></section>
  <section class="panel span"><h3>Feature search, both models <small>every design re-selects its own penalty; ▲ beats the kept design</small></h3><div class="cols two">
    <table class="mt fsr"><tr><th>Value design</th><th class="n">LOO R²</th><th class="n">LOO ρ</th><th class="n">WF ρ</th></tr>${F.features.map((f) => { const k = F.features.find((x) => x.chosen), up = (key) => (f[key] > k[key] && !f.chosen ? ' up' : ''); return `<tr class="${f.chosen ? 'tot' : ''}"><td>${esc(f.name)}</td><td class="n${up('r2')}">${f3(f.r2)}</td><td class="n${up('rho')}">${f3(f.rho)}</td><td class="n${up('wf_rho')}">${f3(f.wf_rho)}</td></tr>`; }).join('')}</table>
    <table class="mt fsr"><tr><th>Odds design (forward)</th><th class="n">LOO log-loss</th><th class="n">LOO AUC</th><th class="n">WF log-loss</th><th class="n">WF AUC</th></tr>${O.designs.map((d) => `<tr class="${d.chosen ? 'tot' : ''}"><td>${esc(d.name)}</td><td class="n">${f3(d.loo.logloss)}</td><td class="n">${f3(d.loo.auc)}</td><td class="n">${f3(d.wf.logloss)}</td><td class="n">${f3(d.wf.auc)}</td></tr>`).join('')}</table></div></section></div>`;
}

// ---------------------------------------------------------------- render and events
function render() {
  header();
  $('#main').innerHTML = { board, audit, method }[S.tab]();
  if (S.open) openDrawer(S.open);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tier],[data-tab],[data-v],[data-ad],[data-sort],[data-slug],#reset,#scrim');
  if (!el) return;
  if (el.id === 'scrim') return closeDrawer();
  if (el.id === 'reset') Object.assign(S, { q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1 });
  else if (el.dataset.tier) S.tier = +el.dataset.tier;
  else if (el.dataset.tab) { S.tab = el.dataset.tab; closeDrawer(); }
  else if (el.dataset.v) S.v = el.dataset.v;
  else if (el.dataset.ad) S.ad = el.dataset.ad;
  else if (el.dataset.sort) { const k = el.dataset.sort; S.dir = S.sort === k ? -S.dir : ['r', 'name', 'be'].includes(k) ? 1 : -1; S.sort = k; }
  else if (el.dataset.slug) return openDrawer(el.dataset.slug);
  render();
});
document.addEventListener('input', (e) => {
  const id = e.target.id;
  if (id === 'q' || id === 'aq') { S[id] = e.target.value; render(); const q = $('#' + id); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener('change', (e) => { if (['seg', 'cat', 'chain'].includes(e.target.id)) { S[e.target.id] = e.target.value; render(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) openDrawer(e.target.dataset.slug);
});
render();
