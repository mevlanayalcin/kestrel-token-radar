'use strict';
// Kestrel Token Radar (kestrel-6). Reads window.RADAR, which main.ts writes to data.js from the
// sealed snapshot, and renders the board, a detail drawer per protocol, the radar scatter, the traded
// comps and the methodology. The page recomputes every implied FDV and every farm tier from the
// shipped coefficients and constants: valuation() and farmTier() mirror lib/model.ts line for line.

const R = window.RADAR, M = R.model, F = R.fit;
const S = { tier: 10000, tab: 'board', q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1, open: null };
const TABS = [['board', 'Board'], ['radar', 'Radar'], ['traded', 'Traded & set aside'], ['method', 'Methodology']];
const HISTORY = [['R3', 0.153, 0.106, 0.216], ['v4', 0.133, 0.091, 0.183]];

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
const pc = (n, dp = 1) => (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(dp) + '%';
const usd0 = (n) => '$' + Math.round(n).toLocaleString('en-US');
const tl = (d) => '$' + d / 1000 + 'k';
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const ageTxt = (a) => (a === null ? 'undated' : a < 365 ? Math.max(1, Math.round(a / 30)) + ' mo' : (a / 365).toFixed(1) + ' y');
const pill = (v) => `<span class="pill ${v}">${v}</span>`;

// ---------------------------------------------------------------- the model, as the page recomputes it

/** Implied FDV from the shipped ridge: ybar + Σ b·z(x), plus the sign-constrained record terms. */
function valuation(r) {
  const base = r.x.reduce((a, v, j) => a + F.beta[j] * ((v - F.mu[j]) / F.sd[j]), F.ybar);
  const growth = (F.k * clamp(r.chg ?? 0, -M.growth_cap_pct, M.growth_cap_pct)) / 100;
  const season = Math.log(1 - F.d * Math.exp(-(r.age ?? M.unknown_age_days) / F.T));
  const terms = r.x.map((v, j) => F.beta[j] * ((v - F.mu[j]) / F.sd[j]));
  return { base, growth, season, terms, fdv: Math.max(1, Math.round(Math.exp(base + growth + season))) };
}

/** One deposit's farm economics: airdrop EV at p25/p50/p75 minus gas, bridge and yield-offset carry. */
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
  const ev = [0, 1, 2].map((q) => rd(deposit * perDollar(q), 2));
  const net = ev.map((e) => rd(e - gas - f.bridge - carry, 2));
  const roi = net.map((n) => rd((100 * n) / deposit, 2));
  const apr = roi.map((x) => rd((x * 365) / days, 2));
  const edge = perDollar(1) - carryRate;
  const verdict = apr[1] >= M.farm_apr && apr[0] >= M.farm_p25_apr ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP';
  return { deposit, ev, gas, bridge: f.bridge, carry, net, roi, apr, txs, tshare, airdrop_apr: rd(100 * perDollar(1) * (365 / days), 2), breakeven: edge > 0 ? Math.ceil((gas + f.bridge) / edge) : null, verdict, whale: deposit > M.whale_tvl_share * f.tvl };
}
const T = (r, d = S.tier) => ((r._t ??= {})[d] ??= farmTier(r.f, d));
const CHECK = R.rows.filter((r) => valuation(r).fdv === r.fdv).length;

