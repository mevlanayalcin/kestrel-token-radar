// Kestrel Token Radar: the fitted valuation model, the launch-odds model, the two-outcome farm planner
// and the board builder (kestrel-8, v7).
//
// One sealed snapshot in, one ranked board out. Every number derives from the snapshot's ten fields;
// no protocol name is special-cased anywhere.
//
// VALUE MODEL (fitted on the snapshot's own 87 traded comps: a token with mcap >= $5M and TVL >= $5M)
//
//   log(FDV) = ybar + b1*z(log tvl) + b2*z(pass-through) + k*clamp(chg7d, +-30%) + log(1 - d*exp(-age/T))
//
// - log tvl        the size term; the fitted elasticity is the page's "x per 10x TVL".
// - pass-through   1 when the category's TVL is depositors' capital routed to someone else's strategy
//                  (vault curators, capital allocators, RWA wrappers, CDPs, yield, basis): a fee-thin
//                  business whose TVL is not its own. Chosen by the feature search below (it is the
//                  only candidate that raises leave-one-out R2); the family map is a stated economic
//                  grouping of DefiLlama categories, not a list of names.
// - record terms   7-day growth (k) and seasoning (d, T). The comps cannot identify them: their 7-day
//                  window runs -100%..+3% and their age is time since listing, not time with no token,
//                  so a free fit puts both slightly negative. They are therefore SIGN-CONSTRAINED: k
//                  and d live in a box whose floors are the economic priors (k >= 0.25, d >= 0.15), and
//                  the point inside the box is chosen by leave-one-out R2 together with the ridge
//                  penalty. A rising TVL always raises a value, a falling one always lowers it, and
//                  older no-token TVL is never priced below brand-new TVL.
// - fit            ridge on standardized columns, intercept by centering, target log(mcap) winsorized
//                  p5-p95 for the fit only; every metric is measured on the actual log(mcap).
// - validation     LOO (87 blind refits); strict nested LOO (penalty AND record box re-selected inside
//                  each of the 87 folds); temporal walk-forward (4 listed_at cohorts, train on older,
//                  predict newer, selection re-run per fold); baselines under the same LOO pass.
// - v6/v7 search   15 designs (interaction and split elasticities, a 3-family taxonomy, category / chain
//                  FE, chain footprint, category share and rank, Huber loss, log TVL squared, the category token rate
//                  of all 758 peers) each run this whole protocol
//                  with their own (lam, k, d). A design ships only if it beats the kept one on LOO R2 and
//                  walk-forward rho together; none does, so kestrel-8 keeps the v5 two-feature core.
//
// LAUNCH ODDS (fitted on all 758 protocols: 416 record a token, 342 do not)
//
//   F(a) = sigmoid(b0 + b*z(log age) + b*z(undated) + b*z(category rate) + b*z(log TVL))
//   P(token within 365 days | none at age a) = (F(a + 365) - F(a)) / (1 - F(a))
//
// F is the cumulative launch curve read off the cross-section (the share of look-alike protocols
// that carry a token by age a); category rate is the empirical-Bayes logit of the category's token
// share, encoded out-of-fold. L2 logistic, penalty chosen by exact LOO log-loss. Validated blind
// twice: 758 exact LOO refits (Brier, log-loss, ROC-AUC, calibration by quintile) and walk-forward
// by listing date with the penalty re-selected per fold. Terms enter by forward search only if they
// lower both held-out log-losses; 7-day growth must also enter with a non-negative sign.
//
// FARM PLANNER (two outcomes, deposit-sized, recomputed live by the page for $1k / $10k / $50k)
//
//   EV_q  = deposit/TVL x drop_q x route_share x FDV_q x time_share          (q = p25 / p50 / p75)
//   A (P):     net_if = EV_q - costs            B (1 - P):  net_none = -costs
//   blended net_q = P x EV_q - costs,  costs = gas + bridge + deposit x (benchmark + premium - base APY) x weeks/52
//
// The deposit sits in the protocol's own yield product, so its base APY offsets the carry of locked
// capital either way. drop_q are the p25/p50/p75 community-drop shares of twelve documented
// launches; route_share is the part of a drop the deposit route earns (0.75 deposit products, 0.4
// trading venues); time_share is the part of the points season the deposit is present for. FARM
// needs a blended p50 net APR of 4%+ (already above the 4.5% benchmark and the route's risk premium)
// with a p25 that does not lose; THIN is any positive blended p50; SKIP is the rest. Every figure is
// the model's claim, never a promise.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'kestrel-8';

/** Every constant the model and the planner use; data.js ships them and the page recomputes from them. */
export const MODEL = {
  comp_min_usd: 5_000_000,
  winsor: [0.05, 0.95] as [number, number],
  lam_grid: [0.01, 0.03, 0.1, 0.3],
  growth_cap_pct: 30,
  k_grid: [0.25, 0.5, 0.75, 1],
  d_grid: [0.15, 0.25, 0.35, 0.5],
  season_days: 180,
  unknown_age_days: 365,
  wf_cohorts: 4,
  // ---- planner
  tiers: [1000, 10000, 50000],
  benchmark_apy: 4.5,
  prior_season_cap_days: 180,
  horizon_weeks: [[180, 26], [365, 20], [730, 16]] as [number, number][],
  horizon_default_weeks: 12,
  horizon_unknown_weeks: 16,
  tx_base: 4,
  tx_per_weeks: 4,
  bridge_usd: 3,
  gas_default_usd: 0.3,
  farm_apr: 4,
  farm_p25_apr: 0,
  whale_tvl_share: 0.01,
  basket_n: 4,
  basket_cat_max: 2,
  // ---- launch odds
  odds_horizon_days: 365,
  odds_lam_grid: [0.001, 0.01, 0.1],
  odds_m: 10,
  odds_age_pad_days: 30,
};
export type ModelConstants = typeof MODEL;

/** Community airdrop share of total supply at twelve launches (approximate, from each token's published tokenomics). */
export const REF_DROPS: [string, number][] = [
  ['Uniswap', 15], ['Arbitrum', 11.6], ['Optimism', 5], ['dYdX', 7.5], ['Jito', 10], ['Jupiter', 10],
  ['Ethena S1', 5], ['EigenLayer S1', 6.7], ['Hyperliquid', 31], ['ZKsync', 17.5], ['LayerZero', 8.5], ['Kamino', 7],
];

/** USD of one DeFi transaction (deposit/approve/claim class) on a chain; others take gas_default_usd. */
export const GAS_USD: Record<string, number> = {
  Ethereum: 2.5, Bitcoin: 2, Solana: 0.02, Base: 0.05, Arbitrum: 0.1, Optimism: 0.1, Linea: 0.1, Scroll: 0.1,
  'zkSync Era': 0.15, Mantle: 0.1, Unichain: 0.05, Ink: 0.05, 'World Chain': 0.1, Starknet: 0.1, Sonic: 0.05,
  Binance: 0.1, Avalanche: 0.15, Polygon: 0.05, Sui: 0.02, Sei: 0.05, Aptos: 0.02, Flare: 0.05, Algorand: 0.01,
  Stellar: 0.01, Monad: 0.05, 'Hyperliquid L1': 0.05, Plasma: 0.05, Berachain: 0.1, Tron: 1, Ripple: 0.01, TON: 0.05,
};

/** Categories whose TVL is depositors' capital routed through someone else's strategy. */
export const PASS_THROUGH = new Set([
  'RWA', 'Onchain Capital Allocator', 'Risk Curators', 'Yield', 'Yield Aggregator', 'CDP', 'Basis Trading',
  'Leveraged Farming', 'Collateral Management', 'Liquidity Manager', 'CeDeFi', 'Insurance', 'Collateral Markets',
  'Governance Incentives', 'Payments', 'Farm', 'Partially Algorithmic Stablecoin', 'Algo-Stables', 'Stablecoin Wrapper',
  'Restaking', 'Staking Pool',
]);

// ---------------------------------------------------------------- basics

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
export const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };
const byStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
export const categoryOf = (p: { category: string | null }): string => p.category ?? 'Uncategorized';

