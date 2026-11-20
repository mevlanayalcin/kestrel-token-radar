'use strict';
// Kestrel model (kestrel-9). main.ts loads this exact file to build board.json and the page re-runs it live,
// so the code read here is the code that ranked the board. Every protocol is one unit u = {s slug, n name,
// c category, t TVL, g 7d change %, a age in days, ch chain count, l listed_at, k records a token, m mcap}.
//   Value: log FDV = ybar + b1·z(log TVL) + b2·z(pass-through), ridge on the traded comps; every other term
//          is fitted free and tested held-out twice in valueLedger().
//   Odds:  F(age) = logistic launch curve on all 758 protocols; P(token by t) = (F(a+t) − F(a)) / (1 − F(a)).
//   Farm:  two outcomes over a 24-month points-credit horizon, the season share diluted by launch timing.
const M = {
  comp_min: 5e6, winsor: [0.05, 0.95], lams: [0.01, 0.03, 0.1, 0.3], cohorts: 4, unknown_age: 365,
  odds_lams: [0.001, 0.01, 0.1], odds_m: 10, age_pad: 30, credit_months: 24, month: 30.4375,
  tiers: [1000, 10000, 50000], benchmark: 4.5, prior_cap: 180, windows: [[180, 26], [365, 20], [730, 16]],
  window_old: 12, window_undated: 16, tx_base: 4, tx_per_weeks: 4, bridge: 3, gas_default: 0.3,
  farm_apr: 4, farm_p25: 0, whale: 0.01, sleeves: 4, cat_max: 2,
};
/** Community airdrop share of supply at twelve launches (published tokenomics, approximate). */
const DROPS = [['Uniswap', 15], ['Arbitrum', 11.6], ['Optimism', 5], ['dYdX', 7.5], ['Jito', 10], ['Jupiter', 10],
  ['Ethena S1', 5], ['EigenLayer S1', 6.7], ['Hyperliquid', 31], ['ZKsync', 17.5], ['LayerZero', 8.5], ['Kamino', 7]];
/** Categories whose TVL is depositors' capital routed through someone else's strategy (fee-thin, not its own). */
const PASS = new Set(['RWA', 'Onchain Capital Allocator', 'Risk Curators', 'Yield', 'Yield Aggregator', 'CDP', 'Basis Trading',
  'Leveraged Farming', 'Collateral Management', 'Liquidity Manager', 'CeDeFi', 'Insurance', 'Collateral Markets', 'Governance Incentives',
  'Payments', 'Farm', 'Partially Algorithmic Stablecoin', 'Algo-Stables', 'Stablecoin Wrapper', 'Restaking', 'Staking Pool']);

// ---- numerics
const rd = (n, dp) => { const f = 10 ** dp; return Math.round(n * f) / f; };
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const by = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function quantile(v, q) {
  if (!v.length) return 0;
  const s = [...v].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.min(lo + 1, s.length - 1);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
function ranks(v) {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0] || a[1] - b[1]), r = new Array(v.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++; for (let t = i; t <= j; t++) r[o[t][1]] = (i + j) / 2; i = j + 1; }
  return r;
}
function spearman(a, b) {
  const x = ranks(a), y = ranks(b), m = (a.length - 1) / 2;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < a.length; i++) { sxy += (x[i] - m) * (y[i] - m); sx += (x[i] - m) ** 2; sy += (y[i] - m) ** 2; }
  return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0;
}
/** Held-out skill of predicted vs actual log mcap: R², Spearman ρ, median |log error|. */
function metrics(pred, act) {
  const mean = act.reduce((a, b) => a + b, 0) / act.length, ss = act.reduce((a, y, i) => a + (y - pred[i]) ** 2, 0), st = act.reduce((a, y) => a + (y - mean) ** 2, 0);
  return { n: act.length, r2: rd(1 - ss / st, 4), rho: rd(spearman(pred, act), 4), mae: rd(quantile(act.map((y, i) => Math.abs(y - pred[i])), 0.5), 4) };
}
function solve(A, b) {
  const n = b.length, X = A.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(X[r][c]) > Math.abs(X[p][c])) p = r;
    [X[c], X[p]] = [X[p], X[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const f = X[r][c] / X[c][c]; for (let t = c; t <= n; t++) X[r][t] -= f * X[c][t]; }
  }
  return X.map((r, i) => r[n] / r[i]);
}
function scaler(X, idx) {
  const k = X[0].length, n = idx.length, mu = new Array(k).fill(0), sd = new Array(k).fill(0);
  for (const i of idx) for (let j = 0; j < k; j++) mu[j] += X[i][j] / n;
  for (const i of idx) for (let j = 0; j < k; j++) sd[j] += (X[i][j] - mu[j]) ** 2 / n;
  return { mu, sd: sd.map((s) => Math.sqrt(s) || 1) };
}
const lin = (m, x, c0) => x.reduce((a, v, j) => a + m.beta[j] * ((v - m.mu[j]) / m.sd[j]), c0);