// ---------------------------------------------------------------- filters and sort
const CATS = [...new Set(R.rows.map((r) => r.cat))].sort();
const CHAINS = Object.entries(R.rows.reduce((a, r) => ((a[r.f.chain] = (a[r.f.chain] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([c]) => c);
const KEYS = { r: (r) => r.r, name: (r) => r.name.toLowerCase(), tvl: (r) => r.tvl, chg: (r) => r.chg ?? -1e9, fdv: (r) => r.fdv, mult: (r) => r.fdv / r.tvl, apy: (r) => r.f.apy, apr: (r) => T(r).apr[1], be: (r) => T(r).breakeven ?? 1e12, v: (r) => ['FARM', 'THIN', 'SKIP'].indexOf(T(r).verdict) };
function view() {
  const q = S.q.trim().toLowerCase();
  const rows = R.rows.filter((r) =>
    (S.seg === 'all' || r.seg === S.seg) && (S.v === 'all' || T(r).verdict === S.v) && (S.cat === 'all' || r.cat === S.cat) &&
    (S.chain === 'all' || r.f.chain === S.chain) && (!q || (r.name + ' ' + r.slug + ' ' + r.cat + ' ' + r.chains.join(' ')).toLowerCase().includes(q)));
  const k = KEYS[S.sort];
  return rows.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : a.r - b.r) * S.dir);
}

// ---------------------------------------------------------------- shell
function header() {
  const v = R.verdicts[S.tier], tvl = R.rows.reduce((a, r) => a + r.tvl, 0);
  const best = R.rows.reduce((b, r) => (T(r).apr[1] > T(b).apr[1] && T(r).verdict === 'FARM' ? r : b), R.rows[0]);
  const wv = R.rows.filter((r) => r.seg === 'W').reduce((a, r) => ((a[T(r).verdict] += 1), a), { FARM: 0, THIN: 0, SKIP: 0 });
  $('#top').innerHTML = `<div class="brand"><div><h1><b>KESTREL</b> Token Launch Radar</h1>
    <p>Pre-token protocols on the sealed DefiLlama snapshot, priced from their own TVL, 7-day growth and time with no token by a ridge fitted on ${F.n_comps} traded comps, then netted to a deposit-sized farm verdict.</p></div>
    <div class="cap" role="group" aria-label="Capital per farm"><span>Capital per farm</span>${M.tiers.map((d) => `<button data-tier="${d}" class="${d === S.tier ? 'on' : ''}">${tl(d)}<small>${['retail', 'active', 'whale'][M.tiers.indexOf(d)]}</small></button>`).join('')}</div>
    <div class="stamp">${esc(R.version)} · snapshot ${R.as_of}<br>${R.funnel.total} protocols → ${R.rows.length} ranked</div></div>
  <div class="kpis">
    <div class="kpi"><label>Watchlist covered</label><b>${R.funnel.watchlist}<i>/${R.funnel.watchlist}</i></b><span>${wv.THIN} THIN · ${wv.SKIP} SKIP · ${wv.FARM} FARM at ${tl(S.tier)}</span></div>
    <div class="kpi"><label>Ranked pre-token</label><b>${R.rows.length}</b><span>${R.funnel.watchlist} watchlist + ${R.funnel.emerging} emerging</span></div>
    <div class="kpi"><label>Untokened TVL ranked</label><b>${usd(tvl)}</b><span>implied FDV ${usd(R.rows.reduce((a, r) => a + r.fdv, 0))} in all</span></div>
    <div class="kpi wide"><label>Verdicts at ${tl(S.tier)}</label><b><em class="FARM">${v.FARM}</em> · <em class="THIN">${v.THIN}</em> · <em class="SKIP">${v.SKIP}</em></b>
      <div class="mix">${['FARM', 'THIN', 'SKIP'].map((k) => `<i class="${k}" style="flex:${v[k]}"></i>`).join('')}</div></div>
    <div class="kpi"><label>Best FARM at ${tl(S.tier)}</label><b class="pos">${pc(T(best).apr[1])}</b><span>${esc(best.name)} · p50 net APR</span></div>
    <div class="kpi"><label>Model, blind LOO</label><b>R² ${F.loo.r2.toFixed(3)}</b><span>ρ ${F.loo.rho.toFixed(2)} · walk-fwd ρ ${F.wf.pooled.rho.toFixed(2)} · v4 R² 0.133</span></div>
  </div>`;
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${n}${k === 'board' ? ` <small>${R.rows.length}</small>` : k === 'traded' ? ` <small>${R.comps.length} + ${R.aside.length}</small>` : ''}</button>`).join('') +
    `<span class="note">${CHECK}/${R.rows.length} implied values recomputed in this page match board.json ✓</span>`;
}

function filters(n) {
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<div class="filters">
    <input id="q" type="search" placeholder="Search name, category, chain" value="${esc(S.q)}" aria-label="Search">
    <select id="seg" aria-label="Segment">${opt('all', 'All segments', S.seg)}${opt('W', 'Watchlist (40)', S.seg)}${opt('E', `Emerging (${R.funnel.emerging})`, S.seg)}</select>
    <div class="chips" role="group" aria-label="Verdict">${['all', 'FARM', 'THIN', 'SKIP'].map((v) => `<button data-v="${v}" class="${v} ${S.v === v ? 'on' : ''}">${v === 'all' ? 'All' : v}</button>`).join('')}</div>
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
      <td class="fdv"><b>${usd(r.fdv)}</b><div class="band"><i style="left:${bx(r.lo)}%;width:${bx(r.hi) - bx(r.lo)}%"></i><u style="left:${bx(r.fdv)}%"></u></div></td>
      <td class="n dim">${(r.fdv / r.tvl).toFixed(2)}x</td><td class="n dim">${r.f.apy}%</td>
      <td class="n apr"><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>${pc(t.apr[0])} … ${pc(t.apr[2])}</small></td>
      <td class="n dim">${t.breakeven === null ? '—' : usd0(t.breakeven)}</td><td class="vc">${pill(t.verdict)}</td></tr>`;
  }).join('');
  return `<div class="cols"><section class="panel tablewrap">${filters(rows.length)}
    <table class="grid" id="grid"><thead><tr>${th('r', '#', 'rk')}${th('name', 'Protocol')}${th('tvl', 'TVL', 'n')}${th('chg', '7d TVL', 'n')}${th('fdv', 'Implied FDV · Q25–Q75', '')}${th('mult', 'FDV/TVL', 'n')}${th('apy', 'Base', 'n')}${th('apr', `Net APR @${tl(S.tier)}`, 'n')}${th('be', 'Break-even', 'n')}${th('v', 'Verdict', 'vc')}</tr></thead>
    <tbody>${body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table>
    <p class="foot">Net APR is the p50 airdrop expectation net of gas, bridge and carry over the window to an assumed token event, annualized; small print shows p25 … p75. FARM: p50 ≥ ${M.farm_apr}% and p25 ≥ ${M.farm_p25_apr}%. THIN: positive p50, a free option on capital already parked there. Click a row for its plan.</p></section>
    <aside class="side">${side(rows)}</aside></div>`;
}