/** Whole days from `listed_at` to `as_of`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const l = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(l)) return null;
  return Math.max(0, Math.round((a - l) / DAY_MS));
}

const median = (v: number[]): number => quantile(v, 0.5);
function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, s.length - 1);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}

function ranks(v: number[]): number[] {
  const o = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const r = new Array<number>(v.length);
  for (let i = 0; i < o.length;) {
    let j = i;
    while (j + 1 < o.length && o[j + 1]![0] === o[i]![0]) j++;
    for (let t = i; t <= j; t++) r[o[t]![1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}
function spearman(a: number[], b: number[]): number {
  const x = ranks(a), y = ranks(b), n = a.length, m = (n - 1) / 2;
  let sxy = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i]! - m) * (y[i]! - m); sx += (x[i]! - m) ** 2; sy += (y[i]! - m) ** 2; }
  return sx > 0 && sy > 0 ? sxy / Math.sqrt(sx * sy) : 0;
}

/** Validation metrics of predicted vs actual log(mcap). */
export interface ValMetrics { n: number; r2: number; rho: number; med_abs_log_err: number; within2x: number }
function metrics(pred: number[], act: number[]): ValMetrics {
  const mean = act.reduce((a, b) => a + b, 0) / act.length;
  let ss = 0, st = 0;
  act.forEach((y, i) => { ss += (y - pred[i]!) ** 2; st += (y - mean) ** 2; });
  const err = act.map((y, i) => Math.abs(y - pred[i]!));
  return {
    n: act.length,
    r2: round(1 - ss / st, 4),
    rho: round(spearman(pred, act), 4),
    med_abs_log_err: round(median(err), 4),
    within2x: round(err.filter((e) => e <= Math.LN2).length / err.length, 4),
  };
}

// ---------------------------------------------------------------- ridge with sign constraints

/** A fitted ridge on standardized columns: mu/sd per column, beta per column, ybar. */
export interface Ridge { mu: number[]; sd: number[]; beta: number[]; ybar: number }

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r]![c]!) > Math.abs(M[p]![c]!)) p = r;
    [M[c], M[p]] = [M[p]!, M[c]!];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r]![c]! / M[c]![c]!;
      for (let t = c; t <= n; t++) M[r]![t]! -= f * M[c]![t]!;
    }
  }
  return M.map((r, i) => r[n]! / r[i]!);
}

/**
 * Ridge of y on the columns of X over rows `idx`, penalty lam*n per standardized column. Columns
 * flagged in `nonneg` may not go negative: an active-set pass drops a violating column and refits.
 */
function ridge(X: number[][], y: number[], idx: number[], lam: number, nonneg: boolean[]): Ridge {
  const k = X[0]!.length, n = idx.length;
  const mu = new Array<number>(k).fill(0), sd = new Array<number>(k).fill(0);
  for (const i of idx) for (let j = 0; j < k; j++) mu[j]! += X[i]![j]! / n;
  for (const i of idx) for (let j = 0; j < k; j++) sd[j]! += (X[i]![j]! - mu[j]!) ** 2 / n;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]!) || 1;
  const ybar = idx.reduce((a, i) => a + y[i]!, 0) / n;
  let active = [...Array(k).keys()];
  let beta = new Array<number>(k).fill(0);
  for (let pass = 0; pass <= k; pass++) {
    const A = active.map(() => new Array<number>(active.length).fill(0));
    const b = new Array<number>(active.length).fill(0);
    for (const i of idx) {
      const z = active.map((j) => (X[i]![j]! - mu[j]!) / sd[j]!);
      for (let a = 0; a < z.length; a++) {
        b[a]! += z[a]! * (y[i]! - ybar);
        for (let c = 0; c < z.length; c++) A[a]![c]! += z[a]! * z[c]!;
      }
    }
    for (let a = 0; a < active.length; a++) A[a]![a]! += lam * n;
    const sol = active.length > 0 ? solve(A, b) : [];
    beta = new Array<number>(k).fill(0);
    active.forEach((j, a) => { beta[j] = sol[a]!; });
    const bad = active.filter((j) => nonneg[j] && beta[j]! < 0);
    if (bad.length === 0) break;
    active = active.filter((j) => !bad.includes(j));
  }
  return { mu, sd, beta, ybar };
}
const predictRidge = (m: Ridge, x: number[]): number => x.reduce((a, v, j) => a + m.beta[j]! * ((v - m.mu[j]!) / m.sd[j]!), m.ybar);

/**
 * Huber M-estimate of the same ridge (c = 0 is plain squares): Huber's pseudo-observation iteration,
 * y* = fit + clip(residual, +-c*MAD/0.6745), eight passes from the squares fit.
 */
function robustRidge(X: number[][], y: number[], idx: number[], lam: number, nonneg: boolean[], c: number): Ridge {
  let m = ridge(X, y, idx, lam, nonneg);
  if (c <= 0) return m;
  for (let it = 0; it < 8; it++) {
    const r = idx.map((i) => y[i]! - predictRidge(m, X[i]!));
    const s = (c * quantile(r.map(Math.abs), 0.5)) / 0.6745 || 1;
    const ys = y.slice();
    idx.forEach((i, a) => { ys[i] = y[i]! - r[a]! + clamp(r[a]!, -s, s); });
    m = ridge(X, ys, idx, lam, nonneg);
  }
  return m;
}

// ---------------------------------------------------------------- features

/** The record terms in log space: growth k*clamped 7d change, seasoning log(1 - d*exp(-age/T)). */
export function recordLog(change7d: number | null, age: number | null, k: number, d: number, model: ModelConstants = MODEL): { growth: number; season: number } {
  const growth = (k * clamp(change7d ?? 0, -model.growth_cap_pct, model.growth_cap_pct)) / 100;
  const season = Math.log(1 - d * Math.exp(-(age ?? model.unknown_age_days) / model.season_days));
  return { growth, season };
}

const L2 = new Set(['Arbitrum', 'Base', 'Optimism', 'Linea', 'Scroll', 'zkSync Era', 'Mantle', 'Ink', 'Unichain', 'Starknet']);
/** The v6 search's 3-family taxonomy: own-fee trading/infra and credit/staking; the rest of own-fee is the base. */
const CORE_INFRA = new Set(['Dexs', 'Derivatives', 'Perpetuals', 'Options', 'Prediction Market', 'Indexes', 'Chain', 'Bridge', 'Cross Chain Bridge', 'Canonical Bridge']);
const CREDIT = new Set(['Lending', 'Uncollateralized Lending', 'Collateral Markets', 'Liquid Staking', 'Liquid Restaking', 'Restaking', 'Staking Pool']);

/** A candidate design: its columns, which columns may not go negative, and its loss (Huber c, 0 = squares). */
interface Design { name: string; f: (p: SnapshotProtocol) => number[]; nonneg: boolean[]; huber: number }

/** Candidate designs the feature search scores under the full protocol; [1] is the shipped design. */
function candidateDesigns(comps: SnapshotProtocol[], snapshot: Snapshot): Design[] {
  const cnt = new Map<string, number>();
  for (const c of comps) cnt.set(categoryOf(c), (cnt.get(categoryOf(c)) ?? 0) + 1);
  const cats = [...cnt.entries()].filter(([, n]) => n >= 6).map(([c]) => c).sort(byStr);
  const homes = ['Ethereum', 'Bitcoin', 'Binance', 'Solana'];
  const catTvl = new Map<string, number>();
  for (const p of snapshot.protocols) catTvl.set(categoryOf(p), (catTvl.get(categoryOf(p)) ?? 0) + p.tvl_usd);
  const lt = (p: SnapshotProtocol) => round(Math.log(p.tvl_usd), 4);
  const ps = (p: SnapshotProtocol) => (PASS_THROUGH.has(categoryOf(p)) ? 1 : 0);
  const lc = (p: SnapshotProtocol) => Math.log(Math.max(1, p.chains.length));
  const rankIn = (p: SnapshotProtocol) => Math.log(1 + snapshot.protocols.filter((q) => categoryOf(q) === categoryOf(p) && q.tvl_usd > p.tvl_usd).length);
  const tok = new Map<string, [number, number]>();
  for (const p of snapshot.protocols) { const t = tok.get(categoryOf(p)) ?? [0, 0]; tok.set(categoryOf(p), [t[0] + 1, t[1] + (isPreToken(p) ? 0 : 1)]); }
  const pbar = snapshot.protocols.filter((p) => !isPreToken(p)).length / snapshot.protocols.length;
  const peer = (p: SnapshotProtocol) => { const [n, k] = tok.get(categoryOf(p))!; const r = (k + 10 * pbar) / (n + 10); return Math.log(r / (1 - r)); };
  const D = (name: string, f: (p: SnapshotProtocol) => number[], nonneg: boolean[] = [true], huber = 0): Design => ({ name, f, nonneg, huber });
  return [
    D('log TVL alone', (p) => [lt(p)]),
    D('+ pass-through family (v5, kept)', (p) => [lt(p), ps(p)]),
    D('+ pass × log TVL interaction', (p) => [lt(p), ps(p), ps(p) * (lt(p) - 18)]),
    D('split own-fee / pass-through elasticity', (p) => [lt(p) * (1 - ps(p)), lt(p) * ps(p), ps(p)], [true, true]),
    D('3 families: + credit / staking', (p) => [lt(p), ps(p), CREDIT.has(categoryOf(p)) ? 1 : 0]),
    D('3 families: + core trading / infra', (p) => [lt(p), ps(p), CORE_INFRA.has(categoryOf(p)) ? 1 : 0]),
    D('+ category FE (6+ comps)', (p) => [lt(p), ps(p), ...cats.map((c) => (categoryOf(p) === c ? 1 : 0))]),
    D('+ home-chain FE (ETH/BTC/BSC/SOL/L2)', (p) => [lt(p), ps(p), ...homes.map((h) => (p.chains[0] === h ? 1 : 0)), L2.has(p.chains[0] ?? '') ? 1 : 0]),
    D('+ log(chains)', (p) => [lt(p), ps(p), lc(p)]),
    D('+ log TVL per chain', (p) => [lt(p), ps(p), lt(p) - lc(p)]),
    D('+ category TVL share', (p) => [lt(p), ps(p), Math.log(p.tvl_usd / catTvl.get(categoryOf(p))!)]),
    D('+ TVL rank inside category', (p) => [lt(p), ps(p), rankIn(p)]),
    D('v5 design, Huber loss (c 1.345)', (p) => [lt(p), ps(p)], [true], 1.345),
    D('v7: + (log TVL)² curvature', (p) => [lt(p), ps(p), (lt(p) - 18) ** 2]),
    D('v7: + category token rate (758 peers)', (p) => [lt(p), ps(p), peer(p)]),
  ];
}