/** Ridge of y on X over rows idx (penalty lam·n per standardized column); huber > 0: Huber M-estimate, 8 passes. */
function ridge(X, y, idx, lam, huber = 0) {
  const { mu, sd } = scaler(X, idx), k = mu.length, n = idx.length;
  const fit = (yy) => {
    const ybar = idx.reduce((a, i) => a + yy[i], 0) / n, A = mu.map(() => new Array(k).fill(0)), b = new Array(k).fill(0);
    for (const i of idx) { const z = X[i].map((v, j) => (v - mu[j]) / sd[j]); for (let a = 0; a < k; a++) { b[a] += z[a] * (yy[i] - ybar); for (let c = 0; c < k; c++) A[a][c] += z[a] * z[c]; } }
    for (let a = 0; a < k; a++) A[a][a] += lam * n;
    return { mu, sd, beta: solve(A, b), ybar };
  };
  let m = fit(y);
  for (let it = 0; huber > 0 && it < 8; it++) {
    const r = idx.map((i) => y[i] - lin(m, X[i], m.ybar)), s = (huber * quantile(r.map(Math.abs), 0.5)) / 0.6745 || 1, ys = y.slice();
    idx.forEach((i, a) => { ys[i] = y[i] - r[a] + clamp(r[a], -s, s); });
    m = fit(ys);
  }
  return m;
}

// ---- value model
const isPass = (cat) => (PASS.has(cat) ? 1 : 0);
/** The shipped design: log TVL and the pass-through family. */
const core = (u) => [rd(Math.log(u.t), 4), isPass(u.c)];
/** Traded comps: a recorded token with mcap and TVL both >= $5M, in slug order. */
const compsOf = (U) => U.filter((u) => u.m !== null && u.m >= M.comp_min && u.t >= M.comp_min).sort((a, b) => by(a.s, b.s));
/** Walk-forward cohorts by listed_at; undated rows train in every fold, test in none. */
function cohorts(rows) {
  const idx = rows.map((_, i) => i), dated = idx.filter((i) => rows[i].l !== null).sort((a, b) => by(rows[a].l, rows[b].l) || a - b), C = M.cohorts;
  return { undated: idx.filter((i) => rows[i].l === null), chunks: [...Array(C).keys()].map((q) => dated.slice(Math.floor((q * dated.length) / C), Math.floor(((q + 1) * dated.length) / C))) };
}