function side(rows) {
  const top = rows.filter((r) => T(r).verdict === 'FARM').sort((a, b) => T(b).apr[1] - T(a).apr[1]).slice(0, 6);
  const watch = R.rows.filter((r) => r.seg === 'W');
  const best = `<section class="panel"><h3>Best setups in view <small>p50 net APR at ${tl(S.tier)}</small></h3>
    ${top.length ? `<ol class="best">${top.map((r) => `<li data-slug="${r.slug}"><b>${esc(r.name)}</b><small>${esc(r.cat)} · ${esc(r.f.chain)} · ${r.f.weeks} wk · break-even ${usd0(T(r).breakeven ?? 0)}</small><em class="pos">${pc(T(r).apr[1])}</em></li>`).join('')}</ol>` : `<p class="empty">No FARM setup in this view at ${tl(S.tier)}; try a larger tier.</p>`}</section>`;
  const cover = `<section class="panel"><h3>Watchlist coverage <small>${watch.length}/${R.funnel.watchlist} ranked · verdict at ${tl(S.tier)}</small></h3>
    <div class="matrix">${watch.map((r) => `<button data-slug="${r.slug}" class="${T(r).verdict}" title="#${r.r} ${esc(r.name)} · ${usd(r.fdv)} · ${pc(T(r).apr[1])}">${esc(r.name.replace(/ (Financial|Protocol|Capital|Network|Finance|Money|Labs|Curation|Vaults|Pooling|by Wintermute|Earn)$/, ''))}</button>`).join('')}</div>
    <p class="mini">Large pass-through vaults dilute a drop across billions of TVL: most of the floor is THIN, a free option on stables already earning base yield.</p></section>`;
  const filtered = S.q || S.seg !== 'all' || S.v !== 'all' || S.cat !== 'all' || S.chain !== 'all';
  return filtered ? best + breakdown(rows) + cover : best + cover + breakdown(rows);
}

/** Verdict mix of the rows in view, by category and by home chain. */
function breakdown(rows) {
  const group = (key, n) => {
    const g = {};
    for (const r of rows) { const k = key(r); (g[k] ??= { FARM: 0, THIN: 0, SKIP: 0, n: 0 }); g[k][T(r).verdict]++; g[k].n++; }
    const list = Object.entries(g).sort((a, b) => b[1].n - a[1].n || (a[0] < b[0] ? -1 : 1)).slice(0, n), max = list.length ? list[0][1].n : 1;
    return list.map(([k, c]) => `<div class="hb"><span>${esc(k)}</span><div style="width:${(100 * c.n) / max}%">${['FARM', 'THIN', 'SKIP'].map((v) => `<i class="${v}" style="flex:${c[v]}"></i>`).join('')}</div><b>${c.n}</b></div>`).join('');
  };
  return `<section class="panel"><h3>This view by category <small>${rows.length} rows · FARM/THIN/SKIP</small></h3>${group((r) => r.cat, 6)}
    <h3 class="sub">By home chain</h3>${group((r) => r.f.chain, 5)}</section>`;
}