// ---------------------------------------------------------------- the fit

export interface LooPoint { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; pred_usd: number; resid: number }
export interface WfFold { from: string; to: string; train_n: number; test_n: number; metrics: ValMetrics }
export interface FeatureTry { name: string; r2: number; rho: number; within2x: number; wf_r2: number; wf_rho: number; betas: number[]; chosen: boolean }
export interface ModelFit {
  equation: string;
  n_comps: number;
  feature_names: string[];
  lam: number;
  k: number;
  d: number;
  T: number;
  mu: number[];
  sd: number[];
  beta: number[];
  ybar: number;
  elasticity: number;
  pass_mult: number;
  in_sample: ValMetrics;
  loo: ValMetrics;
  nested: ValMetrics;
  nested_same: number;
  wf: { folds: WfFold[]; pooled: ValMetrics };
  resid_q: { q10: number; q25: number; q75: number; q90: number };
  loo_points: LooPoint[];
  features: FeatureTry[];
  free_growth: number;
  free_age: number;
  baselines: { name: string; metrics: ValMetrics }[];
  grid_r2: { k: number; d: number; r2: number }[];
}

/** Fit the value model on the snapshot's traded comps and validate it three ways. */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL) {
  const comps = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd >= model.comp_min_usd && p.tvl_usd >= model.comp_min_usd)
    .sort((a, b) => byStr(a.slug, b.slug));
  const design = (p: SnapshotProtocol): number[] => [round(Math.log(p.tvl_usd), 4), PASS_THROUGH.has(categoryOf(p)) ? 1 : 0];
  const age = (p: SnapshotProtocol) => ageDays(snapshot.as_of, p.listed_at);
  const X = comps.map(design);
  const Y = comps.map((c) => Math.log(c.mcap_usd!));
  const [wLo, wHi] = [quantile(Y, model.winsor[0]), quantile(Y, model.winsor[1])];
  const Yw = Y.map((y) => clamp(y, wLo, wHi));
  const nonneg = [true, false];
  const all = comps.map((_, i) => i);
  const combos: { lam: number; k: number; d: number; off: number[] }[] = [];
  for (const lam of model.lam_grid) for (const k of model.k_grid) for (const d of model.d_grid) {
    combos.push({ lam, k, d, off: comps.map((c) => { const r = recordLog(c.change_7d, age(c), k, d, model); return r.growth + r.season; }) });
  }
  type Combo = (typeof combos)[number];
  /** The whole selection-and-validation protocol for one design matrix, its sign mask and its loss. */
  const protocol = (Xd: number[][], nn: boolean[], huber: number) => {
    const fit = (yt: number[], train: number[], lam: number) => robustRidge(Xd, yt, train, lam, nn, huber);
    const looPred = (train: number[], c: Combo) => {
      const yt = Yw.map((y, i) => y - c.off[i]!);
      return train.map((i) => predictRidge(fit(yt, train.filter((j) => j !== i), c.lam), Xd[i]!) + c.off[i]!);
    };
    /** The (lam, k, d) whose LOO over `train` alone scores the best R2 on the actual log(mcap). */
    const select = (train: number[]) => {
      let best = combos[0]!, bestR2 = -Infinity;
      for (const c of combos) {
        const r2 = metrics(looPred(train, c), train.map((i) => Y[i]!)).r2;
        if (r2 > bestR2) { bestR2 = r2; best = c; }
      }
      return best;
    };
    const fitOn = (train: number[], c: Combo) => fit(Yw.map((y, i) => y - c.off[i]!), train, c.lam);
    // Walk-forward: dated comps in listed_at cohorts; undated comps train every fold, test none.
    const walk = () => {
      const folds: WfFold[] = [];
      const wp: number[] = [], wa: number[] = [];
      for (let f = 1; f < C; f++) {
        const train = [...undated, ...chunks.slice(0, f).flat()].sort((x, y) => x - y);
        const test = chunks[f]!;
        const c = select(train);
        const m = fitOn(train, c);
        const pr = test.map((i) => predictRidge(m, Xd[i]!) + c.off[i]!);
        const ac = test.map((i) => Y[i]!);
        wp.push(...pr); wa.push(...ac);
        folds.push({ from: comps[test[0]!]!.listed_at!, to: comps[test[test.length - 1]!]!.listed_at!, train_n: train.length, test_n: test.length, metrics: metrics(pr, ac) });
      }
      return { folds, pooled: metrics(wp, wa) };
    };
    return { looPred, select, fitOn, walk };
  };
  const dated = all.filter((i) => comps[i]!.listed_at !== null).sort((a, b) => byStr(comps[a]!.listed_at!, comps[b]!.listed_at!) || a - b);
  const undated = all.filter((i) => comps[i]!.listed_at === null);
  const C = model.wf_cohorts;
  const chunks = [...Array(C).keys()].map((q) => dated.slice(Math.floor((q * dated.length) / C), Math.floor(((q + 1) * dated.length) / C)));

  const P = protocol(X, nonneg, 0);
  const chosen = P.select(all);
  const full = P.fitOn(all, chosen);
  const loo = P.looPred(all, chosen);
  const resid = loo.map((p, i) => Y[i]! - p);

  // Strict nested LOO: the whole selection re-runs on the other 86 before each comp is predicted.
  let nestedSame = 0;
  const nested = all.map((i) => {
    const train = all.filter((j) => j !== i);
    const c = P.select(train);
    if (c === chosen) nestedSame++;
    return predictRidge(P.fitOn(train, c), X[i]!) + c.off[i]!;
  });
  const wf = P.walk();

  // Feature search (v6): every candidate design runs the same protocol as the shipped one, its own
  // (lam, k, d) chosen by LOO and its own walk-forward selection, so a candidate wins only on blind skill.
  const cands = candidateDesigns(comps, snapshot);
  const features: FeatureTry[] = cands.map((cand, ci) => {
    const Xc = comps.map(cand.f);
    const Q = ci === 1 ? P : protocol(Xc, Xc[0]!.map((_, j) => cand.nonneg[j] ?? false), cand.huber);
    const c = ci === 1 ? chosen : Q.select(all);
    const m = ci === 1 ? metrics(loo, Y) : metrics(Q.looPred(all, c), Y);
    const w = ci === 1 ? wf.pooled : Q.walk().pooled;
    const fm = Q.fitOn(all, c);
    return { name: cand.name, r2: m.r2, rho: m.rho, within2x: m.within2x, wf_r2: w.r2, wf_rho: w.rho, betas: fm.beta.map((b, j) => round(b / fm.sd[j]!, 4)), chosen: ci === 1 };
  });
  // Free record terms, for the page's sign check: the same ridge with no record offsets.
  const freeBeta = (extra: (p: SnapshotProtocol) => number) => {
    const Xc = comps.map((p) => [...design(p), extra(p)]);
    const m = ridge(Xc, Yw, all, chosen.lam, []);
    return round(m.beta[2]! / m.sd[2]!, 4);
  };

  // Baselines under the same LOO pass.
  const ratios = comps.map((c) => clamp(c.mcap_usd! / c.tvl_usd, 0.02, 20));
  const medAll = all.map((i) => Math.log(comps[i]!.tvl_usd * median(ratios.filter((_, j) => j !== i))));
  const catMed = all.map((i) => {
    const peers = all.filter((j) => j !== i && categoryOf(comps[j]!) === categoryOf(comps[i]!)).map((j) => ratios[j]!);
    return Math.log(comps[i]!.tvl_usd * median(peers.length > 0 ? peers : ratios));
  });
  const noRecord = all.map((i) => predictRidge(ridge(X, Yw, all.filter((j) => j !== i), chosen.lam, nonneg), X[i]!));
  const baselines = [
    { name: 'same ridge, record terms off', metrics: metrics(noRecord, Y) },
    { name: 'global median FDV/TVL multiple', metrics: metrics(medAll, Y) },
    { name: 'category median FDV/TVL multiple', metrics: metrics(catMed, Y) },
  ];
  const lamGrid = combos.filter((c) => c.lam === chosen.lam).map((c) => ({ k: c.k, d: c.d, r2: metrics(P.looPred(all, c), Y).r2 }));

  const fit: ModelFit = {
    equation: 'log FDV = ybar + b1*z(log TVL) + b2*z(pass) + k*chg7d + log(1 - d*e^(-age/T))',
    n_comps: comps.length,
    feature_names: ['log(TVL)', 'pass-through'],
    lam: chosen.lam,
    k: chosen.k,
    d: chosen.d,
    T: model.season_days,
    mu: full.mu.map((v) => round(v, 6)),
    sd: full.sd.map((v) => round(v, 6)),
    beta: full.beta.map((v) => round(v, 6)),
    ybar: round(full.ybar, 6),
    elasticity: round(full.beta[0]! / full.sd[0]!, 4),
    pass_mult: round(Math.exp(full.beta[1]! / full.sd[1]!), 4),
    in_sample: metrics(all.map((i) => predictRidge(full, X[i]!) + chosen.off[i]!), Y),
    loo: metrics(loo, Y),
    nested: metrics(nested, Y),
    nested_same: nestedSame,
    wf,
    resid_q: { q10: round(quantile(resid, 0.1), 4), q25: round(quantile(resid, 0.25), 4), q75: round(quantile(resid, 0.75), 4), q90: round(quantile(resid, 0.9), 4) },
    loo_points: comps.map((c, i) => ({ slug: c.slug, name: c.name, category: categoryOf(c), tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd!, pred_usd: Math.round(Math.exp(loo[i]!)), resid: round(resid[i]!, 4) })),
    features,
    free_growth: freeBeta((p) => clamp(p.change_7d ?? 0, -30, 30) / 100),
    free_age: freeBeta((p) => Math.log(1 + (age(p) ?? model.unknown_age_days) / 365)),
    baselines,
    grid_r2: lamGrid,
  };
  return { fit, comps, design };
}

