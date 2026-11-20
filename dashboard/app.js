'use strict';
// Kestrel Token Radar v9: renders window.RADAR (data.js) with KM, M, rd, clamp (model.js). integrity() and
// rerun() prove on load that rows, value fit, ledger and launch curve = board.json.
const R = window.RADAR, F = R.fit, O = R.odds;
const S = { tier: 10000, tab: 'board', q: '', seg: 'all', v: 'all', cat: 'all', chain: 'all', sort: 'r', dir: 1, open: null };
const UN = Object.fromEntries(R.U.map((u) => [u.s, u]));
const DISP = { W: 'Watchlist, ranked', E: 'Emerging, ranked', C: 'Traded comp', K: 'Token, outside comps', A: 'Set aside ≥ floor', X: 'Screened < floor' };

// ---- format
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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
const f3 = (x) => x.toFixed(3);
const sign = (n) => { const v = rd(n, 1); return v > 0 ? 'pos' : v < 0 ? 'neg' : ''; };
const ageTxt = (a) => (a === null ? 'undated' : a < 365 ? Math.max(1, Math.round(a / 30)) + ' mo' : (a / 365).toFixed(1) + ' y');
const pill = (v) => `<span class="pill ${v}">${v}</span>`;
const ck = (c) => `<b class="${c ? 'ck' : 'bad'}">${c ? '✓' : '✗'}</b>`;
const carry = (r) => rd(M.benchmark + r.route.prem - r.route.apy, 2);
const T = (r, d = S.tier) => ((r._t ??= {})[d] ??= KM.farmTier(r.f, d));
/** The value bridge as multipliers: [anchor $, TVL, family, 7d growth, no-token seasoning]. */
const fx = (r) => KM.bridge(F, UN[r.slug]).map(Math.exp);
const xm = (v) => '×' + v.toFixed(2);
/** A table: header cells ('>' right-aligns) and rows of cell HTML. */
const tbl = (head, rows, cls = 'mt') => `<table class="${cls}"><tr>${head.map((h) => (h[0] === '>' ? `<th class="n">${h.slice(1)}</th>` : `<th>${h}</th>`)).join('')}</tr>${rows.join('')}</table>`;
const td = (v, c = 'n') => `<td class="${c}">${v}</td>`;
const box = (l, v, m = '') => `<div><label>${l}</label><b>${v}</b>${m && `<small>${m}</small>`}</div>`;

// ---- integrity
/** On boot: 758 accounted once; every row's value, odds, season share and verdicts = board.json. */
function integrity() {
  const by = R.U.reduce((a, u) => ((a[u.d] = (a[u.d] || 0) + 1), a), {}), fn = R.funnel;
  const live = R.rows.filter((r) => { const u = UN[r.slug], c = KM.campaign(O, u);
    return KM.implied(F, u) === r.fdv && c.p12 === r.f.p12 && c.p24 === r.f.p24 && c.ss === r.f.ss && M.tiers.every((d) => T(r, d).verdict === r.b[d][0] && T(r, d).apr[1] === r.b[d][1]); }).length;
  const ok = by.W === fn.watchlist && by.E === fn.emerging && by.C === fn.comps && by.K === fn.token_other && by.A === fn.aside_above && by.X === fn.screened_below;
  return { by, acc: Object.values(by).reduce((a, n) => a + n, 0), ok, wl: R.rows.filter((r) => r.seg === 'W').length, live };
}
/** After first paint: refit the value model and ledger, and the launch curve with all 758 LOO refits. */
function rerun() {
  const t0 = performance.now(), v = KM.fitValue(R.U), o = KM.fitOdds(R.U, { terms: O.terms, lam: O.lam }), same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return { ms: Math.round(performance.now() - t0), value: same(v, F),
    odds: same([o.beta, o.b0, o.loo, o.calib], [O.beta, O.b0, O.loo, O.calib]) };
}
const I = integrity();
let L = null;