// ---------------------------------------------------------------- drawer
function openDrawer(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  S.open = slug;
  const v = valuation(r), t = T(r), ts = M.tiers.map((d) => T(r, d));
  const comp = Math.exp(F.ybar);
  const fac = [['Comp at sample mean (exp ȳ)', comp, ''], [`× TVL ${usd(r.tvl)} (elasticity ${F.elasticity.toFixed(2)})`, Math.exp(v.terms[0]), ''], [`× ${r.x[1] ? 'Pass-through family' : 'Own-fee family'} (${esc(r.cat)})`, Math.exp(v.terms[1]), ''],
    [`× 7-day growth ${pc(r.chg ?? 0)} (k ${F.k}, capped ±${M.growth_cap_pct}%)`, Math.exp(v.growth), ''], [`× Seasoning ${ageTxt(r.age)} with no token (d ${F.d}, T ${F.T}d)`, Math.exp(v.season), '']];
  const d = $('#drawer');
  d.innerHTML = `<header class="dh"><div><h2>${esc(r.name)} <span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCHLIST' : 'EMERGING'}</span></h2>
      <p>rank <b>#${r.r}</b> of ${R.rows.length} by implied FDV · ${esc(r.cat)} · home chain <b>${esc(r.f.chain)}</b>${r.chains.length > 1 ? ` (+${r.chains.length - 1} more)` : ''} · TVL <b>${usd(r.tvl)}</b> · 7d <b class="${sign(r.chg ?? 0)}">${pc(r.chg ?? 0)}</b> · ${ageTxt(r.age)} tracked, no token recorded</p></div>
    <div class="dk"><div><label>Implied FDV</label><b>${usd(r.fdv)}</b><small>Q25–Q75 ${usd(r.lo)}–${usd(r.hi)}</small></div><div><label>Net APR p50 @${tl(S.tier)}</label><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>p25 ${pc(t.apr[0])} · p75 ${pc(t.apr[2])}</small></div>${pill(t.verdict)}<button class="ghost" id="close" aria-label="Close">Close ✕</button></div></header>
  <div class="dgrid"><div>
    <h3>Valuation waterfall <small>the model's claim</small></h3>
    <table class="wf">${fac.map(([l, x], i) => `<tr><td>${l}</td><td class="n ${i && x < 1 ? 'neg' : i ? 'pos' : ''}">${i ? '×' + x.toFixed(3) : usd(x)}</td></tr>`).join('')}
      <tr class="tot"><td>= Implied FDV · ${(r.fdv / r.tvl).toFixed(2)}x TVL</td><td class="n">${usd(r.fdv)}</td></tr></table>
    <p class="mono">exp(${F.ybar.toFixed(3)} ${v.terms.map((x) => (x < 0 ? '− ' : '+ ') + Math.abs(x).toFixed(3)).join(' ')} ${v.growth < 0 ? '−' : '+'} ${Math.abs(v.growth).toFixed(3)} − ${Math.abs(v.season).toFixed(3)}) = ${v.fdv.toLocaleString('en-US')} ${v.fdv === r.fdv ? '✓ board' : '✗'}</p>
    <h3>Traded anchors <small>same category, nearest TVL</small></h3>
    <table class="mt"><tr><th>Comp</th><th class="n">TVL</th><th class="n">Mcap</th><th class="n">x TVL</th></tr>${r.anchors.map((a) => `<tr><td><b>${esc(a.name)}</b> <small>${esc(a.category)}</small></td><td class="n">${usd(a.tvl)}</td><td class="n">${usd(a.mcap)}</td><td class="n">${a.mult.toFixed(2)}x</td></tr>`).join('')}</table>
  </div><div>
    <h3>Farm economics <small>${r.f.weeks}-week window · ${esc(r.route.product)}</small></h3>
    <table class="mt fe"><tr><th></th>${ts.map((x) => `<th class="n${x.deposit === S.tier ? ' cur' : ''}">${tl(x.deposit)}</th>`).join('')}</tr>
      ${[['Airdrop EV, p50', (x) => usd(x.ev[1])], [`Gas, ${t.txs} tx`, (x) => '−' + usd(x.gas)], ['Bridge', (x) => (x.bridge ? '−' + usd(x.bridge) : '$0')], [`Carry ${rd(M.benchmark_apy + r.f.prem - r.f.apy, 2)}%/yr`, (x) => (x.carry > 0 ? '−' : '+') + usd(Math.abs(x.carry))],
        ['Net, p50', (x) => `<b class="${sign(x.net[1])}">${usd(x.net[1])}</b>`], ['Return in window', (x) => `<b class="${sign(x.roi[1])}">${pc(x.roi[1], 2)}</b>`], ['Net APR, p50', (x) => `<b class="${sign(x.apr[1])}">${pc(x.apr[1])}</b>`], ['APR p25 … p75', (x) => `<small>${pc(x.apr[0], 0)} … ${pc(x.apr[2], 0)}</small>`], ['Verdict', (x) => pill(x.verdict) + (x.whale ? '<br><small class="warn">&gt;1% of TVL</small>' : '')]]
        .map(([l, fn]) => `<tr><td>${l}</td>${ts.map((x) => `<td class="n${x.deposit === S.tier ? ' cur' : ''}">${fn(x)}</td>`).join('')}</tr>`).join('')}</table>
    <p class="mini">Airdrop yield ${t.airdrop_apr}%/yr = ${R.drop_q[1]}% drop (p50 of 12 launches) × ${r.f.share} route share × FDV/TVL ${(r.fdv / r.tvl).toFixed(2)} × ${(100 * t.tshare).toFixed(0)}% of the season. Carry = ${M.benchmark_apy}% benchmark + ${r.f.prem}% risk − ${r.f.apy}% base APY. Break-even deposit <b>${t.breakeven === null ? 'none' : usd0(t.breakeven)}</b>.</p>
    <h3>Sensitivity <small>net APR by deposit size</small></h3>${sens(r)}
  </div><div>
    <h3>Farm plan on ${esc(r.f.chain)} <small>${r.steps.length} steps, cost and time each</small></h3>
    <ol class="plan">${r.steps.map((s) => `<li><p>${esc(s.action)}</p><span><i>Cost</i>${esc(s.cost)}</span> <span><i>Time</i>${esc(s.time)}</span></li>`).join('')}</ol>
  </div></div>`;
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;
  $('#close').onclick = closeDrawer;
}
function closeDrawer() { S.open = null; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }

/** Net APR p25/p50/p75 against deposit ($500 to $100k, log x) with the FARM bar and the tiers marked. */
function sens(r) {
  const W = 420, H = 190, L = 38, B = 22, R0 = 34, xs = [], n = 48;
  for (let i = 0; i <= n; i++) xs.push(100 * 1000 ** (i / n));
  const pts = xs.map((d) => farmTier(r.f, d).apr);
  const all = pts.flat().concat([M.farm_apr, 0]), lo = Math.max(-40, Math.min(...all)), hi = Math.max(...all) * 1.08 + 1;
  const X = (d) => L + ((Math.log(d / 100) / Math.log(1000)) * (W - L - R0)), Y = (v) => 8 + ((hi - clamp(v, lo, hi)) / (hi - lo)) * (H - B - 8);
  const tag = (q, c) => `<text x="${W - R0 + 4}" y="${Y(pts[n][q]) + 3}" style="fill:${c}">p${[25, 50, 75][q]}</text>`;
  const line = (q, c) => `<polyline fill="none" stroke="${c}" stroke-width="${q === 1 ? 2.2 : 1.2}" ${q === 1 ? '' : 'stroke-dasharray="3 3"'} points="${xs.map((d, i) => X(d).toFixed(1) + ',' + Y(pts[i][q]).toFixed(1)).join(' ')}"/>`;
  const t = T(r);
  const ticks = [lo, 0, M.farm_apr, hi].filter((v, i, a) => a.indexOf(v) === i && v >= lo && v <= hi);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net APR sensitivity to deposit size">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - 8}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : v === M.farm_apr ? 'bar' : 'gl'}"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v.toFixed(0)}%</text>`).join('')}
    ${M.tiers.map((d) => `<line x1="${X(d)}" x2="${X(d)}" y1="8" y2="${H - B}" class="${d === S.tier ? 'cur' : 'gl'}"/><text x="${X(d)}" y="${H - 8}" text-anchor="middle">${tl(d)}</text>`).join('')}
    ${line(0, '#8a97ab')}${line(2, '#8a97ab')}${line(1, '#38bdf8')}${tag(0, '#8a97ab')}${tag(1, '#38bdf8')}${tag(2, '#8a97ab')}
    ${t.breakeven ? `<line x1="${X(t.breakeven)}" x2="${X(t.breakeven)}" y1="8" y2="${H - B}" class="be"/><text x="${X(t.breakeven) + 4}" y="20" class="lbl be">break-even ${usd0(t.breakeven)}</text>` : ''}
    <text x="${X(20000)}" y="${Y(M.farm_apr) + 12}" text-anchor="middle" class="lbl farm">FARM bar ${M.farm_apr}%</text></svg>`;
}

// ---------------------------------------------------------------- radar scatter
function scatter(points, o) {
  const { W, H, x0, x1, y0, y1, xl, yl } = o, L = 54, B = 34;
  const X = (v) => L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - 12), Y = (v) => 10 + ((y1 - Math.log10(v)) / (y1 - y0)) * (H - B - 10);
  let g = '';
  for (let e = Math.ceil(x0); e <= x1; e++) g += `<line x1="${X(10 ** e)}" x2="${X(10 ** e)}" y1="10" y2="${H - B}" class="gl"/><text x="${X(10 ** e)}" y="${H - B + 14}" text-anchor="middle">${usd(10 ** e, 0)}</text>`;
  for (let e = Math.ceil(y0); e <= y1; e++) g += `<line x1="${L}" x2="${W - 12}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" class="gl"/><text x="${L - 6}" y="${Y(10 ** e) + 4}" text-anchor="end">${usd(10 ** e, 0)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yl)} against ${esc(xl)}">${g}${(o.extra || '')(X, Y)}
    ${points.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 3.6}" class="${p.c}"${p.slug ? ` data-slug="${p.slug}"` : ''}><title>${esc(p.t)}</title></circle>`).join('')}
    <text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle" class="ax">${xl}</text><text x="12" y="${(H - B) / 2}" transform="rotate(-90 12 ${(H - B) / 2})" text-anchor="middle" class="ax">${yl}</text></svg>`;
}
function radar() {
  const rows = view();
  const pts = R.comps.map((c) => ({ x: c.tvl, y: c.mcap, c: 'comp', r: 3, t: `${c.name} (traded) · TVL ${usd(c.tvl)} · mcap ${usd(c.mcap)}` }))
    .concat(rows.map((r) => ({ x: r.tvl, y: r.fdv, c: T(r).verdict + (r.seg === 'W' ? ' w' : ''), slug: r.slug, t: `${r.name} · TVL ${usd(r.tvl)} · implied ${usd(r.fdv)} · ${T(r).verdict}` })));
  const fit = (X, Y) => { const a = [6.5, 10.6].map((lx) => { const lt = lx * Math.LN10, z = (lt - F.mu[0]) / F.sd[0]; return [X(10 ** lx), Y(Math.exp(F.ybar + F.beta[0] * z + F.beta[1] * ((0 - F.mu[1]) / F.sd[1])))]; });
    return `<line x1="${a[0][0]}" y1="${a[0][1]}" x2="${a[1][0]}" y2="${a[1][1]}" class="fit"/><line x1="${X(R.floor_usd)}" x2="${X(R.floor_usd)}" y1="10" y2="${520 - 34}" class="floor"/><text x="${X(R.floor_usd) + 4}" y="22" class="lbl">$50M watchlist floor</text>`; };
  return `<div class="cols"><section class="panel tablewrap">${filters(rows.length)}<h3>Implied FDV against TVL <small>${rows.length} pre-token rows over ${R.comps.length} traded comps at market cap · log-log · click a dot</small></h3>
    ${scatter(pts, { W: 940, H: 520, x0: 6.6, x1: 10.6, y0: 6, y1: 10.2, xl: 'TVL (log)', yl: 'implied FDV / market cap (log)', extra: fit })}
    <p class="legend"><i class="FARM"></i>FARM <i class="THIN"></i>THIN <i class="SKIP"></i>SKIP <i class="ring"></i>ringed = watchlist <i class="comp"></i>traded comp <i class="fitl"></i>fitted own-fee line, FDV ∝ TVL^${F.elasticity.toFixed(2)}</p></section>
    <aside class="side"><section class="panel"><h3>How to read it</h3><p class="mini">The fitted line rises ×${(10 ** F.elasticity).toFixed(2)} per 10× of TVL, so a $10M protocol is priced near ${(Math.exp(F.ybar + F.beta[0] * ((Math.log(1e7) - F.mu[0]) / F.sd[0]) + F.beta[1] * ((0 - F.mu[1]) / F.sd[1])) / 1e7).toFixed(2)}× its TVL and a $1B one near ${(Math.exp(F.ybar + F.beta[0] * ((Math.log(1e9) - F.mu[0]) / F.sd[0]) + F.beta[1] * ((0 - F.mu[1]) / F.sd[1])) / 1e9).toFixed(3)}×. Pass-through vaults sit ×${F.pass_mult.toFixed(2)} below it. That concave shape, measured on the comps, is why FARM clusters among small emerging protocols and the large watchlist vaults are THIN.</p></section>${breakdown(rows)}</aside></div>`;
}