/** A protocol's implied FDV exactly as the page recomputes it: rounded features, shipped coefficients. */
export function impliedLog(fit: ModelFit, x: number[], change7d: number | null, age: number | null, model: ModelConstants = MODEL): { base: number; growth: number; season: number; total: number } {
  const base = x.reduce((a, v, j) => a + fit.beta[j]! * ((v - fit.mu[j]!) / fit.sd[j]!), fit.ybar);
  const r = recordLog(change7d, age, fit.k, fit.d, model);
  return { base, growth: r.growth, season: r.season, total: base + r.growth + r.season };
}

// ---------------------------------------------------------------- launch odds P(token)
//
// The snapshot holds 758 protocols, 416 of which already record a token. Read as cohorts, the share
// of protocols that carry a token by age a estimates the cumulative launch curve F(a | category,
// size, footprint). A regularized logistic regression fits F on all 758; its skill is measured
// blind twice (exact leave-one-out refits, and walk-forward by listing date with the penalty
// re-selected inside each fold). A protocol still without a token at age a then launches within
// the next H days with odds
//
//   P(token) = (F(a + H) - F(a)) / (1 - F(a))
//
// the conditional of the fitted curve. Old protocols with no token, and categories that rarely
// issue one (curators, allocators), get low odds; young protocols in token-dense categories high.

/** A fitted logistic on standardized columns. */
export interface Logit { mu: number[]; sd: number[]; beta: number[]; b0: number }
const sigmoid = (t: number): number => 1 / (1 + Math.exp(-t));

/** L2-penalized logistic regression by Newton steps (intercept free), optionally warm-started. */
function logit(X: number[][], y: number[], idx: number[], lam: number, warm?: Logit): Logit {
  const k = X[0]!.length, n = idx.length;
  const mu = new Array<number>(k).fill(0), sd = new Array<number>(k).fill(0);
  for (const i of idx) for (let j = 0; j < k; j++) mu[j]! += X[i]![j]! / n;
  for (const i of idx) for (let j = 0; j < k; j++) sd[j]! += (X[i]![j]! - mu[j]!) ** 2 / n;
  for (let j = 0; j < k; j++) sd[j] = Math.sqrt(sd[j]!) || 1;
  let th = warm ? [warm.b0, ...warm.beta] : new Array<number>(k + 1).fill(0);
  const K = k + 1, Z = idx.map((i) => { const z = new Float64Array(K); z[0] = 1; for (let j = 0; j < k; j++) z[j + 1] = (X[i]![j]! - mu[j]!) / sd[j]!; return z; });
  for (let it = 0; it < 30; it++) {
    const g = new Array<number>(K).fill(0);
    const H = th.map(() => new Array<number>(K).fill(0));
    for (let a = 0; a < n; a++) {
      const z = Z[a]!;
      let t = 0;
      for (let j = 0; j < K; j++) t += z[j]! * th[j]!;
      const p = sigmoid(t), w = Math.max(p * (1 - p), 1e-9), r = y[idx[a]!]! - p;
      for (let u = 0; u < K; u++) { g[u]! += r * z[u]!; const hu = H[u]!, wz = w * z[u]!; for (let v = u; v < K; v++) hu[v]! += wz * z[v]!; }
    }
    for (let u = 0; u < K; u++) for (let v = 0; v < u; v++) H[u]![v] = H[v]![u]!;
    for (let u = 1; u < K; u++) { g[u]! -= lam * n * th[u]!; H[u]![u]! += lam * n; }
    const step = solve(H, g);
    th = th.map((v, j) => v + step[j]!);
    if (Math.max(...step.map(Math.abs)) < 1e-7) break;
  }
  return { mu, sd, b0: th[0]!, beta: th.slice(1) };
}
export const predictLogit = (m: Logit, x: number[]): number => sigmoid(x.reduce((a, v, j) => a + m.beta[j]! * ((v - m.mu[j]!) / m.sd[j]!), m.b0));

/** Held-out classification metrics. */
export interface ProbMetrics { n: number; brier: number; logloss: number; auc: number; base_brier: number; bss: number }
function probMetrics(p: number[], y: number[], base: number[]): ProbMetrics {
  const n = y.length;
  const brier = p.reduce((a, v, i) => a + (v - y[i]!) ** 2, 0) / n;
  const bb = base.reduce((a, v, i) => a + (v - y[i]!) ** 2, 0) / n;
  const ll = -p.reduce((a, v, i) => a + Math.log(clamp(y[i] ? v : 1 - v, 1e-6, 1)), 0) / n;
  const r = ranks(p), pos = y.reduce((a, v) => a + v, 0);
  const sumPos = r.reduce((a, v, i) => a + (y[i] ? v + 1 : 0), 0);
  const auc = pos > 0 && pos < n ? (sumPos - (pos * (pos + 1)) / 2) / (pos * (n - pos)) : 0.5;
  return { n, brier: round(brier, 4), logloss: round(ll, 4), auc: round(auc, 4), base_brier: round(bb, 4), bss: round(1 - brier / bb, 4) };
}

export interface OddsDesign { name: string; terms: string[]; loo: ProbMetrics; wf: ProbMetrics; lam: number; chosen: boolean }
export interface OddsFit {
  horizon_days: number;
  n: number; n_token: number;
  terms: string[]; lam: number; m: number;
  mu: number[]; sd: number[]; beta: number[]; b0: number;
  cat_logit: Record<string, number>; prior_logit: number;
  loo: ProbMetrics; wf: { folds: { from: string; to: string; train_n: number; test_n: number; metrics: ProbMetrics }[]; pooled: ProbMetrics };
  calib: { pred: number; obs: number; n: number }[];
  designs: OddsDesign[];
  loo_p: Record<string, number>;
}

/** The odds model's raw columns for one protocol at an age (days, null = undated), by term name. */
export function oddsRow(terms: string[], p: { tvl_usd: number; chains: string[]; change_7d: number | null }, age: number | null, catLogit: number, model: ModelConstants = MODEL): number[] {
  const a = age ?? model.unknown_age_days;
  const col: Record<string, number> = {
    'log age': round(Math.log((a + model.odds_age_pad_days) / 365), 6),
    undated: age === null ? 1 : 0,
    'category rate': round(catLogit, 6),
    'log TVL': round(Math.log(p.tvl_usd), 4),
    'log chains': round(Math.log(Math.max(1, p.chains.length)), 4),
    '7d growth': clamp(p.change_7d ?? 0, -model.growth_cap_pct, model.growth_cap_pct) / 100,
  };
  return terms.map((t) => col[t]!);
}

