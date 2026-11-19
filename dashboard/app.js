// Kestrel Token Radar — the page. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders five views: the ranked board with named traded-token anchors and deposit-sized net-EV
// verdicts, a radar scatter, the tokenized comps that price the model, the set-aside protocols with
// their exact reasons, and the methodology - the fitted equation, its leave-one-out and temporal
// walk-forward validations drawn to scale, the baselines it beats, and the 758-protocol accounting
// funnel. No network, no framework. The drawer recomputes each row's implied FDV and its farm EV
// from the shipped coefficients and constants and prints the board value beside its own, so the
// page proves it agrees with the code that built it.
(function () {
  'use strict';

  var D = window.RADAR;
  if (!D) return;
  var M = D.model, G = D.gas_usd, F = D.fit, K = D.kpis;
  var app = document.getElementById('board');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');

  var state = { view: 'board', q: '', seg: 'all', ver: 'all', cat: 'all', sort: 'rank', dir: 1, sel: null };

  // ------------------------------------------------------------ format

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function rd(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }
  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n, dp) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(dp === undefined ? 1 : dp) + '%';
  }
  function x2(n) { return (n === null || n === undefined || !isFinite(n)) ? '—' : n.toFixed(2) + 'x'; }
  function growth(v) {
    if (v === null || v === undefined) return '<span class="g-flat">n/a</span>';
    var c = v > 0.05 ? 'g-up' : v < -0.05 ? 'g-dn' : 'g-flat';
    return '<span class="' + c + '">' + pct(v) + '</span>';
  }
  function pill(v, sm) { return '<span class="pill ' + v + (sm ? ' sm' : '') + '">' + v + '</span>'; }
  function seg(r) { return '<span class="seg ' + (r.segment === 'watchlist' ? 'w' : 'e') + '">' + (r.segment === 'watchlist' ? 'FLR' : 'EMB') + '</span>'; }
  function money2(n) { return (n < 0 ? '-' : '') + '$' + Math.abs(n).toFixed(2); }

  // ------------------------------------------------------------ recompute (the page proves the board)

  // exp of the fitted log: the same coefficients, standardization and summation order as lib/model.ts.
  function impliedOf(x) {
    var s = F.ybar;
    for (var j = 0; j < x.length; j++) s += F.beta[j] * ((x[j] - F.mu[j]) / F.sd[j]);
    return Math.max(1, Math.round(Math.exp(s)));
  }
  // the farm economics mirror: hold window, per-chain gas, bridge, lock-up carry, band, net, verdict.
  function evOf(r) {
    var farmed = r.chains.slice().sort().slice(0, 2);
    var gas = 0;
    for (var i = 0; i < farmed.length; i++) gas += (G[farmed[i]] === undefined ? M.gas_default_usd : G[farmed[i]]);
    gas = rd(M.tx_count * gas, 2);
    var hold = r.age_days === null ? M.hold_unknown_days : M.hold_default_days;
    if (r.age_days !== null) for (var h = 0; h < M.hold_by_age_days.length; h++) if (r.age_days < M.hold_by_age_days[h][0]) { hold = M.hold_by_age_days[h][1]; break; }
    var mult = r.implied_value_usd / r.tvl_usd;
    var gm = (M.drop_band_lo + M.drop_band_hi) / 2;
    var gross = rd(100 * gm * mult * M.capture_factor, 2);
    function line(d) {
      var op = rd(d * M.opportunity_cost_annum * (hold / 365), 2);
      var cost = rd(gas + M.bridge_usd + op, 2);
      var net = rd(d * gross / 100 - cost, 2);
      return { op: op, cost: cost, net: net, pct: rd((100 * net) / d, 2) };
    }
    var a = line(M.deposit_usd[0]), b = line(M.deposit_usd[1]);
    return {
      gas: gas, hold: hold, gross: gross, a: a, b: b,
      verdict: a.pct >= M.farm_net_pct ? 'FARM' : a.pct >= M.thin_net_pct ? 'THIN' : 'SKIP',
      ok: a.pct === r.net_ev_pct_1000 && b.pct === r.net_ev_pct_5000 && a.cost === r.farm.cost1k_usd && gas === r.farm.gas_usd && hold === r.farm.hold_days
    };
  }

  // ------------------------------------------------------------ svg scatter

  // log-log calibration scatter: predicted vs actual, y=x guide, LOO points in $ billions.
  function scatterLoo() {
    var w = 640, h = 420, l = 58, r = 14, t = 12, b = 40;
    var xs = F.loo_points.map(function (p) { return Math.log10(p.mcap_usd); });
    var ys = F.loo_points.map(function (p) { return Math.log10(p.pred_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.min(x0, Math.floor(Math.min.apply(null, ys))), y1 = Math.max(x1, Math.ceil(Math.max.apply(null, ys)));
    function px(v) { return l + ((v - x0) / (x1 - x0)) * (w - l - r); }
    function py(v) { return h - b - ((v - y0) / (y1 - y0)) * (h - t - b); }
    var s = '<svg class="plot" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Leave-one-out calibration scatter: model prediction against actual market cap, both log scale, with the 45-degree line of a perfect fit">';
    for (var g = x0; g <= x1; g++) s += '<line x1="' + px(g) + '" y1="' + t + '" x2="' + px(g) + '" y2="' + (h - b) + '" stroke="#E2E8F0"/>' + '<text x="' + px(g) + '" y="' + (h - b + 14) + '" font-size="10" fill="#475569" text-anchor="middle">' + g + '</text>';
    for (var e = y0; e <= y1; e++) s += '<line x1="' + l + '" y1="' + py(e) + '" x2="' + (w - r) + '" y2="' + py(e) + '" stroke="#E2E8F0"/>' + '<text x="' + (l - 6) + '" y="' + (py(e) + 3) + '" font-size="10" fill="#475569" text-anchor="end">' + e + '</text>';
    s += '<line x1="' + px(x0) + '" y1="' + py(x0) + '" x2="' + px(x1) + '" y2="' + py(x1) + '" stroke="#0F172A" stroke-dasharray="5 4"/>';
    var LN2 = 0.301; // a decade-free 2x band in log10 is +-log10(2) = 0.301
    s += '<line x1="' + px(x0) + '" y1="' + py(x0 + LN2) + '" x2="' + px(x1) + '" y2="' + py(x1 + LN2) + '" stroke="#CBD5E1"/>';
    s += '<line x1="' + px(x0) + '" y1="' + py(x0 - LN2) + '" x2="' + px(x1) + '" y2="' + py(x1 - LN2) + '" stroke="#CBD5E1"/>';
    for (var i = 0; i < F.loo_points.length; i++) {
      var p = F.loo_points[i];
      var hit = Math.abs(Math.log10(p.mcap_usd) - Math.log10(p.pred_usd)) <= LN2;
      s += '<circle cx="' + px(Math.log10(p.pred_usd)) + '" cy="' + py(Math.log10(p.mcap_usd)) + '" r="3.6" fill="' + (hit ? '#047857' : '#B91C1C') + '" fill-opacity="0.62"><title>' + esc(p.name) + ' — actual ' + usd(p.mcap_usd) + ', LOO ' + usd(p.pred_usd) + ', log err ' + p.resid + '</title></circle>';
    }
    s += '<text x="' + (l + (w - l - r) / 2) + '" y="' + (h - 6) + '" font-size="10.5" fill="#475569" text-anchor="middle">log10 model prediction, $ — dashed = perfect fit, faint lines = within 2x</text>';
    s += '<text transform="rotate(-90 14 ' + (h / 2) + ')" x="14" y="' + (h / 2) + '" font-size="10.5" fill="#475569" text-anchor="middle">log10 actual market cap, $</text>';
    return s + '</svg>';
  }

  // signed LOO residuals, sorted, with the quantiles that draw every row's band.
  function residStrip() {
    var w = 640, h = 250, l = 10, b = 34, t = 8;
    var pts = F.loo_points.slice().sort(function (a, c) { return a.resid - c.resid; });
    var lo = Math.min(pts[0].resid, F.loo.resid_q10) - 0.15, hi = Math.max(pts[pts.length - 1].resid, F.loo.resid_q90) + 0.15;
    function px(v) { return l + ((v - lo) / (hi - lo)) * (w - 2 * l); }
    var bw = (h - t - b) / pts.length;
    var s = '<svg class="plot" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="The 87 leave-one-out log residuals sorted from best to worst, with the quantile markers that set the dollar bands">';
    var zero = px(0);
    s += '<line x1="' + zero + '" y1="' + t + '" x2="' + zero + '" y2="' + (h - b) + '" stroke="#0F172A" stroke-width="1.5"/>';
    [F.loo.resid_q10, F.loo.resid_q25, F.loo.resid_q75, F.loo.resid_q90].forEach(function (q, i) {
      s += '<line x1="' + px(q) + '" y1="' + t + '" x2="' + px(q) + '" y2="' + (h - b) + '" stroke="#1D4ED8" stroke-dasharray="3 3" opacity="' + (i === 1 || i === 2 ? 0.9 : 0.4) + '"/>';
    });
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i], y = t + i * bw, x = p.resid < 0 ? px(p.resid) : zero, wd = Math.abs(px(p.resid) - zero);
      var c = Math.abs(p.resid) <= Math.LN2 ? '#047857' : '#B91C1C';
      s += '<rect x="' + x + '" y="' + (y + 0.4) + '" width="' + Math.max(0.8, wd) + '" height="' + Math.max(1.2, bw - 0.8) + '" fill="' + c + '" opacity="0.75"><title>' + esc(p.name) + ' resid ' + p.resid + ' (pred ' + usd(p.pred_usd) + ' vs ' + usd(p.mcap_usd) + ')</title></rect>';
    }
    s += '<text x="' + (w / 2) + '" y="' + (h - 8) + '" font-size="10.5" fill="#475569" text-anchor="middle">signed log error (ln), sorted: green = within 2x, red = beyond — the two solid blue lines = the Q25/Q75 band every row ships</text>';
    return s + '</svg>';
  }

  // the radar: TVL against the fitted FDV/TVL multiple, both log, coloured by verdict.
  function scatterRadar(rows) {
    var w = 1340, h = 520, l = 60, r = 18, t = 14, b = 44;
    var tvls = rows.map(function (r0) { return Math.log10(r0.tvl_usd); });
    var mults = rows.map(function (r0) { return Math.log10(r0.fitted_multiple); });
    var x0 = Math.floor(Math.min.apply(null, tvls)), x1 = Math.ceil(Math.max.apply(null, tvls));
    var y0 = Math.floor(Math.min.apply(null, mults)), y1 = Math.ceil(Math.max.apply(null, mults));
    function px(v) { return l + ((v - x0) / (x1 - x0)) * (w - l - r); }
    function py(v) { return h - b - ((v - y0) / (y1 - y0)) * (h - t - b); }
    var s = '<svg class="plot" viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Radar scatter: every ranked protocol placed by its TVL against the model’s fitted FDV/TVL multiple, coloured by farm verdict">';
    for (var g = x0; g <= x1; g++) {
      s += '<line x1="' + px(g) + '" y1="' + t + '" x2="' + px(g) + '" y2="' + (h - b) + '" stroke="#E2E8F0"/><text x="' + px(g) + '" y="' + (h - b + 15) + '" font-size="11" fill="#475569" text-anchor="middle">$' + Math.pow(10, g - 6) + 'M</text>';
    }
    for (var e = y0; e <= y1; e++) {
      s += '<line x1="' + l + '" y1="' + py(e) + '" x2="' + (w - r) + '" y2="' + py(e) + '" stroke="#E2E8F0"/><text x="' + (l - 7) + '" y="' + (py(e) + 3.5) + '" font-size="11" fill="#475569" text-anchor="end">' + Math.pow(10, e) + 'x</text>';
    }
    var fx = px(Math.log10(D.floor_usd));
    s += '<line x1="' + fx + '" y1="' + t + '" x2="' + fx + '" y2="' + (h - b) + '" stroke="#0F172A" stroke-dasharray="6 4" opacity="0.55"/><text x="' + (fx + 5) + '" y="' + (t + 11) + '" font-size="10.5" fill="#0F172A">$' + (D.floor_usd / 1e6) + 'M floor</text>';
    for (var i = 0; i < rows.length; i++) {
      var r0 = rows[i], col = r0.verdict === 'FARM' ? '#047857' : r0.verdict === 'THIN' ? '#B45309' : '#B91C1C';
      var ring = r0.segment === 'watchlist' ? ' stroke="#0F172A" stroke-width="1.6"' : '';
      s += '<circle data-i="' + r0.rank + '" cx="' + px(Math.log10(r0.tvl_usd)) + '" cy="' + py(Math.log10(r0.fitted_multiple)) + '" r="6" fill="' + col + '" fill-opacity="0.85"' + ring + ' style="cursor:pointer"><title>#' + r0.rank + ' ' + esc(r0.name) + ' — TVL ' + usd(r0.tvl_usd) + ', fit ' + x2(r0.fitted_multiple) + ', ' + r0.verdict + '</title></circle>';
    }
    s += '<text x="' + (l + (w - l - r) / 2) + '" y="' + (h - 8) + '" font-size="11.5" fill="#475569" text-anchor="middle">TVL, log scale — the model’s fitted FDV/TVL multiple, log scale. Solid ring = watchlist (the floor). Green FARM clusters low-TVL / high-multiple: the edge the floor cannot see.</text>';
    return s + '</svg>';
  }

  // ------------------------------------------------------------ filtering

  function visible() {
    var q = state.q.trim().toLowerCase();
    return D.rows.filter(function (r) {
      if (state.seg !== 'all' && r.segment !== state.seg) return false;
      if (state.ver !== 'all' && r.verdict !== state.ver) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (q && (r.name + ' ' + r.slug + ' ' + r.category).toLowerCase().indexOf(q) < 0) return false;
      return true;
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
    verdict: function (a, b) { var V = { FARM: 0, THIN: 1, SKIP: 2 }; return V[a.verdict] - V[b.verdict] || a.rank - b.rank; }
  };
  function sorted(rows) {
    var f = SORTS[state.sort] || SORTS.rank;
    return rows.slice().sort(function (a, b) {
      var c = state.dir * f(a, b);
      return c !== 0 ? c : a.rank - b.rank;
    });
  }

  // ------------------------------------------------------------ views

  function th(key, label, cls) {
    var car = state.sort === key ? '<span class="car">' + (state.dir > 0 ? '▲' : '▼') + '</span> ' : '';
    if (cls === 'num') return '<th class="num"><button data-s="' + key + '" style="text-align:right">' + car + label + '</button></th>';
    return '<th><button data-s="' + key + '">' + car + label + '</button></th>';
  }

  function viewBoard() {
    var rows = sorted(visible());
    var h = '<div class="bar">' +
      '<label>Find</label><input id="q" type="search" placeholder="name, slug, category" value="' + esc(state.q) + '">' +
      '<label>Segment</label><select id="seg"><option value="all">all (' + K.board + ')</option><option value="watchlist"' + (state.seg === 'watchlist' ? ' selected' : '') + '>watchlist (' + K.watchlist_ranked + ')</option><option value="emerging"' + (state.seg === 'emerging' ? ' selected' : '') + '>emerging (' + K.emerging + ')</option></select>' +
      '<label>Verdict</label><select id="ver"><option value="all">all</option><option value="FARM"' + (state.ver === 'FARM' ? ' selected' : '') + '>FARM (' + K.farm + ')</option><option value="THIN"' + (state.ver === 'THIN' ? ' selected' : '') + '>THIN (' + K.thin + ')</option><option value="SKIP"' + (state.ver === 'SKIP' ? ' selected' : '') + '>SKIP (' + K.skip + ')</option></select>' +
      '<label>Category</label><select id="cat"><option value="all">all</option>' + cats().map(function (c) { return '<option value="' + esc(c) + '"' + (state.cat === c ? ' selected' : '') + '>' + esc(c) + ' (' + D.rows.filter(function (r) { return r.category === c; }).length + ')</option>'; }).join('') + '</select>' +
      '<button class="reset">Reset</button>' +
      '<span class="mix">' + mixLine() + '</span></div>';
    h += '<div class="tblwrap"><table id="bm"><thead><tr>' +
      th('rank', '#') + th('name', 'Protocol') + th('implied', 'Implied FDV', 'num') + th('mult', 'Fit x', 'num') +
      '<th>Traded anchors (FDV/TVL)</th>' + th('tvl', 'TVL', 'num') + th('chg', '7d', 'num') + th('ev', 'Net EV $1k', 'num') + th('verdict', 'Verdict') +
      '</tr></thead><tbody>';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      var anc = r.anchor_comps.slice(0, 2).map(function (a) { return '<b>' + esc(a.name) + '</b> <span class="m">' + a.multiple.toFixed(2) + 'x</span>'; }).join(' · ');
      h += '<tr data-rank="' + r.rank + '"' + (state.sel === r.rank ? ' class="sel"' : '') + ' tabindex="0">' +
        '<td class="rk">' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span>' + seg(r) + '<br><span class="sub">' + esc(r.category) + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + ' · ' + (r.age_days === null ? 'age n/a' : (r.age_days / 365).toFixed(1) + 'y') + '</span></td>' +
        '<td class="num"><b>' + usd(r.implied_value_usd) + '</b><br><span class="band">' + usd(r.implied_low_usd) + '–' + usd(r.implied_high_usd) + '</span></td>' +
        '<td class="num">' + x2(r.fitted_multiple) + '</td>' +
        '<td class="anc">' + anc + '</td>' +
        '<td class="num">' + usd(r.tvl_usd) + '</td>' +
        '<td class="num">' + growth(r.change_7d) + '</td>' +
        '<td class="num"><b class="v-' + r.verdict.toLowerCase() + '">' + pct(r.net_ev_pct_1000, 2) + '</b><br><span class="band">$5k ' + pct(r.net_ev_pct_5000, 2) + '</span></td>' +
        '<td>' + pill(r.verdict) + '</td></tr>';
    }
    h += '</tbody></table></div><div class="foot"><span>' + rows.length + ' of ' + K.board + ' ranked protocols · sum of implied FDVs <b>' + usd(K.total_implied_usd) + '</b> · median fitted multiple <b>' + K.med_fitted_multiple.toFixed(2) + 'x</b></span><span>Click any row for the full farm plan, the dollar bridge and the page-side recomputation.</span></div>';
    return h;
  }

  function cats() {
    var seen = {};
    D.rows.forEach(function (r) { seen[r.category] = (seen[r.category] || 0) + 1; });
    return Object.keys(seen).sort(function (a, b) { return seen[b] - seen[a] || (a < b ? -1 : 1); }).slice(0, 24);
  }
  function mixLine() {
    function m(f) {
      var v = ['FARM', 'THIN', 'SKIP'].map(function (x) { return D.rows.filter(function (r) { return f(r) && r.verdict === x; }).length; });
      return '<b class="v-farm">' + v[0] + '</b>/<b class="v-thin">' + v[1] + '</b>/<b class="v-skip">' + v[2] + '</b>';
    }
    return 'Watchlist ' + m(function (r) { return r.segment === 'watchlist'; }) + ' · Emerging ' + m(function (r) { return r.segment === 'emerging'; }) + ' — the FARM edge sits below the floor';
  }

  function viewRadar() {
    var rows = visible();
    return '<div class="panel"><h3>Radar — where the value sits<span class="q">TVL x fitted multiple, both log</span></h3>' +
      '<p>Every ranked protocol, placed by its TVL and the multiple the fit gave it. The model prices small protocols at a <b>higher</b> FDV/TVL multiple (TVL elasticity ' + F.elasticity_at_mean + '), so the farming economics concentrate bottom-right — that is exactly where the watchlist floor cannot look.</p>' +
      scatterRadar(rows) +
      '<div class="legend"><span><span class="sw" style="background:#047857"></span>FARM (' + rows.filter(function (r) { return r.verdict === 'FARM'; }).length + ')</span><span><span class="sw" style="background:#B45309"></span>THIN (' + rows.filter(function (r) { return r.verdict === 'THIN'; }).length + ')</span><span><span class="sw" style="background:#B91C1C"></span>SKIP (' + rows.filter(function (r) { return r.verdict === 'SKIP'; }).length + ')</span><span><span class="sw" style="background:#fff;border:1.6px solid #0F172A"></span>ring = watchlist floor</span></div></div>';
  }

  function viewComps() {
    var h = '<div class="panel"><h3>Tokenized comps — the evidence, priced by the market<span class="q">' + D.live.length + ' protocols · never ranked on the board</span></h3>' +
      '<p>These already trade, so their market cap is a fact, not a claim: they are what the regression is fitted on and validated against (leave-one-out). A resid near 0 means the model reads the market; a big one names where it disagrees.</p></div>';
    h += '<div class="tblwrap"><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">FDV/TVL</th><th class="num">Model (full fit)</th><th class="num">ln resid</th><th class="num">7d</th></tr></thead><tbody>';
    for (var i = 0; i < D.live.length; i++) {
      var l = D.live[i];
      h += '<tr><td><span class="nm">' + esc(l.name) + '</span><br><span class="sub">' + esc(l.category) + ' · ' + esc(l.chains.slice(0, 2).join(', ')) + '</span></td>' +
        '<td class="num">' + usd(l.tvl_usd) + '</td><td class="num"><b>' + usd(l.mcap_usd) + '</b></td><td class="num">' + x2(l.multiple) + '</td><td class="num">' + usd(l.pred_usd) + '</td>' +
        '<td class="num"><span class="' + (Math.abs(l.resid) <= Math.LN2 ? 'g-up' : 'g-dn') + '">' + (l.resid > 0 ? '+' : '') + l.resid + '</span></td><td class="num">' + growth(l.change_7d) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    return h;
  }

  function viewAside() {
    var above = D.aside.filter(function (a) { return a.above_floor; });
    var below = D.aside.filter(function (a) { return !a.above_floor; });
    function tbl(rows) {
      var h = '<div class="tblwrap"><table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">7d</th><th>Why it is not on the board</th></tr></thead><tbody>';
      for (var i = 0; i < rows.length; i++) {
        var a = rows[i];
        h += '<tr style="cursor:default"><td><span class="nm">' + esc(a.name) + '</span><br><span class="sub">' + esc(a.category) + '</span></td><td class="num">' + usd(a.tvl_usd) + '</td><td class="num">' + growth(a.change_7d) + '</td><td class="sub" style="max-width:640px">' + esc(a.reason) + '</td></tr>';
      }
      return h + '</tbody></table></div>';
    }
    return '<div class="panel"><h3>Set aside — counted, reasoned, never ranked<span class="q">' + D.aside.length + ' protocols</span></h3>' +
      '<p>' + above.length + ' pre-token protocols sit at or above the $' + (D.floor_usd / 1e6) + 'M floor but off the house watchlist (bridges, exchanges, staking receipts, versioned pools, product arms with a parent protocol); ' + below.length + ' more sit below it and fall to the same product screens. Every one is listed with its exact reason — the count is honest and the funnel adds up.</p>' +
      '</div>' +
      '<div class="panel"><h3>Above the floor, off the list<span class="q">' + above.length + '</span></h3>' + tbl(above) + '</div>' +
      '<div class="panel"><h3>Below the floor, screened<span class="q">' + below.length + '</span></h3>' + tbl(below) + '</div>';
  }

  function lamTxt(l) { return 'size ' + l[0] + ' · noise ' + l[1] + ' · category ' + l[2]; }

  function viewModel() {
    var lm = F.loo.metrics, bm = F.baselines[0].metrics, cm = F.baselines[1].metrics, pm = F.wf.pooled;
    var h = '<div class="grid2"><div>';
    h += '<div class="panel"><h3>The fitted equation<span class="q">' + F.n_comps + ' tokenized comps · ridge, LOO-tuned</span></h3>' +
      '<div class="eq">' + esc(F.equation) + '</div>' +
      '<p>Target: ' + esc(F.target) + '. Features standardized (mu/sd below); group penalties ' + lamTxt(F.lam) + ' picked from a shipped grid (' + F.lam_grid[0].join('/') + ' x ' + F.lam_grid[1].join('/') + ' x ' + F.lam_grid[2].join('/') + ') by maximum leave-one-out R2 — selection disclosed, not hidden. Categories with at least ' + M.cat_min_comps + ' comps get fixed effects: ' + esc(F.cats.join(', ')) + '.</p>' +
      '<div class="stat3"><div><span class="k">TVL elasticity</span><div class="v">' + F.elasticity_at_mean + '</div><span class="s">x10 TVL adds ~' + Math.round((Math.pow(10, F.elasticity_at_mean) - 1) * 100) + '% FDV — the market pays multiple, not size</span></div>' +
      '<div><span class="k">In-sample R2</span><div class="v">' + F.in_sample_r2 + '</div><span class="s">on the fit itself</span></div>' +
      '<div><span class="k">LOO R2</span><div class="v">' + lm.r2 + '</div><span class="s">every comp blind to itself</span></div></div></div>';
    h += '<div class="panel"><h3>Coefficients (standardized)</h3><table class="mini"><thead><tr><th>Feature</th><th class="num">beta</th><th class="num">mean</th><th class="num">sd</th></tr></thead><tbody>';
    for (var i = 0; i < F.feature_names.length; i++) {
      h += '<tr><td>' + esc(F.feature_names[i]) + '</td><td class="num"><b>' + F.beta[i] + '</b></td><td class="num">' + F.mu[i] + '</td><td class="num">' + F.sd[i] + '</td></tr>';
    }
    h += '</tbody></table><p>The LOO-optimal penalties nearly zero the momentum, age and breadth terms (betas at noise level): size plus category carries the fit. What the regression buys is <b>calibrated levels</b> — see the baselines opposite.</p></div>';
    h += '<div class="panel"><h3>Validation 1 — leave-one-out, ' + lm.n + ' refits<span class="q">R2 ' + lm.r2 + ' · rho ' + lm.rho + ' · med |ln err| ' + lm.med_abs_log_err + ' · ' + lm.within_2x_pct + '% within 2x</span></h3>' +
      scatterLoo() + residStrip() + '</div>';
    h += '</div><div>';
    h += '<div class="panel"><h3>The regression versus what it replaces<span class="q">identical LOO pass</span></h3>' +
      '<table class="mini"><thead><tr><th>Model</th><th class="num">R2</th><th class="num">rho</th><th class="num">med err</th><th class="num">w2</th></tr></thead><tbody>' +
      '<tr class="hi"><td>kestrel-3 regression</td><td class="num win">' + lm.r2 + '</td><td class="num">' + lm.rho + '</td><td class="num">' + lm.med_abs_log_err + '</td><td class="num">' + lm.within_2x_pct + '%</td></tr>';
    for (var k = 0; k < F.baselines.length; k++) {
      var b = F.baselines[k], x = b.metrics;
      h += '<tr><td>' + esc(b.name) + '<br><span class="sub">' + esc(b.note) + '</span></td><td class="num lose">' + x.r2 + '</td><td class="num">' + x.rho + '</td><td class="num">' + x.med_abs_log_err + '</td><td class="num">' + x.within_2x_pct + '%</td></tr>';
    }
    h += '</tbody></table><p>Honest read: all three rank about equally (rho 0.34–0.44); the median hand-sets are <b>worse than useless at levels</b> (negative R2 — they misprice by more than a flat constant), while the regression holds positive R2 and the 2x error share. Dollar bands you can farm against are what the fit adds; the median model’s 0.48x was never validated at all.</p></div>';
    h += '<div class="panel"><h3>Validation 2 — temporal walk-forward<span class="q">train older, predict newer</span></h3>' +
      '<p>The ' + F.n_comps + ' comps split into ' + F.wf.cohorts + ' dated cohorts by token-listing date; ' + (F.wf.folds.length) + ' expanding folds always fit on the past and predict the next cohort blind, re-tuning penalties on training data alone. Undated comps sit in every training fold, never in a test fold.</p>' +
      '<table class="mini"><thead><tr><th>Test cohort (listed_at)</th><th class="num">train / test</th><th>lam</th><th class="num">R2</th><th class="num">rho</th><th class="num">med err</th><th class="num">w2</th></tr></thead><tbody>';
    for (var f2 = 0; f2 < F.wf.folds.length; f2++) {
      var fo = F.wf.folds[f2], fm = fo.metrics;
      h += '<tr><td>' + fo.from + ' → ' + fo.to + '</td><td class="num">' + fo.train_n + ' / ' + fo.test_n + '</td><td class="sub">' + lamTxt(fo.lam) + '</td><td class="num ' + (fm.r2 > 0 ? 'win' : 'lose') + '">' + fm.r2 + '</td><td class="num">' + fm.rho + '</td><td class="num">' + fm.med_abs_log_err + '</td><td class="num">' + fm.within_2x_pct + '%</td></tr>';
    }
    h += '<tr class="tot"><td>Pooled out-of-time</td><td class="num">— / ' + pm.n + '</td><td></td><td class="num ' + (pm.r2 > 0 ? 'win' : 'lose') + '">' + pm.r2 + '</td><td class="num">' + pm.rho + '</td><td class="num">' + pm.med_abs_log_err + '</td><td class="num">' + pm.within_2x_pct + '%</td></tr></tbody></table>' +
      '<p><b>What this says:</b> the rank signal survives the future (rho ' + pm.rho + ' pooled; ' + F.wf.folds[1].metrics.rho + ' on the 2024–25 cohort), but levels re-rate through cycles — the newest cohort gets a negative R2. That is precisely why every board row ships a <b>band</b>, why EV decisions use the mid-band, and why nothing here is a price target.</p></div>';
    h += '<div class="panel"><h3>Farm verdicts — the arithmetic on every row<span class="q">deposit-sized, model claims</span></h3>' +
      '<p>Allocation band: a token launch commonly hands <b>' + (M.drop_band_lo * 100) + '–' + (M.drop_band_hi * 100) + '% of FDV</b> to the snapshot of early users; divided over current TVL that pays ' + ((M.drop_band_lo + M.drop_band_hi) / 2 * 100).toFixed(1) + '%-pro-rata per TVL dollar, times the fitted multiple (FDV dollars per TVL dollar) times a <b>capture factor of ' + M.capture_factor + '</b> for activity-weighted (not pro-rata) drops — the model’s stated assumption, not a measurement.</p>' +
      '<p>Costs: ' + M.tx_count + ' transactions on the two cheapest named chains at the gas table, a $' + M.bridge_usd + ' bridge allowance, and ' + (M.opportunity_cost_annum * 100) + '%/yr carried on the deposit over a ' + M.hold_default_days + '–' + M.hold_by_age_days[0][1] + '-day hold. FARM if the mid-band nets at least ' + M.farm_net_pct + '% at $1,000; THIN above ' + M.thin_net_pct + '%; SKIP below.</p></div>';
    var ex = D.rows.filter(function (r) { return r.verdict === 'FARM'; }).sort(function (a, b) { return b.net_ev_pct_1000 - a.net_ev_pct_1000; })[0];
    if (ex) {
      h += '<div class="panel"><h3>Worked: ' + esc(ex.name) + ' (rank ' + ex.rank + ', ' + ex.verdict + ')<span class="q">every number recomputes from the shipped constants</span></h3>' +
        '<div class="eq">fit ' + x2(ex.fitted_multiple) + ' x capture ' + M.capture_factor + ' x band ' + (((M.drop_band_lo + M.drop_band_hi) / 2) * 100).toFixed(1) + '% = ' + ex.farm.gross_mid_pct + '% gross · costs ' + money2(ex.farm.cost1k_usd) + ' (gas ' + money2(ex.farm.gas_usd) + ' + bridge ' + money2(ex.farm.bridge_usd) + ' + carry ' + money2(ex.farm.op1k_usd) + ') = <b>' + (ex.net_ev_pct_1000 > 0 ? '+' : '') + ex.net_ev_pct_1000 + '% at $1,000</b></div></div>';
    }
    h += '</div></div>';
    h += viewModelFunnel();
    return h;
  }

  function viewModelFunnel() {
    var h = '<div class="panel"><h3>The whole snapshot, accounted for<span class="q">' + K.total + ' protocols, every one classified</span></h3><div class="fnl">';
    for (var i = 0; i < D.funnel.steps.length; i++) {
      var s = D.funnel.steps[i];
      h += '<div class="fl">' + esc(s.label) + '</div><div class="fn">' + s.n + '</div><div class="fd">' + esc(s.detail) + '</div>';
    }
    h += '</div>';
    var parts = [[K.comps, 'comps'], [K.tokenized_no_mcap, 'token-no-mcap'], [K.tokenized_small_mcap, 'small-mcap'], [K.watchlist_ranked, 'watchlist'], [K.aside_above, 'set-aside'], [K.excluded_below, 'screened-below-floor'], [K.emerging, 'emerging-scored']];
    var sum = parts.reduce(function (a, b) { return a + b[0]; }, 0);
    var idn = parts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' + ') + ' = ' + sum;
    h += '<div class="idn">' + esc(idn) + ' — ' + (sum === K.total ? 'exactly the ' + K.total + ' protocols on the snapshot, every one classified once' : 'MISMATCH against ' + K.total) + '</div>';
    function why(list) { return list.map(function (x) { return '<li><b>' + x.n + '</b> — ' + esc(x.reason) + '</li>'; }).join(''); }
    h += '<div class="grid2" style="margin-top:10px"><div><h3 style="border:0;padding:0;margin:0 0 4px;font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase">Reasons kept off above the floor</h3><ul>' + why(D.funnel.aside_reasons_above) + '</ul></div>' +
      '<div><h3 style="border:0;padding:0;margin:0 0 4px;font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase">Reasons screened below the floor</h3><ul>' + why(D.funnel.excluded_reasons_below) + '</ul></div></div></div>';
    return h;
  }

  // ------------------------------------------------------------ drawer

  function drawerHtml(r) {
    var ev = evOf(r), im = impliedOf(r.x);
    var h = '<button class="x" aria-label="Close">close ✕</button>';
    h += '<h2>' + esc(r.name) + '</h2><div class="dsub"><span class="rk">rank #' + r.rank + '</span> of ' + K.board + ' · ' + esc(r.slug) + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) + ' · TVL ' + usd(r.tvl_usd) + ' · ' + (r.age_days === null ? 'age n/a' : (r.age_days / 365).toFixed(1) + 'y since listing') + '</div>';
    h += '<div class="dv">' + pill(r.verdict) +
      '<span><span class="lab">Net EV at $1,000</span><span class="big v-' + r.verdict.toLowerCase() + '">' + pct(r.net_ev_pct_1000, 2) + '</span></span>' +
      '<span><span class="lab">at $5,000</span><span class="big">' + pct(r.net_ev_pct_5000, 2) + '</span></span>' +
      '<span><span class="lab">Implied FDV (mid)</span><span class="big">' + usd(r.implied_value_usd) + '</span></span>' +
      '</div>';
    h += '<div class="dsec"><h4>Valuation — what the model claims</h4>' +
      '<p>Implied FDV <b>' + usd(r.implied_value_usd) + '</b> (' + x2(r.fitted_multiple) + ' of TVL). The LOO log-error band puts Q25–Q75 at <b>' + usd(r.implied_low_usd) + ' – ' + usd(r.implied_high_usd) + '</b>; the wider Q10–Q90 spread reaches ' + usd(Math.max(1, Math.round(r.implied_value_usd * Math.exp(F.loo.resid_q10)))) + ' – ' + usd(Math.round(r.implied_value_usd * Math.exp(F.loo.resid_q90))) + '. This is a model’s claim on ' + esc(r.category) + ' comps, not a price target.</p>' +
      '<table class="ev"><thead><tr><th>Named anchor (already trades)</th><th class="num">TVL</th><th class="num">MCap</th><th class="num">FDV/TVL</th></tr></thead><tbody>';
    for (var i = 0; i < r.anchor_comps.length; i++) {
      var a = r.anchor_comps[i];
      h += '<tr><td><b>' + esc(a.name) + '</b> <span class="sub">' + esc(a.category) + '</span></td><td class="num">' + usd(a.tvl_usd) + '</td><td class="num">' + usd(a.mcap_usd) + '</td><td class="num">' + x2(a.multiple) + '</td></tr>';
    }
    h += '</tbody></table></div>';
    h += '<div class="dsec"><h4>Farm economics — ' + ev.hold + '-day hold, per deposit</h4>' +
      '<table class="ev"><thead><tr><th></th><th class="num">$1,000</th><th class="num">$5,000</th></tr></thead><tbody>' +
      '<tr><td>Airdrop band ' + (M.drop_band_lo * 100) + '–' + (M.drop_band_hi * 100) + '% of ' + usd(r.implied_value_usd) + ' FDV, x' + M.capture_factor + ' capture</td><td class="num">' + usd(r.farm.alloc1k_lo_usd) + '–' + usd(r.farm.alloc1k_hi_usd) + '</td><td class="num">' + usd(r.farm.alloc5k_lo_usd) + '–' + usd(r.farm.alloc5k_hi_usd) + '</td></tr>' +
      '<tr><td>Gross mid expectation</td><td class="num">' + money2(rd(r.farm.gross_mid_pct * 10, 2)) + ' (' + r.farm.gross_mid_pct + '%)</td><td class="num">' + money2(rd(r.farm.gross_mid_pct * 50, 2)) + '</td></tr>' +
      '<tr><td>Gas — ' + M.tx_count + ' tx on ' + esc(r.farm.chains_farmed.join(' + ')) + '</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.gas_usd) + '</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.gas_usd) + '</td></tr>' +
      '<tr><td>Bridge / tx allowance</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.bridge_usd) + '</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.bridge_usd) + '</td></tr>' +
      '<tr><td>Lock-up carry @ ' + (M.opportunity_cost_annum * 100) + '%/yr x ' + r.farm.hold_days + 'd</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.op1k_usd) + '</td><td class="num" style="color:#B91C1C">-' + money2(r.farm.op5k_usd) + '</td></tr>' +
      '<tr class="tot"><td>Net expected return</td><td class="num ' + (ev.a.net >= 0 ? 'win' : 'lose') + '">' + (ev.a.net >= 0 ? '+' : '') + money2(ev.a.net) + ' (' + pct(r.net_ev_pct_1000, 2) + ')</td><td class="num ' + (ev.b.net >= 0 ? 'win' : 'lose') + '">' + (ev.b.net >= 0 ? '+' : '') + money2(ev.b.net) + ' (' + pct(r.net_ev_pct_5000, 2) + ')</td></tr>' +
      '</tbody></table>' +
      '<div class="recompute' + (im === r.implied_value_usd && ev.ok ? '' : ' off') + '">' +
      'page recompute: exp(' + F.ybar + ' + Σ β·z) = $' + im.toLocaleString('en-US') + ' · board $' + r.implied_value_usd.toLocaleString('en-US') + (im === r.implied_value_usd ? ' ✓' : ' ✗') + '\n' +
      'farm recompute: ' + pct(ev.a.pct, 2) + ' @1k / ' + pct(ev.b.pct, 2) + ' @5k → ' + ev.verdict + (ev.ok && ev.verdict === r.verdict ? ' ✓ matches board' : ' ✗ board ' + r.verdict) + '</div>' +
      '<p>Low-band outcome pays ' + r.farm.gross_lo_pct + '%, high-band ' + r.farm.gross_hi_pct + '% of the deposit before costs. The verdict applies the mid-band at $1,000.</p></div>';
    h += '<div class="dsec"><h4>The plan — six steps</h4><ul class="plan">';
    for (var p = 0; p < r.steps.length; p++) {
      var s = r.steps[p];
      h += '<li><span class="st">Step ' + (p < 9 ? '0' : '') + (p + 1) + '</span>' + esc(s.action) + '<span class="ct"><b>Cost:</b> ' + esc(s.cost) + ' · <b>Time:</b> ' + esc(s.time) + '</span></li>';
    }
    h += '</ul></div>';
    h += '<div class="dsec"><h4>Risk, plainly</h4><p>Pre-token farming is venture-sized: a young ' + esc(r.category) + ' protocol can lose the whole deposit to a contract bug, a depeg or a rogue admin key, and a points programme can change rules, dilute or never drop at all. The implied FDV and every dollar here is the model’s claim — never a promise. Check the protocol’s own docs before depositing anything; a claim site that asks for a seed phrase is always a scam.</p></div>';
    return h;
  }

  function openDrawer(rank) {
    var r = null;
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].rank === rank) r = D.rows[i];
    if (!r) return;
    state.sel = rank;
    drawer.innerHTML = drawerHtml(r);
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.hidden = false;
    drawer.scrollTop = 0;
    var tr = app.querySelector('tr.sel');
    if (tr) tr.classList.remove('sel');
    var row = app.querySelector('tr[data-rank="' + rank + '"]');
    if (row) row.classList.add('sel');
  }
  function closeDrawer() {
    state.sel = null;
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.hidden = true;
    var tr = app.querySelector('tr.sel');
    if (tr) tr.classList.remove('sel');
  }

  // ------------------------------------------------------------ shell

  function kpiCards() {
    return '<section class="kpis" aria-label="Snapshot accounting">' +
      '<div class="kpi"><div class="k">Protocols sealed</div><div class="v">' + K.total + '</div><div class="s">TVL ≥ $5M · as of ' + D.as_of + '</div></div>' +
      '<div class="kpi"><div class="k">Tokenized comps fitted</div><div class="v">' + K.comps + '</div><div class="s">mcap ≥ $5M · the model’s evidence</div></div>' +
      '<div class="kpi"><div class="k">Pre-token universe</div><div class="v">' + K.pre_token + '</div><div class="s">' + K.watchlist_ranked + ' ranked + ' + K.emerging + ' emerging + ' + K.aside_above + ' set aside + ' + K.excluded_below + ' screened</div></div>' +
      '<div class="kpi"><div class="k">Watchlist ranked</div><div class="v">' + K.watchlist_ranked + '</div><div class="s">all ' + K.watchlist + ' house slugs, floor kept</div></div>' +
      '<div class="kpi"><div class="k">Emerging finds</div><div class="v">' + K.emerging + '</div><div class="s">below floor, screens passed</div></div>' +
      '<div class="kpi good"><div class="k">Board · FARM</div><div class="v">' + K.board + ' <span class="v-farm">/ ' + K.farm + '</span></div><div class="s">THIN ' + K.thin + ' · SKIP ' + K.skip + '</div></div>' +
      '<div class="kpi"><div class="k">LOO R² / ρ</div><div class="v">' + F.loo.metrics.r2 + ' <span style="font-size:14px">/ ' + F.loo.metrics.rho + '</span></div><div class="s">vs ' + F.baselines[0].metrics.r2 + ' shrink-median · walk-fwd ρ ' + F.wf.pooled.rho + '</div></div>' +
      '</section>';
  }

  function render() {
    var tabs = [['board', 'Board', K.board], ['radar', 'Radar', K.board], ['comps', 'Tokenized', D.live.length], ['aside', 'Set-aside', D.aside.length], ['model', 'Methodology', null]];
    var h = '<header class="mast"><h1><span class="kestrel">KESTREL</span> <span class="thinw">· Token Launch Radar</span></h1>' +
      '<div class="meta"><b>' + MODEL_LABEL() + '</b><br>one sealed snapshot dated ' + D.as_of + '<br>' + K.total + ' protocols accounted for, ' + K.board + ' ranked</div></header>';
    h += '<div class="tagline"><span>Regression-fitted FDV vs ' + K.comps + ' tokenized comps · validated leave-one-out <span class="val">(R² ' + F.loo.metrics.r2 + ', ρ ' + F.loo.metrics.rho + ')</span> and on temporal walk-forward folds <span class="val">(pooled ρ ' + F.wf.pooled.rho + ')</span> · deposit-sized net-EV verdicts on every row.</span><span>Floor $' + (D.floor_usd / 1e6) + 'M is the house list — never the search boundary.</span></div>';
    h += kpiCards();
    h += '<nav class="tabs" role="tablist" aria-label="Views">' + tabs.map(function (t) {
      return '<button role="tab" data-v="' + t[0] + '" aria-selected="' + (state.view === t[0]) + '">' + t[1] + (t[2] === null ? '' : ' <span class="cnt">' + t[2] + '</span>') + '</button>';
    }).join('') + '</nav>';
    h += '<section class="view">' + (state.view === 'board' ? viewBoard() : state.view === 'radar' ? viewRadar() : state.view === 'comps' ? viewComps() : state.view === 'aside' ? viewAside() : viewModel()) + '</section>';
    app.innerHTML = h;
    app.setAttribute('aria-busy', 'false');
    if (state.sel !== null) { var row = app.querySelector('tr[data-rank="' + state.sel + '"]'); if (row) row.classList.add('sel'); }
  }
  function MODEL_LABEL() { return D.model_version + ' — fitted log-linear ridge'; }

  // ------------------------------------------------------------ events (delegated)

  app.addEventListener('click', function (e) {
    var tb = e.target.closest && e.target.closest('[data-v]');
    if (tb) { state.view = tb.getAttribute('data-v'); render(); return; }
    var sb = e.target.closest && e.target.closest('[data-s]');
    if (sb) {
      var k = sb.getAttribute('data-s');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = (k === 'rank' || k === 'name' || k === 'verdict') ? 1 : -1; }
      render(); return;
    }
    if (e.target.closest && e.target.closest('.reset')) { state.q = ''; state.seg = 'all'; state.ver = 'all'; state.cat = 'all'; render(); return; }
    var tr = e.target.closest && e.target.closest('tr[data-rank]');
    if (tr) { openDrawer(+tr.getAttribute('data-rank')); return; }
    var ci = e.target.closest && e.target.closest('circle[data-i]');
    if (ci) { openDrawer(+ci.getAttribute('data-i')); return; }
  });
  app.addEventListener('keydown', function (e) {
    var tr = e.target.closest && e.target.closest('tr[data-rank]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openDrawer(+tr.getAttribute('data-rank')); }
  });
  app.addEventListener('input', function (e) {
    if (e.target.id === 'q') { state.q = e.target.value; rerenderKeepFocus(); }
  });
  app.addEventListener('change', function (e) {
    if (e.target.id === 'seg') state.seg = e.target.value;
    else if (e.target.id === 'ver') state.ver = e.target.value;
    else if (e.target.id === 'cat') state.cat = e.target.value;
    else return;
    render();
  });
  function rerenderKeepFocus() {
    var pos = app.querySelector('#q') ? app.querySelector('#q').selectionStart : 0;
    render();
    var q = app.querySelector('#q');
    if (q) { q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} }
  }

  scrim.addEventListener('click', closeDrawer);
  drawer.addEventListener('click', function (e) { if (e.target.closest && e.target.closest('.x')) closeDrawer(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });

  render();
})();