/** Both held-out tests of one design; λ is picked by LOO on the training rows only, so every fold re-picks it. */
function heldOut(comps, X, o = {}) {
  const Y = comps.map((c) => Math.log(c.m)), lo = quantile(Y, M.winsor[0]), hi = quantile(Y, M.winsor[1]);
  const Yw = o.raw ? Y : Y.map((y) => clamp(y, lo, hi)), all = comps.map((_, i) => i), hub = o.huber || 0;
  const loo = (tr, lam) => tr.map((i) => { const m = ridge(X, Yw, tr.filter((j) => j !== i), lam, hub); return lin(m, X[i], m.ybar); });
  const pick = (tr) => { let b = M.lams[0], br = -Infinity; for (const l of M.lams) { const r = metrics(loo(tr, l), tr.map((i) => Y[i])).r2; if (r > br) { br = r; b = l; } } return b; };
  const lam = pick(all), pred = loo(all, lam), { undated, chunks } = cohorts(comps), folds = [], wp = [], wa = [];
  for (let f = 1; f < chunks.length; f++) {
    const tr = [...undated, ...chunks.slice(0, f).flat()].sort((a, b) => a - b), te = chunks[f], l = pick(tr), m = ridge(X, Yw, tr, l, hub);
    const p = te.map((i) => lin(m, X[i], m.ybar)), a = te.map((i) => Y[i]);
    wp.push(...p); wa.push(...a);
    folds.push({ from: comps[te[0]].l, to: comps[te.at(-1)].l, train: tr.length, test: te.length, m: metrics(p, a) });
  }
  const out = { lam, pred, Y, Yw, loo: metrics(pred, Y), wf: { folds, pooled: metrics(wp, wa) } };
  return out;
}

/** Candidate value terms, each fitted free (no sign box). Age terms carry an undated flag so the 365-day stand-in cannot carry the fit. */
function ledgerTerms(U) {
  const med = {};
  for (const u of U) (med[u.c] ??= []).push(u.g ?? 0);
  const all = quantile(U.map((u) => u.g ?? 0), 0.5), cm = (c) => (med[c].length >= 5 ? quantile(med[c], 0.5) : all);
  const g = (u) => u.g ?? 0, und = (u) => (u.a === null ? 1 : 0), A = (u) => u.a ?? M.unknown_age, ex = (u) => g(u) - cm(u.c);
  const T = (group, name, add, o = {}) => ({ group, name, add, ...o });
  return [
    T('core', 'drop log TVL', null, { only: (u) => [isPass(u.c)] }),
    T('core', 'drop pass-through', null, { only: (u) => [rd(Math.log(u.t), 4)] }),
    T('7d growth', 'clamp ±30%', (u) => [clamp(g(u), -30, 30) / 100]),
      T('7d growth', 'excess vs category median', (u) => [clamp(ex(u), -30, 30) / 100]),
    T('7d growth', 'asinh(chg / 10)', (u) => [Math.asinh(g(u) / 10)]),
    T('7d growth', 'log(1 + chg)', (u) => [Math.log(1 + clamp(g(u), -90, 300) / 100)]),
    T('7d growth', 'clamp ±15%, Huber loss', (u) => [clamp(g(u), -15, 15) / 100], { huber: 1.345 }),
    T('age', 'log(1 + age/1y) + undated flag', (u) => [Math.log(1 + A(u) / 365), und(u)]),
    T('age', '1 − e^(−age/1y) + undated flag', (u) => [1 - Math.exp(-A(u) / 365), und(u)]),
    T('age', 'listed < 2y + undated flag', (u) => [u.a !== null && u.a < 730 ? 1 : 0, und(u)]),
      T('footprint', 'multi-chain (chains > 1)', (u) => [u.ch > 1 ? 1 : 0]),
      T('size', '(log TVL)² curvature', (u) => [(Math.log(u.t) - 18) ** 2]),
    T('size', 'own-fee / pass elasticities', null, { only: (u) => [rd(Math.log(u.t), 4) * (1 - isPass(u.c)), rd(Math.log(u.t), 4) * isPass(u.c), isPass(u.c)] }),
    T('loss', 'Huber loss on the core', null, { huber: 1.345 }),
    T('loss', 'no target winsorizing', null, { raw: true }),
  ];
}
/** Each term held-out twice against the core: it ships only if LOO R² AND walk-forward ρ rise and its sign matches its rank correlation with the core residuals. */
function valueLedger(U, comps, base, coreFit) {
  const resid = base.Y.map((y, i) => y - lin(coreFit, comps[i].x, coreFit.ybar));
  return ledgerTerms(U).map((t) => {
    const X = comps.map((c) => (t.only ? t.only(c.u) : t.add ? [...c.x, ...t.add(c.u)] : c.x)), h = heldOut(comps, X, t);
    const m = ridge(X, h.Yw, comps.map((_, i) => i), h.lam, t.huber), j = t.add ? 2 : -1;
    const beta = j >= 0 ? rd(m.beta[j] / m.sd[j], 3) : null, rc = j >= 0 ? rd(spearman(resid, X.map((x) => x[j])), 3) : null;
    const gain = h.loo.r2 > base.loo.r2 && h.wf.pooled.rho > base.wf.pooled.rho, signOk = j < 0 || Math.sign(beta) === Math.sign(rc);
    const kept = t.group === 'core' ? !gain : gain && signOk;
    const why = t.group === 'core' ? (kept ? 'needed' : 'drop it') : kept ? 'ships' : !gain ? 'no gain' : 'outlier sign';
    return { group: t.group, name: t.name, beta, rc, r2: h.loo.r2, wf: h.wf.pooled.rho, kept, why };
  });
}