/** P(token within H days | none at age a) from a fitted curve: (F(a+H) - F(a)) / (1 - F(a)). */
export function launchOdds(fa: number, fb: number): number { return round(clamp((fb - fa) / Math.max(1e-9, 1 - fa), 0, 1), 4); }

/** Fit the launch curve on every protocol in the snapshot and validate it blind, twice. */
export function fitOdds(snapshot: Snapshot, model: ModelConstants = MODEL): OddsFit {
  const P = [...snapshot.protocols].sort((a, b) => byStr(a.slug, b.slug));
  const y = P.map((p) => (isPreToken(p) ? 0 : 1));
  const ages = P.map((p) => ageDays(snapshot.as_of, p.listed_at));
  const cats = P.map(categoryOf);
  const m = model.odds_m;
  /** Empirical-Bayes logit of each category's token rate over `train`, leaving `skip` out of its own. */
  const eb = (train: number[]) => {
    const n = new Map<string, number>(), k = new Map<string, number>();
    let N = 0, K = 0;
    for (const i of train) { n.set(cats[i]!, (n.get(cats[i]!) ?? 0) + 1); k.set(cats[i]!, (k.get(cats[i]!) ?? 0) + y[i]!); N++; K += y[i]!; }
    const pbar = K / N;
    return (c: string, self: number) => {
      const nc = (n.get(c) ?? 0) - (self >= 0 ? 1 : 0), kc = (k.get(c) ?? 0) - (self >= 0 ? self : 0);
      const r = (kc + m * pbar) / (nc + m);
      return Math.log(r / (1 - r));
    };
  };
  const all = P.map((_, i) => i);
  /** Rows for a fold: training rows encode their category without themselves, test rows with the whole train. */
  const fixed = new Map<string, number[][]>();
  const matrix = (terms: string[], train: number[]) => {
    const key = terms.join('|');
    if (!fixed.has(key)) fixed.set(key, P.map((p, i) => oddsRow(terms, p, ages[i]!, 0, model)));
    const base = fixed.get(key)!, ci = terms.indexOf('category rate');
    if (ci < 0) return base;
    const e = eb(train), inTrain = new Uint8Array(P.length);
    for (const i of train) inTrain[i] = 1;
    return base.map((row, i) => { const r = row.slice(); r[ci] = round(e(cats[i]!, inTrain[i] ? y[i]! : -1), 6); return r; });
  };
  const usesCat = (terms: string[]) => terms.includes('category rate');
  /** Exact leave-one-out predictions over `train` (a refit per row, warm-started from the train fit). */
  const looOver = (terms: string[], train: number[], lam: number) => {
    const Xt = matrix(terms, train);
    const full = logit(Xt, y, train, lam);
    return train.map((i) => {
      const rest = train.filter((j) => j !== i);
      const X = usesCat(terms) ? matrix(terms, rest) : Xt;
      return predictLogit(logit(X, y, rest, lam, full), X[i]!);
    });
  };
  const ll = (p: number[], idx: number[]) => probMetrics(p, idx.map((i) => y[i]!), idx.map(() => 0.5)).logloss;
  const pick = (terms: string[], train: number[]) => {
    let best = model.odds_lam_grid[0]!, bestL = Infinity, bestP: number[] = [];
    for (const lam of model.odds_lam_grid) { const p = looOver(terms, train, lam); const l = ll(p, train); if (l < bestL) { bestL = l; best = lam; bestP = p; } }
    return { lam: best, p: bestP };
  };
  const dated = all.filter((i) => ages[i] !== null).sort((a, b) => byStr(P[a]!.listed_at!, P[b]!.listed_at!) || a - b);
  const undated = all.filter((i) => ages[i] === null);
  const C = model.wf_cohorts;
  const chunks = [...Array(C).keys()].map((q) => dated.slice(Math.floor((q * dated.length) / C), Math.floor(((q + 1) * dated.length) / C)));
  /** Out-of-fold base rate of the training rows, for the Brier skill baseline. */
  const rate = (idx: number[]) => idx.reduce((a, i) => a + y[i]!, 0) / idx.length;
  const walk = (terms: string[]) => {
    const folds: OddsFit['wf']['folds'] = [];
    const wp: number[] = [], wy: number[] = [], wb: number[] = [];
    for (let f = 1; f < C; f++) {
      const train = [...undated, ...chunks.slice(0, f).flat()].sort((a, b) => a - b), test = chunks[f]!;
      const { lam } = pick(terms, train);
      const X = matrix(terms, train), mfit = logit(X, y, train, lam);
      const pr = test.map((i) => predictLogit(mfit, X[i]!)), base = test.map(() => rate(train));
      wp.push(...pr); wy.push(...test.map((i) => y[i]!)); wb.push(...base);
      folds.push({ from: P[test[0]!]!.listed_at!, to: P[test[test.length - 1]!]!.listed_at!, train_n: train.length, test_n: test.length, metrics: probMetrics(pr, test.map((i) => y[i]!), base) });
    }
    return { folds, pooled: probMetrics(wp, wy, wb) };
  };
  const looBase = all.map((i) => (rate(all) * all.length - y[i]!) / (all.length - 1));

  // Forward search: each candidate term is kept only if it lowers BOTH the blind LOO log-loss and
  // the walk-forward log-loss of the design so far. 7-day growth must also enter with a sign >= 0:
  // pre-token protocols run points campaigns that pull TVL in, so a negative cross-sectional sign is
  // that campaign effect (reverse causality), not lower launch odds, and cannot enter a hazard.
  const ladder = ['category rate', 'log TVL', 'log chains', '7d growth'];
  let terms = ['log age', 'undated'];
  const score = (t: string[]) => { const s = pick(t, all); return { lam: s.lam, p: s.p, loo: probMetrics(s.p, y, looBase), wf: walk(t) }; };
  let cur = score(terms);
  const designs: OddsDesign[] = [{ name: 'log age + undated flag', terms, loo: cur.loo, wf: cur.wf.pooled, lam: cur.lam, chosen: false }];
  for (const t of ladder) {
    const next = [...terms, t], s = score(next);
    const b = logit(matrix(next, all), y, all, s.lam).beta[next.length - 1]!;
    const signOk = t !== '7d growth' || b >= 0;
    const skill = s.loo.logloss < cur.loo.logloss && s.wf.pooled.logloss < cur.wf.pooled.logloss;
    const keep = skill && signOk;
    designs.push({ name: `+ ${t}${keep ? '' : !skill ? ' (no held-out gain)' : ' (sign < 0, refused)'}`, terms: next, loo: s.loo, wf: s.wf.pooled, lam: s.lam, chosen: false });
    if (keep) { terms = next; cur = s; }
  }
  designs.find((d) => JSON.stringify(d.terms) === JSON.stringify(terms))!.chosen = true;

  const e = eb(all);
  const X = matrix(terms, all);
  const fit = logit(X, y, all, cur.lam);
  const order = all.slice().sort((a, b) => cur.p[a]! - cur.p[b]! || a - b);
  const calib = [...Array(5).keys()].map((q) => {
    const bin = order.slice(Math.floor((q * order.length) / 5), Math.floor(((q + 1) * order.length) / 5));
    return { pred: round(bin.reduce((a, i) => a + cur.p[i]!, 0) / bin.length, 4), obs: round(rate(bin), 4), n: bin.length };
  });
  const catLogit = Object.fromEntries([...new Set(cats)].sort(byStr).map((c) => [c, round(e(c, -1), 6)]));
  return {
    horizon_days: model.odds_horizon_days,
    n: P.length, n_token: y.reduce((a, v) => a + v, 0),
    terms, lam: cur.lam, m,
    mu: fit.mu.map((v) => round(v, 6)), sd: fit.sd.map((v) => round(v, 6)), beta: fit.beta.map((v) => round(v, 6)), b0: round(fit.b0, 6),
    cat_logit: catLogit, prior_logit: round(e('\u0000none', -1), 6),
    loo: cur.loo, wf: cur.wf, calib, designs,
    loo_p: Object.fromEntries(P.map((p, i) => [p.slug, round(cur.p[i]!, 4)])),
  };
}

/** A pre-token protocol's launch odds exactly as the page recomputes them from the shipped fit. */
export function oddsFor(o: OddsFit, p: SnapshotProtocol, age: number | null, model: ModelConstants = MODEL) {
  const c = o.cat_logit[categoryOf(p)] ?? o.prior_logit;
  const xa = oddsRow(o.terms, p, age, c, model);
  const xb = oddsRow(o.terms, p, (age ?? model.unknown_age_days) + o.horizon_days, c, model);
  if (age === null) xb[o.terms.indexOf('undated')] = 1;
  const F = (x: number[]) => sigmoid(x.reduce((a, v, j) => a + o.beta[j]! * ((v - o.mu[j]!) / o.sd[j]!), o.b0));
  const fa = F(xa), fb = F(xb);
  return { xa, xb, fa: round(fa, 4), fb: round(fb, 4), p: launchOdds(fa, fb) };
}