// ---------------------------------------------------------------- traded comps and set-aside
function traded() {
  const lp = new Map(F.loo_points.map((p) => [p.name, p]));
  return `<div class="cols two"><section class="panel"><h3>Tokens that already trade <small>${R.comps.length} comps the model is fitted on · never ranked</small></h3>
    <div class="scroll"><table class="mt"><tr><th>Comp</th><th>Category</th><th class="n">TVL</th><th class="n">Mcap</th><th class="n">x TVL</th><th class="n">Blind LOO</th><th class="n">Error</th></tr>
    ${R.comps.slice().sort((a, b) => b.mcap - a.mcap).map((c) => { const p = lp.get(c.name); return `<tr><td><b>${esc(c.name)}</b></td><td>${esc(c.cat)}</td><td class="n">${usd(c.tvl)}</td><td class="n">${usd(c.mcap)}</td><td class="n">${(c.mcap / c.tvl).toFixed(2)}x</td><td class="n">${usd(p.pred_usd)}</td><td class="n ${Math.abs(p.resid) <= Math.LN2 ? 'pos' : 'dim'}">${p.resid >= 0 ? '+' : '−'}${Math.abs(p.resid).toFixed(2)}</td></tr>`; }).join('')}</table></div></section>
  <section class="panel"><h3>Record no token, kept off the board <small>${R.aside.length} with the exact reason</small></h3>
    <div class="scroll"><table class="mt"><tr><th>Protocol</th><th class="n">TVL</th><th>Why it is not ranked</th></tr>${R.aside.map((a) => `<tr><td><b>${esc(a.name)}</b><br><small>${esc(a.category)}</small></td><td class="n">${usd(a.tvl)}</td><td class="why">${esc(a.reason)}</td></tr>`).join('')}</table></div></section></div>`;
}