/** The value model on U's comps, tested blind (LOO and walk-forward), with its ledger. */
function fitValue(U, o = {}) {
  const comps = compsOf(U).map((u) => ({ u, s: u.s, n: u.n, c: u.c, t: u.t, m: u.m, l: u.l, x: core(u) }));
  const X = comps.map((c) => c.x), h = heldOut(comps, X), m = ridge(X, h.Yw, comps.map((_, i) => i), h.lam);
  const fit = { n: comps.length, lam: h.lam, mu: m.mu.map((v) => rd(v, 6)), sd: m.sd.map((v) => rd(v, 6)), beta: m.beta.map((v) => rd(v, 6)), ybar: rd(m.ybar, 6) };
  const resid = h.pred.map((p, i) => h.Y[i] - p);
  return {
    ...fit, elasticity: rd(fit.beta[0] / fit.sd[0], 4), pass_mult: rd(Math.exp(fit.beta[1] / fit.sd[1]), 4),
    loo: h.loo, wf: h.wf, band: [rd(quantile(resid, 0.25), 4), rd(quantile(resid, 0.75), 4)],
    points: comps.map((c, i) => [c.n, c.t, c.m, Math.round(Math.exp(h.pred[i]))]),
    ledger: o.ledger === false ? [] : valueLedger(U, comps, h, m),
  };
}
/** Implied FDV if a token launches: exp(ybar + Σ β·z(x)), from the shipped (rounded) coefficients. */
const implied = (F, u) => Math.max(1, Math.round(Math.exp(lin(F, core(u), F.ybar))));