// ---------------------------------------------------------------- farm planner

/** One farm route: the category's deposit product, the base APY it pays while you wait, and its moves. */
export interface Route { key: string; product: string; apy: number; prem: number; share: number; open: string; keep: string; exit: string; risk: string }

/** The category's farm route, in words a farmer can follow this week. */
export function routeOf(category: string): Route {
  const c = category.toLowerCase();
  const R = (key: string, product: string, apy: number, prem: number, share: number, open: string, keep: string, exit: string, risk: string): Route => ({ key, product, apy, prem, share, open, keep, exit, risk });
  if (['lending', 'uncollateralized lending', 'collateral markets'].includes(c)) return R('lend', 'USDC supply market', 5, 1, 0.75, 'supply USDC to its main lending market and borrow back 10-20% against it so both sides of the book register', 'leave the supply compounding; repay and re-borrow once a month', 'repay the borrow, then withdraw the supply', 'bad-debt or oracle failure');
  if (['risk curators', 'onchain capital allocator', 'governance incentives'].includes(c)) return R('vault', 'curated USDC vault', 6, 1.5, 0.75, 'deposit USDC into its largest curated vault and take the receipt token', 'keep the receipt in the wallet; add a monthly top-up so the balance is a streak, not a spike', 'redeem the vault receipt in one transaction', 'curator mis-allocation into a failing market');
  if (['yield', 'yield aggregator', 'liquidity manager', 'farm'].includes(c)) return R('yield', 'auto-compounding stable vault', 6.5, 2, 0.75, 'deposit USDC into its flagship auto-compounding stable vault', 'leave the receipt untouched so the compounding streak accrues', 'exit the vault and swap the receipt back to USDC', 'strategy loss or depeg of the vault asset');
  if (c === 'rwa') return R('rwa', 'tokenized T-bill / credit receipt', 4.5, 0.5, 0.75, 'finish its onboarding (KYC where the asset needs it) and mint its tokenized yield asset with USDC', 'hold the yield token; it is the balance a future drop would snapshot', 'redeem the yield asset back to USDC (allow its settlement window)', 'issuer, custody or redemption-gate risk');
  if (['cdp', 'stablecoin issuer', 'dual-token stablecoin', 'algo-stables', 'partially algorithmic stablecoin', 'stablecoin wrapper'].includes(c)) return R('cdp', 'minted stable in its savings module', 4, 1.5, 0.75, 'mint or buy its stablecoin and deposit it in its savings / staking module', 'keep the savings position open; re-check the peg weekly', 'withdraw from savings and swap the stable back to USDC', 'depeg of the minted stablecoin');
  if (['basis trading', 'leveraged farming', 'cedefi'].includes(c)) return R('basis', 'delta-neutral basis vault', 7, 2.5, 0.75, 'deposit USDC into its delta-neutral basis vault at the lowest leverage offered', 'let at least two funding cycles settle before touching the position', 'request the withdrawal and claim it after the cooldown', 'negative funding or venue failure');
  if (['dexs', 'derivatives', 'perpetuals', 'interest rate derivatives', 'options', 'options vault', 'synthetics', 'indexes', 'prediction market'].includes(c)) return R('venue', 'stable LP / liquidity vault', 6, 2, 0.4, 'add USDC to its stable-pair pool or protocol liquidity vault (never a meme pair), then place one small swap or trade each month so trading activity registers too', 'keep the LP fee-accruing; one small trade a month', 'pull the liquidity and swap the LP token out', 'LP impermanent loss or vault drawdown');
  if (['restaking', 'staking pool', 'insurance'].includes(c)) return R('stake', 'staking / cover pool', 3.5, 1.5, 0.6, 'stake the accepted asset in its pool and keep the receipt in the farming wallet', 'stay in for at least two epochs; never unstake mid-epoch', 'unstake and wait out the unbonding period', 'slashing or cover-claim loss');
  if (['chain', 'payments'].includes(c)) return R('chain', 'idle balance on the network', 0, 1, 0.25, 'bridge a working balance and make 8-10 real transactions across its flagship apps', 'keep a running balance and one transaction a week', 'sweep the balance back to an exchange', 'bridge risk; no yield while idle');
  return R('other', 'main deposit product', 3, 2, 0.5, 'deposit USDC into its main product and keep the position open', 'one small action a month from the same wallet', 'withdraw the deposit in one transaction', 'contract risk of an unaudited product');
}

/** The airdrop share percentiles of REF_DROPS, in per cent of supply. */
export function dropQuantiles(): [number, number, number] {
  const v = REF_DROPS.map(([, s]) => s);
  return [round(quantile(v, 0.25), 2), round(quantile(v, 0.5), 2), round(quantile(v, 0.75), 2)];
}

/** Time to the assumed token event, in weeks, from how long the protocol has run with no token. */
export function horizonWeeks(age: number | null, model: ModelConstants = MODEL): number {
  if (age === null) return model.horizon_unknown_weeks;
  for (const [cap, w] of model.horizon_weeks) if (age < cap) return w;
  return model.horizon_default_weeks;
}

/** The planner's inputs for one row (data.js ships these and the page recomputes every tier from them). */
export interface FarmInput { tvl: number; fdv: [number, number, number]; chain: string; gas_tx: number; bridge: number; apy: number; prem: number; share: number; age: number | null; weeks: number; p: number }
/**
 * One deposit tier's economics, two outcomes. A (odds p): a token ships and the drop pays ev_if.
 * B (1 - p): no token, no drop. Gas, bridge and carry are paid either way. net / roi / apr are the
 * blended expectation (p x drop - costs); the _if fields are outcome A alone, net_none outcome B.
 */
export interface FarmTier { deposit: number; ev_if: [number, number, number]; ev: [number, number, number]; gas: number; bridge: number; carry: number; net_if: [number, number, number]; net_none: number; net: [number, number, number]; roi: [number, number, number]; apr: [number, number, number]; apr_if: [number, number, number]; apr_none: number; airdrop_apr: number; breakeven: number | null; verdict: 'FARM' | 'THIN' | 'SKIP'; whale: boolean }

/** Carry of locked capital in %/yr after the route's base APY; at or below zero the farm holds for free. */
export const model_carry = (route: { apy: number; prem: number }, model: ModelConstants = MODEL): number => round(model.benchmark_apy + route.prem - route.apy, 2);

/** One sleeve of the diversified basket. */
export interface BasketPick { slug: string; tier: FarmTier }
/**
 * The diversified farm basket for `total` dollars: basket_n equal sleeves, filled greedily by p50 net
 * APR at the sleeve's own size among FARM rows, no two sleeves on one home chain, at most two per category.
 * Rows come in rank order; the page's basket() is this function line for line.
 */
export function basket(rows: { slug: string; cat: string; f: FarmInput }[], total: number, model: ModelConstants = MODEL) {
  const sleeve = total / model.basket_n;
  const cand = rows.map((r, i) => ({ r, i, t: farmTier(r.f, sleeve, model) })).filter((x) => x.t.verdict === 'FARM')
    .sort((a, b) => b.t.apr[1] - a.t.apr[1] || a.i - b.i);
  const picks: BasketPick[] = [];
  const chains = new Set<string>(), cats = new Map<string, number>();
  for (const x of cand) {
    if (picks.length >= model.basket_n) break;
    if (chains.has(x.r.f.chain) || (cats.get(x.r.cat) ?? 0) >= model.basket_cat_max) continue;
    chains.add(x.r.f.chain); cats.set(x.r.cat, (cats.get(x.r.cat) ?? 0) + 1);
    picks.push({ slug: x.r.slug, tier: x.t });
  }
  const sum = (g: (t: FarmTier) => number) => round(picks.reduce((a, p) => a + g(p.tier), 0), 2);
  return {
    total, sleeve, slugs: picks.map((p) => p.slug),
    net_p50: sum((t) => t.net[1]), net_p25: sum((t) => t.net[0]), costs: sum((t) => t.gas + t.bridge), carry: sum((t) => t.carry),
    apr_p50: picks.length ? round(picks.reduce((a, p) => a + p.tier.apr[1], 0) / picks.length, 2) : 0,
  };
}