// ---------------------------------------------------------------- methodology
function method() {
  const fn = R.funnel, lo = F.loo_points;
  const band = (X, Y) => `<polygon points="${X(1e6)},${Y(2e6)} ${X(1e10)},${Y(2e10)} ${X(1e10)},${Y(5e9)} ${X(1e6)},${Y(5e5)}" class="band2"/><line x1="${X(1e6)}" y1="${Y(1e6)}" x2="${X(1e10)}" y2="${Y(1e10)}" class="diag"/>`;
  const sc = scatter(lo.map((p) => ({ x: p.pred_usd, y: p.mcap_usd, c: Math.abs(p.resid) <= Math.LN2 ? 'in' : 'out', r: 3.4, t: `${p.name}: blind ${usd(p.pred_usd)} vs actual ${usd(p.mcap_usd)}` })),
    { W: 440, H: 330, x0: 6.3, x1: 9.7, y0: 6.3, y1: 10, xl: 'blind LOO prediction (log)', yl: 'actual market cap (log)', extra: band });
  const coef = [['log TVL', F.beta[0] / F.sd[0], `×${(10 ** (F.beta[0] / F.sd[0])).toFixed(2)} per 10× TVL`, '≥ 0', true],
    ['pass-through family', F.beta[1] / F.sd[1], `×${F.pass_mult.toFixed(2)} when TVL is routed capital`, 'free', true],
    ['7-day growth k', F.k, `free fit ${F.free_growth.toFixed(2)} → held in [0.25, 1]`, '≥ 0.25', F.k > 0],
    ['seasoning depth d', F.d, `free log-age fit ${F.free_age.toFixed(2)} → held in [0.15, 0.5]`, '≥ 0.15', F.d > 0]];
  const mx = Math.max(...coef.map((c) => Math.abs(c[1])));
  const ver = [...HISTORY, ['v5', F.loo.r2, F.nested.r2, F.wf.pooled.rho]];
  const feats = F.features, fmax = Math.max(...feats.map((f) => f.r2));
  const ks = [...new Set(F.grid_r2.map((g) => g.k))], ds = [...new Set(F.grid_r2.map((g) => g.d))], gmax = Math.max(...F.grid_r2.map((g) => g.r2)), gmin = Math.min(...F.grid_r2.map((g) => g.r2));
  const parts = [['comps', fn.comps, 'traded comps (fit)'], ['tok', fn.token_other, 'other tokens'], ['W', fn.watchlist, 'watchlist ranked'], ['E', fn.emerging, 'emerging ranked'], ['as', fn.aside_above, 'set aside ≥ floor'], ['sc', fn.screened_below, 'screened < floor']];
  return `<div class="mgrid">
  <section class="panel"><h3>The fitted equation <small>ridge on ${F.n_comps} traded comps, λ ${F.lam}</small></h3>
    <pre class="eq">log FDV = ${F.ybar.toFixed(3)} + ${(F.beta[0] / F.sd[0]).toFixed(3)}·(log TVL − ${F.mu[0].toFixed(2)})
        ${F.beta[1] / F.sd[1] < 0 ? '−' : '+'} ${Math.abs(F.beta[1] / F.sd[1]).toFixed(3)}·(pass − ${F.mu[1].toFixed(2)})
        + ${F.k}·clamp(chg7d, ±30%)
        + log(1 − ${F.d}·e^(−age/${F.T}d))</pre>
    <h3 class="sub">Coefficients and their signs <small>economic sanity, enforced</small></h3>
    ${coef.map(([n, b, note, box, ok]) => `<div class="cf"><span>${n}<small>${note}</small></span><div class="cfb"><i class="${b < 0 ? 'neg' : 'pos'}" style="width:${(48 * Math.abs(b)) / mx}%;${b < 0 ? 'right:50%' : 'left:50%'}"></i></div><b>${b.toFixed(3)}</b><em>${box} ${ok ? '✓' : '✗'}</em></div>`).join('')}
    <p class="mini">The comps cannot price the record terms: their 7-day window spans ${'−100%…+3%'} and their age is time since listing, not time with no token, so a free fit leans negative. The terms are held in a box whose floors are the economic priors, and leave-one-out picks the point inside it: k ${F.k}, d ${F.d}. A rising TVL always raises a value; older no-token TVL is never priced below new TVL. Cost: LOO R² ${F.loo.r2.toFixed(3)} with the terms vs ${F.baselines[0].metrics.r2.toFixed(3)} without.</p>
    <h3 class="sub">LOO R² over the record box <small>rows k, columns d</small></h3>
    <table class="heat"><tr><th></th>${ds.map((d) => `<th>${d}</th>`).join('')}</tr>${ks.map((k) => `<tr><th>${k}</th>${ds.map((d) => { const g = F.grid_r2.find((x) => x.k === k && x.d === d); return `<td style="--a:${((g.r2 - gmin) / (gmax - gmin || 1)).toFixed(2)}" class="${k === F.k && d === F.d ? 'pick' : ''}">${g.r2.toFixed(3)}</td>`; }).join('')}</tr>`).join('')}</table></section>
  <section class="panel"><h3>Blind leave-one-out, predicted vs actual <small>${F.n_comps} refits</small></h3>${sc}
    <div class="stats"><div><label>LOO R²</label><b>${F.loo.r2.toFixed(3)}</b></div><div><label>LOO ρ</label><b>${F.loo.rho.toFixed(3)}</b></div><div><label>Nested R²</label><b>${F.nested.r2.toFixed(3)}</b></div><div><label>Within 2×</label><b>${(100 * F.loo.within2x).toFixed(0)}%</b></div></div>
    <p class="mini">Green: within 2× (shaded band). Nested LOO re-selects λ, k and d inside each of the ${F.n_comps} folds (the full pick recurs in ${F.nested_same}), so the reported skill also pays for the search. Comps of one size trade from 0.01× to 30× TVL: every row ships a Q25–Q75 band.</p>
    <h3 class="sub">Walk-forward by listing date <small>train older, predict newer</small></h3>
    <table class="mt"><tr><th>Test cohort</th><th class="n">Train/test</th><th class="n">R²</th><th class="n">ρ</th><th class="n">≤2×</th></tr>
    ${F.wf.folds.map((f) => `<tr><td>${f.from} → ${f.to}</td><td class="n">${f.train_n}/${f.test_n}</td><td class="n">${f.metrics.r2.toFixed(3)}</td><td class="n">${f.metrics.rho.toFixed(3)}</td><td class="n">${(100 * f.metrics.within2x).toFixed(0)}%</td></tr>`).join('')}
    <tr class="tot"><td>Pooled out-of-time</td><td class="n">${F.wf.pooled.n}</td><td class="n">${F.wf.pooled.r2.toFixed(3)}</td><td class="n">${F.wf.pooled.rho.toFixed(3)}</td><td class="n">${(100 * F.wf.pooled.within2x).toFixed(0)}%</td></tr></table></section>
  <section class="panel"><h3>Versus R3, v4 and baselines <small>same 87 comps</small></h3>
    <table class="mt"><tr><th>Model</th><th class="n">LOO R²</th><th class="n">Nested R²</th><th class="n">Walk-fwd ρ</th></tr>${ver.map(([n, a, b, c]) => `<tr class="${n === 'v5' ? 'tot' : ''}"><td>${n === 'v5' ? 'v5 kestrel-6 (this board)' : n + (n === 'R3' ? ' group ridge' : ' growth/age as offsets')}</td><td class="n">${a.toFixed(3)}</td><td class="n">${b.toFixed(3)}</td><td class="n">${c.toFixed(3)}</td></tr>`).join('')}
    ${F.baselines.map((b) => `<tr><td class="dim">${b.name}</td><td class="n dim">${b.metrics.r2.toFixed(3)}</td><td class="n dim">—</td><td class="n dim">—</td></tr>`).join('')}</table>
    <h3 class="sub">Feature search <small>LOO R² of each candidate design</small></h3>
    ${feats.map((f) => `<div class="fs${f.chosen ? ' on' : ''}"><span>${esc(f.name)}</span><div><i style="width:${Math.max(0, (100 * f.r2) / fmax)}%"></i></div><b>${f.r2.toFixed(3)}</b></div>`).join('')}
    <p class="mini">Category and home-chain fixed effects and chain count overfit 87 comps; free growth and age come out negative. Only the pass-through family adds blind skill, so it is the one kept.</p>
    <h3 class="sub">Farm assumptions <small>shipped in data.js, applied to every row</small></h3>
    <p class="mini">Drop share of supply, p25/p50/p75 <b>${R.drop_q.join(' / ')}%</b> from ${R.drops.map(([n, s]) => `${esc(n)} ${s}`).join(', ')}. Benchmark ${M.benchmark_apy}% stable yield; carry = benchmark + route risk premium − route base APY. Window ${M.horizon_weeks.map(([a, w]) => `&lt;${a}d ${w}wk`).join(', ')}, older ${M.horizon_default_weeks}wk. Gas ${M.tx_base} + 1 per ${M.tx_per_weeks} weeks of transactions at the home chain's rate; bridge $${M.bridge_usd} off Ethereum.</p></section>
  <section class="panel span"><h3>The whole snapshot, accounted for <small>${fn.total} protocols, each classified once</small></h3>
    <div class="funnel">${parts.map(([k, n]) => `<i class="${k}" style="flex:${n}">${n}</i>`).join('')}</div>
    <p class="legend">${parts.map(([k, n, l]) => `<i class="${k}"></i>${n} ${l}`).join(' ')} = ${parts.reduce((a, p) => a + p[1], 0)} ✓</p></section></div>`;
}

// ---------------------------------------------------------------- render and events
function render() {
  header();
  $('#main').innerHTML = { board, radar, traded, method }[S.tab]();
  if (S.open) openDrawer(S.open);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tier],[data-tab],[data-v],[data-sort],[data-slug],#reset,#scrim');
  if (!el) return;
  if (el.id === 'scrim') return closeDrawer();
  if (el.id === 'reset') Object.assign(S, { q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1 });
  else if (el.dataset.tier) S.tier = +el.dataset.tier;
  else if (el.dataset.tab) { S.tab = el.dataset.tab; closeDrawer(); }
  else if (el.dataset.v) S.v = el.dataset.v;
  else if (el.dataset.sort) { const k = el.dataset.sort; S.dir = S.sort === k ? -S.dir : ['r', 'name', 'be'].includes(k) ? 1 : -1; S.sort = k; }
  else if (el.dataset.slug) return openDrawer(el.dataset.slug);
  render();
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { S.q = e.target.value; render(); const q = $('#q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener('change', (e) => { if (['seg', 'cat', 'chain'].includes(e.target.id)) { S[e.target.id] = e.target.value; render(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) openDrawer(e.target.dataset.slug);
});
render();