// ---- filters and sort
const CATS = [...new Set(R.rows.map((r) => r.cat))].sort();
const CHAINS = Object.entries(R.rows.reduce((a, r) => ((a[r.f.chain] = (a[r.f.chain] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).map(([c]) => c);
const KEYS = { r: (r) => r.r, name: (r) => r.name.toLowerCase(), tvl: (r) => r.tvl, p: (r) => r.f.p12, fdv: (r) => r.fdv, apr: (r) => T(r).apr[1], be: (r) => T(r).breakeven ?? 1e12, v: (r) => ['FARM', 'THIN', 'SKIP'].indexOf(T(r).verdict) };
function view() {
  const q = S.q.trim().toLowerCase(), k = KEYS[S.sort];
  return R.rows.filter((r) => (S.seg === 'all' || r.seg === S.seg) && (S.v === 'all' || T(r).verdict === S.v) && (S.cat === 'all' || r.cat === S.cat) &&
    (S.chain === 'all' || r.f.chain === S.chain) && (!q || (r.name + ' ' + r.slug + ' ' + r.cat + ' ' + r.chains.join(' ')).toLowerCase().includes(q)))
    .sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : a.r - b.r) * S.dir);
}

// ---- shell
function header() {
  const n = R.rows.length, cnt = (rs) => rs.reduce((a, r) => ((a[T(r).verdict] += 1), a), { FARM: 0, THIN: 0, SKIP: 0 }), v = cnt(R.rows), wv = cnt(R.rows.filter((r) => r.seg === 'W'));
  const live = L === null ? '<span class="dim">re-running both fits in this browser…</span>' : `${ck(L.value)} <span><b>4-term value fit + ${F.ledger.length}-design ledger</b> re-run = shipped</span>${ck(L.odds)} <span><b>launch curve + ${O.n} LOO refits</b> re-run = shipped · ${L.ms} ms</span>`;
  const kpi = (l, b, s, c = '') => `<div class="kpi ${c}"><label>${l}</label><b>${b}</b>${s}</div>`;
  $('#top').innerHTML = `<div class="brand"><div><h1><b>KESTREL</b> Token Launch Radar</h1>
  <p>Every pre-token protocol in the DefiLlama snapshot, valued if it launches from its TVL, 7-day growth and time with no token (fit on ${F.n} traded comps), given launch odds from all ${O.n} peers and a costed two-outcome farm verdict.</p></div>
  <div class="cap" role="group" aria-label="Capital per farm"><span>Capital per farm</span>${M.tiers.map((d, i) => `<button data-tier="${d}" class="${d === S.tier ? 'on' : ''}">${tl(d)}<small>${['retail', 'active', 'whale'][i]}</small></button>`).join('')}</div>
  <div class="stamp">${esc(R.version)} · snapshot ${R.as_of}<br>${R.funnel.total} protocols → ${n} ranked</div></div>
  <div class="strip">${ck(I.acc === R.funnel.total && I.ok)} <span><b>${I.acc}/${R.funnel.total}</b> accounted</span>${ck(I.wl === R.funnel.watchlist)} <span><b>${I.wl}/${R.funnel.watchlist}</b> watchlist</span>${ck(I.live === n)} <span><b>${I.live}/${n}</b> live-recomputed = board.json</span>${live}</div>
  ${S.tab !== 'board' ? '' : `<div class="kpis">${kpi('Watchlist covered', `${I.wl}<i>/${R.funnel.watchlist}</i>`, `<span>${wv.FARM} FARM · ${wv.THIN} THIN · ${wv.SKIP} SKIP at ${tl(S.tier)}</span>`)}
  ${kpi('Ranked pre-token', `${n}<i> of ${R.funnel.total}</i>`, `<span>${R.funnel.watchlist} watch + ${R.funnel.emerging} emerging · ${R.funnel.comps + R.funnel.token_other} traded apart</span>`)}
  ${kpi(`Verdicts at ${tl(S.tier)}`, ['FARM', 'THIN', 'SKIP'].map((k) => `<em class="${k}">${v[k]}</em>`).join(' · '), `<div class="mix">${['FARM', 'THIN', 'SKIP'].map((k) => `<i class="${k}" style="flex:${v[k]}"></i>`).join('')}</div>`)}
  ${kpi('Value model · 4 terms', `TVL<sup>${F.elasticity.toFixed(2)}</sup>·(1+g)<sup>${F.bg}</sup>`, `<span>× seasoning<sup>${F.elasticity.toFixed(2)}</sup> × family (pass ×${F.pass_mult.toFixed(2)})</span>`, 'eqk')}
  ${kpi('Held-out, both tests', `ρ ${F.loo.rho.toFixed(2)}<i> · AUC ${O.loo.auc.toFixed(2)}</i>`, `<span>LOO R² ${F.loo.r2.toFixed(2)} · walk-fwd ρ ${F.wf.pooled.rho.toFixed(2)}, AUC ${O.wf.pooled.auc.toFixed(2)}</span>`)}</div>`}`;
  $('#tabs').innerHTML = [['board', 'Board'], ['method', 'Methodology']].map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? 'on' : ''}">${l}${k === 'board' ? ` <small>${n}</small>` : ''}</button>`).join('') +
    '<span class="note">g = 7d growth over the market week · P = odds of a token in 12 / 24 months · APR blended over both outcomes, net of every cost</span>';
}

function filters(n) {
  const opt = (v, l, cur) => `<option value="${esc(v)}"${v === cur ? ' selected' : ''}>${esc(l)}</option>`;
  return `<div class="filters"><input id="q" type="search" placeholder="Search protocols" value="${esc(S.q)}" aria-label="Search">
  <select id="seg" aria-label="Segment">${opt('all', 'All segments', S.seg)}${opt('W', 'Watchlist (40)', S.seg)}${opt('E', `Emerging (${R.funnel.emerging})`, S.seg)}</select>
  <div class="chips" role="group" aria-label="Verdict">${['all', 'FARM', 'THIN', 'SKIP'].map((v) => `<button data-v="${v}" class="${v} ${S.v === v ? 'on' : ''}">${v === 'all' ? 'All' : v}</button>`).join('')}</div>
  <select id="cat" aria-label="Category">${opt('all', 'All categories', S.cat)}${CATS.map((c) => opt(c, c, S.cat)).join('')}</select>
  <select id="chain" aria-label="Home chain">${opt('all', 'All home chains', S.chain)}${CHAINS.map((c) => opt(c, c, S.chain)).join('')}</select>
  <button id="reset" class="ghost">Reset</button><span class="count"><b>${n}</b> of ${R.rows.length}</span></div>`;
}

// ---- board
function board() {
  const rows = view(), th = (k, l, c = '') => `<th class="${c}${S.sort === k ? ' sorted' : ''}" data-sort="${k}">${l}${S.sort === k ? (S.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
  const body = rows.map((r) => { const t = T(r), c = r.chg ?? 0, x = fx(r), fp = (l, v) => `<i class="${v >= 1.005 ? 'pos' : v <= 0.995 ? 'neg' : ''}">${l} ${xm(v)}</i>`;
    return `<tr data-slug="${r.slug}" tabindex="0"><td class="rk">${r.r}</td>
  <td class="pn"><b>${esc(r.name)}</b><span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCH' : 'EMERG'}</span><small>${esc(r.cat)} · ${esc(r.f.chain)}${r.chains.length > 1 ? ' +' + (r.chains.length - 1) : ''} · ${ageTxt(r.age)}</small></td>
  ${td(`<b>${usd(r.tvl)}</b><small class="trend ${sign(c)}">${c > 0 ? '▲' : c < 0 ? '▼' : '•'} ${Math.abs(c).toFixed(1)}% 7d</small>`, 'n tv')}
  <td class="pt"><b>${pp(r.f.p12)}</b><small> · ${pp(r.f.p24)}</small><div class="pbar"><i style="width:${100 * r.f.p24}%"></i><u style="width:${100 * r.f.p12}%"></u></div></td>
  <td class="fdv"><b>${usd(r.fdv)}</b><small>${usd(r.lo, 0)}–${usd(r.hi, 0)}</small><div class="fx">${fp('TVL', x[1] * x[2])}${fp('7d', x[3])}${fp('age', x[4])}</div></td>
  <td class="fp"><b>${esc(r.tag)} · ${r.f.weeks} wk</b><small>${usd0(t.gas + t.bridge)} gas · ${usd0(t.carry)} carry · BE ${t.breakeven === null ? '—' : usd0(t.breakeven)}</small></td>
  ${td(`<b class="${sign(t.apr[1])}">${pc(t.apr[1])}</b><small>if token ${pc(t.apr_if[1])}</small>`, 'n apr')}${td(pill(t.verdict), 'vc')}</tr>`; }).join('');
  return `<div class="cols"><section class="panel">${filters(rows.length)}
  <table class="grid" id="grid"><thead><tr>${th('r', '#', 'rk')}${th('name', 'Protocol')}${th('tvl', 'TVL · 7d', 'n')}${th('p', 'P 12m · 24m')}${th('fdv', 'Implied value · Q25–Q75')}${th('be', `Farm plan @${tl(S.tier)}`)}${th('apr', 'Net APR', 'n')}${th('v', 'Verdict', 'vc')}</tr></thead>
  <tbody>${body || '<tr><td colspan="8" class="empty">No protocol matches these filters.</td></tr>'}</tbody></table></section>
  <aside class="side">${S.v === 'FARM' ? basketCard() + breakdown(rows) : setups(rows) + basketCard()}</aside></div>`;
}
const li = (r, name, sub, apr, right) => `<li data-slug="${r.slug}"><b>${name}</b><small>${sub}</small><em class="pos">${pc(apr)}</em><span>${right}</span></li>`;
function setups(rows) {
  const top = rows.filter((r) => T(r).verdict === 'FARM').sort((a, b) => T(b).apr[1] - T(a).apr[1]).slice(0, 5);
  return `<section class="panel bk"><h3>Top farm setups in view <small>risk-adj p50 APR · P 24m · ${tl(S.tier)}</small></h3>
  ${top.length ? `<ol class="bkl">${top.map((r) => li(r, esc(r.name) + ' ' + pill('FARM'), `#${r.r} · ${esc(r.cat)} · ${esc(r.f.chain)} · break-even ${usd0(T(r).breakeven)}`, T(r).apr[1], 'P ' + pp(r.f.p24))).join('')}</ol>` : `<p class="empty">No FARM row at ${tl(S.tier)} in this view.</p>`}</section>`;
}
function basketCard() {
  const b = KM.basket(R.rows, S.tier), s = R.baskets[S.tier], ok = JSON.stringify(b.slugs) === JSON.stringify(s.slugs) && b.net === s.net && b.apr === s.apr;
  return `<section class="panel bk"><h3>Portfolio allocator <small>${b.picks.length} × ${usd0(b.sleeve)} · ${ok ? '= data.js ✓' : '≠ data.js ✗'}</small></h3>
  <div class="bkk">${box('Net APR', `<em class="${sign(b.apr)}">${pc(b.apr)}</em>`)}${box('p50 profit', usd0(b.net), 'p25 ' + usd0(b.p25))}${box('Costs', usd0(b.costs), 'carry ' + usd0(b.carry))}${box('≥1 launch', pp(b.any), 'in 24 months')}</div>
  ${b.picks.length ? `<ol class="bkl">${b.picks.map((x) => li(x.r, esc(x.r.name), `${esc(x.r.cat)} · ${esc(x.r.f.chain)} · P ${pp(x.r.f.p24)} · ${x.r.f.weeks} wk`, x.t.apr[1], usd0(x.t.net[1]))).join('')}</ol>` : `<p class="empty">No FARM sleeve at ${usd0(b.sleeve)}.</p>`}</section>`;
}
function breakdown(rows) {
  const bars = (key, l, k) => { const e = Object.entries(rows.reduce((a, r) => ((a[key(r)] = (a[key(r)] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, k), mx = Math.max(1, ...e.map((x) => x[1]));
    return `<h3 class="sub">${l}</h3>${e.map(([k, n]) => `<div class="hb"><span>${esc(k)}</span><i style="width:${(100 * n) / mx}%"></i><b>${n}</b></div>`).join('')}`; };
  return `<section class="panel"><h3>FARM in view <small>${rows.length} rows at ${tl(S.tier)}</small></h3>${bars((r) => r.cat, 'By category', 4)}${bars((r) => r.f.chain, 'By home chain', 5)}</section>`;
}
// ---- drawer
function openDrawer(slug) {
  const r = R.rows.find((x) => x.slug === slug);
  if (!r) return;
  S.open = slug;
  const u = UN[slug], z = KM.bridge(F, u), fdv = KM.implied(F, u), c = KM.campaign(O, u), t = T(r), ts = M.tiers.map((d) => T(r, d)), g = KM.growth(u, F.gm), sb = F.dur.bands.find((b) => b.k === KM.bandOf(u.a));
  const fac = [['Peer anchor: comps’ mean log mcap', 'exp(ȳ)'], [`TVL ${usd(r.tvl)}`, `^${F.elasticity.toFixed(2)} fitted`], [`${KM.isPass(u.c) ? 'Pass-through' : 'Own-fee'} family · ${esc(r.cat)}`, 'ridge'],
    [`7d ${pc(r.chg ?? 0)} vs market ${pc(F.gm)} → ${pc(100 * Math.expm1(g))}`, `(1+g)^${F.bg}`], [`No token ${ageTxt(r.age)}: TVL σ ${sb.s.toFixed(1)}%/wk`, `(${F.dur.ref.toFixed(1)}/σ)^${F.elasticity.toFixed(2)}`]];
  const row = (l, fn, cls = '') => `<tr class="${cls}"><td>${l}</td>${ts.map((y) => td(fn(y), 'n' + (y.deposit === S.tier ? ' cur' : ''))).join('')}</tr>`, sec = (l) => `<tr class="sec"><td colspan="4">${l}</td></tr>`;
  const d = $('#drawer');
  d.innerHTML = `<header class="dh"><div><h2>${esc(r.name)} <span class="seg ${r.seg}">${r.seg === 'W' ? 'WATCHLIST' : 'EMERGING'}</span></h2>
  <p>rank <b>#${r.r}</b> of ${R.rows.length} by implied value · ${esc(r.cat)} · home chain <b>${esc(r.f.chain)}</b>${r.chains.length > 1 ? ` (+${r.chains.length - 1})` : ''} · TVL <b>${usd(r.tvl)}</b> · 7d <b class="${sign(r.chg ?? 0)}">${pc(r.chg ?? 0)}</b> · ${ageTxt(r.age)} tracked, no token</p></div>
  <div class="dk">${box('Implied value', usd(r.fdv), `Q25–Q75 ${usd(r.lo)}–${usd(r.hi)}`)}${box('P(token) 12m · 24m', `${pp(c.p12)} <i>· ${pp(c.p24)}</i>`, 'risk-adj ' + usd(r.fdv * c.p24))}${box(`Risk-adj APR @${tl(S.tier)}`, `<em class="${sign(t.apr[1])}">${pc(t.apr[1])}</em>`, 'if token ' + pc(t.apr_if[1]))}${pill(t.verdict)}<button class="ghost" id="close" aria-label="Close">Close ✕</button></div></header>
  <div class="dgrid"><div>
  <h3>Valuation <small>${fdv === r.fdv ? '✓ KM.implied() = board' : '✗'}</small></h3>
  <table class="wf">${fac.map(([l, f], i) => { const v = Math.exp(z[i]); return `<tr><td>${i ? '× ' : ''}${l}<small> ${f}</small></td>${td(i ? xm(v) : usd(v), 'n ' + (i ? (v < 0.995 ? 'neg' : v > 1.005 ? 'pos' : '') : ''))}</tr>`; }).join('')}<tr class="tot"><td>= Implied value · ${(r.fdv / r.tvl).toFixed(2)}× TVL</td>${td(usd(r.fdv))}</tr></table>
  <p class="mono">exp(${z[0].toFixed(3)} ${z.slice(1).map((v) => (v < 0 ? '− ' : '+ ') + Math.abs(v).toFixed(3)).join(' ')}) = ${fdv.toLocaleString('en-US')} ${fdv === r.fdv ? '✓' : '✗'}</p>
  <h3>Launch odds <small>${c.p12 === r.f.p12 && c.p24 === r.f.p24 ? '✓ KM.campaign() = board' : '✗'}</small></h3>
  <div class="stats">${box('F(age)', pp(c.fa), 'peers')}${box('P 12m', pp(c.p12), 'if none yet')}${box('P 24m', pp(c.p24), 'credit span')}${box('Share', (100 * c.ss).toFixed(1) + '%', 'of season')}</div>
  <p class="mini">A launch in month m (odds p_m) pays a ${c.weeks}-week deposit min(window, t) ÷ (prior season + t) of the points, so a late token dilutes the drop.</p>
  </div><div>
  <h3>Two-outcome economics <small>${r.f.weeks}-week window · ${M.credit_months}-month credit</small></h3>
  <table class="mt fe"><tr><th></th>${ts.map((y) => `<th class="n${y.deposit === S.tier ? ' cur' : ''}">${tl(y.deposit)}</th>`).join('')}</tr>
  ${row(`Gas ${t.txs} tx + bridge`, (y) => '−' + usd(y.gas + y.bridge))}${row(`Carry ${carry(r)}%/yr`, (y) => (y.carry > 0 ? '−' : '+') + usd(Math.abs(y.carry)))}
  ${sec(`A · Token within ${M.credit_months} months · ${pp(c.p24)}`)}${row('Airdrop, p50', (y) => usd(y.ev_if[1]))}${row('Net APR if token', (y) => `<b class="${sign(y.apr_if[1])}">${pc(y.apr_if[1])}</b>`)}
  ${sec(`B · No token · ${pp(1 - c.p24)}`)}${row('Net: no drop, costs', (y) => `<b class="${sign(y.net_none)}">${usd(y.net_none)}</b>`)}
  ${sec('Blended expectation')}${row('Expected drop, p50', (y) => usd(y.ev[1]))}${row('Net, p50', (y) => `<b class="${sign(y.net[1])}">${usd(y.net[1])}</b>`)}${row('Risk-adj APR, p50', (y) => `<b class="${sign(y.apr[1])}">${pc(y.apr[1])}</b>`, 'hi')}
  ${row('p25 … p75', (y) => `<small>${pc(y.apr[0], 0)} … ${pc(y.apr[2], 0)}</small>`)}${row('Break-even deposit', (y) => (y.breakeven === null ? '—' : usd0(y.breakeven)))}${row('Verdict', (y) => pill(y.verdict) + (y.whale ? '<br><small class="warn">&gt;1% of TVL</small>' : ''))}</table>
  <h3>Sensitivity <small>blended net APR by deposit</small></h3>${sens(r.f)}
  <p class="mini">Drop p50 = ${KM.dropQ()[1]}% of supply (median of 12 launches) × ${r.f.share} route share × value × ${(100 * c.ss).toFixed(1)}% season share ÷ a ${usd(t.pool)} farming pool (TVL to $5M, then ^${M.pool_gamma}). Main risk: ${esc(r.route.risk)}.</p>
  </div><div>
  <h3>Farm plan on ${esc(r.f.chain)} <small>${r.steps.length} steps, cost and time each</small></h3>
  <ol class="plan">${r.steps.map((s) => `<li><p>${esc(s.action)}</p><span><i>Cost</i>${esc(s.cost)}</span> <span><i>Time</i>${esc(s.time)}</span></li>`).join('')}</ol>
  </div></div>`;
  d.classList.add('open'); d.setAttribute('aria-hidden', 'false'); $('#scrim').hidden = false;
  $('#close').onclick = closeDrawer;
}
function closeDrawer() { S.open = null; $('#drawer').classList.remove('open'); $('#drawer').setAttribute('aria-hidden', 'true'); $('#scrim').hidden = true; }

/** Label baselines pushed `gap` apart inside [top, bottom], so no two labels touch. */
function spread(ys, gap, top, bottom) {
  const o = ys.map((y, i) => ({ y: clamp(y, top, bottom), i })).sort((a, b) => a.y - b.y);
  for (let k = 1; k < o.length; k++) o[k].y = Math.max(o[k].y, o[k - 1].y + gap);
  const over = o.length ? o[o.length - 1].y - bottom : 0;
  if (over > 0) o.forEach((p) => (p.y -= over));
  return o.reduce((a, p) => ((a[p.i] = p.y), a), []);
}
/** Net APR p25/p50/p75 and if-token p50 by deposit ($100 to $100k, log x), FARM bar, break-even. */
function sens(f) {
  const W = 440, H = 182, L = 40, B = 22, TOP = 24, R0 = 88, n = 48, xs = [...Array(n + 1).keys()].map((i) => 100 * 1000 ** (i / n));
  const pts = xs.map((d) => { const t = KM.farmTier(f, d); return [t.apr[0], t.apr[1], t.apr[2], t.apr_if[1]]; }), t = KM.farmTier(f, S.tier);
  const lo = Math.max(-30, Math.min(...pts.map((p) => p[0]), -2)), hi = Math.max(M.farm_apr * 3, Math.max(...pts.map((p) => p[3])) * 1.15 + 4);
  const X = (d) => L + (Math.log(d / 100) / Math.log(1000)) * (W - L - R0), Y = (v) => TOP + ((hi - clamp(v, lo, hi)) / (hi - lo)) * (H - B - TOP);
  const col = ['#8a97ab', '#38bdf8', '#8a97ab', '#c4b5fd', '#22c55e'], nm = ['p25', 'p50', 'p75', 'if token', 'FARM bar'];
  const ty = spread([0, 1, 2, 3, 4].map((q) => Y(q < 4 ? pts[n][q] : M.farm_apr)), 15, TOP, H - B), ticks = [];
  for (const v of [Math.floor(hi / 10) * 10, M.farm_apr, 0, Math.ceil(lo)]) if (v >= lo && v < hi && ticks.every((w) => Math.abs(Y(w) - Y(v)) >= 12)) ticks.push(v);
  const line = (q) => `<polyline fill="none" stroke="${col[q]}" stroke-width="${q === 1 ? 2.2 : 1.2}"${q === 1 ? '' : ` stroke-dasharray="${q === 3 ? '1 3' : '3 3'}"`} points="${xs.map((d, i) => X(d).toFixed(1) + ',' + Y(pts[i][q]).toFixed(1)).join(' ')}"/>`;
  const be = t.breakeven ? X(clamp(t.breakeven, 100, 1e5)) : 0;
  return `<svg class="chart sens" viewBox="0 0 ${W} ${H}" role="img" aria-label="Net APR sensitivity to deposit size">
  ${ticks.map((v) => `<line x1="${L}" x2="${W - R0 + 4}" y1="${Y(v)}" y2="${Y(v)}" class="${v === 0 ? 'zero' : v === M.farm_apr ? 'bar' : 'gl'}"/><text x="${L - 5}" y="${Y(v) + 3}" text-anchor="end">${v}%</text>`).join('')}
  ${M.tiers.map((d) => `<line x1="${X(d)}" x2="${X(d)}" y1="${TOP}" y2="${H - B}" class="${d === S.tier ? 'cur' : 'gl'}"/><text x="${X(d)}" y="${H - 7}" text-anchor="middle">${tl(d)}</text>`).join('')}
  ${[3, 0, 2, 1].map(line).join('')}${ty.map((y, q) => `<text x="${W - R0 + 8}" y="${y + 3}" style="fill:${col[q]}">${nm[q]} ${q < 4 ? pc(pts[n][q], 0) : M.farm_apr + '%'}</text>`).join('')}
  ${be ? `<line x1="${be}" x2="${be}" y1="${TOP - 6}" y2="${H - B}" class="be"/><text x="${be > W / 2 ? be - 4 : be + 4}" y="13" text-anchor="${be > W / 2 ? 'end' : 'start'}" class="be">break-even ${usd0(t.breakeven)}</text>` : ''}</svg>`;
}

// ---- methodology
/** A scatter on one shared x/y range, with grid and overlay. */
function scatter(points, o) {
  const { W, H, a, z, f, xl, yl } = o, L = 60, B = 30, X = (v) => L + ((f(v) - a) / (z - a)) * (W - L - 18), Y = (v) => 8 + ((z - f(v)) / (z - a)) * (H - B - 8);
  const grid = o.ticks.map((v, i) => `<line x1="${X(v)}" x2="${X(v)}" y1="8" y2="${H - B}" class="gl"/>${i || !o.skip0 ? `<text x="${X(v)}" y="${H - B + 13}" text-anchor="middle">${o.lab(v)}</text>` : ''}<line x1="${L}" x2="${W - 10}" y1="${Y(v)}" y2="${Y(v)}" class="gl"/><text x="${L - 5}" y="${Y(v) + 3}" text-anchor="end">${o.lab(v)}</text>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yl)} against ${esc(xl)}">${grid}${o.extra(X, Y)}
  ${points.map((p) => `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${p.r || 3.2}" class="${p.c}"/>`).join('')}
  <text x="${(W + L) / 2}" y="${H - 3}" text-anchor="middle" class="ax">${xl}</text><text x="11" y="${(H - B) / 2}" transform="rotate(-90 11 ${(H - B) / 2})" text-anchor="middle" class="ax">${yl}</text></svg>`;
}
function method() {
  const fn = R.funnel, b = (j) => F.beta[j] / F.sd[j], W = F.wf.pooled, OW = O.wf.pooled, diag = (X, Y, lo, hi) => `<line x1="${X(lo)}" y1="${Y(lo)}" x2="${X(hi)}" y2="${Y(hi)}" class="diag"/>`;
  const sc = scatter(F.points.map(([nm, , m, p]) => ({ x: p, y: m, c: Math.abs(Math.log(m / p)) <= Math.LN2 ? 'in' : 'out' })),
    { W: 440, H: 204, a: 6.6, z: 10.2, f: Math.log10, ticks: [1e7, 1e8, 1e9, 1e10], lab: (v) => usd(v, 0), xl: 'blind LOO predicted value (log)', yl: 'actual mcap (log)',
      extra: (X, Y) => `<polygon points="${X(2e6)},${Y(4e6)} ${X(2e10)},${Y(4e10)} ${X(2e10)},${Y(1e10)} ${X(2e6)},${Y(1e6)}" class="band2"/>${diag(X, Y, 2e6, 2e10)}` });
  const cal = scatter(O.calib.map((c) => ({ x: c.pred, y: c.obs, c: 'cal', r: 3 + c.n / 40 })),
    { W: 440, H: 176, a: 0, z: 1, f: (v) => v, ticks: [0, 0.25, 0.5, 0.75, 1], lab: pp, skip0: 1, xl: 'held-out predicted token rate, by quintile', yl: 'observed',
      extra: (X, Y) => `${diag(X, Y, 0, 1)}<polyline fill="none" class="cl" points="${O.calib.map((c) => X(c.pred).toFixed(1) + ',' + Y(c.obs).toFixed(1)).join(' ')}"/>` });
  const parts = [['W', fn.watchlist], ['E', fn.emerging], ['C', fn.comps], ['K', fn.token_other], ['A', fn.aside_above], ['X', fn.screened_below]];
  const fold = (f, a, c) => `<tr><td>${f.from} → ${f.to}</td>${td(f.train + '/' + f.test)}${td(a)}${td(c)}</tr>`, pool = (n, a, c) => `<tr class="tot"><td>Pooled out-of-time</td>${td(n)}${td(a)}${td(c)}</tr>`;
  const dv = (v, base, lo, c = 'up', d = 'dn') => td(f3(v), 'n ' + ((lo ? v < base : v > base) ? c : d)), L0 = F.loo, D = F.dur, V = F.ledger[2];
  return `<div class="mgrid">
  <section class="panel"><h3>Valuation model <small>${F.n} traded comps · λ ${F.lam} · bg ${F.bg}, both by blind LOO</small></h3>
    <pre class="eq">log V = ${(F.ybar + F.bg * F.gbar).toFixed(3)} + ${f3(b(0))}·(log TVL − ${F.mu[0].toFixed(2)})
      − ${f3(Math.abs(b(1)))}·(pass-through − ${F.mu[1].toFixed(2)})
      + ${F.bg}·(log(1+g) − ${F.gbar.toFixed(3)})
      + ${f3(b(0))}·log(${D.ref.toFixed(2)} / σ(time with no token))</pre>
  <h3 class="sub">Term ledger, each held-out twice <small>KM.valueLedger()</small></h3>
  ${tbl(['Design', '>b', '>LOO R²', '>LOO |e|', '>LOO ρ', '>WF ρ'], [`<tr class="tot"><td>shipped: TVL + family + 7d + age</td>${td(F.bg)}${dv(L0.r2, V.r2, 0, 'win', '')}${dv(L0.l1, V.l1, 1, 'win', '')}${dv(L0.rho, V.rho, 0, 'win', '')}${dv(F.wf.pooled.rho, V.wf, 0, 'win', '')}</tr>`,
      ...F.ledger.map((t) => `<tr><td>${esc(t.name)}</td>${td(t.slope ?? t.b)}${dv(t.r2, L0.r2)}${dv(t.l1, L0.l1, 1)}${dv(t.rho, L0.rho)}${dv(t.wf, F.wf.pooled.rho)}</tr>`)], 'mt led')}
  <p class="mini">g = 7d change − the market week's ${pc(F.gm)}, capped ±${M.g_cap} points. Green: shipped beats v8 core; amber: a design beats shipped on that test. Dropping TVL or the family loses on every test. 7-day growth is chosen at slope ${F.bg} by blind LOO mean |log error| (${f3(F.ledger[2].l1)} → ${f3(L0.l1)}); re-picked on older cohorts only, it costs the walk-forward a little (ρ ${f3(F.ledger[2].wf)} → ${f3(F.wf.pooled.rho)}). Fitted raw it turns negative only through four comps that lost 22–37% of TVL that week (without them, +1.8). Age is not fitted on comps: their clock is time tracked with a token already trading, and fitted there it gives a fresh-listing premium (slope ${F.ledger[4].slope}). Time with no token enters through TVL durability instead (right).</p></section>
  <section class="panel"><h3>Blind LOO: predicted vs actual value <small>${F.n} refits · green within 2×</small></h3>${sc}
  <div class="stats">${box('LOO R²', f3(F.loo.r2))}${box('Median err', '×' + Math.exp(F.loo.mae).toFixed(2), 'blind, per comp')}${box('LOO rho', f3(F.loo.rho))}${box('WF rho', f3(W.rho), 'R² ' + f3(W.r2))}</div>
  <h3 class="sub">Held-out P(token) calibration <small>${O.n} protocols · LOO by quintile</small></h3>${cal}
  <div class="stats">${box('LOO Brier', f3(O.loo.brier), 'base rate ' + f3(O.loo.base_brier))}${box('Log-loss', f3(O.loo.logloss), 'LOO')}${box('ROC-AUC', f3(O.loo.auc), 'LOO')}${box('WF AUC', f3(OW.auc), 'out-of-time')}</div>
  <p class="mini">Launch curve F: logistic, λ ${O.lam}, on ${O.terms.map((t, j) => `${t} ${O.beta[j] >= 0 ? '+' : '−'}${Math.abs(O.beta[j] / O.sd[j]).toFixed(2)}`).join(' · ')}; P(by t) = (F(a+t) − F(a)) ÷ (1 − F(a)). Forward search, both held-out log-losses must drop (LOO / WF AUC): ${O.designs.map((x) => `${esc(x.name)} ${x.loo.auc.toFixed(3)}/${x.wf.auc.toFixed(3)}`).join(' → ')}.</p></section>
  <section class="panel"><h3>Walk-forward by listing date <small>train older, predict newer</small></h3>
  ${tbl(['Value · test cohort', '>n', '>R²', '>rho'], [...F.wf.folds.map((f) => fold(f, f3(f.m.r2), f3(f.m.rho))), pool(W.n, f3(W.r2), f3(W.rho))])}
  ${tbl(['Odds · test cohort', '>n', '>AUC', '>Brier skill'], [...O.wf.folds.map((f) => fold(f, f3(f.m.auc), pc(100 * f.m.bss, 0))), pool(OW.n, f3(OW.auc), pc(100 * OW.bss, 0))], 'mt')}
  <h3 class="sub">TVL durability by no-token age <small>σ of 7d moves · ${D.n} protocols</small></h3>
  ${tbl(['Age band', '>n', '>σ %/wk', '>even · odd', '>value ×'], D.bands.map((x) => `<tr><td>${x.k < 0 ? 'undated' : x.from + (M.age_bands[x.k + 1] ? '–' + M.age_bands[x.k + 1] : '+') + ' days'}</td>${td(x.n)}${td(x.s.toFixed(2))}${td(x.h.map((v) => v.toFixed(1)).join(' · '), 'n dim')}${td(xm((D.ref / x.s) ** F.elasticity))}</tr>`))}
  <h3 class="sub">${parts.reduce((a, p) => a + p[1], 0)} / ${fn.total} accounting <small>${I.acc === fn.total && I.ok ? 'each protocol once ✓' : '✗'}</small></h3>
  <div class="acc">${parts.map(([k, v]) => `<div><i class="dot ${k}"></i><b>${v}</b><small>${DISP[k]}</small></div>`).join('')}</div></section></div>`;
}

// ---- render and events
function render() {
  header();
  $('#main').innerHTML = { board, method }[S.tab]();
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
  const id = e.target.id;
  if (id === 'q') { S[id] = e.target.value; render(); const q = $('#' + id); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
});
document.addEventListener('change', (e) => { if (['seg', 'cat', 'chain'].includes(e.target.id)) { S[e.target.id] = e.target.value; render(); } });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawer();
  if (e.key === 'Enter' && e.target.dataset && e.target.dataset.slug) openDrawer(e.target.dataset.slug);
});
render();
setTimeout(() => { L = rerun(); header(); }, 30);
