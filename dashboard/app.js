'use strict';
// Kestrel Token Radar (kestrel-7). Renders window.RADAR (data.js, written by main.ts from the sealed
// snapshot): board + farm basket, detail drawer, opportunity radar, traded comps, methodology. Every
// implied FDV, farm tier and basket is recomputed here: valuation(), farmTier() and basket() mirror
// lib/model.ts line for line.

const R = window.RADAR, M = R.model, F = R.fit;
const S = { tier: 10000, tab: 'board', q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1, open: null, scn: 'base' };
const TABS = [['board', 'Board'], ['radar', 'Radar'], ['traded', 'Traded & set aside'], ['method', 'Methodology']];
const HISTORY = [['R3 group ridge', 0.153, 0.106, 0.216], ['v4 growth/age as offsets', 0.133, 0.091, 0.183], ['v5 pass-through family', 0.207, 0.203, 0.396]];
const SCN = { base: ['Base', (f) => f], cons: ['Conservative · 1.5× dilution', (f) => ({ ...f, fdv: f.fdv.map((v) => v / 1.5) })], fast: ['Fast TGE · 12 wk', (f) => ({ ...f, weeks: 12 })] };

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
const usd0 = (n) => (n < 0 ? '−$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const tl = (d) => '$' + d / 1000 + 'k';
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
const ageTxt = (a) => (a === null ? 'undated' : a < 365 ? Math.max(1, Math.round(a / 30)) + ' mo' : (a / 365).toFixed(1) + ' y');
const pill = (v) => `<span class="pill ${v}">${v}</span>`;
const short = (n) => n.replace(/ (Financial|Protocol|Capital|Network|Finance|Money|Labs|Curation|Vaults|Pooling|by Wintermute|Earn)$/, '');
const carry = (r) => rd(M.benchmark_apy + r.route.prem - r.route.apy, 2);

// ---------------------------------------------------------------- the model, as the page recomputes it

/** Implied FDV from the shipped ridge: ybar + Σ b·z(x), plus the sign-constrained record terms. */
function valuation(r) {
  const terms = r.x.map((v, j) => F.beta[j] * ((v - F.mu[j]) / F.sd[j]));
  const base = terms.reduce((a, t) => a + t, F.ybar);
  const growth = (F.k * clamp(r.chg ?? 0, -M.growth_cap_pct, M.growth_cap_pct)) / 100;
  const season = Math.log(1 - F.d * Math.exp(-(r.age ?? M.unknown_age_days) / F.T));
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

/** The diversified basket: equal sleeves, greedy by sleeve-size p50 APR, one per home chain and category. */
function basket(total) {
  const sl = total / M.basket_n;
  const c = R.rows.map((r, i) => ({ r, i, t: farmTier(r.f, sl) })).filter((x) => x.t.verdict === 'FARM').sort((a, b) => b.t.apr[1] - a.t.apr[1] || a.i - b.i);
  const p = [], ch = new Set(), ca = new Set();
  for (const x of c) {
    if (p.length >= M.basket_n) break;
    if (ch.has(x.r.f.chain) || ca.has(x.r.cat)) continue;
    ch.add(x.r.f.chain); ca.add(x.r.cat); p.push(x);
  }
  const sum = (g) => rd(p.reduce((a, x) => a + g(x.t), 0), 2);
  return { p, sl, net: sum((t) => t.net[1]), p25: sum((t) => t.net[0]), costs: sum((t) => t.gas + t.bridge), carry: sum((t) => t.carry), apr: p.length ? rd(p.reduce((a, x) => a + x.t.apr[1], 0) / p.length, 2) : 0 };
}

// ---------------------------------------------------------------- filters and sort
const CATS = [...new Set(R.rows.map((r) => r.cat))].sort();
const CHAINS = Object.entries(R.rows.reduce((a, r) => ((a[r.f.chain] = (a[r.f.chain] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([c]) => c);
const KEYS = { r: (r) => r.r, name: (r) => r.name.toLowerCase(), tvl: (r) => r.tvl, chg: (r) => r.chg ?? -1e9, fdv: (r) => r.fdv, mult: (r) => r.fdv / r.tvl, apy: (r) => r.f.apy, apr: (r) => T(r).apr[1], be: (r) => T(r).breakeven ?? 1e12, v: (r) => ['FARM', 'THIN', 'SKIP'].indexOf(T(r).verdict) };
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
  const v = R.verdicts[S.tier], tvl = R.rows.reduce((a, r) => a + r.tvl, 0);
  const best = R.rows.reduce((b, r) => (T(r).apr[1] > T(b).apr[1] && T(r).verdict === 'FARM' ? r : b), R.rows[0]);
  const W = R.rows.filter((r) => r.seg === 'W'), wv = W.reduce((a, r) => ((a[T(r).verdict] += 1), a), { FARM: 0, THIN: 0, SKIP: 0 });
  const free = W.filter((r) => T(r).verdict === 'THIN' && carry(r) <= 0).length;
  $('#top').innerHTML = `<div class="brand"><div><h1><b>KESTREL</b> Token Launch Radar</h1>
    <p>Pre-token protocols on the sealed DefiLlama snapshot, priced from their own TVL, 7-day growth and time with no token by a ridge fitted on ${F.n_comps} traded comps, then netted to a deposit-sized farm verdict.</p></div>
    <div class="cap" role="group" aria-label="Capital per farm"><span>Capital per farm</span>${M.tiers.map((d, i) => `<button data-tier="${d}" class="${d === S.tier ? 'on' : ''}">${tl(d)}<small>${['retail', 'active', 'whale'][i]}</small></button>`).join('')}</div>
    <div class="stamp">${esc(R.version)} · snapshot ${R.as_of}<br>${R.funnel.total} protocols → ${R.rows.length} ranked</div></div>
  ${S.tab !== 'board' ? '' : `<div class="kpis">
    <div class="kpi"><label>Watchlist covered</label><b>${R.funnel.watchlist}<i>/${R.funnel.watchlist}</i></b><span>${wv.THIN} THIN · ${wv.SKIP} SKIP · ${free} zero-carry</span></div>
    <div class="kpi"><label>Ranked pre-token</label><b>${R.rows.length}</b><span>${R.funnel.watchlist} watchlist + ${R.funnel.emerging} emerging</span></div>
    <div class="kpi"><label>Untokened TVL ranked</label><b>${usd(tvl)}</b><span>implied FDV ${usd(R.rows.reduce((a, r) => a + r.fdv, 0))} in all</span></div>
    <div class="kpi wide"><label>Verdicts at ${tl(S.tier)}</label><b><em class="FARM">${v.FARM}</em> · <em class="THIN">${v.THIN}</em> · <em class="SKIP">${v.SKIP}</em></b>
      <div class="mix">${['FARM', 'THIN', 'SKIP'].map((k) => `<i class="${k}" style="flex:${v[k]}"></i>`).join('')}</div></div>
    <div class="kpi"><label>Best FARM at ${tl(S.tier)}</label><b class="pos">${pc(T(best).apr[1])}</b><span>${esc(best.name)} · p50 net APR</span></div>
    <div class="kpi"><label>Model, blind LOO</label><b>R² ${F.loo.r2.toFixed(3)}</b><span>ρ ${F.loo.rho.toFixed(2)} · walk-fwd ρ ${F.wf.pooled.rho.toFixed(2)} · ${F.features.length} designs</span></div>
  </div>`}`;
  $('#tabs').innerHTML = TABS.map(([k, n]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${n}${k === 'board' ? ` <small>${R.rows.length}</small>` : k === 'traded' ? ` <small>${R.comps.length} + ${R.aside.length}</small>` : ''}</button>`).join('') +
    `<span class="note">${CHECK}/${R.rows.length} implied values recomputed in this page match board.json ✓</span>`;
}

function filters(n) {
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<div class="filters">
    <input id="q" type="search" placeholder="Search name, category, chain" value="${esc(S.q)}" aria-label="Search">
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
      <td class="fdv"><b>${usd(r.fdv)}</b><small>${usd(r.lo, 0)}–${usd(r.hi, 0)}</small><div class="band"><i style="left:${bx(r.lo)}%;width:${bx(r.hi) - bx(r.lo)}%"></i><u style="left:${bx(r.fdv)}%"></u></div></td>
      <td class="n dim">${(r.fdv / r.tvl).toFixed(2)}x</td><td class="n dim">${r.f.apy}%</td>
      <td class="n apr"><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>${pc(t.apr[0])} … ${pc(t.apr[2])}</small></td>
      <td class="n dim">${t.breakeven === null ? '—' : usd0(t.breakeven)}</td><td class="vc">${pill(t.verdict)}</td></tr>`;
  }).join('');
  return `<div class="cols"><section class="panel tablewrap">${filters(rows.length)}
    <table class="grid" id="grid"><thead><tr>${th('r', '#', 'rk')}${th('name', 'Protocol')}${th('tvl', 'TVL', 'n')}${th('chg', '7d TVL', 'n')}${th('fdv', 'Implied FDV · Q25–Q75')}${th('mult', 'FDV/TVL', 'n')}${th('apy', 'Base', 'n')}${th('apr', `Net APR @${tl(S.tier)}`, 'n')}${th('be', 'Break-even', 'n')}${th('v', 'Verdict', 'vc')}</tr></thead>
    <tbody>${body || '<tr><td colspan="10" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table>
    <p class="foot">Net APR is the p50 airdrop expectation net of gas, bridge and carry over the window to an assumed token event, annualized; small print shows p25 … p75. FARM: p50 ≥ ${M.farm_apr}% and p25 ≥ ${M.farm_p25_apr}%. THIN: positive p50. Click a row for its plan.</p></section>
    <aside class="side">${basketCard()}${coverage()}</aside></div>`;
}

function basketCard() {
  const b = basket(S.tier), ship = R.baskets[S.tier], ok = ship && JSON.stringify(b.p.map((x) => x.r.slug)) === JSON.stringify(ship.slugs) && b.net === ship.net_p50;
  const rk = Object.entries(b.p.reduce((a, x) => ((a[x.r.route.key] = (a[x.r.route.key] || []).concat(x.r)), a), {})).sort((x, y) => y[1].length - x[1].length)[0];
  return `<section class="panel bk"><h3>Farm basket at ${tl(S.tier)} <small>${b.p.length} × ${usd0(b.sl)} sleeves</small></h3>
    <div class="bkk"><div><label>p50 APR</label><b class="${sign(b.apr)}">${pc(b.apr)}</b></div><div><label>p50 profit</label><b class="${sign(b.net)}">${usd0(b.net)}</b><small>p25 ${usd0(b.p25)}</small></div>
      <div><label>Gas + bridge</label><b>${usd0(b.costs)}</b><small>carry ${usd0(b.carry)}</small></div><div><label>Risk bucket</label><b>${rk ? rk[1].length + '/' + b.p.length : '—'}</b><small>${rk ? esc(rk[0]) : ''}</small></div></div>
    ${b.p.length ? `<ol class="bkl">${b.p.map((x) => `<li data-slug="${x.r.slug}"><b>${esc(x.r.name)}</b><small>${esc(x.r.cat)} · ${esc(x.r.f.chain)} · ${x.r.f.weeks} wk</small><em class="pos">${pc(x.t.apr[1])}</em><span>${usd0(x.t.net[1])}</span></li>`).join('')}</ol>` : `<p class="empty">No FARM sleeve at ${usd0(b.sl)}.</p>`}
    <p class="mini">One per chain and category; top risk ${rk ? esc(rk[1][0].route.risk) : 'none'}. ${ok ? '= data.js ✓' : '≠ data.js ✗'}</p></section>`;
}

function coverage() {
  const W = R.rows.filter((r) => r.seg === 'W'), free = W.filter((r) => T(r).verdict === 'THIN' && carry(r) <= 0), act = W.filter((r) => r.x[1] === 0);
  return `<section class="panel"><h3>Watchlist coverage <small>${W.length}/${R.funnel.watchlist} ranked · verdict at ${tl(S.tier)}</small></h3>
    <div class="matrix">${W.map((r) => `<button data-slug="${r.slug}" class="${T(r).verdict}${free.includes(r) ? ' fo' : ''}${r.x[1] === 0 ? ' ac' : ''}" title="#${r.r} ${esc(r.name)} · ${usd(r.fdv)} · ${pc(T(r).apr[1])}">${esc(short(r.name))}</button>`).join('')}</div>
    <p class="mini"><b class="fo">◆ ${free.length} zero-carry free options</b>: base yield covers benchmark + risk premium, so the drop is free upside. <b class="ac">▲ ${act.length} own-fee active signals</b>: usage, not just balance, earns points.</p></section>`;
}

// ---------------------------------------------------------------- drawer
function openDrawer(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  if (S.open !== slug) S.scn = 'base';
  S.open = slug;
  const v = valuation(r), t = T(r), sf = SCN[S.scn][1](r.f), ts = M.tiers.map((d) => (S.scn === 'base' ? T(r, d) : farmTier(sf, d))), st = ts[M.tiers.indexOf(S.tier)];
  const fac = [['Comp at sample mean (exp ȳ)', Math.exp(F.ybar)], [`× TVL ${usd(r.tvl)} (elasticity ${F.elasticity.toFixed(2)})`, Math.exp(v.terms[0])], [`× ${r.x[1] ? 'Pass-through family' : 'Own-fee family'} (${esc(r.cat)})`, Math.exp(v.terms[1])],
    [`× 7-day growth ${pc(r.chg ?? 0)} (k ${F.k}, capped ±${M.growth_cap_pct}%)`, Math.exp(v.growth)], [`× Seasoning ${ageTxt(r.age)} with no token (d ${F.d}, T ${F.T}d)`, Math.exp(v.season)]];
  const fo = t.verdict === 'THIN' && carry(r) <= 0;
  const d = $('#drawer');
  d.innerHTML = `<header class="dh"><div><h2>${esc(r.name)} <span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCHLIST' : 'EMERGING'}</span></h2>
      <p>rank <b>#${r.r}</b> of ${R.rows.length} by implied FDV · ${esc(r.cat)} · home chain <b>${esc(r.f.chain)}</b>${r.chains.length > 1 ? ` (+${r.chains.length - 1} more)` : ''} · TVL <b>${usd(r.tvl)}</b> · 7d <b class="${sign(r.chg ?? 0)}">${pc(r.chg ?? 0)}</b> · ${ageTxt(r.age)} tracked, no token recorded</p></div>
    <div class="dk"><div><label>Implied FDV</label><b>${usd(r.fdv)}</b><small>Q25–Q75 ${usd(r.lo)}–${usd(r.hi)}</small></div><div><label>Net APR p50 @${tl(S.tier)}</label><b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>p25 ${pc(t.apr[0])} · p75 ${pc(t.apr[2])}</small></div>${pill(t.verdict)}<button class="ghost" id="close" aria-label="Close">Close ✕</button></div></header>
  ${fo ? `<p class="fobar">◆ Zero-carry free option: the ${r.route.apy}% base APY covers the ${M.benchmark_apy}% benchmark + ${r.route.prem}% risk premium, so parked stables lose nothing against the benchmark and the ${pc(t.apr[1], 2)}/yr airdrop is pure upside. Hold it if you already park stables here; it is never a reason to open a wallet.</p>` : ''}
  <div class="dgrid"><div>
    <h3>Valuation waterfall <small>${v.fdv === r.fdv ? '✓ recomputed = board' : '✗'}</small></h3>
    <table class="wf">${fac.map(([l, x], i) => `<tr><td>${l}</td><td class="n ${i && x < 1 ? 'neg' : i ? 'pos' : ''}">${i ? '×' + x.toFixed(3) : usd(x)}</td></tr>`).join('')}
      <tr class="tot"><td>= Implied FDV · ${(r.fdv / r.tvl).toFixed(2)}x TVL</td><td class="n">${usd(r.fdv)}</td></tr></table>
    <p class="mono">exp(${F.ybar.toFixed(3)} ${v.terms.map((x) => (x < 0 ? '− ' : '+ ') + Math.abs(x).toFixed(3)).join(' ')} ${v.growth < 0 ? '−' : '+'} ${Math.abs(v.growth).toFixed(3)} − ${Math.abs(v.season).toFixed(3)}) = ${v.fdv.toLocaleString('en-US')} ${v.fdv === r.fdv ? '✓ board' : '✗'}</p>
    <h3>Peer comps <small>FDV or mcap per $ of TVL, log scale</small></h3>${peers(r)}
  </div><div>
    <h3>Farm economics <small>${sf.weeks}-week window · ${esc(r.route.product)}</small></h3>
    <div class="scn" role="group" aria-label="Scenario">${Object.entries(SCN).map(([k, [l]]) => `<button data-scn="${k}" class="${S.scn === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <table class="mt fe"><tr><th></th>${ts.map((x) => `<th class="n${x.deposit === S.tier ? ' cur' : ''}">${tl(x.deposit)}</th>`).join('')}</tr>
      ${[['Airdrop EV, p50', (x) => usd(x.ev[1])], [`Gas, ${st.txs} tx`, (x) => '−' + usd(x.gas)], ['Bridge', (x) => (x.bridge ? '−' + usd(x.bridge) : '$0')], [`Carry ${carry(r)}%/yr`, (x) => (x.carry > 0 ? '−' : '+') + usd(Math.abs(x.carry))],
        ['Net, p50', (x) => `<b class="${sign(x.net[1])}">${usd(x.net[1])}</b>`], ['Return in window', (x) => `<b class="${sign(x.roi[1])}">${pc(x.roi[1], 2)}</b>`], ['Net APR, p50', (x) => `<b class="${sign(x.apr[1])}">${pc(x.apr[1])}</b>`], ['APR p25 … p75', (x) => `<small>${pc(x.apr[0], 0)} … ${pc(x.apr[2], 0)}</small>`], ['Verdict', (x) => pill(x.verdict) + (x.whale ? '<br><small class="warn">&gt;1% of TVL</small>' : '')]]
        .map(([l, fn]) => `<tr><td>${l}</td>${ts.map((x) => `<td class="n${x.deposit === S.tier ? ' cur' : ''}">${fn(x)}</td>`).join('')}</tr>`).join('')}</table>
    <p class="mini">Airdrop yield ${st.airdrop_apr}%/yr = ${R.drop_q[1]}% drop (p50 of 12 launches) × ${r.f.share} route share × FDV/TVL ${(sf.fdv[1] / r.tvl).toFixed(2)} × ${(100 * st.tshare).toFixed(0)}% of the season. Break-even <b>${st.breakeven === null ? 'none' : usd0(st.breakeven)}</b>.${S.scn === 'base' ? '' : ' Scenario applies to this drawer only; board.json stays Base.'}</p>
    <h3>Sensitivity <small>net APR by deposit · ${esc(SCN[S.scn][0])}</small></h3>${sens(sf)}
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
  const list = [{ n: r.name + ' (implied)', m: r.fdv / r.tvl, me: 1 }].concat(r.anchors.map((a) => ({ n: a.name, m: a.mult, s: usd(a.mcap) + ' / ' + usd(a.tvl) })));
  const W = 318, L = 118, X = (m) => L + ((Math.log10(clamp(m, 0.01, 30)) + 2) / Math.log10(3000)) * (W - L - 44);
  return `<svg class="chart peer" viewBox="0 0 ${W} ${list.length * 24 + 20}" role="img" aria-label="Peer multiples">${[0.01, 0.1, 1, 10].map((m) => `<line x1="${X(m)}" x2="${X(m)}" y1="4" y2="${list.length * 24 + 4}" class="gl"/><text x="${X(m)}" y="${list.length * 24 + 16}" text-anchor="middle">${m}×</text>`).join('')}
    ${list.map((p, i) => `<text x="4" y="${i * 24 + 19}" class="${p.me ? 'me' : ''}">${esc(p.n.length > 19 ? p.n.slice(0, 18) + '…' : p.n)}</text><rect x="${L}" y="${i * 24 + 9}" width="${Math.max(2, X(p.m) - L)}" height="13" rx="2" class="${p.me ? 'me' : 'pr'}"/><text x="${X(p.m) + 4}" y="${i * 24 + 19}" class="v">${p.m.toFixed(2)}×</text>`).join('')}</svg>`;
}

/** Net APR p25/p50/p75 against deposit ($100 to $100k, log x) with the FARM bar, break-even and tiers. */
function sens(f) {
  const W = 420, H = 190, L = 38, B = 22, R0 = 60, xs = [], n = 48;
  for (let i = 0; i <= n; i++) xs.push(100 * 1000 ** (i / n));
  const pts = xs.map((d) => farmTier(f, d).apr), t = farmTier(f, S.tier);
  const p50 = pts.map((p) => p[1]), lo = Math.max(-30, Math.min(...pts.map((p) => p[0]), -2)), hi = Math.max(M.farm_apr * 2, Math.max(...p50) * 1.35 + 2);
  const X = (d) => L + (Math.log(d / 100) / Math.log(1000)) * (W - L - R0), Y = (v) => 10 + ((hi - clamp(v, lo, hi)) / (hi - lo)) * (H - B - 10);
  const tags = [0, 1, 2].map((q) => ({ q, y: Y(pts[n][q]) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < 3; i++) tags[i].y = Math.max(tags[i].y, tags[i - 1].y + 11);
  const col = ['#8a97ab', '#38bdf8', '#8a97ab'];
  const line = (q) => `<polyline fill="none" stroke="${col[q]}" stroke-width="${q === 1 ? 2.2 : 1.2}" ${q === 1 ? '' : 'stroke-dasharray="3 3"'} points="${xs.map((d, i) => X(d).toFixed(1) + ',' + Y(pts[i][q]).toFixed(1)).join(' ')}"/>`;
  const ticks = [0, M.farm_apr, Math.floor(hi / 10) * 10].concat(Y(lo) - Y(0) > 14 ? [Math.ceil(lo)] : []).filter((v, i, a) => a.indexOf(v) === i && v < hi);
  return `<svg class="chart sens" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net APR sensitivity to deposit size">
    ${ticks.map((v) => `<line x1="${L}" x2="${W - R0 + 4}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : v === M.farm_apr ? 'bar' : 'gl'}"/><text x="${L - 4}" y="${Y(v) + 3}" text-anchor="end">${v}%</text>`).join('')}
    ${M.tiers.map((d) => `<line x1="${X(d)}" x2="${X(d)}" y1="10" y2="${H - B}" class="${d === S.tier ? 'cur' : 'gl'}"/><text x="${X(d)}" y="${H - 8}" text-anchor="middle">${tl(d)}</text>`).join('')}
    ${line(0)}${line(2)}${line(1)}${tags.map(({ q, y }) => `<text x="${W - R0 + 8}" y="${y + 3}" style="fill:${col[q]}">p${[25, 50, 75][q]} ${pc(pts[n][q], 0)}</text>`).join('')}
    ${t.breakeven ? `<line x1="${X(clamp(t.breakeven, 100, 1e5))}" x2="${X(clamp(t.breakeven, 100, 1e5))}" y1="10" y2="${H - B}" class="be"/><text x="${X(clamp(t.breakeven, 100, 1e5)) + 4}" y="20" class="lbl be">break-even ${usd0(t.breakeven)}</text>` : ''}
    <text x="${X(1e5) - 2}" y="${Y(M.farm_apr) - 4}" text-anchor="end" class="lbl farm">FARM bar ${M.farm_apr}%</text></svg>`;
}

// ---------------------------------------------------------------- shared log-log scatter (methodology)
function scatter(points, o) {
  const { W, H, x0, x1, y0, y1, xl, yl } = o, L = 54, B = 34;
  const X = (v) => L + ((Math.log10(v) - x0) / (x1 - x0)) * (W - L - 12), Y = (v) => 10 + ((y1 - Math.log10(v)) / (y1 - y0)) * (H - B - 10);
  let g = '';
  for (let e = Math.ceil(x0); e <= x1; e++) g += `<line x1="${X(10 ** e)}" x2="${X(10 ** e)}" y1="10" y2="${H - B}" class="gl"/><text x="${X(10 ** e)}" y="${H - B + 14}" text-anchor="middle">${usd(10 ** e, 0)}</text>`;
  for (let e = Math.ceil(y0); e <= y1; e++) g += `<line x1="${L}" x2="${W - 12}" y1="${Y(10 ** e)}" y2="${Y(10 ** e)}" class="gl"/><text x="${L - 6}" y="${Y(10 ** e) + 4}" text-anchor="end">${usd(10 ** e, 0)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yl)} against ${esc(xl)}">${g}${(o.extra || '')(X, Y)}
    ${points.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 3.6}" class="${p.c}"><title>${esc(p.t)}</title></circle>`).join('')}
    <text x="${(W + L) / 2}" y="${H - 4}" text-anchor="middle" class="ax">${xl}</text><text x="12" y="${(H - B) / 2}" transform="rotate(-90 12 ${(H - B) / 2})" text-anchor="middle" class="ax">${yl}</text></svg>`;
}

// ---------------------------------------------------------------- radar: opportunity map
function radar() {
  const rows = view(), W = 1372, H = 360, L = 50, B = 30, Rt = 16;
  const apr = (r) => T(r).apr[1], ymax = Math.ceil((Math.max(10, ...rows.map(apr)) + 4) / 5) * 5, ymin = -10;
  const X = (v) => L + ((Math.log10(v) - 6.65) / (9.55 - 6.65)) * (W - L - Rt), Y = (v) => 8 + ((ymax - clamp(v, ymin, ymax)) / (ymax - ymin)) * (H - B - 8);
  const fmax = Math.max(...R.rows.map((r) => r.fdv)), rad = (r) => 3.5 + 11 * Math.sqrt(r.fdv / fmax);
  let g = '';
  for (const v of [5e6, 1e7, 3e7, 1e8, 3e8, 1e9, 3e9]) g += `<line x1="${X(v)}" x2="${X(v)}" y1="8" y2="${H - B}" class="gl"/><text x="${X(v)}" y="${H - B + 15}" text-anchor="middle">${usd(v, 0)}</text>`;
  for (let v = ymin; v <= ymax; v += 5) g += `<line x1="${L}" x2="${W - Rt}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : 'gl'}"/><text x="${L - 6}" y="${Y(v) + 3}" text-anchor="end">${v}%</text>`;
  const pick = rows.filter((r) => T(r).verdict === 'FARM').sort((a, b) => apr(b) - apr(a)).slice(0, 7).concat(rows.filter((r) => r.seg === 'W').sort((a, b) => b.fdv - a.fdv).slice(0, 3));
  const boxes = [], labels = [];
  const hit = (b, o) => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h;
  const discs = rows.map((r) => { const k = rad(r); return { x: X(r.tvl) - k, y: Y(apr(r)) - k, w: 2 * k, h: 2 * k }; });
  for (const r of pick) {
    const cx = X(r.tvl), cy = Y(apr(r)), k = rad(r), txt = `${short(r.name)} ${pc(apr(r))}`, w = txt.length * 6.9 + 6;
    const at = [[k + 4, 4, 0], [-k - 4, 4, 1], [0, -k - 6, 0.5], [0, k + 13, 0.5], [k + 2, -k - 2, 0], [-k - 2, -k - 2, 1], [k + 2, k + 10, 0], [-k - 2, k + 10, 1], [0, -k - 20, 0.5], [0, k + 27, 0.5]];
    const fit = (soft) => at.find(([dx, dy, a]) => { const b = { x: cx + dx - a * w, y: cy + dy - 11, w, h: 15 };
      return !(b.x < L || b.x + w > W - Rt || b.y < 8 || b.y + 15 > H - B || boxes.some((o) => hit(b, o)) || (soft && discs.some((o) => hit(b, o)))); });
    const p = fit(true) || fit(false);
    if (!p) continue;
    const x = cx + p[0] - p[2] * w;
    boxes.push({ x, y: cy + p[1] - 11, w, h: 15 }); labels.push(`<text x="${x.toFixed(1)}" y="${(cy + p[1]).toFixed(1)}" class="cl ${T(r).verdict}">${esc(txt)}</text>`);
  }
  const dots = rows.slice().sort((a, b) => b.fdv - a.fdv).map((r) => `<circle cx="${X(r.tvl).toFixed(1)}" cy="${Y(apr(r)).toFixed(1)}" r="${rad(r).toFixed(1)}" class="${T(r).verdict}${r.seg === 'W' ? ' w' : ''}" data-slug="${r.slug}"><title>${esc(r.name)} · TVL ${usd(r.tvl)} · implied ${usd(r.fdv)} · p50 ${pc(apr(r))} · ${T(r).verdict}</title></circle>`).join('');
  const svg = `<svg class="chart map" viewBox="0 0 ${W} ${H}" role="img" aria-label="p50 net APR against TVL">${g}
    <line x1="${L}" x2="${W - Rt}" y1="${Y(M.farm_apr)}" y2="${Y(M.farm_apr)}" class="bar"/><text x="${W - Rt - 4}" y="${Y(M.farm_apr) - 5}" text-anchor="end" class="lbl farm">FARM bar · p50 ≥ ${M.farm_apr}% and p25 ≥ 0</text>
    <line x1="${X(R.floor_usd)}" x2="${X(R.floor_usd)}" y1="8" y2="${H - B}" class="floor"/><text x="${X(R.floor_usd) + 5}" y="20" class="lbl">$50M watchlist floor →</text>
    <text x="${X(R.floor_usd) + 5}" y="${Y(-6)}" class="note">large vaults: drop diluted over billions of TVL</text>${dots}${labels.join('')}
    <text x="${(W + L) / 2}" y="${H - 3}" text-anchor="middle" class="ax">TVL (log) · bubble area = implied FDV</text><text x="12" y="${(H - B) / 2}" transform="rotate(-90 12 ${(H - B) / 2})" text-anchor="middle" class="ax">p50 net APR @${tl(S.tier)}</text></svg>`;
  return `<section class="panel">${filters(rows.length)}<h3>Opportunity map <small>${rows.length} rows · p50 net farm APR at ${tl(S.tier)} against TVL · click a bubble</small></h3>${svg}
    <p class="legend"><i class="FARM"></i>FARM <i class="THIN"></i>THIN <i class="SKIP"></i>SKIP <i class="ring"></i>ringed = watchlist · labels: top FARM by APR and the largest watchlist names in view</p></section>
    <div class="cols two rv">${matrix(rows)}${cards(rows)}</div>`;
}

/** Median p50 net APR of the rows in view by category × home chain (top six of each). */
function matrix(rows) {
  const top = (key) => Object.entries(rows.reduce((a, r) => ((a[key(r)] = (a[key(r)] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 6).map(([k]) => k);
  const cs = top((r) => r.cat), hs = top((r) => r.f.chain);
  const med = (v) => { const s = v.slice().sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const cell = (list) => { if (!list.length) return '<td class="e">·</td>'; const m = med(list.map((r) => T(r).apr[1])); return `<td class="${m >= M.farm_apr ? 'FARM' : m > 0 ? 'THIN' : 'SKIP'}">${pc(m)}<small>${list.length}</small></td>`; };
  return `<section class="panel"><h3>Yield matrix <small>median p50 net APR · count · category × home chain</small></h3>
    <table class="ym"><tr><th></th>${hs.map((h) => `<th>${esc(h)}</th>`).join('')}<th>all</th></tr>${cs.map((c) => `<tr><th>${esc(c)}</th>${hs.map((h) => cell(rows.filter((r) => r.cat === c && r.f.chain === h))).join('')}${cell(rows.filter((r) => r.cat === c))}</tr>`).join('')}</table></section>`;
}

function cards(rows) {
  const top = rows.filter((r) => T(r).verdict === 'FARM').sort((a, b) => T(b).apr[1] - T(a).apr[1]).slice(0, 6);
  return `<section class="panel"><h3>Top FARM in view <small>ranked by p50 net APR at ${tl(S.tier)}</small></h3>
    ${top.length ? `<div class="cards">${top.map((r, i) => `<div class="card" data-slug="${r.slug}"><i>${i + 1}</i><b>${esc(r.name)}</b><em class="pos">${pc(T(r).apr[1])}</em><small>${esc(r.cat)} · ${esc(r.f.chain)} · ${r.f.weeks} wk</small><small>FDV ${usd(r.fdv)} · break-even ${usd0(T(r).breakeven ?? 0)}</small></div>`).join('')}</div>` : `<p class="empty">No FARM row in this view.</p>`}</section>`;
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
  const fn = R.funnel, lo = F.loo_points, f3 = (x) => x.toFixed(3);
  const band = (X, Y) => `<polygon points="${X(1e6)},${Y(2e6)} ${X(1e10)},${Y(2e10)} ${X(1e10)},${Y(5e9)} ${X(1e6)},${Y(5e5)}" class="band2"/><line x1="${X(1e6)}" y1="${Y(1e6)}" x2="${X(1e10)}" y2="${Y(1e10)}" class="diag"/>`;
  const sc = scatter(lo.map((p) => ({ x: p.pred_usd, y: p.mcap_usd, c: Math.abs(p.resid) <= Math.LN2 ? 'in' : 'out', r: 3.4, t: `${p.name}: blind ${usd(p.pred_usd)} vs actual ${usd(p.mcap_usd)}` })),
    { W: 440, H: 300, x0: 6.3, x1: 9.7, y0: 6.3, y1: 10, xl: 'blind LOO prediction (log)', yl: 'actual market cap (log)', extra: band });
  const coef = [['log TVL', F.beta[0] / F.sd[0], `×${(10 ** (F.beta[0] / F.sd[0])).toFixed(2)} per 10× TVL`, '≥ 0', true],
    ['pass-through family', F.beta[1] / F.sd[1], `×${F.pass_mult.toFixed(2)} when TVL is routed capital`, 'free', true],
    ['7-day growth k', F.k, `free fit ${F.free_growth.toFixed(2)} → held in [0.25, 1]`, '≥ 0.25', F.k > 0],
    ['seasoning depth d', F.d, `free log-age fit ${F.free_age.toFixed(2)} → held in [0.15, 0.5]`, '≥ 0.15', F.d > 0]];
  const mx = Math.max(...coef.map((c) => Math.abs(c[1])));
  const kept = F.features.find((f) => f.chosen), split = F.features.find((f) => /split/.test(f.name));
  const ks = [...new Set(F.grid_r2.map((g) => g.k))], ds = [...new Set(F.grid_r2.map((g) => g.d))], gmax = Math.max(...F.grid_r2.map((g) => g.r2)), gmin = Math.min(...F.grid_r2.map((g) => g.r2));
  const mono = R.rows.reduce((a, r) => { const v = valuation(r).fdv, c = r.chg ?? 0; a.u += valuation({ ...r, chg: c + 5 }).fdv >= v; a.d += valuation({ ...r, chg: c - 5 }).fdv <= v; a.o += valuation({ ...r, age: (r.age ?? M.unknown_age_days) + 90 }).fdv >= v; return a; }, { u: 0, d: 0, o: 0 });
  const drops = R.drops.slice().sort((a, b) => b[1] - a[1]), DW = 440, bw = (DW - 20) / drops.length, DY = (s) => 96 - (s / 32) * 84;
  const parts = [['comps', fn.comps, 'traded comps (fit)'], ['tok', fn.token_other, 'other tokens'], ['W', fn.watchlist, 'watchlist ranked'], ['E', fn.emerging, 'emerging ranked'], ['as', fn.aside_above, 'set aside ≥ floor'], ['sc', fn.screened_below, 'screened < floor']];
  const better = (f, k) => (f[k] > kept[k] && !f.chosen ? ' up' : '');
  return `<div class="mgrid">
  <section class="panel"><h3>The fitted equation <small>ridge on ${F.n_comps} traded comps, λ ${F.lam}</small></h3>
    <pre class="eq">log FDV = ${F.ybar.toFixed(3)} + ${f3(F.beta[0] / F.sd[0])}·(log TVL − ${F.mu[0].toFixed(2)})
        ${F.beta[1] / F.sd[1] < 0 ? '−' : '+'} ${f3(Math.abs(F.beta[1] / F.sd[1]))}·(pass − ${F.mu[1].toFixed(2)})
        + ${F.k}·clamp(chg7d, ±30%)
        + log(1 − ${F.d}·e^(−age/${F.T}d))</pre>
    <h3 class="sub">Coefficients and their signs <small>economic sanity, enforced</small></h3>
    ${coef.map(([n, b, note, box, ok]) => `<div class="cf"><span>${n}<small>${note}</small></span><div class="cfb"><i class="${b < 0 ? 'neg' : 'pos'}" style="width:${(48 * Math.abs(b)) / mx}%;${b < 0 ? 'right:50%' : 'left:50%'}"></i></div><b>${f3(b)}</b><em>${box} ${ok ? '✓' : '✗'}</em></div>`).join('')}
    <h3 class="sub">Monotonicity proof <small>LOO R², rows k × columns d</small></h3>
    <table class="heat"><tr><th></th>${ds.map((d) => `<th>${d}</th>`).join('')}</tr>${ks.map((k) => `<tr><th>${k}</th>${ds.map((d) => { const g = F.grid_r2.find((x) => x.k === k && x.d === d); return `<td style="--a:${((g.r2 - gmin) / (gmax - gmin || 1)).toFixed(2)}" class="${k === F.k && d === F.d ? 'pick' : ''}">${f3(g.r2)}</td>`; }).join('')}</tr>`).join('')}</table>
    <p class="mini">Every cell has k &gt; 0 and d &gt; 0, so the sign holds wherever LOO lands. Rechecked on all ${R.rows.length} rows here: +5pp of 7-day growth never lowers FDV <b class="pos">${mono.u}/${R.rows.length} ✓</b>, −5pp never raises it <b class="pos">${mono.d}/${R.rows.length} ✓</b>, 90 more days with no token never lowers it <b class="pos">${mono.o}/${R.rows.length} ✓</b>. Cost of the box: LOO R² ${f3(F.loo.r2)} vs ${f3(F.baselines[0].metrics.r2)} with the terms off.</p>
    <h3 class="sub">Airdrop calibration <small>community share of supply, 12 launches</small></h3>
    <svg class="chart" viewBox="0 0 ${DW} 124" role="img" aria-label="Airdrop shares">${R.drop_q.map((q, i) => `<line x1="10" x2="${DW - 10}" y1="${DY(q)}" y2="${DY(q)}" class="${i === 1 ? 'bar' : 'gl'}"/>`).join('')}<text x="${DW - 12}" y="18" text-anchor="end" class="lbl farm">p25 / p50 / p75 = ${R.drop_q.join(' / ')}% (dashed p50)</text>
      ${drops.map(([n, s], i) => `<rect x="${10 + i * bw + 3}" y="${DY(s)}" width="${bw - 6}" height="${96 - DY(s)}" rx="2" class="dr"/><text x="${10 + i * bw + bw / 2}" y="${DY(s) - 3}" text-anchor="middle" class="v">${s}</text><text x="${10 + i * bw + bw / 2}" y="${108 + (i % 2) * 11}" text-anchor="middle">${esc(n.replace(/ S1$/, ''))}</text>`).join('')}</svg></section>
  <section class="panel"><h3>Blind leave-one-out, predicted vs actual <small>${F.n_comps} refits</small></h3>${sc}
    <div class="stats"><div><label>LOO R²</label><b>${f3(F.loo.r2)}</b></div><div><label>LOO ρ</label><b>${f3(F.loo.rho)}</b></div><div><label>Nested R²</label><b>${f3(F.nested.r2)}</b></div><div><label>Within 2×</label><b>${(100 * F.loo.within2x).toFixed(0)}%</b></div></div>
    <p class="mini">Green: within 2× (shaded band). Nested LOO re-selects λ, k and d inside each of the ${F.n_comps} folds (the full pick recurs in ${F.nested_same}), so the reported skill also pays for the search. Every row ships a Q25–Q75 band.</p>
    <h3 class="sub">Walk-forward by listing date <small>train older, predict newer</small></h3>
    <table class="mt"><tr><th>Test cohort</th><th class="n">Train/test</th><th class="n">R²</th><th class="n">ρ</th><th class="n">≤2×</th></tr>
    ${F.wf.folds.map((f) => `<tr><td>${f.from} → ${f.to}</td><td class="n">${f.train_n}/${f.test_n}</td><td class="n">${f3(f.metrics.r2)}</td><td class="n">${f3(f.metrics.rho)}</td><td class="n">${(100 * f.metrics.within2x).toFixed(0)}%</td></tr>`).join('')}
    <tr class="tot"><td>Pooled out-of-time</td><td class="n">${F.wf.pooled.n}</td><td class="n">${f3(F.wf.pooled.r2)}</td><td class="n">${f3(F.wf.pooled.rho)}</td><td class="n">${(100 * F.wf.pooled.within2x).toFixed(0)}%</td></tr></table></section>
  <section class="panel"><h3>Ablation, R3 → v6 <small>same 87 comps, blind</small></h3>
    <table class="mt"><tr><th>Model</th><th class="n">LOO R²</th><th class="n">Nested R²</th><th class="n">Walk-fwd ρ</th></tr>${HISTORY.map(([n, a, b, c]) => `<tr><td>${n}</td><td class="n">${f3(a)}</td><td class="n">${f3(b)}</td><td class="n">${f3(c)}</td></tr>`).join('')}
    <tr class="tot"><td>v6 ${esc(R.version)} (this board)</td><td class="n">${f3(F.loo.r2)}</td><td class="n">${f3(F.nested.r2)}</td><td class="n">${f3(F.wf.pooled.rho)}</td></tr>
    ${F.baselines.map((b) => `<tr><td class="dim">${b.name}</td><td class="n dim">${f3(b.metrics.r2)}</td><td class="n dim">—</td><td class="n dim">—</td></tr>`).join('')}</table>
    <h3 class="sub">v6 feature search <small>each design re-selects λ, k, d; ▲ beats kept</small></h3>
    <table class="mt fsr"><tr><th>Design</th><th class="n">LOO R²</th><th class="n">LOO ρ</th><th class="n">WF ρ</th></tr>${F.features.map((f) => `<tr class="${f.chosen ? 'tot' : ''}"><td>${esc(f.name)}</td><td class="n${better(f, 'r2')}">${f3(f.r2)}</td><td class="n${better(f, 'rho')}">${f3(f.rho)}</td><td class="n${better(f, 'wf_rho')}">${f3(f.wf_rho)}</td></tr>`).join('')}</table>
    <p class="mini">A design ships only if it beats the kept one on LOO R² and walk-forward ρ together; none of ${F.features.length - 2} challengers does, so v6 keeps the v5 core. Split elasticities measure own-fee ${split ? split.betas[0].toFixed(2) : '—'} vs pass-through ${split ? split.betas[1].toFixed(2) : '—'} per log TVL: own-fee names barely move, large vaults would fall further.</p></section>
  <section class="panel span"><h3>The whole snapshot, accounted for <small>${fn.total} protocols, each classified once</small></h3>
    <div class="funnel">${parts.map(([k, n]) => `<i class="${k}" style="flex:${n}">${n}</i>`).join('')}</div>
    <p class="legend">${parts.map(([k, n, l]) => `<i class="${k}"></i>${n} ${l}`).join(' ')} = ${parts.reduce((a, p) => a + p[1], 0)} ✓</p>
    <p class="mini">Planner: window ${M.horizon_weeks.map(([a, w]) => `&lt;${a}d ${w}wk`).join(', ')}, older ${M.horizon_default_weeks}wk; gas ${M.tx_base} + 1 tx per ${M.tx_per_weeks} wk at home-chain rates; bridge $${M.bridge_usd} off Ethereum.</p></section></div>`;
}

// ---------------------------------------------------------------- render and events
function render() {
  header();
  $('#main').innerHTML = { board, radar, traded, method }[S.tab]();
  if (S.open) openDrawer(S.open);
}
document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-tier],[data-tab],[data-v],[data-sort],[data-slug],[data-scn],#reset,#scrim');
  if (!el) return;
  if (el.id === 'scrim') return closeDrawer();
  if (el.dataset.scn) { S.scn = el.dataset.scn; return openDrawer(S.open); }
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