// ---- launch odds: the 758-peer launch curve
const sigmoid = (t) => 1 / (1 + Math.exp(-t));
/** L2 logistic regression by Newton steps (intercept free), optionally warm-started. */
function logit(X, y, idx, lam, warm) {
  const { mu, sd } = scaler(X, idx), K = mu.length + 1, n = idx.length;
  let th = warm ? [warm.b0, ...warm.beta] : new Array(K).fill(0);
  const Z = idx.map((i) => [1, ...X[i].map((v, j) => (v - mu[j]) / sd[j])]);
  for (let it = 0; it < 30; it++) {
    const g = new Array(K).fill(0), H = th.map(() => new Array(K).fill(0));
    for (let a = 0; a < n; a++) {
      const z = Z[a], p = sigmoid(z.reduce((s, v, j) => s + v * th[j], 0)), w = Math.max(p * (1 - p), 1e-9), r = y[idx[a]] - p;
      for (let u = 0; u < K; u++) { g[u] += r * z[u]; for (let v = u; v < K; v++) H[u][v] += w * z[u] * z[v]; }
    }
    for (let u = 0; u < K; u++) for (let v = 0; v < u; v++) H[u][v] = H[v][u];
    for (let u = 1; u < K; u++) { g[u] -= lam * n * th[u]; H[u][u] += lam * n; }
    const step = solve(H, g);
    th = th.map((v, j) => v + step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return { mu, sd, b0: th[0], beta: th.slice(1) };
}
/** Held-out probability skill: Brier (and the base rate's), log-loss, ROC-AUC, Brier skill. */
function probMetrics(p, y, base) {
  const n = y.length, brier = p.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / n, bb = base.reduce((a, v, i) => a + (v - y[i]) ** 2, 0) / n;
  const ll = -p.reduce((a, v, i) => a + Math.log(clamp(y[i] ? v : 1 - v, 1e-6, 1)), 0) / n, r = ranks(p), pos = y.reduce((a, v) => a + v, 0);
  const auc = pos > 0 && pos < n ? (r.reduce((a, v, i) => a + (y[i] ? v + 1 : 0), 0) - (pos * (pos + 1)) / 2) / (pos * (n - pos)) : 0.5;
  return { n, brier: rd(brier, 4), logloss: rd(ll, 4), auc: rd(auc, 4), base_brier: rd(bb, 4), bss: rd(1 - brier / bb, 4) };
}
/** One protocol's raw launch-curve columns at age a (days); cat = its category's empirical-Bayes logit. */
function oddsRow(terms, u, a, undated, cat) {
  const col = { 'log age': rd(Math.log((a + M.age_pad) / 365), 6), undated: undated ? 1 : 0, 'category rate': rd(cat, 6), 'log TVL': rd(Math.log(u.t), 4),
    'log chains': rd(Math.log(Math.max(1, u.ch)), 4), '7d growth': clamp(u.g ?? 0, -30, 30) / 100 };
  return terms.map((t) => col[t]);
}

/**
 * Launch curve on all of U (y = records a token), tested blind by exact LOO refits and by walk-forward on listing
 * date (penalty re-picked per fold). search: a term enters only if BOTH held-out log-losses drop (7d growth also
 * needs sign >= 0); otherwise the given terms and lam are re-run.
 */
function fitOdds(U0, o = {}) {
  const U = [...U0].sort((a, b) => by(a.s, b.s)), y = U.map((u) => u.k), cats = U.map((u) => u.c), all = U.map((_, i) => i);
  const eb = (tr) => {
    const n = {}, k = {}; let K = 0;
    for (const i of tr) { n[cats[i]] = (n[cats[i]] || 0) + 1; k[cats[i]] = (k[cats[i]] || 0) + y[i]; K += y[i]; }
    const pbar = K / tr.length;
    return (c, self) => { const r = ((k[c] || 0) - (self >= 0 ? self : 0) + M.odds_m * pbar) / ((n[c] || 0) - (self >= 0 ? 1 : 0) + M.odds_m); return Math.log(r / (1 - r)); };
  };
  const base = {}, matrix = (terms, tr) => {
    const key = terms.join('|'); base[key] ??= U.map((u) => oddsRow(terms, u, u.a ?? M.unknown_age, u.a === null, 0));
    const ci = terms.indexOf('category rate'); if (ci < 0) return base[key];
    const e = eb(tr), inT = new Uint8Array(U.length); for (const i of tr) inT[i] = 1;
    return base[key].map((r, i) => { const s = r.slice(); s[ci] = rd(e(cats[i], inT[i] ? y[i] : -1), 6); return s; });
  };
  const loo = (terms, tr, lam) => {
    const Xt = matrix(terms, tr), full = logit(Xt, y, tr, lam), cat = terms.includes('category rate');
    return tr.map((i) => { const rest = tr.filter((j) => j !== i), X = cat ? matrix(terms, rest) : Xt, m = logit(X, y, rest, lam, full); return sigmoid(lin(m, X[i], m.b0)); });
  };
  const ll = (p, idx) => probMetrics(p, idx.map((i) => y[i]), idx.map(() => 0.5)).logloss;
  const pick = (terms, tr, lams) => { let b = null; for (const lam of lams) { const p = loo(terms, tr, lam), l = ll(p, tr); if (!b || l < b.l) b = { lam, p, l }; } return b; };
  const rate = (idx) => idx.reduce((a, i) => a + y[i], 0) / idx.length, { undated, chunks } = cohorts(U);
  const walk = (terms) => {
    const folds = [], wp = [], wy = [], wb = [];
    for (let f = 1; f < chunks.length; f++) {
      const tr = [...undated, ...chunks.slice(0, f).flat()].sort((a, b) => a - b), te = chunks[f], { lam } = pick(terms, tr, M.odds_lams), X = matrix(terms, tr), m = logit(X, y, tr, lam);
      const p = te.map((i) => sigmoid(lin(m, X[i], m.b0))), b = te.map(() => rate(tr));
      wp.push(...p); wy.push(...te.map((i) => y[i])); wb.push(...b);
      folds.push({ from: U[te[0]].l, to: U[te.at(-1)].l, train: tr.length, test: te.length, m: probMetrics(p, te.map((i) => y[i]), b) });
    }
    return { folds, pooled: probMetrics(wp, wy, wb) };
  };
  const looBase = all.map((i) => (rate(all) * all.length - y[i]) / (all.length - 1));
  const score = (terms, lams, wf = true) => { const s = pick(terms, all, lams); return { terms, lam: s.lam, p: s.p, loo: probMetrics(s.p, y, looBase), wf: wf ? walk(terms) : null }; };
  let cur, designs = [];
  if (o.search) {
    cur = score(['log age', 'undated'], M.odds_lams);
    designs.push({ name: 'log age + undated flag', loo: cur.loo, wf: cur.wf.pooled, lam: cur.lam });
    for (const t of ['category rate', 'log TVL', 'log chains', '7d growth']) {
      const s = score([...cur.terms, t], M.odds_lams), b = logit(matrix(s.terms, all), y, all, s.lam).beta.at(-1);
      const skill = s.loo.logloss < cur.loo.logloss && s.wf.pooled.logloss < cur.wf.pooled.logloss, keep = skill && (t !== '7d growth' || b >= 0);
      designs.push({ name: `+ ${t}${keep ? '' : skill ? ' (sign < 0, refused)' : ' (no held-out gain)'}`, loo: s.loo, wf: s.wf.pooled, lam: s.lam });
      if (keep) cur = s;
    }
  } else cur = score(o.terms, [o.lam], false);
  const X = matrix(cur.terms, all), m = logit(X, y, all, cur.lam), e = eb(all), order = all.slice().sort((a, b) => cur.p[a] - cur.p[b] || a - b);
  return {
    n: U.length, n_token: y.reduce((a, v) => a + v, 0), terms: cur.terms, lam: cur.lam, m: M.odds_m,
    mu: m.mu.map((v) => rd(v, 6)), sd: m.sd.map((v) => rd(v, 6)), beta: m.beta.map((v) => rd(v, 6)), b0: rd(m.b0, 6),
    cat_logit: Object.fromEntries([...new Set(cats)].sort(by).map((c) => [c, rd(e(c, -1), 6)])), prior_logit: rd(e('\u0000', -1), 6),
    loo: cur.loo, wf: cur.wf, designs,
    calib: [0, 1, 2, 3, 4].map((q) => { const b = order.slice(Math.floor((q * order.length) / 5), Math.floor(((q + 1) * order.length) / 5)); return { pred: rd(b.reduce((a, i) => a + cur.p[i], 0) / b.length, 4), obs: rd(rate(b), 4), n: b.length }; }),
    loo_p: Object.fromEntries(U.map((u, i) => [u.s, rd(cur.p[i], 4)])),
  };
}

/** Farm window in weeks from how long the protocol has run with no token. */
function windowWeeks(age) {
  if (age === null) return M.window_undated;
  for (const [cap, w] of M.windows) if (age < cap) return w;
  return M.window_old;
}
/**
 * The campaign over the credit horizon: p_m = odds the token ships in month m given none yet; a D-day deposit
 * in a season begun `prior` days ago earns min(D, t) / (prior + t) of the points if it ships at t. ss = Σ p_m · that.
 */
function campaign(O, u) {
  const a = u.a ?? M.unknown_age, cat = O.cat_logit[u.c] ?? O.prior_logit, weeks = windowWeeks(u.a), D = weeks * 7, prior = Math.min(u.a ?? M.prior_cap, M.prior_cap);
  const F = (t) => sigmoid(lin(O, oddsRow(O.terms, u, a + t, u.a === null, cat), O.b0)), f0 = F(0);
  let prev = f0, cum = 0, share = 0, p12 = 0;
  for (let k = 1; k <= M.credit_months; k++) {
    const f = F(M.month * k), p = (f - prev) / Math.max(1e-9, 1 - f0), t = M.month * (k - 0.5);
    cum += p; share += (p * Math.min(D, t)) / (prior + t); prev = f;
    if (k === 12) p12 = cum;
  }
  return { fa: rd(f0, 4), p12: rd(clamp(p12, 0, 1), 4), p24: rd(clamp(cum, 0, 1), 4), ss: rd(share, 6), weeks };
}

// ---- the two-outcome farm planner
const dropQ = () => [0.25, 0.5, 0.75].map((q) => rd(quantile(DROPS.map((d) => d[1]), q), 2));
/**
 * One deposit, two outcomes. A (p24): a token ships in the credit horizon, the drop pays ev_if. B: no drop. Gas,
 * bridge and carry (benchmark + premium − base APY) are paid either way. FARM: blended p50 >= 4%/yr, p25 >= 0.
 */
function farmTier(f, deposit) {
  const dq = dropQ(), days = f.weeks * 7, per = (q) => ((dq[q] / 100) * f.share * f.fdv[q] * f.ss) / f.tvl;
  const txs = M.tx_base + Math.ceil(f.weeks / M.tx_per_weeks), gas = rd(txs * f.gas_tx, 2), carryRate = ((M.benchmark + f.prem - f.apy) / 100) * (days / 365);
  const carry = rd(deposit * carryRate, 2), cost = gas + f.bridge + carry, ann = (n) => rd((((100 * n) / deposit) * 365) / days, 2);
  const ev = [0, 1, 2].map((q) => rd(deposit * per(q), 2)), ev_if = [0, 1, 2].map((q) => rd((deposit * per(q)) / Math.max(1e-9, f.p24), 2));
  const net = ev.map((e) => rd(e - cost, 2)), net_if = ev_if.map((e) => rd(e - cost, 2)), net_none = rd(-cost, 2), apr = net.map(ann), edge = per(1) - carryRate;
  const verdict = apr[1] >= M.farm_apr && apr[0] >= M.farm_p25 ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP';
  return { deposit, txs, gas, bridge: f.bridge, carry, ev, ev_if, net, net_if, net_none, roi: net.map((n) => rd((100 * n) / deposit, 2)), apr, apr_if: net_if.map(ann), apr_none: ann(net_none),
    breakeven: edge > 0 ? Math.ceil((gas + f.bridge) / edge) : null, verdict, whale: deposit > M.whale * f.tvl };
}
/** Equal sleeves filled greedily by sleeve-size blended p50 APR among FARM rows: one per home chain, <= 2 per category. */
function basket(rows, total) {
  const sl = total / M.sleeves, c = rows.map((r, i) => ({ r, i, t: farmTier(r.f, sl) })).filter((x) => x.t.verdict === 'FARM').sort((a, b) => b.t.apr[1] - a.t.apr[1] || a.i - b.i);
  const p = [], ch = new Set(), ca = {};
  for (const x of c) {
    if (p.length >= M.sleeves) break;
    if (ch.has(x.r.f.chain) || (ca[x.r.cat] || 0) >= M.cat_max) continue;
    ch.add(x.r.f.chain); ca[x.r.cat] = (ca[x.r.cat] || 0) + 1; p.push(x);
  }
  const sum = (g) => rd(p.reduce((a, x) => a + g(x.t), 0), 2);
  return { slugs: p.map((x) => x.r.slug), picks: p, sleeve: sl, net: sum((t) => t.net[1]), p25: sum((t) => t.net[0]), costs: sum((t) => t.gas + t.bridge), carry: sum((t) => t.carry),
    apr: p.length ? rd(p.reduce((a, x) => a + x.t.apr[1], 0) / p.length, 2) : 0, any: rd(1 - p.reduce((a, x) => a * (1 - x.r.f.p24), 1), 4) };
}

const KM = { M, DROPS, PASS, rd, clamp, isPass, core, compsOf, fitValue, implied, fitOdds, campaign, dropQ, farmTier, basket };
if (typeof module === 'object') module.exports = KM;