/** Deposit-sized two-outcome economics; the page's farmTier() is this function line for line. */
export function farmTier(f: FarmInput, deposit: number, model: ModelConstants = MODEL): FarmTier {
  const dq = dropQuantiles();
  const prior = Math.min(f.age ?? model.prior_season_cap_days, model.prior_season_cap_days);
  const days = f.weeks * 7;
  const tshare = days / (days + prior);
  const perDollar = (q: number) => ((dq[q]! / 100) * f.share * f.fdv[q]! * tshare) / f.tvl;
  const txs = model.tx_base + Math.ceil(f.weeks / model.tx_per_weeks);
  const gas = round(txs * f.gas_tx, 2);
  const carryRate = ((model.benchmark_apy + f.prem - f.apy) / 100) * (days / 365);
  const carry = round(deposit * carryRate, 2);
  const cost = gas + f.bridge + carry;
  const ann = (n: number) => round((((100 * n) / deposit) * 365) / days, 2);
  const ev_if = [0, 1, 2].map((q) => round(deposit * perDollar(q), 2)) as [number, number, number];
  const ev = ev_if.map((e) => round(f.p * e, 2)) as [number, number, number];
  const net_if = ev_if.map((e) => round(e - cost, 2)) as [number, number, number];
  const net_none = round(-cost, 2);
  const net = ev.map((e) => round(e - cost, 2)) as [number, number, number];
  const roi = net.map((n) => round((100 * n) / deposit, 2)) as [number, number, number];
  const apr = roi.map((r) => round((r * 365) / days, 2)) as [number, number, number];
  const edge = f.p * perDollar(1) - carryRate;
  const verdict = apr[1] >= model.farm_apr && apr[0] >= model.farm_p25_apr ? 'FARM' : apr[1] > 0 ? 'THIN' : 'SKIP';
  return {
    deposit, ev_if, ev, gas, bridge: f.bridge, carry, net_if, net_none, net, roi, apr,
    apr_if: net_if.map(ann) as [number, number, number], apr_none: ann(net_none),
    airdrop_apr: round(100 * f.p * perDollar(1) * (365 / days), 2),
    breakeven: edge > 0 ? Math.ceil((gas + f.bridge) / edge) : null,
    verdict, whale: deposit > model.whale_tvl_share * f.tvl,
  };
}

// ---------------------------------------------------------------- screens

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** No market cap, no CoinGecko id, no symbol: DefiLlama records no token. */
export const isPreToken = (p: SnapshotProtocol): boolean => p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
/** A token is recorded by gecko id or symbol, market cap or not. */
export const recordsToken = (p: SnapshotProtocol): boolean => p.gecko_id !== null || p.symbol !== null;

/** Why a pre-token protocol stays off the board (the house rule's own product screens), or null. */
export function productScreen(p: SnapshotProtocol): string | null {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return `${p.category}: a bridged, staked or custodial product of another protocol's token`;
  if (/\b(wrapped|staked|staking|restaked)\b/i.test(p.name)) return 'name carries wrapped/staked: a product of a token that may already trade';
  if (/\bst[A-Z]/.test(p.name)) return 'name carries a stETH-style receipt token: a product of a token that already trades';
  if (VERSIONED.test(p.name)) return 'versioned name: a release pool of another protocol';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-fronted name: a CEX product, not a launch candidate';
  return null;
}

// ---------------------------------------------------------------- farm plan text

const usd = (n: number): string => `${n < 0 ? '-' : ''}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: Math.abs(n) < 10 ? 2 : 0 })}`;
const pct = (n: number): string => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;

/** A farm step: what to do, what it costs, how long it takes. */
export interface FarmStep { action: string; cost: string; time: string }

/** Seven concrete steps on the protocol's home chain, sized by the three tiers' own economics. */
export function farmSteps(p: SnapshotProtocol, f: FarmInput, route: Route, tiers: FarmTier[]): FarmStep[] {
  const [t1, t10, t50] = tiers as [FarmTier, FarmTier, FarmTier];
  const best = tiers.find((t) => t.verdict === 'FARM') ?? tiers.find((t) => t.verdict === 'THIN') ?? null;
  const g = p.change_7d;
  const funding = f.chain === 'Ethereum'
    ? 'Withdraw USDC from an exchange straight to Ethereum mainnet (no bridge needed)'
    : `Withdraw USDC to Ethereum or an exchange that supports ${f.chain}, then move it to ${f.chain} with the chain's canonical or a major intent bridge`;
  const freeCarry = model_carry(route) <= 0;
  const odds = `${Math.round(100 * f.p)}%`;
  const size = best === null
    ? `No tier clears the FARM bar: at ${odds} launch odds even ${usd(t50.deposit)} expects ${pct(t50.apr[1])} a year at p50 (${pct(t50.apr_if[1])} if a token ships), so use this plan only for stables you would park in ${p.name} anyway`
    : `Size it at ${usd(best.deposit)} or more: ${best.verdict} there blended over both outcomes, ${pct(best.apr[1])} a year at p50 (p25 ${pct(best.apr[0])}, p75 ${pct(best.apr[2])}) after every cost, at ${odds} odds of a token within 12 months${best.verdict === 'THIN' && freeCarry ? `. Zero carry: the ${route.apy}% base yield covers benchmark + premium, so no token costs only gas` : ''}`;
  const tranche = g !== null && g >= 15
    ? `TVL jumped ${g.toFixed(1)}% in 7 days: put in half now and the rest only if TVL holds for two more weeks (a hot week can be an incentive campaign that ends)`
    : g !== null && g <= -15
      ? `TVL fell ${Math.abs(g).toFixed(1)}% in 7 days: enter at half size and leave if it slides another 25% from your entry print`
      : `Log ${p.name}'s TVL against this snapshot's ${usd(Math.round(p.tvl_usd / 1e6))}M print every week; close if it drops 25% below entry or a token ships`;
  return [
    { action: `${size}. ${funding}, keeping ${usd(Math.max(1, round(f.gas_tx * 3, 2)))} of ${f.chain} gas token for fees in a fresh wallet used only for this farm.`, cost: `${usd(f.bridge)} bridge + ${usd(f.gas_tx)} per transaction`, time: '15-30 minutes' },
    { action: `On ${p.name} (${f.chain}), ${route.open}. This is the ${route.product}; its base yield of about ${route.apy}% a year is what offsets the carry of locked capital.`, cost: `${usd(round(f.gas_tx * 2, 2))} gas (approve + deposit)`, time: '10 minutes' },
    { action: `Over the ${f.weeks}-week window to the assumed token event, ${route.keep}. Every action comes from the same wallet so the address reads as a repeat user.`, cost: `${usd(round(f.gas_tx * Math.ceil(f.weeks / MODEL.tx_per_weeks), 2))} gas for ${Math.ceil(f.weeks / MODEL.tx_per_weeks)} actions`, time: `10 minutes a month for ${f.weeks} weeks` },
    { action: `${tranche}.`, cost: "free on the protocol's own stats page", time: '5 minutes a week' },
    { action: `Two outcomes at p50. Token ships (${odds}): a drop of ${usd(t1.ev_if[1])} on ${usd(t1.deposit)}, ${usd(t10.ev_if[1])} on ${usd(t10.deposit)}, ${usd(t50.ev_if[1])} on ${usd(t50.deposit)}, ${pct(t10.apr_if[1])} a year at ${usd(t10.deposit)}. No token (${100 - Math.round(100 * f.p)}%): no drop, ${usd(t10.net_none)} at ${usd(t10.deposit)}. Blended: ${pct(t1.apr[1])} / ${pct(t10.apr[1])} / ${pct(t50.apr[1])} a year, ${t1.verdict} / ${t10.verdict} / ${t50.verdict}; break-even ${t10.breakeven === null ? 'none' : usd(t10.breakeven)}.`, cost: `carry ${usd(t10.carry)} at ${usd(t10.deposit)} (${MODEL.benchmark_apy}% benchmark + ${route.prem}% risk premium - ${route.apy}% base APY)`, time: `${f.weeks} weeks` },
    { action: `Bookmark ${p.name}'s points or rewards page from its own docs, never from a DM or an ad, and claim only through its official claimer; a page that asks for a seed phrase is a scam.`, cost: 'nothing: a real claim never charges a deposit', time: '10 minutes when a claim opens' },
    { action: `When the window closes or a token ships, ${route.exit} on ${f.chain}. Main risk: ${route.risk}; size this as capital you can lose, since a pre-token protocol can fail outright.`, cost: `${usd(round(f.gas_tx * 2, 2))} gas to unwind`, time: '20 minutes' },
  ];
}

/** A step as one board.json string: always inside the gate's 20..600 characters. */
export function stepText(s: FarmStep): string {
  const t = `${s.action} Cost: ${s.cost}. Time: ${s.time}.`;
  return t.length > 600 ? `${t.slice(0, 596)}...` : t;
}

// ---------------------------------------------------------------- the board

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  segment: 'pre_token_watchlist' | 'pre_token_emerging';
  token_status: 'pre-token';
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  fdv_to_tvl: number;
  p_token_12m: number;
  risk_adj_value_usd: number;
  net_apr_p50_pct_by_deposit: Record<string, number>;
  net_apr_if_token_p50_pct_by_deposit: Record<string, number>;
  verdict_by_deposit: Record<string, 'FARM' | 'THIN' | 'SKIP'>;
  net_roi_p50_pct_by_deposit: Record<string, number>;
  farm_steps: string[];
}

