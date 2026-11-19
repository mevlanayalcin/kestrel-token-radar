// Kestrel Token Radar - the page. It reads window.RADAR (data.js, written beside dashboard/ by
// main.ts) and renders five views: the board (the top FARM picks, then every pre-token protocol
// ranked by implied FDV with inline band and net-EV bars), the radar scatter (TVL against implied
// FDV, drawn over the 87 traded comps and the fitted line), the tokenized comps, the set-aside
// protocols with their reasons, and the methodology suite. No network, no framework. The detail
// view recomputes each row's implied FDV, its value bridge and its farm EV from the shipped
// coefficients and constants, and prints the board's value beside its own.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var M = D.model, G = D.gas_usd, F = D.fit, K = D.kpis;
  var app = document.getElementById('board');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');
  var state = { view: 'board', q: '', seg: 'all', ver: 'all', cat: 'all', sort: 'rank', dir: 1, sel: null };
  var COL = { FARM: '#047857', THIN: '#B45309', SKIP: '#B91C1C' };

  // ------------------------------------------------------------ format

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function rd(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(dp === undefined ? 1 : dp) + '%';
  }
  function ax(e) { return '$' + (e >= 9 ? Math.pow(10, e - 9) + 'B' : Math.pow(10, e - 6) + 'M'); }
  function x2(n) { return n.toFixed(2) + 'x'; }
  function age(d) { return d === null ? 'age n/a' : (d / 365).toFixed(1) + 'y'; }
  function growth(v) {
    if (v === null) return '<span class="g0">n/a</span>';
    return '<span class="' + (v > 0.05 ? 'gu' : v < -0.05 ? 'gd' : 'g0') + '">' + pct(v) + '</span>';
  }
  function pill(v, cls) { return '<span class="pill ' + v + (cls ? ' ' + cls : '') + '">' + v + '</span>'; }
  function seg(r) { return r.segment === 'watchlist' ? '<span class="seg w" title="on the house watchlist (TVL at or above the floor)">FLR</span>' : '<span class="seg e" title="emerging: below the floor, product screens passed">EMG</span>'; }
  function money(n) { return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }
  function vc(v) { return 'v-' + v.toLowerCase(); }
  function byEv(a, b) { return b.net_ev_pct_1000 - a.net_ev_pct_1000 || a.rank - b.rank; }

  // ------------------------------------------------------------ recompute (the page proves the board)

  // exp of the fitted log: the same coefficients, standardization and summation order as lib/model.ts.
  function impliedOf(x) {
    var s = F.ybar;
    for (var j = 0; j < x.length; j++) s += F.beta[j] * ((x[j] - F.mu[j]) / F.sd[j]);
    return Math.max(1, Math.round(Math.exp(s)));
  }
  // the same sum split by term: the multiplicative value bridge from a typical comp to this row.
  function bridgeOf(x) {
    var t = [0, 0, 0, 0, 0];
    for (var j = 0; j < x.length; j++) t[Math.min(j, 4)] += F.beta[j] * ((x[j] - F.mu[j]) / F.sd[j]);
    return t;
  }
  // the farm economics mirror: hold window, per-chain gas, bridge, carry, band, net, verdict.
  function evOf(r, capture) {
    var farmed = r.chains.slice().sort().slice(0, 2), gas = 0;
    for (var i = 0; i < farmed.length; i++) gas += G[farmed[i]] === undefined ? M.gas_default_usd : G[farmed[i]];
    gas = rd(M.tx_count * gas, 2);
    var hold = r.age_days === null ? M.hold_unknown_days : M.hold_default_days;
    if (r.age_days !== null) for (var h = 0; h < M.hold_by_age_days.length; h++) if (r.age_days < M.hold_by_age_days[h][0]) { hold = M.hold_by_age_days[h][1]; break; }
    var mult = r.implied_value_usd / r.tvl_usd;
    var gross = rd(100 * ((M.drop_band_lo + M.drop_band_hi) / 2) * mult * (capture || M.capture_factor), 2);
    var t = M.deposit_usd.map(function (d) {
      var op = rd(d * M.opportunity_cost_annum * (hold / 365), 2);
      var cost = rd(gas + M.bridge_usd + op, 2);
      var net = rd(d * gross / 100 - cost, 2);
      return { d: d, op: op, cost: cost, net: net, pct: rd((100 * net) / d, 2) };
    });
    var p = t[0].pct;
    return {
      gas: gas, hold: hold, gross: gross, t: t,
      verdict: p >= M.farm_net_pct ? 'FARM' : p >= M.thin_net_pct ? 'THIN' : 'SKIP',
      ok: p === r.net_ev_pct_1000 && t[1].pct === r.net_ev_pct_5000 && t[2].pct === r.net_ev_pct_25000 && gas === r.farm.gas_usd && hold === r.farm.hold_days
    };
  }

  // ------------------------------------------------------------ inline bars

  var LO = Math.log10(Math.min.apply(null, D.rows.map(function (r) { return r.implied_low_usd; })));
  var HI = Math.log10(Math.max.apply(null, D.rows.map(function (r) { return r.implied_high_usd; })));
  function at(v) { return Math.max(0, Math.min(100, ((Math.log10(v) - LO) / (HI - LO)) * 100)).toFixed(1); }
  // the Q25-Q75 dollar band on one log scale shared by every row, the mid as a tick.
  function rangeBar(r) {
    var a = at(r.implied_low_usd), b = at(r.implied_high_usd);
    return '<span class="rb" title="Q25-Q75 ' + usd(r.implied_low_usd) + ' - ' + usd(r.implied_high_usd) + ' on a log scale shared by all ' + K.board + ' rows"><i style="left:' + a + '%;width:' + (b - a).toFixed(1) + '%"></i><b style="left:' + at(r.implied_value_usd) + '%"></b></span>';
  }
  // net EV at $1k as a diverging bar, +-15% full scale.
  function evBar(v) {
    return '<span class="eb"><i class="' + (v >= 0 ? 'p' : 'n') + '" style="width:' + Math.min(50, (Math.abs(v) / 15) * 50).toFixed(1) + '%"></i></span>';
  }

  // ------------------------------------------------------------ filtering + sorting

  function visible() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      return (state.seg === 'all' || r.segment === state.seg) && (state.ver === 'all' || r.verdict === state.ver) &&
        (state.cat === 'all' || r.category === state.cat) && (!q || (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) >= 0);
    });
  }
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    implied: function (a, b) { return a.implied_value_usd - b.implied_value_usd; },
    mult: function (a, b) { return a.fitted_multiple - b.fitted_multiple; },
    tvl: function (a, b) { return a.tvl_usd - b.tvl_usd; },
    chg: function (a, b) { return (a.change_7d === null ? -999 : a.change_7d) - (b.change_7d === null ? -999 : b.change_7d); },
    ev: function (a, b) { return a.net_ev_pct_1000 - b.net_ev_pct_1000; },
    verdict: function (a, b) { var V = { FARM: 0, THIN: 1, SKIP: 2 }; return V[a.verdict] - V[b.verdict]; }
  };
  function sorted(rows) {
    var f = SORTS[state.sort];
    return rows.slice().sort(function (a, b) { return state.dir * f(a, b) || a.rank - b.rank; });
  }
  function count(f) { return D.rows.filter(f).length; }
  function opt(id, v, label) { return '<option value="' + esc(v) + '"' + (state[id] === v ? ' selected' : '') + '>' + esc(label) + '</option>'; }
  function cats() {
    var seen = {};
    D.rows.forEach(function (r) { seen[r.category] = (seen[r.category] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); }).slice(0, 24).map(function (c) { return [c, seen[c]]; });
  }
  function filterBar(n) {
    return '<div class="bar"><label for="q">Find</label><input id="q" type="search" placeholder="name, slug, category" value="' + esc(state.q) + '">' +
      '<label for="seg">Segment</label><select id="seg">' + opt('seg', 'all', 'all (' + K.board + ')') + opt('seg', 'watchlist', 'watchlist (' + K.watchlist_ranked + ')') + opt('seg', 'emerging', 'emerging (' + K.emerging + ')') + '</select>' +
      '<label for="ver">Verdict</label><select id="ver">' + opt('ver', 'all', 'all') + ['FARM', 'THIN', 'SKIP'].map(function (v) { return opt('ver', v, v + ' (' + K[v.toLowerCase()] + ')'); }).join('') + '</select>' +
      '<label for="cat">Category</label><select id="cat">' + opt('cat', 'all', 'all') + cats().map(function (c) { return opt('cat', c[0], c[0] + ' (' + c[1] + ')'); }).join('') + '</select>' +
      '<button class="reset">Reset</button><span class="shown"><b>' + n + '</b> of ' + K.board + ' shown</span></div>';
  }

  // ------------------------------------------------------------ board

  function card(r) {
    return '<button class="card" data-r="' + r.rank + '"><span class="ct"><span class="crk">#' + r.rank + '</span>' + seg(r) + pill(r.verdict, 'sm') + '</span>' +
      '<span class="cn">' + esc(r.name) + '</span><span class="cs">' + esc(r.category) + ' · ' + esc(r.chains[0] || 'n/a') + ' · ' + age(r.age_days) + '</span>' +
      '<span class="cev">' + pct(r.net_ev_pct_1000, 2) + '<small>net at $1k</small></span>' +
      '<span class="cm">$5k <b>' + pct(r.net_ev_pct_5000, 2) + '</b> · $25k <b>' + pct(r.net_ev_pct_25000, 2) + '</b></span>' +
      '<span class="cf">FDV <b>' + usd(r.implied_value_usd) + '</b> <small>' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '</small></span>' + rangeBar(r) +
      '<span class="cx">TVL ' + usd(r.tvl_usd) + ' · 7d ' + growth(r.change_7d) + ' · ' + x2(r.fitted_multiple) + ' TVL</span></button>';
  }
  function stack(f, w) {
    var n = ['FARM', 'THIN', 'SKIP'].map(function (v) { return count(function (r) { return f(r) && r.verdict === v; }); });
    var t = n[0] + n[1] + n[2];
    return '<span class="stk" style="width:' + w + '%">' + n.map(function (x, i) { return x ? '<i class="' + ['FARM', 'THIN', 'SKIP'][i] + '" style="width:' + (100 * x / t).toFixed(1) + '%">' + x + '</i>' : ''; }).join('') + '</span>';
  }
  function picks() {
    var top = D.rows.filter(function (r) { return r.verdict === 'FARM'; }).sort(byEv).slice(0, 5);
    return '<section class="picks" aria-label="Top farm opportunities"><div class="ph"><h2>Top farm opportunities</h2><span>best net expected return on a $1,000 deposit after gas, bridge and lock-up carry · ' + K.farm + ' FARM of ' + K.board + ' ranked · click a card for its plan</span></div>' +
      '<div class="pk">' + top.map(card).join('') +
      '<div class="mix"><div class="mk">Verdict mix · ' + K.board + ' ranked</div>' + stack(function () { return true; }, 100) +
      '<div class="ml"><span>Watchlist ' + K.watchlist_ranked + '</span><span class="tr">' + stack(function (r) { return r.segment === 'watchlist'; }, 100 * K.watchlist_ranked / K.emerging) + '</span></div>' +
      '<div class="ml"><span>Emerging ' + K.emerging + '</span><span class="tr">' + stack(function (r) { return r.segment === 'emerging'; }, 100) + '</span></div>' +
      '<p>Big-TVL floor names dilute a $1k wallet to cents; the FARM edge sits below the $' + D.floor_usd / 1e6 + 'M floor.</p></div></div></section>';
  }
  function th(key, label, num) {
    var car = state.sort === key ? '<span class="car">' + (state.dir > 0 ? '▲' : '▼') + '</span> ' : '';
    return '<th' + (num ? ' class="num"' : '') + '><button data-s="' + key + '">' + car + label + '</button></th>';
  }
  function anchors(r, n) {
    return r.anchor_comps.slice(0, n).map(function (a) { return '<b>' + esc(a.name) + '</b> <span class="m">' + x2(a.multiple) + '</span>'; }).join(' · ');
  }
  function viewBoard() {
    var rows = sorted(visible());
    var h = picks() + filterBar(rows.length) + '<div class="tblwrap"><table id="bm"><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + th('implied', 'Implied FDV · Q25–Q75 band', 1) + th('mult', 'FDV/TVL', 1) +
      '<th>Traded anchors (FDV/TVL)</th>' + th('tvl', 'TVL', 1) + th('chg', '7d', 1) + th('ev', 'Net EV $1k', 1) + th('verdict', 'Verdict') + '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      h += '<tr data-rank="' + r.rank + '" tabindex="0"><td class="rk">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span>' + seg(r) + '<br><span class="sub">' + esc(r.category) + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + ' · ' + age(r.age_days) + '</span></td>' +
        '<td class="num fv"><b>' + usd(r.implied_value_usd) + '</b> <span class="sub">' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '</span><br>' + rangeBar(r) + '</td>' +
        '<td class="num">' + x2(r.fitted_multiple) + '</td><td class="anc">' + anchors(r, 2) + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + growth(r.change_7d) + '</td>' +
        '<td class="num"><b class="' + vc(r.verdict) + '">' + pct(r.net_ev_pct_1000, 2) + '</b><br>' + evBar(r.net_ev_pct_1000) + '</td>' +
        '<td>' + pill(r.verdict) + '</td></tr>';
    }
    return h + '</tbody></table></div><div class="foot"><span>Rank = the model’s implied FDV, rank 1 the most valuable; sort or filter freely, the rank stays the claim. Sum of implied FDVs <b>' + usd(K.total_implied_usd) + '</b> · median FDV/TVL <b>' + x2(K.med_fitted_multiple) + '</b></span><span>Click any row for its value bridge, farm economics and six-step plan.</span></div>';
  }

  // ------------------------------------------------------------ radar scatter

  // greedy label placement: try rings of offsets, keep the first box that hits no other label.
  function labels(items, box, W, H) {
    var s = '', R = [10, 26, 44, 64, 88, 114], A = [-35, -10, -60, 15, 40, -90, -125, -150, 165, 140, 90, 180];
    items.forEach(function (p) {
      var w = p.t.length * 6.3 + 6, hh = 14;
      for (var i = 0; i < R.length; i++) for (var k = 0; k < A.length; k++) {
        var dx = R[i] * Math.cos(A[k] * Math.PI / 180), dy = R[i] * Math.sin(A[k] * Math.PI / 180);
        var bx = { x: dx >= 0 ? p.x + dx + 2 : p.x + dx - w - 2, y: p.y + dy - hh / 2, w: w, h: hh };
        if (bx.x < 58 || bx.x + bx.w > W - 8 || bx.y < 6 || bx.y + bx.h > H - 44) continue;
        if (box.some(function (o) { return bx.x < o.x + o.w && o.x < bx.x + bx.w && bx.y < o.y + o.h && o.y < bx.y + bx.h; })) continue;
        box.push(bx);
        if (R[i] > 10) s += '<line x1="' + p.x + '" y1="' + p.y + '" x2="' + (p.x + dx) + '" y2="' + (p.y + dy) + '" stroke="#475569" stroke-width="0.8"/>';
        s += '<text class="lb" x="' + (dx >= 0 ? bx.x + 3 : bx.x + bx.w - 3) + '" y="' + (bx.y + 10.5) + '" text-anchor="' + (dx >= 0 ? 'start' : 'end') + '" fill="' + p.c + '">' + esc(p.t) + '</text>';
        return;
      }
    });
    return s;
  }
  function scatterRadar(rows) {
    var W = 900, H = 650, l = 56, r = 14, t = 12, b = 44, x0 = 6.6, x1 = 10.6, y0 = 6.4, y1 = 9.6;
    function px(v) { return l + ((Math.log10(v) - x0) / (x1 - x0)) * (W - l - r); }
    function py(v) { return H - b - ((Math.log10(v) - y0) / (y1 - y0)) * (H - t - b); }
    var inSet = {};
    rows.forEach(function (x) { inSet[x.rank] = 1; });
    var s = '<svg class="plot" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Radar: TVL against implied FDV, both log scale. Hollow circles are the traded comps at their market cap; filled dots are the pre-token rows at the model’s implied FDV, coloured by farm verdict.">';
    for (var g = 7; g <= 10; g++) s += '<line x1="' + px(Math.pow(10, g)) + '" y1="' + t + '" x2="' + px(Math.pow(10, g)) + '" y2="' + (H - b) + '" class="gl"/><text x="' + px(Math.pow(10, g)) + '" y="' + (H - b + 15) + '" class="ax" text-anchor="middle">' + ax(g) + '</text>';
    for (var e = 7; e <= 9; e++) s += '<line x1="' + l + '" y1="' + py(Math.pow(10, e)) + '" x2="' + (W - r) + '" y2="' + py(Math.pow(10, e)) + '" class="gl"/><text x="' + (l - 7) + '" y="' + (py(Math.pow(10, e)) + 4) + '" class="ax" text-anchor="end">' + ax(e) + '</text>';
    // FDV = TVL diagonal, the fitted line at mean momentum/age/breadth/category, and the floor
    var d0 = Math.pow(10, 6.6), d1 = Math.pow(10, 9.6);
    s += '<line x1="' + px(d0) + '" y1="' + py(d0) + '" x2="' + px(d1) + '" y2="' + py(d1) + '" stroke="#94A3B8" stroke-dasharray="2 4"/><text x="' + (px(d1) - 4) + '" y="' + (py(d1) + 14) + '" class="ax" text-anchor="end">FDV = 1x TVL</text>';
    var b1 = F.beta[0] / F.sd[0];
    function fit(tv) { return Math.exp(F.ybar + b1 * (Math.log(tv) - F.mu[0])); }
    var ta = Math.pow(10, x0), tb = Math.pow(10, x1);
    s += '<line x1="' + px(ta) + '" y1="' + py(fit(ta)) + '" x2="' + px(tb) + '" y2="' + py(fit(tb)) + '" stroke="#1D4ED8" stroke-width="2"/><text x="' + (px(tb) - 4) + '" y="' + (py(fit(tb)) - 7) + '" class="ax" fill="#1D4ED8" text-anchor="end">fitted: FDV ∝ TVL^' + b1.toFixed(2) + '</text>';
    var fx = px(D.floor_usd);
    s += '<line x1="' + fx + '" y1="' + t + '" x2="' + fx + '" y2="' + (H - b) + '" stroke="#0F172A" stroke-dasharray="6 4" opacity=".6"/><text x="' + (fx + 5) + '" y="' + (t + 12) + '" class="ax" fill="#0F172A">$' + D.floor_usd / 1e6 + 'M floor →</text>';
    D.live.forEach(function (c) {
      s += '<circle cx="' + px(c.tvl_usd) + '" cy="' + py(Math.max(Math.pow(10, y0), Math.min(Math.pow(10, y1), c.mcap_usd))) + '" r="4" fill="none" stroke="#64748B" stroke-width="1.2"><title>' + esc(c.name) + ' (trades): TVL ' + usd(c.tvl_usd) + ', mcap ' + usd(c.mcap_usd) + '</title></circle>';
    });
    var box = [], items = [];
    D.rows.slice().reverse().forEach(function (x) {
      var on = inSet[x.rank], cx = px(x.tvl_usd), cy = py(x.implied_value_usd);
      s += '<circle data-i="' + x.rank + '" cx="' + cx + '" cy="' + cy + '" r="' + (on ? 5.5 : 4) + '" fill="' + COL[x.verdict] + '" fill-opacity="' + (on ? 0.9 : 0.14) + '"' + (x.segment === 'watchlist' && on ? ' stroke="#0F172A" stroke-width="1.5"' : '') + '><title>#' + x.rank + ' ' + esc(x.name) + ': TVL ' + usd(x.tvl_usd) + ', implied ' + usd(x.implied_value_usd) + ', ' + x.verdict + ' ' + pct(x.net_ev_pct_1000, 2) + '</title></circle>';
      if (on) box.push({ x: cx - 4, y: cy - 4, w: 8, h: 8 });
    });
    var top = rows.slice().sort(byEv).slice(0, 7).concat(rows.slice(0, 4));
    var seen = {};
    top.forEach(function (x) {
      if (seen[x.rank]) return;
      seen[x.rank] = 1;
      items.push({ x: px(x.tvl_usd), y: py(x.implied_value_usd), t: x.name + ' ' + (x.verdict === 'FARM' ? pct(x.net_ev_pct_1000, 1) : usd(x.implied_value_usd)), c: COL[x.verdict] });
    });
    s += labels(items, box, W, H);
    s += '<text x="' + (l + (W - l - r) / 2) + '" y="' + (H - 8) + '" class="ax" text-anchor="middle">TVL (log) → · ↑ implied FDV for pre-token rows, market cap for traded comps (log)</text>';
    return s + '</svg>';
  }
  function viewRadar() {
    var rows = visible(), list = rows.slice().sort(byEv).slice(0, 14);
    var tally = ['FARM', 'THIN', 'SKIP'].map(function (v) { return '<span><i class="sw" style="background:' + COL[v] + '"></i>' + v + ' ' + rows.filter(function (r) { return r.verdict === v; }).length + '</span>'; }).join('');
    var h = filterBar(rows.length) + '<div class="rgrid"><div class="panel"><h3>Valuation radar — ' + rows.length + ' pre-token rows against ' + D.live.length + ' traded comps<span class="q">click a dot for its plan</span></h3>' + scatterRadar(rows) +
      '<div class="legend">' + tally + '<span><i class="sw ring"></i>ring = watchlist</span><span><i class="sw hollow"></i>traded comp (market cap)</span><span><i class="ln"></i>fitted TVL elasticity</span><span class="dim">faded = outside the filter</span></div></div>';
    h += '<div class="panel"><h3>The filter, ranked by net EV<span class="q">' + rows.length + ' rows</span></h3><table class="mini click"><thead><tr><th>#</th><th>Protocol</th><th class="num">TVL</th><th class="num">FDV</th><th class="num">$1k</th><th></th></tr></thead><tbody>';
    list.forEach(function (r) {
      h += '<tr data-rank="' + r.rank + '" tabindex="0"><td class="rk">' + r.rank + '</td><td><b>' + esc(r.name) + '</b>' + seg(r) + '<br><span class="sub">' + esc(r.category) + ' · ' + growth(r.change_7d) + ' 7d</span></td><td class="num">' + usd(r.tvl_usd) + '</td><td class="num">' + usd(r.implied_value_usd) + '</td><td class="num"><b class="' + vc(r.verdict) + '">' + pct(r.net_ev_pct_1000, 1) + '</b></td><td>' + pill(r.verdict, 'sm') + '</td></tr>';
    });
    return h + '</tbody></table><p>Read it: the fitted line rises only ' + b1txt() + ' per decade of TVL, so a $5M protocol is priced near ' + x2(Math.exp(F.ybar + (F.beta[0] / F.sd[0]) * (Math.log(5e6) - F.mu[0])) / 5e6) + ' its TVL while a $1B one sits near ' + x2(Math.exp(F.ybar + (F.beta[0] / F.sd[0]) * (Math.log(1e9) - F.mu[0])) / 1e9) + '. That gap, not a hand-picked list, is why FARM clusters bottom-left.</p></div></div>';
  }
  function b1txt() { return '×' + Math.pow(10, F.beta[0] / F.sd[0]).toFixed(2); }

  // ------------------------------------------------------------ comps + set-aside

  function viewComps() {
    var h = '<div class="panel"><h3>Tokenized comps — the evidence, priced by the market<span class="q">' + D.live.length + ' protocols · never ranked</span></h3><p>These already trade, so their market cap is a fact: the regression is fitted on them and validated against them. A log residual near 0 means the model reads the market; a large one names where it disagrees.</p></div>';
    h += '<div class="tblwrap"><table class="plain"><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">FDV/TVL</th><th class="num">Model (full fit)</th><th class="num">ln resid</th><th class="num">7d</th></tr></thead><tbody>';
    D.live.forEach(function (c) {
      h += '<tr><td><span class="nm">' + esc(c.name) + '</span><br><span class="sub">' + esc(c.category) + ' · ' + esc(c.chains.slice(0, 2).join(', ')) + '</span></td><td class="num">' + usd(c.tvl_usd) + '</td><td class="num"><b>' + usd(c.mcap_usd) + '</b></td><td class="num">' + x2(c.multiple) + '</td><td class="num">' + usd(c.pred_usd) + '</td>' +
        '<td class="num"><span class="' + (Math.abs(c.resid) <= Math.LN2 ? 'gu' : 'gd') + '">' + (c.resid > 0 ? '+' : '') + c.resid + '</span></td><td class="num">' + growth(c.change_7d) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }
  function viewAside() {
    var h = '<div class="panel"><h3>Set aside — counted, reasoned, never ranked<span class="q">' + D.aside.length + ' protocols</span></h3><p>' + K.aside_above + ' pre-token protocols sit at or above the $' + D.floor_usd / 1e6 + 'M floor but off the house watchlist; ' + K.excluded_below + ' more sit below it and fall to the same product screens (bridges, exchanges, staking receipts, versioned pools). Each carries its exact reason, so the funnel adds up.</p></div>';
    h += '<div class="tblwrap"><table class="plain"><thead><tr><th>Protocol</th><th>Floor</th><th class="num">TVL</th><th class="num">7d</th><th>Why it is not on the board</th></tr></thead><tbody>';
    D.aside.forEach(function (a) {
      h += '<tr><td><span class="nm">' + esc(a.name) + '</span><br><span class="sub">' + esc(a.category) + '</span></td><td class="sub">' + (a.above_floor ? 'above' : 'below') + '</td><td class="num">' + usd(a.tvl_usd) + '</td><td class="num">' + growth(a.change_7d) + '</td><td class="sub">' + esc(a.reason) + '</td></tr>';
    });
    return h + '</tbody></table></div>';
  }

  // ------------------------------------------------------------ methodology

  // LOO calibration: blind prediction against actual market cap, 45-degree line, shaded 2x band.
  function scatterLoo() {
    var W = 470, H = 420, l = 58, r = 10, t = 10, b = 38, v0 = 6.5, v1 = 9.6, L2 = Math.log10(2);
    function p(v, ax) { return ax ? l + ((v - v0) / (v1 - v0)) * (W - l - r) : H - b - ((v - v0) / (v1 - v0)) * (H - t - b); }
    var s = '<svg class="plot" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Leave-one-out calibration: each comp’s blind prediction against its actual market cap, log scale, with the 45-degree line and the within-2x band">';
    s += '<clipPath id="cl"><rect x="' + l + '" y="' + t + '" width="' + (W - l - r) + '" height="' + (H - t - b) + '"/></clipPath>';
    s += '<polygon clip-path="url(#cl)" fill="#DBEAFE" opacity=".7" points="' + [[v0, v0 + L2], [v1, v1 + L2], [v1, v1 - L2], [v0, v0 - L2]].map(function (q) { return p(q[0], 1) + ',' + p(q[1]); }).join(' ') + '"/>';
    for (var g = 7; g <= 9; g++) s += '<line x1="' + p(g, 1) + '" y1="' + t + '" x2="' + p(g, 1) + '" y2="' + (H - b) + '" class="gl"/><text x="' + p(g, 1) + '" y="' + (H - b + 14) + '" class="ax" text-anchor="middle">' + ax(g) + '</text><line x1="' + l + '" y1="' + p(g) + '" x2="' + (W - r) + '" y2="' + p(g) + '" class="gl"/><text x="' + (l - 5) + '" y="' + (p(g) + 4) + '" class="ax" text-anchor="end">' + ax(g) + '</text>';
    s += '<line clip-path="url(#cl)" x1="' + p(v0, 1) + '" y1="' + p(v0) + '" x2="' + p(v1, 1) + '" y2="' + p(v1) + '" stroke="#0F172A" stroke-dasharray="5 4"/>';
    F.loo_points.forEach(function (q) {
      var hit = Math.abs(q.resid) <= Math.LN2, yv = Math.max(v0, Math.min(v1, Math.log10(q.mcap_usd)));
      s += '<circle cx="' + p(Math.log10(q.pred_usd), 1) + '" cy="' + p(yv) + '" r="3.8" fill="' + (hit ? '#047857' : '#B91C1C') + '" fill-opacity=".7"><title>' + esc(q.name) + ': actual ' + usd(q.mcap_usd) + ', blind ' + usd(q.pred_usd) + ', ln err ' + q.resid + '</title></circle>';
    });
    s += '<text x="' + (l + 8) + '" y="' + (t + 14) + '" class="ax">green = within 2x (shaded) · red = beyond · dashed = perfect</text>';
    s += '<text x="' + (l + (W - l - r) / 2) + '" y="' + (H - 6) + '" class="ax" text-anchor="middle">blind LOO prediction →</text><text transform="rotate(-90 11 ' + H / 2 + ')" x="11" y="' + H / 2 + '" class="ax" text-anchor="middle">actual market cap →</text>';
    return s + '</svg>';
  }
  function residStrip() {
    var W = 900, H = 120, pts = F.loo_points.slice().sort(function (a, c) { return a.resid - c.resid; });
    var lo = pts[0].resid - 0.2, hi = pts[pts.length - 1].resid + 0.2, bw = (W - 20) / pts.length;
    function py(v) { return 8 + ((hi - v) / (hi - lo)) * (H - 30); }
    var s = '<svg class="plot" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="The 87 leave-one-out log residuals, sorted, with the Q25 and Q75 lines that set every row’s dollar band">';
    pts.forEach(function (q, i) {
      var y = py(Math.max(0, q.resid)), hgt = Math.abs(py(q.resid) - py(0));
      s += '<rect x="' + (10 + i * bw) + '" y="' + y + '" width="' + (bw - 1) + '" height="' + Math.max(0.8, hgt) + '" fill="' + (Math.abs(q.resid) <= Math.LN2 ? '#047857' : '#B91C1C') + '" opacity=".75"><title>' + esc(q.name) + ' ' + q.resid + '</title></rect>';
    });
    s += '<line x1="10" x2="' + (W - 10) + '" y1="' + py(0) + '" y2="' + py(0) + '" stroke="#0F172A"/>';
    [F.loo.resid_q25, F.loo.resid_q75].forEach(function (q) { s += '<line x1="10" x2="' + (W - 10) + '" y1="' + py(q) + '" y2="' + py(q) + '" stroke="#1D4ED8" stroke-dasharray="4 3"/>'; });
    return s + '<text x="' + W / 2 + '" y="' + (H - 6) + '" class="ax" text-anchor="middle">signed ln error, every comp sorted · blue dashed = Q25 / Q75 (' + F.loo.resid_q25 + ' / ' + F.loo.resid_q75 + '), the band each row ships</text></svg>';
  }
  function mrow(name, m, cls, note) {
    var w = Math.max(0, m.r2) / 0.2 * 100;
    return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><td>' + name + (note ? '<br><span class="sub">' + note + '</span>' : '') + '</td><td class="num ' + (m.r2 > 0 ? 'win' : 'lose') + '">' + m.r2 + '<span class="r2b"><i style="width:' + Math.min(100, w).toFixed(0) + '%"></i></span></td><td class="num">' + m.rho + '</td><td class="num">' + m.med_abs_log_err + '</td><td class="num">' + m.within_2x_pct + '%</td></tr>';
  }
  function funnelBar() {
    var parts = [[K.comps, 'traded comps (fit)', '#0F172A'], [K.tokenized_small_mcap, 'token, mcap < $5M', '#475569'], [K.tokenized_no_mcap, 'token, no mcap', '#94A3B8'],
      [K.watchlist_ranked, 'watchlist, ranked', '#1D4ED8'], [K.emerging, 'emerging, ranked', '#047857'], [K.aside_above, 'set aside ≥ floor', '#B45309'], [K.excluded_below, 'screened < floor', '#B91C1C']];
    var sum = parts.reduce(function (a, q) { return a + q[0]; }, 0);
    var h = '<div class="fbar">' + parts.map(function (q) { return '<i style="width:' + (100 * q[0] / sum).toFixed(2) + '%;background:' + q[2] + '" title="' + q[0] + ' ' + q[1] + '"><b>' + q[0] + '</b></i>'; }).join('') + '</div>';
    h += '<div class="fkey">' + parts.map(function (q) { return '<span><i class="sw" style="background:' + q[2] + '"></i><b>' + q[0] + '</b> ' + q[1] + '</span>'; }).join('') + '</div>';
    return h + '<div class="idn">' + parts.map(function (q) { return q[0]; }).join(' + ') + ' = ' + sum + (sum === K.total ? ' ✓ exactly the ' + K.total + ' protocols on the snapshot, each classified once · ' + K.pre_token + ' record no token → ' + K.board + ' ranked (' + K.watchlist_ranked + ' watchlist + ' + K.emerging + ' emerging)' : ' ✗ MISMATCH against ' + K.total) + '</div>';
  }
  function viewModel() {
    var lm = F.loo.metrics, pm = F.wf.pooled, nm = F.nested.metrics;
    var h = '<div class="mgrid"><div class="panel"><h3>The fitted equation<span class="q">ridge on ' + F.n_comps + ' traded comps</span></h3><div class="eq">' + esc(F.equation) + '</div>' +
      '<div class="stat4"><div><span class="k">TVL elasticity</span><b>' + F.elasticity_at_mean + '</b><span class="s">' + b1txt() + ' / 10x TVL</span></div><div><span class="k">In-sample R²</span><b>' + F.in_sample_r2 + '</b><span class="s">the fit itself</span></div>' +
      '<div><span class="k">LOO R²</span><b>' + lm.r2 + '</b><span class="s">ρ ' + lm.rho + '</span></div><div><span class="k">Nested LOO R²</span><b>' + nm.r2 + '</b><span class="s">ρ ' + nm.rho.toFixed(3) + '</span></div></div>' +
      '<table class="mini"><thead><tr><th>Term</th><th class="num">β (std)</th><th class="num">mean</th><th class="num">sd</th></tr></thead><tbody>';
    F.feature_names.forEach(function (n, i) { h += '<tr><td>' + esc(n) + '</td><td class="num"><b>' + F.beta[i] + '</b></td><td class="num">' + F.mu[i] + '</td><td class="num">' + F.sd[i] + '</td></tr>'; });
    h += '</tbody></table><p>Target ' + esc(F.target) + '. Penalties ' + F.lam.join(' / ') + ' (size / noise / category) from a ' + F.lam_grid.map(function (g) { return g.length; }).join('x') + ' grid by LOO R²; the nested pass re-picks them blind in every fold (' + F.nested.same_lam + ' of ' + F.n_comps + ' folds pick the same triple).</p></div>';
    h += '<div class="panel"><h3>Validation 1 — leave-one-out calibration<span class="q">' + lm.n + ' blind refits</span></h3>' + scatterLoo() +
      '<p><b>' + lm.within_2x_pct + '%</b> of comps land within 2x blind, median |ln err| <b>' + lm.med_abs_log_err + '</b>. The spread is the market’s: comps of one size trade from 0.003x to 400x TVL, so every row ships a band, never a point.</p></div>';
    h += '<div><div class="panel"><h3>Against the baselines<span class="q">identical LOO pass</span></h3><table class="mini"><thead><tr><th>Model</th><th class="num">R²</th><th class="num">ρ</th><th class="num">med err</th><th class="num">≤2x</th></tr></thead><tbody>' +
      mrow('kestrel-4 ridge, LOO', lm, 'hi') + mrow('kestrel-4, nested LOO', nm, '', 'penalties re-selected inside each fold');
    F.baselines.forEach(function (b) { h += mrow(esc(b.name), b.metrics); });
    h += '</tbody></table><p>The hand-set median multiples go <b>negative</b> on R²: they misprice levels by more than a flat constant. Blind and re-tuned, the ridge (nested R² ' + nm.r2 + ') ' + (nm.r2 > F.baselines[0].metrics.r2 ? 'edges' : 'does not beat') + ' TVL alone (' + F.baselines[0].metrics.r2 + '): on this snapshot the momentum, age and category terms add little blind skill, so every row ships a band and the verdict uses the mid.</p></div>';
    h += '<div class="panel"><h3>Validation 2 — temporal walk-forward<span class="q">older → newer</span></h3><table class="mini"><thead><tr><th>Test cohort (listed_at)</th><th class="num">train/test</th><th class="num">R²</th><th class="num">ρ</th><th class="num">≤2x</th></tr></thead><tbody>';
    F.wf.folds.forEach(function (f) { h += '<tr><td>' + f.from + ' → ' + f.to + '</td><td class="num">' + f.train_n + '/' + f.test_n + '</td><td class="num ' + (f.metrics.r2 > 0 ? 'win' : 'lose') + '">' + f.metrics.r2 + '</td><td class="num">' + f.metrics.rho + '</td><td class="num">' + f.metrics.within_2x_pct + '%</td></tr>'; });
    h += '<tr class="hi"><td>Pooled out-of-time</td><td class="num">—/' + pm.n + '</td><td class="num ' + (pm.r2 > 0 ? 'win' : 'lose') + '">' + pm.r2 + '</td><td class="num">' + pm.rho + '</td><td class="num">' + pm.within_2x_pct + '%</td></tr></tbody></table>' +
      '<p>Ranks survive the future (pooled ρ ' + pm.rho + '); levels re-rate through cycles. Hence bands, mid-band EV and no price targets.</p></div></div></div>';
    h += '<div class="panel"><h3>The whole snapshot, accounted for<span class="q">' + K.total + ' protocols → ' + K.board + ' ranked</span></h3>' + funnelBar() + '</div>';
    h += '<div class="grid2"><div class="panel"><h3>Residuals — where the band comes from</h3>' + residStrip() + '</div><div class="panel"><h3>Farm verdicts — the arithmetic on every row</h3>' +
      '<p>Allocation: a launch commonly hands <b>' + M.drop_band_lo * 100 + '–' + M.drop_band_hi * 100 + '% of FDV</b> to early users; over current TVL that pays the band × the fitted FDV/TVL × a <b>capture factor of ' + M.capture_factor + '</b> for activity-weighted drops (a stated assumption; the detail view shows the pure pro-rata case beside it).</p>' +
      '<p>Costs: ' + M.tx_count + ' transactions on the two named chains at the gas table, a $' + M.bridge_usd + ' bridge allowance, and ' + M.opportunity_cost_annum * 100 + '%/yr carry over a ' + M.hold_default_days + '–' + M.hold_by_age_days[0][1] + '-day hold. FARM nets ≥ ' + M.farm_net_pct + '% at $1,000, THIN ≥ ' + M.thin_net_pct + '%, SKIP below; $5,000 and $25,000 are shown as sensitivity tiers.</p></div></div>';
    return h;
  }

  // ------------------------------------------------------------ detail view

  function drawerHtml(r) {
    var ev = evOf(r), im = impliedOf(r.x), br = bridgeOf(r.x), pr = evOf(r, 1);
    var q10 = Math.round(r.implied_value_usd * Math.exp(F.loo.resid_q10)), q90 = Math.round(r.implied_value_usd * Math.exp(F.loo.resid_q90));
    var h = '<button class="x" aria-label="Close">close ✕</button><div class="dh"><h2>' + esc(r.name) + ' ' + seg(r) + '</h2><div class="dsub"><b>rank #' + r.rank + '</b> of ' + K.board + ' by implied FDV · ' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(r.chains.slice(0, 4).join(', ')) + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '') + ' · TVL ' + usd(r.tvl_usd) + ' · 7d ' + growth(r.change_7d) + ' · ' + age(r.age_days) + ' tracked, no token recorded</div></div>';
    h += '<div class="dk">' + pill(r.verdict, 'lg') + ev.t.map(function (x, i) { return '<span><span class="lab">Net EV at $' + x.d.toLocaleString('en-US') + '</span><span class="big ' + (i ? (x.pct >= 0 ? 'v-farm' : 'v-skip') : vc(r.verdict)) + '">' + pct(x.pct, 2) + '</span></span>'; }).join('') +
      '<span><span class="lab">Implied FDV (mid)</span><span class="big">' + usd(r.implied_value_usd) + '</span></span></div><div class="dg"><div>';
    h += '<div class="dsec"><h4>Valuation — what the model claims</h4><div class="vband"><span class="o" style="left:' + at(q10) + '%;width:' + (at(q90) - at(q10)).toFixed(1) + '%"></span>' + rangeBar(r).replace('class="rb"', 'class="rb big"') + '</div>' +
      '<div class="vl"><span>Q10 ' + usd(q10) + '</span><span>Q25–Q75 <b>' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</b></span><span>Q90 ' + usd(q90) + '</span></div>' +
      '<table class="ev"><tbody><tr><td>Typical traded comp, exp(ȳ)</td><td class="num">' + usd(Math.exp(F.ybar)) + '</td></tr>';
    [['TVL ' + usd(r.tvl_usd), br[0]], ['7-day momentum ' + pct(r.change_7d), br[1]], ['Time tracked with no token, ' + age(r.age_days), br[2]], ['Breadth, ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), br[3]], ['Category, ' + esc(r.category), br[4]]].forEach(function (b) {
      h += '<tr><td>× ' + b[0] + '</td><td class="num ' + (b[1] >= 0 ? 'win' : 'lose') + '">×' + Math.exp(b[1]).toFixed(3) + '</td></tr>';
    });
    h += '<tr class="tot"><td>= Implied FDV (' + x2(r.fitted_multiple) + ' TVL)</td><td class="num">' + usd(im) + '</td></tr></tbody></table></div>';
    h += '<div class="dsec"><h4>Named anchors — tokens that already trade</h4><table class="ev"><thead><tr><th>Comp</th><th class="num">TVL</th><th class="num">MCap</th><th class="num">FDV/TVL</th></tr></thead><tbody>';
    r.anchor_comps.forEach(function (a) { h += '<tr><td><b>' + esc(a.name) + '</b> <span class="sub">' + esc(a.category) + '</span></td><td class="num">' + usd(a.tvl_usd) + '</td><td class="num">' + usd(a.mcap_usd) + '</td><td class="num">' + x2(a.multiple) + '</td></tr>'; });
    h += '</tbody></table></div>';
    var f = r.farm, tr = function (label, k, neg) { return '<tr><td>' + label + '</td>' + ev.t.map(function (x) { var v = k(x); return '<td class="num' + (neg ? ' lose' : '') + '">' + (neg ? '-' : '') + money(v) + '</td>'; }).join('') + '</tr>'; };
    h += '<div class="dsec"><h4>Farm economics — ' + ev.hold + '-day hold, per deposit</h4><table class="ev"><thead><tr><th></th><th class="num">$1,000</th><th class="num">$5,000</th><th class="num">$25,000</th></tr></thead><tbody>' +
      tr('Gross mid: ' + ((M.drop_band_lo + M.drop_band_hi) * 50).toFixed(2) + '% drop × ' + x2(r.fitted_multiple) + ' × ' + M.capture_factor + ' capture = ' + ev.gross + '%', function (x) { return x.d * ev.gross / 100; }) +
      tr('Gas, ' + M.tx_count + ' tx on ' + esc(f.chains_farmed.join(' + ')), function () { return ev.gas; }, 1) + tr('Bridge allowance', function () { return M.bridge_usd; }, 1) +
      tr('Carry ' + M.opportunity_cost_annum * 100 + '%/yr × ' + ev.hold + 'd', function (x) { return x.op; }, 1) +
      '<tr class="tot"><td>Net expected return</td>' + ev.t.map(function (x) { return '<td class="num ' + (x.net >= 0 ? 'win' : 'lose') + '">' + (x.net >= 0 ? '+' : '') + money(x.net) + '<br><small>' + pct(x.pct, 2) + '</small></td>'; }).join('') + '</tr>' +
      '<tr><td class="sub">Pure pro-rata (capture 1x)</td>' + pr.t.map(function (x) { return '<td class="num sub">' + pct(x.pct, 2) + '</td>'; }).join('') + '</tr></tbody></table>';
    h += '<div class="recompute' + (im === r.implied_value_usd && ev.ok && ev.verdict === r.verdict ? '' : ' off') + '">page recompute: exp(' + F.ybar + ' + Σ β·z) = $' + im.toLocaleString('en-US') + ' · board $' + r.implied_value_usd.toLocaleString('en-US') + (im === r.implied_value_usd ? ' ✓' : ' ✗') +
      '\nfarm: ' + ev.t.map(function (x) { return pct(x.pct, 2) + ' @' + x.d / 1000 + 'k'; }).join(' / ') + ' → ' + ev.verdict + (ev.ok && ev.verdict === r.verdict ? ' ✓ matches board' : ' ✗ board ' + r.verdict) + '</div></div></div>';
    h += '<div><div class="dsec"><h4>The plan — six steps, each with cost and time</h4><ol class="plan">';
    r.steps.forEach(function (s, i) { h += '<li><span class="st">' + (i + 1) + '</span><span class="sa">' + esc(s.action) + '</span><span class="ct"><b>Cost</b> ' + esc(s.cost) + ' <b>Time</b> ' + esc(s.time) + '</span></li>'; });
    h += '</ol></div><div class="dsec"><h4>Risk, plainly</h4><p>Pre-token farming is venture-sized: a young ' + esc(r.category) + ' protocol can lose the deposit to a bug, a depeg or an admin key, and a points programme can change, dilute or never drop. Every dollar here is the model’s claim, never a promise; DefiLlama records no token for it, which is not proof it has none.</p></div></div></div>';
    return h;
  }
  function openDrawer(rank) {
    var r = D.rows.filter(function (x) { return x.rank === rank; })[0];
    if (!r) return;
    state.sel = rank;
    drawer.innerHTML = drawerHtml(r);
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    drawer.scrollTop = 0;
    mark();
  }
  function closeDrawer() {
    state.sel = null;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.hidden = true;
    mark();
  }
  function mark() {
    Array.prototype.forEach.call(app.querySelectorAll('tr[data-rank]'), function (tr) { tr.classList.toggle('sel', +tr.getAttribute('data-rank') === state.sel); });
  }

  // ------------------------------------------------------------ shell

  function kpis() {
    var best = D.rows.slice().sort(byEv)[0], lm = F.loo.metrics;
    function k(label, v, s, cls) { return '<div class="kpi' + (cls ? ' ' + cls : '') + '"><div class="k">' + label + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; }
    return '<section class="kpis" aria-label="Snapshot accounting">' +
      k('Protocols sealed', K.total, 'all classified · ' + K.board + ' ranked') +
      k('Watchlist covered', K.watchlist_ranked + '<small>/' + K.watchlist + '</small>', 'every house slug ranked') +
      k('Emerging finds', K.emerging, 'below the $' + D.floor_usd / 1e6 + 'M floor') +
      k('Verdicts', '<span class="v-farm">' + K.farm + '</span><small> · </small><span class="v-thin">' + K.thin + '</span><small> · </small><span class="v-skip">' + K.skip + '</span>', 'FARM · THIN · SKIP at $1,000', 'good') +
      k('Best net EV $1k', '<span class="v-farm">' + pct(best.net_ev_pct_1000, 2) + '</span>', esc(best.name) + ' · after all costs', 'good') +
      k('Comps fitted', K.comps, 'traded tokens, mcap ≥ $5M') +
      k('LOO R² · ρ', lm.r2 + '<small> · ' + lm.rho + '</small>', 'nested ' + F.nested.metrics.r2.toFixed(3) + ' · wf ρ ' + F.wf.pooled.rho.toFixed(3)) + '</section>';
  }
  function render() {
    var tabs = [['board', 'Board', K.board], ['radar', 'Radar', K.board], ['comps', 'Tokenized', D.live.length], ['aside', 'Set-aside', D.aside.length], ['model', 'Methodology', '']];
    var h = '<header class="mast"><div><h1><span class="kestrel">KESTREL</span> <span class="thinw">Token Launch Radar</span></h1><p class="tag">Which pre-token protocol to farm next: every protocol on the sealed DefiLlama snapshot, priced by a ridge regression on ' + K.comps + ' traded comps (TVL, 7d momentum, time with no token, breadth, category) and netted to a deposit-sized FARM / THIN / SKIP verdict.</p></div>' +
      '<div class="meta"><b>' + D.model_version + '</b> · snapshot ' + D.as_of + '<br>' + K.total + ' protocols → ' + K.pre_token + ' record no token → ' + K.board + ' ranked</div></header>';
    h += kpis() + '<nav class="tabs" role="tablist" aria-label="Views">' + tabs.map(function (t) {
      return '<button role="tab" data-v="' + t[0] + '" aria-selected="' + (state.view === t[0]) + '">' + t[1] + ' <span class="cnt">' + t[2] + '</span></button>';
    }).join('') + '</nav>';
    h += '<section class="view">' + { board: viewBoard, radar: viewRadar, comps: viewComps, aside: viewAside, model: viewModel }[state.view]() + '</section>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    mark();
  }

  // ------------------------------------------------------------ events (delegated)

  function near(e, sel) { return e.target.closest && e.target.closest(sel); }
  app.addEventListener('click', function (e) {
    var n;
    if ((n = near(e, '[data-v]'))) { state.view = n.getAttribute('data-v'); render(); return; }
    if ((n = near(e, '[data-s]'))) {
      var k = n.getAttribute('data-s');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = (k === 'rank' || k === 'name' || k === 'verdict') ? 1 : -1; }
      render(); return;
    }
    if (near(e, '.reset')) { state.q = ''; state.seg = 'all'; state.ver = 'all'; state.cat = 'all'; render(); return; }
    if ((n = near(e, '[data-rank],[data-r],circle[data-i]'))) openDrawer(+(n.getAttribute('data-rank') || n.getAttribute('data-r') || n.getAttribute('data-i')));
  });
  app.addEventListener('keydown', function (e) {
    var tr = near(e, 'tr[data-rank]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(+tr.getAttribute('data-rank')); }
  });
  app.addEventListener('input', function (e) {
    if (e.target.id !== 'q') return;
    var pos = e.target.selectionStart;
    state.q = e.target.value;
    render();
    var q = app.querySelector('#q');
    q.focus();
    try { q.setSelectionRange(pos, pos); } catch (_) { /* search inputs may refuse a range */ }
  });
  app.addEventListener('change', function (e) {
    if (['seg', 'ver', 'cat'].indexOf(e.target.id) < 0) return;
    state[e.target.id] = e.target.value;
    render();
  });
  scrim.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', function (e) { if (near(e, '.x')) closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  render();
})();
