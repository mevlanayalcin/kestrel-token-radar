// Kestrel Token Radar — the page. It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, the filters, the tokenized comps the model is calibrated from,
// the products set aside, and a per-protocol detail drawer: a valuation waterfall, a peer-multiple
// gauge and the numbered farm plan with its cost and time tags. No network, no framework: every
// byte it shows is in data.js, and the page recomputes each row's implied FDV from the same
// constants to prove the board and the code agree.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var M = DATA.model;
  var app = document.getElementById('board');
  var drawer = document.getElementById('drawer');
  var scrim = document.getElementById('scrim');

  var state = {
    view: 'radar', q: '', seg: 'all', cat: 'all', chain: 'all', tier: 'all', growth: 'all',
    sort: 'rank', dir: 1, selected: null
  };

  // ------------------------------------------------------------ format

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(d) {
    if (d === null || d === undefined) return 'unk';
    if (d >= 365) return (d / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(d)) + 'd';
  }
  function fmtMult(n) { return n.toFixed(2) + '\u00d7'; }

  // The model in one function, run in the page from the same constants the board was scored with:
  // the drawer shows the number it rebuilds next to the number board.json carries.
  function recompute(r) {
    var v = r.tvl_usd * r.peer_multiple * r.momentum_multiplier * r.maturity_multiplier * r.breadth_multiplier;
    return Math.max(1, Math.round(v));
  }

  // ------------------------------------------------------------ dom

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined) return;
        if (k === 'class') node.className = v;
        else if (k === 'text') node.textContent = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }
  function svgEl(tag, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  // ------------------------------------------------------------ state io

  function readHash() {
    var next = { view: 'radar', q: '', seg: 'all', cat: 'all', chain: 'all', tier: 'all', growth: 'all', sort: 'rank', dir: 1, selected: null };
    var h = window.location.hash.replace(/^#/, '');
    if (h) {
      var p = new URLSearchParams(h);
      if (p.get('q')) next.q = p.get('q');
      if (p.get('seg')) next.seg = p.get('seg');
      if (p.get('cat')) next.cat = p.get('cat');
      if (p.get('chain')) next.chain = p.get('chain');
      if (p.get('tier')) next.tier = p.get('tier');
      if (p.get('growth')) next.growth = p.get('growth');
      if (p.get('view')) next.view = p.get('view');
      if (p.get('sort')) { next.sort = p.get('sort'); next.dir = p.get('dir') === '-1' ? -1 : 1; }
      if (p.get('p')) next.selected = p.get('p');
    }
    state = next;
  }
  function writeHash() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.view !== 'radar') p.set('view', state.view);
    if (state.seg !== 'all') p.set('seg', state.seg);
    if (state.cat !== 'all') p.set('cat', state.cat);
    if (state.chain !== 'all') p.set('chain', state.chain);
    if (state.tier !== 'all') p.set('tier', state.tier);
    if (state.growth !== 'all') p.set('growth', state.growth);
    if (state.sort !== 'rank') { p.set('sort', state.sort); p.set('dir', state.dir); }
    if (state.selected) p.set('p', state.selected);
    var next = p.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname);
  }

  // ------------------------------------------------------------ filters

  var TIERS = [
    { id: 'all', label: 'Every tier', test: function () { return true; } },
    { id: 'b1', label: '\u2265 $1B', test: function (t) { return t >= 1e9; } },
    { id: 'b2', label: '$500M \u2013 $1B', test: function (t) { return t >= 5e8 && t < 1e9; } },
    { id: 'b3', label: '$100M \u2013 $500M', test: function (t) { return t >= 1e8 && t < 5e8; } },
    { id: 'b4', label: '$50M \u2013 $100M', test: function (t) { return t >= 5e7 && t < 1e8; } },
    { id: 'b5', label: '< $50M (emerging)', test: function (t) { return t < 5e7; } }
  ];
  var GROWTHS = [
    { id: 'all', label: 'Any 7d', test: function () { return true; } },
    { id: 'pos', label: '7d > 0', test: function (g) { return g !== null && g > 0; } },
    { id: 'hot', label: '7d \u2265 +15%', test: function (g) { return g !== null && g >= 15; } },
    { id: 'neg', label: '7d < 0', test: function (g) { return g !== null && g < 0; } }
  ];

  function rows() {
    var q = state.q.trim().toLowerCase();
    var tier = TIERS.filter(function (t) { return t.id === state.tier; })[0] || TIERS[0];
    var grw = GROWTHS.filter(function (t) { return t.id === state.growth; })[0] || GROWTHS[0];
    return DATA.rows.filter(function (r) {
      if (state.seg !== 'all' && r.segment !== state.seg) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (!tier.test(r.tvl_usd)) return false;
      if (!grw.test(r.change_7d)) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + r.category + ' ' + r.chains.join(' ')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  var SORTS = {
    rank: function (r) { return r.rank; },
    name: function (r) { return r.name.toLowerCase(); },
    implied: function (r) { return r.implied_value_usd; },
    tvl: function (r) { return r.tvl_usd; },
    growth: function (r) { return r.change_7d === null ? -1e12 : r.change_7d; },
    mult: function (r) { return r.peer_multiple; },
    age: function (r) { return r.age_days === null ? -1 : r.age_days; },
    chains: function (r) { return r.chains.length; },
    conviction: function (r) { return r.conviction_score; }
  };

  function sorted(list) {
    var key = SORTS[state.sort] ? state.sort : 'rank';
    var get = SORTS[key];
    return list.slice().sort(function (a, b) {
      var av = get(a), bv = get(b);
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ------------------------------------------------------------ chrome

  function brandMark() {
    var s = svgEl('svg', { width: 34, height: 34, viewBox: '0 0 34 34', 'aria-hidden': 'true' });
    s.appendChild(svgEl('circle', { cx: 17, cy: 17, r: 15, fill: 'none', stroke: '#283242', 'stroke-width': 1 }));
    s.appendChild(svgEl('circle', { cx: 17, cy: 17, r: 9.5, fill: 'none', stroke: '#283242', 'stroke-width': 1 }));
    s.appendChild(svgEl('circle', { cx: 17, cy: 17, r: 4, fill: 'none', stroke: '#31d68f', 'stroke-width': 1 }));
    s.appendChild(svgEl('path', { d: 'M17 17 L17 2', stroke: '#31d68f', 'stroke-width': 1.4, transform: 'rotate(32 17 17)' }));
    s.appendChild(svgEl('circle', { cx: 24, cy: 11, r: 2.1, fill: '#e8a63d' }));
    s.appendChild(svgEl('circle', { cx: 9.5, cy: 21, r: 1.5, fill: '#31d68f' }));
    return s;
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, brandMark(),
        el('div', null,
          el('h1', { text: 'KESTREL \u00b7 TOKEN LAUNCH RADAR' }),
          el('div', { class: 'sub', text: 'pre-token protocols \u00b7 peer-calibrated implied FDV' }))),
      el('div', { class: 'topmeta' },
        el('span', { class: 'chip', text: 'SNAPSHOT ' + DATA.snapshot_date }),
        el('span', { class: 'chip', text: 'FLOOR ' + fmtUsd(DATA.floor_usd) }),
        el('span', { class: 'chip', text: 'MODEL ' + DATA.model_version }),
        el('span', { class: 'chip', text: 'DEFILLAMA PROTOCOL INDEX' })));
  }

  function kpis() {
    var k = DATA.kpis;
    function kpi(key, val, sub, hot) {
      return el('div', { class: 'kpi' + (hot ? ' hot' : '') },
        el('div', { class: 'k', text: key }),
        el('div', { class: 'v', text: val }),
        el('div', { class: 's', text: sub }));
    }
    return el('section', { class: 'kpis', 'aria-label': 'Board summary' },
      kpi('watchlist covered', k.watchlist + ' / ' + k.watchlist, 'house floor: every slug ranked', false),
      kpi('emerging below floor', String(k.emerging), 'pre-token finds under ' + fmtUsd(DATA.floor_usd), false),
      kpi('\u03a3 implied pre-token fdv', fmtUsd(k.total_implied_usd), 'the board\u2019s own claim, summed', true),
      kpi('board rows', String(k.board), 'all records show no token', false),
      kpi('median peer multiple', fmtMult(k.median_peer_multiple), 'across the board\u2019s rows', false),
      kpi('tokenized comps', String(k.comp_count), 'calibrate the model\u2019s multiples', false));
  }

  function formulaPill() {
    return el('div', { class: 'formula', role: 'note' },
      el('b', { text: 'MODEL' }),
      el('span', { class: 'fx', text: 'implied FDV = TVL \u00d7 peer_mult(category) \u00d7 momentum(7d) \u00d7 maturity(age, no token) \u00d7 breadth(chains)' }),
      el('span', { text: '\u2014 peer multiples are medians of FDV/TVL over ' + DATA.kpis.comp_count + ' tokenized protocols inside this snapshot, shrunk toward the ' + fmtMult(DATA.calibration.global_median) + ' market median by w = n/(n+4) comps.' }));
  }

  // ------------------------------------------------------------ controls

  function options(list, selected) {
    return list.map(function (o) {
      return el('option', { value: o.id, text: o.label, selected: o.id === selected ? 'selected' : null });
    });
  }

  function controls() {
    var cats = [{ id: 'all', label: 'All categories' }].concat(
      Array.from(new Set(DATA.rows.map(function (r) { return r.category; }))).sort()
        .map(function (c) { return { id: c, label: c }; }));
    var chains = [{ id: 'all', label: 'All chains' }].concat(
      Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort()
        .map(function (c) { return { id: c, label: c }; }));

    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category, chain\u2026', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () {
      state.q = search.value;
      writeHash();
      fillStage();
      if (state.fillCounts) state.fillCounts();
    });

    function sel(id, label, list, key) {
      var s = el('select', { id: id, 'aria-label': label }, options(list, state[key]));
      s.addEventListener('change', function () {
        state[key] = s.value;
        writeHash();
        fillStage();
        if (state.fillCounts) state.fillCounts();
      });
      return el('div', { class: 'field' }, el('label', { for: id, text: label }), s);
    }

    var tabDefs = [['radar', 'Radar'], ['comps', 'Tokenized comps'], ['aside', 'Set aside']];
    var tabs = tabDefs.map(function (t) {
      return el('button', {
        type: 'button', 'aria-pressed': state.view === t[0] ? 'true' : 'false', text: t[1],
        onclick: function () { state.view = t[0]; writeHash(); render(); }
      });
    });

    var shown = state.view === 'radar' ? rows().length : 0;
    var counts = el('span', { class: 'counts', id: 'counts' });
    var fillCounts = function () {
      counts.textContent = '';
      if (state.view !== 'radar') return;
      var list = rows();
      counts.appendChild(el('b', { text: String(list.length) }));
      counts.appendChild(document.createTextNode(' of ' + DATA.kpis.board + ' rows \u00b7 ' + list.filter(function (r) { return r.segment === 'watchlist'; }).length + ' watchlist \u00b7 ' + list.filter(function (r) { return r.segment === 'emerging'; }).length + ' emerging'));
    };
    fillCounts();
    state.fillCounts = fillCounts;

    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('div', { class: 'lb', text: 'View' }), el('div', { class: 'tabs' }, tabs)),
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      state.view === 'radar' ? sel('seg', 'Segment', [
        { id: 'all', label: 'All pre-token' }, { id: 'watchlist', label: 'Watchlist' }, { id: 'emerging', label: 'Emerging' }
      ], 'seg') : null,
      state.view === 'radar' ? sel('cat', 'Category', cats, 'cat') : null,
      state.view === 'radar' ? sel('chain', 'Chain', chains, 'chain') : null,
      state.view === 'radar' ? sel('tier', 'TVL tier', TIERS, 'tier') : null,
      state.view === 'radar' ? sel('growth', '7d growth', GROWTHS, 'growth') : null,
      el('button', { class: 'reset', type: 'button', text: 'Reset', onclick: function () {
        state.q = ''; state.seg = 'all'; state.cat = 'all'; state.chain = 'all'; state.tier = 'all'; state.growth = 'all';
        state.sort = 'rank'; state.dir = 1;
        writeHash(); render();
      } }),
      counts);
  }

  // ------------------------------------------------------------ radar table

  function sortHead(key, label, numeric) {
    return el('th', { scope: 'col', class: numeric ? 'num' : null },
      el('button', { type: 'button', onclick: function () {
        if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'rank' || key === 'name' ? 1 : -1; }
        writeHash();
        fillStage();
        if (state.fillCounts) state.fillCounts();
      } }, label, state.sort === key ? el('span', { class: 'arrow', 'aria-hidden': 'true', text: state.dir > 0 ? '\u25b4' : '\u25be' }) : null));
  }

  /** The chain list a row shows: the filtered chain first, so the filter\u2019s match is visible. */
  function chainList(r) {
    var cs = r.chains;
    if (state.chain !== 'all' && cs.indexOf(state.chain) >= 0) cs = [state.chain].concat(cs.filter(function (c) { return c !== state.chain; }));
    return cs.slice(0, 3);
  }

  function radarTable() {
    var list = sorted(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'NO PROTOCOL MATCHES THAT FILTER' }),
        el('p', { text: 'Clear the search or widen a filter to see the board again.' })));
    }
    var max = list.reduce(function (m, r) { return Math.max(m, r.implied_value_usd); }, 1);
    var body = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d, gc = g === null ? '' : g >= 0 ? 'pos' : 'neg';
      body.appendChild(el('tr', {
        class: state.selected === r.slug ? 'sel' : null, tabindex: '0', 'data-slug': r.slug,
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rk', text: String(r.rank).padStart(3, '0') }),
        el('td', null, el('div', { class: 'pname' },
          el('b', { text: r.name }),
          el('span', { class: 'pc', text: r.category + ' \u00b7 ' + chainList(r).join(' / ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') }))),
        el('td', null, el('span', { class: 'badge ' + (r.segment === 'watchlist' ? 'wl' : 'emg'), text: r.segment === 'watchlist' ? 'watchlist' : 'emerging' })),
        el('td', { class: 'num' }, el('div', { class: 'fdvc' },
          el('span', { class: 'spark', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round(100 * r.implied_value_usd / max)) + '%' })),
          el('span', { text: fmtUsd(r.implied_value_usd) }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: fmtPct(g) }),
        el('td', { class: 'num mlt' }, el('span', null, fmtMult(r.peer_multiple), el('small', { text: ' ' + r.category_comps + 'c' }))),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: String(r.chains.length) }),
        el('td', { class: 'num' }, el('div', { class: 'conv' },
          el('span', { class: 'cg', 'aria-hidden': 'true' }, el('i', { style: 'width:' + r.conviction_score + '%' })),
          el('b', { text: String(r.conviction_score) })))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'twrap' },
        el('table', { id: 'bm' },
          el('caption', { class: 'cap' },
            el('b', null, 'THE RADAR \u2014 ', String(DATA.kpis.board)), ' pre-token protocols ranked by implied FDV. Select a row for the valuation waterfall and its farm plan; every row records no token on DefiLlama. ', el('b', null, fmtUsd(DATA.floor_usd)), ' is the watchlist floor, never the ceiling.'),
          el('thead', null, el('tr', null,
            sortHead('rank', 'Rank', true),
            sortHead('name', 'Protocol', false),
            el('th', { scope: 'col', text: 'Segment' }),
            sortHead('implied', 'Implied FDV', true),
            sortHead('tvl', 'TVL', true),
            sortHead('growth', '7d', true),
            sortHead('mult', 'Multiple', true),
            sortHead('age', 'Age', true),
            sortHead('chains', 'Chains', true),
            sortHead('conviction', 'Conviction', true))),
          body)));
  }

  // ------------------------------------------------------------ comps + aside

  function compsTable() {
    var body = el('tbody');
    DATA.live.forEach(function (r, i) {
      var g = r.change_7d, gc = g === null ? '' : g >= 0 ? 'pos' : 'neg';
      body.appendChild(el('tr', null,
        el('td', { class: 'num rk', text: String(i + 1).padStart(3, '0') }),
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'pc', text: r.category + ' \u00b7 ' + r.chains.slice(0, 3).join(' / ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num mlt', text: fmtMult(r.multiple) }),
        el('td', { class: 'num ' + gc, text: fmtPct(g) }),
        el('td', null, el('span', { class: 'badge mut', text: 'token trades' }))));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'twrap' },
        el('table', { id: 'cm' },
          el('caption', { class: 'cap' },
            el('b', null, 'TOKENIZED COMPS \u2014 THE MODEL\u2019S EVIDENCE. '), 'These ' + DATA.kpis.live_count + ' protocols already trade, so their market cap is a fact, not a model. They never enter the ranking. Their FDV/TVL ratios \u2014 winsorized to [' + M.ratio_floor + ', ' + M.ratio_cap + '] \u2014 are the per-category medians the board\u2019s peer multiples are calibrated from.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: '#' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'Live FDV/TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', text: 'Status' }))),
          body)));
  }

  function asideTable() {
    var body = el('tbody');
    DATA.aside.forEach(function (r) {
      var g = r.change_7d, gc = g === null ? '' : g >= 0 ? 'pos' : 'neg';
      body.appendChild(el('tr', null,
        el('td', null, el('div', { class: 'pname' }, el('b', { text: r.name }), el('span', { class: 'pc', text: r.category + ' \u00b7 ' + r.chains.slice(0, 3).join(' / ') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + gc, text: fmtPct(g) }),
        el('td', null, el('span', { class: 'badge rd', text: 'set aside' })),
        el('td', { class: 'why', text: r.reason })));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'twrap' },
        el('table', { id: 'am' },
          el('caption', { class: 'cap' },
            el('b', null, 'SET ASIDE \u2014 FLAGGED, NEVER RANKED. '), 'Pre-token protocols the product screens keep off the board: bridged, staked, wrapped or custodial products of tokens that may already trade, versioned pools, exchange fronts, and pre-token rows above the floor that the house\u2019s watchlist rule left off (typically product arms of a tokenized group). Ranking them would mislabel a product as a launch.'),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Why set aside' }))),
          body)));
  }

  // ------------------------------------------------------------ model panel

  function modelPanel() {
    var catsOnBoard = {};
    DATA.rows.forEach(function (r) { catsOnBoard[r.category] = (catsOnBoard[r.category] || 0) + 1; });
    var cal = DATA.calibration.categories
      .slice().sort(function (a, b) { return (catsOnBoard[b.category] || 0) - (catsOnBoard[a.category] || 0) || (a.category < b.category ? -1 : 1); })
      .slice(0, 12);
    var calBody = el('tbody');
    cal.forEach(function (c) {
      calBody.appendChild(el('tr', null,
        el('td', { text: c.category + (catsOnBoard[c.category] ? ' (' + catsOnBoard[c.category] + ')' : '') }),
        el('td', { class: 'num', text: String(c.comps) }),
        el('td', { class: 'num', text: c.raw_median.toFixed(2) + '\u00d7' }),
        el('td', { class: 'num mlt', text: c.peer_multiple.toFixed(2) + '\u00d7' }),
        el('td', { class: 'num', text: c.peer_low.toFixed(2) + '\u2013' + c.peer_high.toFixed(2) }),
        el('td', { class: 'num', text: c.efficiency.toFixed(2) + '\u00d7' })));
    });
    var loo = DATA.calibration.loo;
    var factors = el('tbody');
    [['peer_mult(cat)', 'median FDV/TVL of the category\u2019s tokenized comps, clamped [' + M.cat_mult_floor + ', ' + M.cat_mult_cap + '], shrunk to the ' + DATA.calibration.global_median.toFixed(3) + '\u00d7 market median by w = n/(n+' + M.shrink_comps + ')'],
     ['momentum(7d)', '1 + clamp(change_7d, ' + M.momentum_floor_pct + ', +' + M.momentum_cap_pct + ')/100 \u00d7 ' + M.momentum_weight + ' \u2014 the snapshot\u2019s own 7-day TVL print'],
     ['maturity(age)', M.maturity_floor + ' + min(age_days, ' + M.maturity_days + ')/' + M.maturity_days + ' \u00d7 ' + M.maturity_range + ' \u2014 days on DefiLlama\u2019s record with no token; unknown age takes ' + M.maturity_unknown],
     ['breadth(chains)', '1 + ' + M.breadth_step + ' \u00d7 (min(chains, ' + M.breadth_max_chains + ') \u2212 1) \u2014 multi-chain footprint'],
     ['conviction 0\u2013100', '0.35\u00d7momentum + 0.30\u00d7TVL standing + 0.15\u00d7age + 0.10\u00d7breadth + 0.10\u00d7multiple, each normalized \u2014 how hard to farm, apart from how big the prize is']
    ].forEach(function (f) {
      factors.appendChild(el('tr', null, el('td', { text: f[0] }), el('td', { class: 'why', style: 'max-width:520px', text: f[1] })));
    });
    return el('section', { class: 'grid2' },
      el('div', { class: 'card' },
        el('h3', { text: 'THE VALUE MODEL' }),
        el('p', { class: 'note' }, 'Every row is scored by the same function of the snapshot\u2019s own figures \u2014 TVL, 7-day growth, days on record with no token, chain count, and the category\u2019s comps. No protocol name is special-cased, and no row is hand-picked: the watchlist is covered because it is the floor, and the emerging rows are every pre-token protocol below it that passes the product screens.'),
        el('table', null, el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Factor' }), el('th', { scope: 'col', text: 'Definition (constants as shipped)' }))), factors)),
      el('div', { class: 'card' },
        el('h3', { text: 'CATEGORY PEER MULTIPLES' }),
        el('p', { class: 'note' }, 'Calibrated from ' + DATA.calibration.comp_count + ' tokenized comps in this snapshot (' + DATA.calibration.categories.length + ' categories). \u2018Comps\u2019 counts the category\u2019s tokenized peers; \u2018median\u2019 is their raw FDV/TVL median; \u2018multiple\u2019 is after clamping and shrinkage \u2014 the number each row\u2019s TVL is multiplied by; \u2018band\u2019 is the Q25\u2013Q75 comp multiples, the same treatment the point estimate gets, which is the range the detail view shows. \u2018Eff\u2019 is that multiple over the market median. Categories with no comps price at the market median.'),
        el('div', { class: 'loo' },
          el('div', null, el('b', { text: String(loo.comps) }), el('span', { text: 'comps in the backtest' })),
          el('div', null, el('b', { text: loo.median_miss_x.toFixed(1) + '\u00d7' }), el('span', { text: 'median leave-one-out miss' })),
          el('div', null, el('b', { text: loo.rank_corr.toFixed(2) }), el('span', { text: 'rank correlation vs market' }))),
        el('p', { class: 'note' }, 'Leave-one-out validation: each of the ' + loo.comps + ' tokenized comps is priced from its category\u2019s multiple built without itself, then compared with its actual market cap. A comp median is a coarse instrument \u2014 it lands within 2\u00d7 of the market for ' + loo.within_2x_pct + '% of comps \u2014 which is exactly why every row carries a dollar band, not a single promise.'),
        el('table', null,
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category (rows)' }), el('th', { scope: 'col', class: 'num', text: 'Comps' }), el('th', { scope: 'col', class: 'num', text: 'Median' }), el('th', { scope: 'col', class: 'num', text: 'Multiple' }), el('th', { scope: 'col', class: 'num', text: 'Band' }), el('th', { scope: 'col', class: 'num', text: 'Eff' }))),
          calBody)));
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('span', { text: 'MODEL ' + DATA.model_version + ' \u00b7 SNAPSHOT ' + DATA.snapshot_date + ' \u00b7 SOURCE: DEFILLAMA PROTOCOL INDEX (FETCHED ONCE, SEALED)' }),
      el('span', { class: 'sep', text: '|' }),
      el('span', { text: 'AN IMPLIED FDV IS THIS ENTRY\u2019S OWN MODEL CLAIM \u2014 NEVER A PROMISE, NEVER A MAKE.FUN CLAIM. A PROTOCOL ON THIS BOARD MAY STILL HAVE A TOKEN ITS DEFILLAMA RECORD DOES NOT CARRY.' }),
      el('span', { class: 'sep', text: '|' }),
      el('span', { text: 'NOT INVESTMENT ADVICE. FARM PLANS STATE COST AND TIME; THE RISK IS YOURS.' }));
  }

  // ------------------------------------------------------------ detail drawer

  function gaugeSvg(mult) {
    var lo = 0.1, hi = 3.0;
    var t = Math.max(0, Math.min(1, (Math.log10(mult) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))));
    var s = svgEl('svg', { class: 'gauge', width: 136, height: 76, viewBox: '0 0 150 84', 'aria-hidden': 'true' });
    s.appendChild(svgEl('path', { d: 'M21 72 A54 54 0 0 1 129 72', fill: 'none', stroke: '#1b2330', 'stroke-width': 9, 'stroke-linecap': 'round' }));
    s.appendChild(svgEl('path', { d: 'M21 72 A54 54 0 0 1 129 72', fill: 'none', stroke: mult >= 1 ? '#31d68f' : '#e8a63d', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': (t * 169.6).toFixed(1) + ' 200' }));
    [[0.1, '0.1'], [0.479, ''], [1, '1.0'], [3, '3.0']].forEach(function (tick) {
      var tt = (Math.log10(tick[0]) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo));
      var a = Math.PI * (1 - tt);
      var x1 = 75 + 49 * Math.cos(a), y1 = 72 - 49 * Math.sin(a);
      var x2 = 75 + 59 * Math.cos(a), y2 = 72 - 59 * Math.sin(a);
      s.appendChild(svgEl('line', { x1: x1.toFixed(1), y1: y1.toFixed(1), x2: x2.toFixed(1), y2: y2.toFixed(1), stroke: tick[0] === 0.479 ? '#e8a63d' : '#5d6c80', 'stroke-width': tick[0] === 0.479 ? 1.5 : 1 }));
    });
    var am = Math.PI * (1 - t);
    s.appendChild(svgEl('circle', { cx: (75 + 54 * Math.cos(am)).toFixed(1), cy: (72 - 54 * Math.sin(am)).toFixed(1), r: 4, fill: '#dce5f0' }));
    var label = svgEl('text', { x: 75, y: 66, 'text-anchor': 'middle', fill: '#dce5f0', 'font-family': 'monospace', 'font-size': 17, 'font-weight': 600 });
    label.textContent = mult.toFixed(2) + '\u00d7';
    s.appendChild(label);
    return s;
  }

  function waterfall(r) {
    var gm = DATA.calibration.global_median;
    var stages = [
      { cls: 'base', name: 'Market base', note: 'TVL ' + fmtUsd(r.tvl_usd) + ' \u00d7 ' + gm.toFixed(3) + '\u00d7 market median', v: r.tvl_usd * gm },
      { cls: 'cat', name: 'Category efficiency', note: fmtMult(r.category_efficiency) + ' ' + r.category + ' (' + r.category_comps + ' comp' + (r.category_comps === 1 ? '' : 's') + ', shrunk)', v: r.tvl_usd * r.peer_multiple },
      { cls: 'mom', name: '7d momentum', note: fmtMult(r.momentum_multiplier) + ' \u00b7 TVL ' + fmtPct(r.change_7d) + ' in 7 days', v: r.tvl_usd * r.peer_multiple * r.momentum_multiplier },
      { cls: 'mat', name: 'Maturity, no token', note: fmtMult(r.maturity_multiplier) + ' \u00b7 ' + fmtAge(r.age_days) + ' on record', v: r.tvl_usd * r.peer_multiple * r.momentum_multiplier * r.maturity_multiplier },
      { cls: 'fin', name: 'Implied FDV', note: fmtMult(r.breadth_multiplier) + ' breadth \u00b7 ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's'), v: r.implied_value_usd }
    ];
    var max = stages.reduce(function (m, s) { return Math.max(m, s.v); }, 1);
    return el('div', { class: 'wf' }, stages.map(function (s) {
      return el('div', { class: 'wfrow ' + s.cls },
        el('div', { class: 'wl' }, el('b', { text: s.name }), el('span', { text: s.note })),
        el('div', { class: 'wbar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(1.5, 100 * s.v / max).toFixed(1) + '%' })),
        el('div', { class: 'wv', text: fmtUsd(s.v) }));
    }));
  }

  function rangeBand(r) {
    var span = Math.max(1, r.implied_high - r.implied_low);
    var mid = Math.max(3, Math.min(97, (100 * (r.implied_value_usd - r.implied_low)) / span));
    return el('div', { class: 'vband' },
      el('div', { class: 'vband-head' },
        el('span', null, 'COMP-DISPERSION RANGE ', el('small', { text: 'Q25 ' + fmtMult(r.peer_low) + ' \u2013 Q75 ' + fmtMult(r.peer_high) + ' of the ' + r.category + ' comps' })),
        el('b', { text: fmtUsd(r.implied_low) + ' \u2013 ' + fmtUsd(r.implied_high) })),
      el('div', { class: 'vband-track', 'aria-hidden': 'true' },
        el('div', { class: 'vband-fill', style: 'width:' + mid.toFixed(1) + '%' }),
        el('i', { class: 'vband-mark', style: 'left:' + mid.toFixed(1) + '%' })));
  }

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { r = DATA.rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    writeHash();
    var again = recompute(r);
    var d = drawer;
    d.textContent = '';
    d.setAttribute('aria-hidden', 'false');
    d.appendChild(el('div', { class: 'dhead' },
      el('div', { class: 'row1' },
        el('div', null,
          el('div', { class: 'rk2', text: 'RANK ' + String(r.rank).padStart(3, '0') + ' OF ' + DATA.kpis.board + ' \u00b7 ' + fmtUsd(r.implied_value_usd) + ' IMPLIED FDV' }),
          el('h2', { text: r.name }),
          el('div', { class: 'meta', text: r.category + ' \u00b7 ' + r.chains.join(' / ') + (r.listed_at ? ' \u00b7 listed ' + r.listed_at : ' \u00b7 listing date unknown') })),
        el('button', { class: 'dclose', type: 'button', 'aria-label': 'Close detail', text: '\u00d7', onclick: closeDetail })),
      el('div', { class: 'badges' },
        el('span', { class: 'badge ' + (r.segment === 'watchlist' ? 'wl' : 'emg'), text: r.segment === 'watchlist' ? 'watchlist' : 'emerging \u00b7 below floor' }),
        el('span', { class: 'badge mut', text: 'no token recorded on DefiLlama' }),
        el('span', { class: 'badge mut', text: 'age ' + fmtAge(r.age_days) }),
        el('span', { class: 'badge mut', text: 'conviction ' + r.conviction_score + '/100' }))));

    var body = el('div', { class: 'dbody' });
    body.appendChild(el('div', { class: 'dk' },
      el('div', null, el('div', { class: 'k', text: 'TVL' }), el('div', { class: 'v', text: fmtUsd(r.tvl_usd) })),
      el('div', null, el('div', { class: 'k', text: 'IMPLIED FDV' }), el('div', { class: 'v', text: fmtUsd(r.implied_value_usd) })),
      el('div', null, el('div', { class: 'k', text: 'PEER MULTIPLE' }), el('div', { class: 'v mlt' }, el('span', { text: fmtMult(r.peer_multiple) }), el('small', { text: ' ' + r.category_comps + 'c' }))),
      el('div', null, el('div', { class: 'k', text: '7D TVL' }), el('div', { class: 'v ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }))));

    body.appendChild(el('section', { class: 'dsec' },
      el('h3', null, 'VALUATION BREAKDOWN ', el('small', { text: '\u2014 peer multiple \u00d7 TVL \u00d7 momentum \u00d7 maturity \u00d7 breadth' })),
      waterfall(r),
      rangeBand(r),
      el('p', { class: 'recheck', text: 'Recompute check: ' + fmtUsd(r.tvl_usd) + ' \u00d7 ' + r.peer_multiple + ' \u00d7 ' + r.momentum_multiplier + ' \u00d7 ' + r.maturity_multiplier + ' \u00d7 ' + r.breadth_multiplier + ' = ' + fmtUsd(again) + (again === r.implied_value_usd ? ' \u2014 the same number board.json carries.' : ' \u2014 which differs from the board: the data would be stale.') })));

    body.appendChild(el('section', { class: 'dsec' },
      el('h3', null, 'PEER MULTIPLE ', el('small', { text: '\u2014 ' + r.category + ' vs the 0.10\u20133.00\u00d7 band (log scale)' })),
      el('div', { class: 'gaugewrap' },
        gaugeSvg(r.peer_multiple),
        el('div', { class: 'gaugeinfo' },
          el('div', null, 'comps in category: ', el('b', { text: String(r.category_comps) }), ' \u00b7 market median: ', el('b', { text: fmtMult(DATA.calibration.global_median) })),
          el('div', null, 'category efficiency: ', el('b', { text: fmtMult(r.category_efficiency) }), ' vs the market\u2019s ' + DATA.calibration.comp_count + ' tokenized protocols')))));

    body.appendChild(el('section', { class: 'dsec' },
      el('h3', null, 'FARM PLAN ', el('small', { text: '\u2014 ' + r.steps.length + ' steps, sized for this protocol\u2019s TVL tier, chain and age' })),
      el('ol', { class: 'plan' }, r.steps.map(function (s) {
        return el('li', null,
          el('p', { text: s.action }),
          el('div', { class: 'tags' },
            el('span', { class: 'tag cost', text: 'cost: ' + s.cost }),
            el('span', { class: 'tag time', text: 'time: ' + s.time })));
      })),
      el('p', { class: 'recheck', text: 'This plan is generated from the protocol\u2019s own record \u2014 category, chains, TVL tier, age and 7-day growth \u2014 by the same functions that wrote board.json. A token is not predicted; the plan is what to do before one exists.' })));

    d.appendChild(body);
    d.classList.add('open');
    scrim.hidden = false;
    requestAnimationFrame(function () { scrim.classList.add('open'); });
    document.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) {
      tr.classList.toggle('sel', tr.getAttribute('data-slug') === slug);
    });
  }

  function closeDetail() {
    state.selected = null;
    writeHash();
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.classList.remove('open');
    setTimeout(function () { if (!drawer.classList.contains('open')) scrim.hidden = true; }, 220);
    document.querySelectorAll('tbody tr[data-slug]').forEach(function (tr) { tr.classList.remove('sel'); });
  }
  scrim.addEventListener('click', closeDetail);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('open')) closeDetail(); });

  // ------------------------------------------------------------ render

  /** Fill the stage (the table and, on the radar, the model cards) without touching the controls:
   *  typing in the search box keeps focus, so the board updates in place. */
  function fillStage() {
    var stage = document.getElementById('stage');
    if (!stage) return;
    stage.textContent = '';
    stage.appendChild(state.view === 'radar' ? radarTable() : state.view === 'comps' ? compsTable() : asideTable());
    if (state.view === 'radar') stage.appendChild(modelPanel());
  }

  function render() {
    app.textContent = '';
    app.setAttribute('aria-busy', 'true');
    var shell = el('div', { class: 'wrap-inner' });
    shell.appendChild(header());
    shell.appendChild(kpis());
    shell.appendChild(formulaPill());
    shell.appendChild(controls());
    var stage = el('div', { id: 'stage' });
    shell.appendChild(stage);
    shell.appendChild(footer());
    app.appendChild(shell);
    fillStage();
    app.setAttribute('aria-busy', 'false');
    if (state.selected && state.view === 'radar') openDetail(state.selected);
  }

  window.addEventListener('hashchange', function () { readHash(); render(); });

  readHash();
  render();
})();