/** Named traded anchors for a row: same category first, then the nearest in TVL. */
function anchorsFor(p: SnapshotProtocol, comps: SnapshotProtocol[], n: number) {
  return comps
    .map((c) => ({ c, key: (categoryOf(c) === categoryOf(p) ? 0 : 100) + (PRODUCT_CATEGORIES.has(categoryOf(c)) ? 50 : 0) + Math.abs(Math.log(c.tvl_usd / p.tvl_usd)) }))
    .sort((a, b) => a.key - b.key || byStr(a.c.slug, b.c.slug))
    .slice(0, n)
    .map(({ c }) => ({ name: c.name, category: categoryOf(c), tvl: c.tvl_usd, mcap: c.mcap_usd!, mult: round(c.mcap_usd! / c.tvl_usd, 3) }));
}

/** The board and the dashboard's data, built from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL) {
  const { fit, comps, design } = fitModel(snapshot, model);
  const odds = fitOdds(snapshot, model);
  const watch = new Set(snapshot.watchlist);
  const funnel = { total: snapshot.protocols.length, comps: comps.length, token_other: 0, watchlist: 0, emerging: 0, aside_above: 0, screened_below: 0 };
  const aside: { name: string; category: string; tvl: number; reason: string }[] = [];
  const all: { s: string; n: string; c: string; t: number; d: string; why: string; pt: number }[] = [];
  const chosen: SnapshotProtocol[] = [];
  const compSet = new Set(comps.map((c) => c.slug));
  const mark = (p: SnapshotProtocol, d: string, why: string) => all.push({ s: p.slug, n: p.name, c: categoryOf(p), t: p.tvl_usd, d, why, pt: odds.loo_p[p.slug]! });
  for (const p of snapshot.protocols) {
    if (watch.has(p.slug)) { chosen.push(p); funnel.watchlist++; mark(p, 'W', 'on the house watchlist: ranked'); continue; }
    if (compSet.has(p.slug)) { mark(p, 'C', `token trades (mcap ${usd(Math.round(p.mcap_usd! / 1e6))}M): a value comp, never ranked`); continue; }
    if (!isPreToken(p)) {
      funnel.token_other++;
      mark(p, 'K', p.mcap_usd === null ? 'token recorded (gecko id or symbol), no market cap: launch-odds evidence only' : `token trades under the ${usd(model.comp_min_usd / 1e6)}M comp floor: launch-odds evidence only`);
      continue;
    }
    const screen = productScreen(p);
    if (p.tvl_usd >= snapshot.floor_usd) {
      funnel.aside_above++;
      const why = screen ?? 'above the floor but off the house list: DefiLlama records a parent protocol (a field the snapshot does not carry)';
      aside.push({ name: p.name, category: categoryOf(p), tvl: p.tvl_usd, reason: why }); mark(p, 'A', why);
    } else if (screen !== null) {
      funnel.screened_below++;
      aside.push({ name: p.name, category: categoryOf(p), tvl: p.tvl_usd, reason: screen }); mark(p, 'X', screen);
    } else { chosen.push(p); funnel.emerging++; mark(p, 'E', 'pre-token below the floor, passes every product screen: ranked'); }
  }
  const band = fit.resid_q;
  const scored = chosen.map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const x = design(p);
    const lg = impliedLog(fit, x, p.change_7d, age, model);
    const fdv = Math.max(1, Math.round(Math.exp(lg.total)));
    const lo = Math.max(1, Math.round(fdv * Math.exp(band.q25)));
    const hi = Math.max(1, Math.round(fdv * Math.exp(band.q75)));
    const route = routeOf(categoryOf(p));
    const chain = p.chains[0] ?? 'Ethereum';
    const od = oddsFor(odds, p, age, model);
    const f: FarmInput = { tvl: p.tvl_usd, fdv: [lo, fdv, hi], chain, gas_tx: GAS_USD[chain] ?? model.gas_default_usd, bridge: chain === 'Ethereum' ? 0 : model.bridge_usd, apy: route.apy, prem: route.prem, share: route.share, age, weeks: horizonWeeks(age, model), p: od.p };
    const tiers = model.tiers.map((d) => farmTier(f, d, model));
    return { p, age, x, lg, fdv, lo, hi, route, f, od, tiers, steps: farmSteps(p, f, route, tiers) };
  }).sort((a, b) => b.fdv - a.fdv || byStr(a.p.slug, b.p.slug));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    segment: watch.has(s.p.slug) ? 'pre_token_watchlist' : 'pre_token_emerging',
    token_status: 'pre-token',
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.fdv,
    implied_low_usd: s.lo,
    implied_high_usd: s.hi,
    fdv_to_tvl: round(s.fdv / s.p.tvl_usd, 4),
    p_token_12m: s.f.p,
    risk_adj_value_usd: Math.max(1, Math.round(s.fdv * s.f.p)),
    verdict_by_deposit: Object.fromEntries(s.tiers.map((t) => [String(t.deposit), t.verdict])),
    net_apr_p50_pct_by_deposit: Object.fromEntries(s.tiers.map((t) => [String(t.deposit), t.apr[1]])),
    net_apr_if_token_p50_pct_by_deposit: Object.fromEntries(s.tiers.map((t) => [String(t.deposit), t.apr_if[1]])),
    net_roi_p50_pct_by_deposit: Object.fromEntries(s.tiers.map((t) => [String(t.deposit), t.roi[1]])),
    farm_steps: s.steps.map(stepText),
  }));

  const count = (d: number, v: string) => scored.filter((s) => s.tiers[model.tiers.indexOf(d)]!.verdict === v).length;
  const radar = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    version: MODEL_VERSION,
    model,
    drops: REF_DROPS,
    drop_q: dropQuantiles(),
    fit,
    odds: { ...odds, loo_p: undefined },
    funnel,
    verdicts: Object.fromEntries(model.tiers.map((d) => [String(d), { FARM: count(d, 'FARM'), THIN: count(d, 'THIN'), SKIP: count(d, 'SKIP') }])),
    baskets: Object.fromEntries(model.tiers.map((d) => [String(d), basket(scored.map((s) => ({ slug: s.p.slug, cat: categoryOf(s.p), f: s.f })), d, model)])),
    rows: scored.map((s, i) => ({
      r: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      seg: watch.has(s.p.slug) ? 'W' : 'E',
      cat: categoryOf(s.p),
      chains: s.p.chains,
      tvl: s.p.tvl_usd,
      chg: s.p.change_7d,
      age: s.age,
      x: s.x,
      fdv: s.fdv,
      lo: s.lo,
      hi: s.hi,
      route: s.route,
      f: s.f,
      od: s.od,
      b: Object.fromEntries(s.tiers.map((t) => [String(t.deposit), [t.verdict, t.apr[1]]])),
      anchors: anchorsFor(s.p, comps, 3),
      steps: s.steps,
    })),
    comps: comps.map((c) => ({ name: c.name, cat: categoryOf(c), tvl: c.tvl_usd, mcap: c.mcap_usd! })),
    aside: aside.sort((a, b) => b.tvl - a.tvl || byStr(a.name, b.name)),
    all: all.sort((a, b) => b.t - a.t || byStr(a.s, b.s)),
  };
  return { board, radar };
}

/** Why a board is not one the gate takes, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice';
  const invented = board.filter((r) => !known.has(r.slug)).map((r) => r.slug);
  if (invented.length > 0) return `unknown slugs: ${invented.slice(0, 5).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100 || board.length > 4000) return `${board.length} rows, outside 100..4000`;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank ${i + 1} is ${r.rank}`;
    if (i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14) return `${r.slug} implied ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} steps`;
    for (const s of r.farm_steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a ${s.trim().length}-character step`;
  }
  if (board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  return null;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new SnapshotError('snapshot.json is not JSON'); }
  const o = raw as Record<string, unknown>;
  if (typeof o !== 'object' || o === null || typeof o.as_of !== 'string' || typeof o.source !== 'string' || typeof o.floor_usd !== 'number' || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) {
    throw new SnapshotError('snapshot.json lacks as_of, source, floor_usd, protocols or watchlist');
  }
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '-' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols = o.protocols.map((v, i) => {
    const p = v as Record<string, unknown>;
    if (typeof p?.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) throw new SnapshotError(`protocol ${i} lacks a slug, a name or a TVL`);
    return {
      slug: p.slug, name: p.name, category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd as number, change_7d: num(p.change_7d), mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at), gecko_id: str(p.gecko_id), symbol: str(p.symbol),
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist.filter((s): s is string => typeof s === 'string') };
}

/** The dashboard's data.js: the whole dataset as one script, no fetch and no network. */
export const dataScript = (radar: unknown): string => `window.RADAR=${JSON.stringify(radar)};\n`;
