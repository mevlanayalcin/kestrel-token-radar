// Kestrel Token Radar: the fitted valuation model and the board builder (kestrel-5).
//
// One sealed snapshot in, one ranked board out.
//
// The value model is NOT a hand-picked median multiple. It fits a real log-linear ridge regression
// on the snapshot's own tokenized protocols:
//
//   log(mcap_usd) ~ log(tvl_usd) + log(chains) + category_fixed_effects + offset(record)
//
// where the record offset is g*change_7d (clamped) + log(1 - d*exp(-age/T)): see recordLog.
//
// - comps        every tokenized protocol (mcap recorded) at or above COMP_MIN_USD of TVL and mcap:
//                this snapshot's 87. No protocol name is special-cased; the design matrix is built
//                from the ten snapshot fields alone.
// - features     log(tvl); log(chains); 7-day growth and seasoning (age = days from listed_at to
//                as_of, UNKNOWN_AGE_DAYS when unlisted) enter as the fixed record offset; category fixed effects for every category holding CAT_MIN_COMPS+ comps (anything
//                else loads on the baseline intercept).
// - target       log(mcap), winsorized at [WINSOR_LO, WINSOR_HI] quantiles for the FIT only; every
//                error metric below is measured against the actual, unwinsorized log(mcap).
// - ridge        features standardized by the training sample's own mean/SD; intercept unpenalized
//                via centering; group penalties: lambda_size on log(tvl), lambda_noise on momentum/
//                age/breadth, lambda_category on the dummies. The triple is chosen from a shipped
//                grid by maximum leave-one-out R² (the selection is disclosed on the page).
// - validation   (1) Leave-One-Out: refit 87 times, each comp blind to itself; then a strict nested
//                    LOO that re-selects the penalties inside every one of the 87 folds, so the
//                    reported skill also pays for the grid search (no selection leakage).
//                (2) Temporal walk-forward: dated comps split into four equal cohorts by listed_at;
//                    three expanding folds train on OLDER comps and predict the NEWER cohort blind;
//                    each fold re-selects its lambdas by LOO on its training cohort alone (nested,
//                    no look-ahead). Comps with no listed_at sit in every training fold and never
//                    in a test fold. Both passes report R², Spearman rho, median absolute log
//                    error and the within-2x share. The shrink-median multiple model (the
//                    hand-calibrated baseline) is scored under the identical LOO pass and shown
//                    beside the regression with a TVL-only log-log OLS, so the page argues instead
//                    of asserting.
// - implied      a board row's implied FDV is exp(the fitted log mcap) of its own features; the
//                dollar band is implied x exp(Q25..Q75 of the LOO log residuals).
//
// Every row also carries deposit-sized farming economics: the airdrop allocation band
// DROP_BAND_LO..HI of the implied FDV divided by the protocol's current TVL, times a capture factor
// for activity-weighted (not purely pro-rata) drops, minus per-chain gas for TX_COUNT transactions,
// a bridge allowance and the opportunity cost of capital locked for the 45-90 day hold window ->
// net expected return in dollars and per cent at $1,000 and $5,000 deposits, and one of FARM /
// THIN / SKIP verdicts. The implied FDV is the model's claim, never a promise; the economics are
// an illustration of that claim, not advice.
//
// The board covers every slug on the snapshot's watchlist (the floor, never a ceiling) plus every
// pre-token protocol below the floor that passes the product screens the house's rule applies.
// Protocols whose token already trades never enter the ranking; they are the comps the model is
// fitted on, and the dashboard shows them apart, priced by the market.

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

/** The model's constants, stated in the dashboard; the page recomputes rows from these + the fit. */
export interface ModelConstants {
  comp_min_usd: number;
  winsor_lo: number;
  winsor_hi: number;
  lam_size_grid: number[];
  lam_noise_grid: number[];
  lam_category_grid: number[];
  cat_min_comps: number;
  growth_cap_pct: number;
  growth_elasticity: number;
  season_depth: number;
  season_days: number;
  unknown_age_days: number;
  tx_count: number;
  bridge_usd: number;
  opportunity_cost_annum: number;
  hold_by_age_days: [number, number][];
  hold_default_days: number;
  hold_unknown_days: number;
  drop_band_lo: number;
  drop_band_hi: number;
  capture_factor: number;
  deposit_usd: number[];
  farm_net_pct: number;
  thin_net_pct: number;
  gas_default_usd: number;
  band_quantiles: [number, number];
  wf_cohorts: number;
}

export const MODEL: ModelConstants = {
  comp_min_usd: 5_000_000,
  winsor_lo: 0.05,
  winsor_hi: 0.95,
  lam_size_grid: [0.03, 0.1, 0.3],
  lam_noise_grid: [10, 30, 100, 300],
  lam_category_grid: [0.3, 1, 3, 10],
  cat_min_comps: 6,
  growth_cap_pct: 30,
  growth_elasticity: 0.75,
  season_depth: 0.35,
  season_days: 180,
  unknown_age_days: 270,
  tx_count: 12,
  bridge_usd: 6,
  opportunity_cost_annum: 0.04,
  hold_by_age_days: [[180, 90], [365, 75], [730, 60]],
  hold_default_days: 45,
  hold_unknown_days: 60,
  drop_band_lo: 0.005,
  drop_band_hi: 0.02,
  capture_factor: 3,
  deposit_usd: [1000, 5000, 25000],
  farm_net_pct: 5,
  thin_net_pct: 1,
  gas_default_usd: 0.5,
  band_quantiles: [0.25, 0.75],
  wf_cohorts: 4,
};

/** Per-chain USD cost of one transaction, as a rounded allowance (the snapshot names 100+ chains). */
export const GAS_USD: Record<string, number> = {
  Ethereum: 8, Bitcoin: 2, Solana: 0.05, Base: 0.1, Arbitrum: 0.3, Optimism: 0.3, Linea: 0.3,
  Scroll: 0.3, 'zkSync Era': 0.5, Mantle: 0.3, Unichain: 0.1, Ink: 0.1, 'World Chain': 0.3,
  Starknet: 0.3, Sonic: 0.1, Binance: 0.3, Avalanche: 0.3, Polygon: 0.3, Sui: 0.05, Sei: 0.1,
  Aptos: 0.1, Flare: 0.1, Algorand: 0.01, Stellar: 0.01, Monad: 0.1, 'Hyperliquid L1': 0.1,
  Plasma: 0.1, Berachain: 0.3,
};

/** The model's version label: the dashboard names it, the board carries it. */
export const MODEL_VERSION = 'kestrel-5';

// ---------------------------------------------------------------- basics

const DAY_MS = 86_400_000;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (n: number, dp: number): number => { const f = 10 ** dp; return Math.round(n * f) / f; };

/** A whole-day count from `listed_at` to `as_of`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

const median = (values: number[]): number => {
  const a = [...values].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 === 1 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
};

/** The q-quantile of `values` (linear interpolation). */
const quantile = (values: number[], q: number): number => {
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0]!;
  const at = q * (a.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return a[lo]! + (a[hi]! - a[lo]!) * (at - lo);
};

/** Category key a protocol calibrates and displays under. */
export const categoryOf = (p: SnapshotProtocol): string => p.category ?? 'Uncategorized';

/** Spearman rho (average ranks for ties). */
function spearman(xs: number[], ys: number[]): number {
  const rank = (v: number[]): number[] => {
    const o = v.map((x, i) => [x, i] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const r = new Array<number>(v.length);
    for (let i = 0; i < o.length;) {
      let j = i;
      while (j + 1 < o.length && o[j + 1]![0] === o[i]![0]) j++;
      const avg = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) r[o[k]![1]] = avg;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  if (n < 3) return 0;
  const mx = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i]! - mx) * (ry[i]! - mx);
    dx += (rx[i]! - mx) ** 2;
    dy += (ry[i]! - mx) ** 2;
  }
  return dx > 0 && dy > 0 ? round(num / Math.sqrt(dx * dy), 4) : 0;
}

const r2Of = (preds: number[], actuals: number[], baselineMean: number): number => {
  let ss = 0, tt = 0;
  for (let i = 0; i < preds.length; i++) {
    ss += (preds[i]! - actuals[i]!) ** 2;
    tt += (baselineMean - actuals[i]!) ** 2;
  }
  return tt > 0 ? round(1 - ss / tt, 4) : 0;
};

// ---------------------------------------------------------------- the ridge fit

/** One fitted ridge: standardized design (mu/sd per column), betas (beta[0] is the intercept), ybar. */
export interface RidgeFit {
  mu: number[];
  sd: number[];
  beta: number[];
  ybar: number;
  predict: (x: number[]) => number;
}

/** Solve A z = b by Gauss-Jordan with partial pivoting (k <= 14 here). */
function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]!]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    const d = M[col]![col]! || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r]![col]! / d;
      if (!f) continue;
      for (let k = col; k <= n; k++) M[r]![k]! -= f * M[col]![k]!;
    }
  }
  return M.map((r, i) => r[n]! / (M[i]![i]! || 1e-12));
}

/** Ridge on the rows of `idx`; per-column penalty vector `pen` (scaled by n); intercept via centering. */
function ridgeFit(F: number[][], Yv: number[], idx: number[], pen: number[]): RidgeFit {
  const k = F[idx[0]!]!.length;
  const n = idx.length;
  const mu = new Array<number>(k).fill(0);
  const sd = new Array<number>(k).fill(0);
  for (const i of idx) for (let j = 0; j < k; j++) mu[j]! += F[i]![j]! / n;
  for (const i of idx) for (let j = 0; j < k; j++) sd[j]! += ((F[i]![j]! - mu[j]!) ** 2) / n;
  for (let j = 0; j < k; j++) sd[j]! = Math.sqrt(sd[j]!) || 1;
  const ybar = idx.reduce((a, i) => a + Yv[i]!, 0) / n;
  const X = idx.map((i) => F[i]!.map((v, j) => (v - mu[j]!) / sd[j]!));
  const y = idx.map((i) => Yv[i]! - ybar);
  const XtX = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r]![a]! * X[r]![b]!;
    return s + (a === b ? pen[a]! * n : 0);
  }));
  const Xty = Array.from({ length: k }, (_, a) => {
    let s = 0;
    for (let r = 0; r < n; r++) s += X[r]![a]! * y[r]!;
    return s;
  });
  const beta = gaussSolve(XtX, Xty);
  const predict = (x: number[]): number => x.reduce((acc, v, j) => acc + beta[j]! * ((v - mu[j]!) / sd[j]!), ybar);
  return { mu, sd, beta, ybar, predict };
}

/** Metrics of one set of (predicted log, actual log) pairs, always against the ACTUAL log(mcap). */
export interface ValMetrics {
  n: number;
  r2: number;
  rho: number;
  med_abs_log_err: number;
  within_2x_pct: number;
}

function metrics(predLog: number[], actualLog: number[], meanActual: number): ValMetrics {
  const errs = predLog.map((p, i) => Math.abs(p - actualLog[i]!));
  return {
    n: predLog.length,
    r2: r2Of(predLog, actualLog, meanActual),
    rho: spearman(predLog, actualLog),
    med_abs_log_err: round(median(errs), 4),
    within_2x_pct: Math.round((100 * errs.filter((e) => e <= Math.LN2).length) / errs.length),
  };
}

/** One leave-one-out point: the comp, its blind prediction, its signed log error. */
export interface LooPoint {
  slug: string;
  name: string;
  category: string;
  mcap_usd: number;
  pred_usd: number;
  resid: number;
}

/** One temporal walk-forward fold: train older comps, blind-predict the newer cohort. */
export interface WfFold {
  from: string;
  to: string;
  train_n: number;
  test_n: number;
  lam: [number, number, number];
  metrics: ValMetrics;
}

/** The regression's full disclosure: equation, sample, penalty, coefficients, both validations. */
export interface ModelFit {
  equation: string;
  target: string;
  n_comps: number;
  lam: [number, number, number];
  lam_grid: number[][];
  winsorized: [number, number];
  cats: string[];
  mu: number[];
  sd: number[];
  ybar: number;
  beta: number[];
  feature_names: string[];
  elasticity_at_mean: number;
  in_sample_r2: number;
  nested: { metrics: ValMetrics; same_lam: number };
  loo: { metrics: ValMetrics; resid_q10: number; resid_q25: number; resid_q75: number; resid_q90: number };
  wf: { folds: WfFold[]; pooled: ValMetrics; cohorts: number };
  loo_points: LooPoint[];
  baselines: { name: string; note: string; metrics: ValMetrics }[];
}

// ---------------------------------------------------------------- radar row shapes

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** Deposit-sized net-EV farming economics for one protocol (all numbers are model claims). */
export interface FarmEconomics {
  hold_days: number;
  chains_farmed: string[];
  gas_usd: number;
  bridge_usd: number;
  op1k_usd: number;
  op5k_usd: number;
  op25k_usd: number;
  cost1k_usd: number;
  cost5k_usd: number;
  cost25k_usd: number;
  gross_lo_pct: number;
  gross_mid_pct: number;
  gross_hi_pct: number;
  alloc1k_lo_usd: number;
  alloc1k_hi_usd: number;
  alloc5k_lo_usd: number;
  alloc5k_hi_usd: number;
  net1k_usd: number;
  net5k_usd: number;
  net25k_usd: number;
  net1k_pct: number;
  net5k_pct: number;
  net25k_pct: number;
  breakeven_usd: number | null;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

/** One row of board.json. */
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
  mcap_usd: null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  fitted_multiple: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_ev_pct_1000: number;
  net_ev_pct_5000: number;
  net_ev_pct_25000: number;
  anchor_comps: { slug: string; name: string; category: string; tvl_usd: number; mcap_usd: number; multiple: number }[];
  farm: FarmEconomics;
  farm_steps: string[];
}

/** The dashboard's view of one row: the board's claim, the named anchors, the farm EV and the steps. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  segment: 'watchlist' | 'emerging';
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  fitted_multiple: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  net_ev_pct_1000: number;
  net_ev_pct_5000: number;
  net_ev_pct_25000: number;
  anchor_comps: BoardRow['anchor_comps'];
  farm: FarmEconomics;
  x: number[];
  steps: FarmStep[];
}

/** A tokenized peer: it already trades, so its market cap is a fact; the fit prices it anyway. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  age_days: number | null;
  multiple: number;
  pred_usd: number;
  resid: number;
}

/** A pre-token protocol the screens keep off the board: flagged with its exact reason, never ranked. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
  above_floor: boolean;
}

/** One step of the whole-snapshot accounting funnel. */
export interface FunnelStep {
  label: string;
  n: number;
  detail: string;
}

/** Everything the dashboard renders, built from the same board. */
export interface RadarData {
  as_of: string;
  snapshot_date: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  gas_usd: Record<string, number>;
  fit: ModelFit;
  funnel: { total: number; steps: FunnelStep[]; aside_reasons_above: { reason: string; n: number }[]; excluded_reasons_below: { reason: string; n: number }[] };
  kpis: {
    total: number;
    comps: number;
    tokenized_no_mcap: number;
    tokenized_small_mcap: number;
    pre_token: number;
    watchlist: number;
    watchlist_ranked: number;
    emerging: number;
    board: number;
    aside_above: number;
    excluded_below: number;
    total_implied_usd: number;
    med_fitted_multiple: number;
    farm: number;
    thin: number;
    skip: number;
  };
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
}

// ---------------------------------------------------------------- screens

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** Categories whose TVL is a wrapped, staked, bridged or custodial product of another protocol. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Cross Chain Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
/** Exchange-fronted names: the house's rule keeps them off the watchlist at any TVL. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;

/** Whether a protocol records no token at all (no market cap, no CoinGecko id, no symbol). */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol records a token by gecko id or symbol, market cap or not. */
export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null;
}

/** Why a pre-token protocol is screened out of the board, or null when it is not. */
export function productScreen(p: SnapshotProtocol): string | null {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return `${p.category ?? 'Bridge'}: a bridged, staked or custodial product of another protocol's token`;
  const n = p.name.toLowerCase();
  if (/\b(wrapped|staked|staking|restaked)\b/.test(n)) return 'name carries wrapped/staked: a product of a token that may already trade';
  if (/\bst[A-Z]/.test(p.name)) return 'name carries a liquid-staking receipt token (stETH-style): a product of a token that already trades';
  if (VERSIONED.test(p.name)) return 'versioned name: a release pool of another protocol';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-fronted name: a CEX product, not a launch candidate';
  return null;
}

/** Which product-screen bucket an exclusion reason falls in (for the exact funnel accounting). */
function screenBucket(reason: string): string {
  if (/^CEX/.test(reason)) return 'CEX category (custodial)';
  if (/Bridge/i.test(reason)) return 'Bridge / canonical-bridge category (a product of another chain)';
  if (/Liquid Staking|Liquid Restaking|Restaked BTC/i.test(reason)) return 'Liquid staking / restaking category (a receipt of a token that trades)';
  if (/wrapped\/staked/.test(reason)) return 'name carries wrapped/staked/staking';
  if (/receipt token/.test(reason)) return 'name carries a stETH-style receipt token';
  if (/versioned name/.test(reason)) return 'versioned name (a release pool)';
  if (/exchange-fronted/.test(reason)) return 'exchange-fronted name';
  return 'other screen';
}

// ---------------------------------------------------------------- deposit-sized farm economics

/** How long to hold: the younger the record, the longer the plausible snapshot window (45-90 days). */
function holdDaysFor(age: number | null, model: ModelConstants): number {
  if (age === null) return model.hold_unknown_days;
  for (const [cap, days] of model.hold_by_age_days) if (age < cap) return days;
  return model.hold_default_days;
}

/**
 * Deposit-sized net-EV farm verdict for one row. Per dollar of capital deployed, the model's mid
 * expectation is the drop band (0.5%-2% of the implied FDV, pro-rata over current TVL) scaled by
 * the fitted multiple and the capture factor for activity-weighted drops; costs are per-chain gas
 * for TX_COUNT transactions, one bridge allowance and the capital's opportunity cost over the hold
 * window. The verdict thresholds apply to the $1,000 mid-band net return; $5,000 and $25,000 are
 * the sensitivity tiers (fixed costs amortize, carry does not).
 */
export function farmEconomics(tvlUsd: number, impliedUsd: number, chains: string[], age: number | null, model: ModelConstants = MODEL): FarmEconomics {
  // Gas is paid on the one chain the plan farms: the protocol's first-listed (home) chain.
  const farmed = chains.slice(0, 1);
  const gas = round(model.tx_count * farmed.reduce((a, c) => a + (GAS_USD[c] ?? model.gas_default_usd), 0), 2);
  const bridge = model.bridge_usd;
  const hold = holdDaysFor(age, model);
  const mult = impliedUsd / tvlUsd;
  const [d1, d5, d25] = model.deposit_usd as [number, number, number];
  const gm = (model.drop_band_lo + model.drop_band_hi) / 2;
  const op = (d: number) => round(d * model.opportunity_cost_annum * (hold / 365), 2);
  const grossPct = round(100 * gm * mult * model.capture_factor, 2);
  const op1 = op(d1);
  const op5 = op(d5);
  const op25 = op(d25);
  const c1 = round(gas + bridge + op1, 2);
  const c5 = round(gas + bridge + op5, 2);
  const c25 = round(gas + bridge + op25, 2);
  const net = (d: number, cc: number) => round((d * grossPct) / 100 - cc, 2);
  const n1 = net(d1, c1);
  const n5 = net(d5, c5);
  const n25 = net(d25, c25);
  const netPct1 = round((100 * n1) / d1, 2);
  const band = (d: number, f: number) => round(d * f * mult * model.capture_factor, 2);
  return {
    hold_days: hold,
    chains_farmed: farmed.length > 0 ? farmed : ['its home chain'],
    gas_usd: gas,
    bridge_usd: bridge,
    op1k_usd: op1,
    op5k_usd: op5,
    op25k_usd: op25,
    cost1k_usd: c1,
    cost5k_usd: c5,
    cost25k_usd: c25,
    gross_lo_pct: round(100 * model.drop_band_lo * mult * model.capture_factor, 2),
    gross_mid_pct: grossPct,
    gross_hi_pct: round(100 * model.drop_band_hi * mult * model.capture_factor, 2),
    alloc1k_lo_usd: band(d1, model.drop_band_lo),
    alloc1k_hi_usd: band(d1, model.drop_band_hi),
    alloc5k_lo_usd: band(d5, model.drop_band_lo),
    alloc5k_hi_usd: band(d5, model.drop_band_hi),
    net1k_usd: n1,
    net5k_usd: n5,
    net25k_usd: n25,
    net1k_pct: netPct1,
    net5k_pct: round((100 * n5) / d5, 2),
    net25k_pct: round((100 * n25) / d25, 2),
    // The deposit at which the mid-band drop first pays the fixed costs back, or null when the
    // drop yield never beats the carry (then no deposit size breaks even).
    breakeven_usd: grossPct / 100 > model.opportunity_cost_annum * (hold / 365) ? Math.ceil((gas + bridge) / (grossPct / 100 - model.opportunity_cost_annum * (hold / 365))) : null,
    verdict: netPct1 >= model.farm_net_pct ? 'FARM' : netPct1 >= model.thin_net_pct ? 'THIN' : 'SKIP',
  };
}

// ---------------------------------------------------------------- farm plans

/** A signed number as text: +1.5 or -2. */
const sgn = (n: number): string => `${n >= 0 ? '+' : ''}${n}`;

/** The first chain the snapshot names for a protocol (DefiLlama lists the primary first). */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** The category's core action, in words a farmer can follow this week. */
function coreAction(p: SnapshotProtocol, chain: string): { action: string; cost: string; time: string; exit: string } {
  const c = categoryOf(p).toLowerCase();
  const n = p.name;
  if (c === 'lending' || c === 'uncollateralized lending' || c === 'collateral markets') {
    return {
      action: `Supply capital into ${n}'s lending market on ${chain} as a first-position lender, then borrow back 15-25% of it against the deposit so both sides of the book register to the wallet.`,
      cost: 'the deposit at risk plus gas', time: '20 minutes to open',
      exit: 'repay the borrow, then withdraw the supply',
    };
  }
  if (c === 'cdp' || c === 'dual-token stablecoin' || c === 'algo-stables' || c === 'stablecoin wrapper' || c === 'stablecoin issuer') {
    return {
      action: `Lock ETH or BTC as collateral in ${n} on ${chain} and mint its stablecoin at a conservative 2.5-3x ratio; keep the minted amount in the farming wallet rather than repaying it at once.`,
      cost: 'the collateral at risk plus gas', time: '20 minutes to open',
      exit: 'repay the minted stable and redeem the collateral',
    };
  }
  if (c === 'dexs' || c === 'farm') {
    return {
      action: `Provide liquidity to ${n}'s deepest blue-chip pool on ${chain} (a WETH/USDC-class pair, never a meme pair), and leave the LP position fee-accruing for the hold window.`,
      cost: 'the position at risk plus gas', time: '15 minutes to open',
      exit: 'pull the LP position and swap out the pool token',
    };
  }
  if (c === 'yield' || c === 'yield aggregator' || c === 'liquidity manager') {
    return {
      action: `Deposit into ${n}'s flagship auto-compounding vault on ${chain}, and leave the receipt token untouched so the compounding streak accrues.`,
      cost: 'the deposit at risk plus gas', time: '10 minutes to open',
      exit: 'exit the vault and swap the receipt back to the deposit asset',
    };
  }
  if (c === 'risk curators' || c === 'onchain capital allocator' || c === 'governance incentives') {
    return {
      action: `Deposit into ${n}'s highest-yield curated vault on ${chain}, then move part of it into a second curated strategy so the wallet registers as an active allocator, not a parked depositor.`,
      cost: 'the deposit at risk plus twice the gas', time: '25 minutes across two sessions',
      exit: 'withdraw from the curated vault in one transaction',
    };
  }
  if (c === 'rwa') {
    return {
      action: `Finish ${n}'s onboarding (KYC where the tokenized asset requires it) and mint or buy its tokenized yield asset on ${chain}; hold the receipt token, which is the piece a future drop would snapshot.`,
      cost: 'the position at risk plus gas', time: '30-45 minutes including onboarding',
      exit: 'redeem the yield asset back to USDC',
    };
  }
  if (c === 'basis trading' || c === 'leveraged farming') {
    return {
      action: `Fund a basis or spread strategy on ${n} (${chain}) at the minimum leverage it offers, and let at least one full funding or harvest cycle settle before touching the position.`,
      cost: 'the margin at risk plus gas', time: '15 minutes to open',
      exit: 'de-claim the strategy and withdraw the margin',
    };
  }
  if (c === 'derivatives' || c === 'perpetuals' || c === 'interest rate derivatives' || c === 'options' || c === 'options vault' || c === 'synthetics' || c === 'indexes') {
    return {
      action: `Open a margin account on ${n} on ${chain}, place one small two-sided or hedged position (notional at most 2x the margin), and close it the next day so maker and taker activity both register.`,
      cost: 'the margin at risk plus gas', time: '20 minutes over two days',
      exit: 'flatten the position and withdraw the margin',
    };
  }
  if (c === 'prediction market') {
    return {
      action: `Fund ${n} and take both sides of one near-dated market at roughly even odds, so activity registers at close to zero net exposure while the position stays live.`,
      cost: 'the stake at risk plus gas', time: '15 minutes to place',
      exit: 'let the market settle, then withdraw',
    };
  }
  if (c === 'insurance') {
    return {
      action: `Buy cover on ${n} for a blue-chip vault the farming wallet already uses, and stake a matching amount into the capital pool if membership is open, registering both buyer and backer roles.`,
      cost: 'the premium and stake at risk', time: '20 minutes to place',
      exit: 'let the policy lapse and unstake the capital',
    };
  }
  if (c === 'staking pool' || c === 'restaking' || c === 'anchor btc' || c === 'decentralized btc' || c === 'liquid staking') {
    return {
      action: `Stake the chain's native or BTC asset through ${n} on ${chain} and keep the staking receipt in the farming wallet; if epochs matter, stay in for at least two.`,
      cost: 'the stake at risk plus gas', time: '10 minutes to stake',
      exit: 'unstake and wait out the unbonding period',
    };
  }
  if (c === 'chain' || c === 'payments') {
    return {
      action: `Route real activity through ${n} on ${chain}: fund the wallet with its gas asset, make 8-10 transactions across its flagship app over two weeks, and keep a running balance rather than draining it.`,
      cost: 'working capital plus gas', time: 'spread over two weeks',
      exit: 'spend down or sweep the balance back to an exchange',
    };
  }
  if (c === 'cedefi' || c === 'crypto card issuer') {
    return {
      action: `Open the ${n} account, fund it, and place one on-chain yield position it wraps, so the wallet shows as an end-user of both the account and the underlying product.`,
      cost: 'the balance at risk', time: '30 minutes including account setup',
      exit: 'close the wrapped position and withdraw',
    };
  }
  if (c === 'nft marketplace') {
    return {
      action: `Buy and list one floor-priced collection item on ${n} (${chain}), and leave the listing live so the address reads as a marketplace user.`,
      cost: 'the item plus gas', time: '15 minutes to place',
      exit: 'cancel the listing and sell or hold the item',
    };
  }
  return {
    action: `Deposit into ${n}'s main product on ${chain} and keep the position open; if it offers more than one market, split the deposit across two so the wallet shows breadth.`,
    cost: 'the deposit at risk plus gas', time: '15 minutes to open',
    exit: 'withdraw the deposit in one transaction',
  };
}

/**
 * A protocol's farm plan: six steps, each with a concrete action, a cost and a time, sized against
 * the row's own deposit economics. Every number derives from the protocol's record and the fitted
 * model - never from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, farm: FarmEconomics): FarmStep[] {
  const chain = chainOf(p);
  const core = coreAction(p, chain);
  const weeks = Math.max(4, Math.round(farm.hold_days / 7));
  const growth = p.change_7d;
  let monitor: string;
  if (growth !== null && growth >= 15) {
    monitor = `Size in two tranches: commit half now and the rest only if TVL holds its level for two more weeks. ${p.name} grew ${growth.toFixed(1)}% in the snapshot's 7-day window, and one hot week can be a migration, an incentive campaign or noise the model cannot tell apart.`;
  } else if (growth !== null && growth <= -15) {
    monitor = `Enter at half size and log TVL weekly: ${p.name} shed ${Math.abs(growth).toFixed(1)}% over the snapshot's 7 days, so treat the current level as unstable and exit the farm entirely if TVL slides another 25% from your entry print.`;
  } else {
    monitor = `Track ${p.name}'s TVL against this snapshot's $${Math.round(p.tvl_usd / 1_000_000)}M print each week; if it falls more than 25% below your entry level, or the protocol ships a token, close the farm and re-read the board.`;
  }
  const be = farm.breakeven_usd === null
    ? `no deposit size breaks even, because the ${farm.gross_mid_pct}% drop yield is below the ${round((100 * MODEL.opportunity_cost_annum * farm.hold_days) / 365, 2)}% carry`
    : `it breaks even from a $${farm.breakeven_usd.toLocaleString('en-US')} deposit`;
  const verdictWord = farm.verdict === 'FARM' ? `it clears the ${MODEL.farm_net_pct}% FARM bar at $1,000 and ${be}` : farm.verdict === 'THIN' ? `it pays, but under the ${MODEL.farm_net_pct}% FARM bar; ${be}` : `do not open a wallet for the drop alone: ${be}`;
  const ageWord = age === null ? 'an undated' : age < 365 ? `a ${Math.max(1, Math.round(age / 30))}-month-old` : `a ${(age / 365).toFixed(1)}-year-old`;
  return [
    {
      action: `Open a dedicated farming wallet for this position only (a fresh seed phrase, stored offline) and fund it with $1,000 of USDC plus the ${chain} gas token. $1,000 is the size this ${farm.verdict} verdict is computed at; the same plan nets ${sgn(farm.net5k_pct)}% at $5,000 and ${sgn(farm.net25k_pct)}% at $25,000, because gas and bridge are fixed costs and only the carry scales.`,
      cost: `$${farm.cost1k_usd} of hard costs total: $${farm.gas_usd} gas (${MODEL.tx_count} tx on ${farm.chains_farmed.join(' + ')}), $${MODEL.bridge_usd} bridge allowance, $${farm.op1k_usd} lock-up carry`,
      time: '15 minutes',
    },
    {
      action: `${core.action} The model's mid-band expectation for a $1,000 wallet is $${farm.alloc1k_lo_usd.toFixed(0)}-$${farm.alloc1k_hi_usd.toFixed(0)} of allocation (${farm.gross_mid_pct}% of the deposit before costs) - a claim of the fitted model, never a promise.`,
      cost: core.cost,
      time: core.time,
    },
    {
      action: `Every 5-7 days make one small on-chain action on ${p.name} from the same wallet - a swap, a vault re-balance, a claim-and-restake or a small top-up - so the address reads as a repeat user across the whole ${farm.hold_days}-day window, not a one-shot visitor.`,
      cost: `about $${round(farm.gas_usd / MODEL.tx_count, 2)} of ${chain} gas per action`,
      time: `10 minutes a week for ${farm.hold_days} days (${weeks} weeks)`,
    },
    { action: monitor, cost: "free to check on the protocol's own stats page", time: '5 minutes a week' },
    {
      action: `Bookmark ${p.name}'s official points, streak or rewards page from its own docs today - never from a DM or a search ad - and claim only through the protocol's own claimer when a drop lands. A claim site that asks for a seed phrase is always a scam.`,
      cost: 'nothing; a legitimate claim never charges a deposit',
      time: '10 minutes when a claim opens',
    },
    {
      action: `Net the position: $${farm.cost1k_usd} of costs against the mid-band expectation leave ${farm.net1k_usd >= 0 ? '+' : '-'}$${Math.abs(farm.net1k_usd)} (${sgn(farm.net1k_pct)}%) at $1,000, a ${farm.verdict}: ${verdictWord}. ${core.exit.charAt(0).toUpperCase() + core.exit.slice(1)} on ${chain} when the window closes. Treat the capital as venture-sized: ${ageWord} ${categoryOf(p)} protocol can lose all of it to a bug or a rogue admin key.`,
      cost: `$${farm.cost5k_usd} of hard costs at $5,000 (net ${sgn(farm.net5k_pct)}%), $${farm.cost25k_usd} at $25,000 (net ${sgn(farm.net25k_pct)}%)`,
      time: '20 minutes to unwind',
    },
  ];
}

/** A step as one string for board.json: action, cost, time - always inside the gate's 20..600 chars. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}

// ---------------------------------------------------------------- the fitted model

/** The whole ridge pipeline over the snapshot's comps: fit, LOO, walk-forward, baselines, bands. */
export function fitModel(snapshot: Snapshot, model: ModelConstants = MODEL): { fit: ModelFit; comps: SnapshotProtocol[]; design: (p: SnapshotProtocol) => number[]; offset: (p: SnapshotProtocol) => number } {
  const comps = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd >= model.comp_min_usd && p.tvl_usd >= model.comp_min_usd)
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const counts = new Map<string, number>();
  for (const c of comps) counts.set(categoryOf(c), (counts.get(categoryOf(c)) ?? 0) + 1);
  const cats = [...counts.entries()].filter(([, n]) => n >= model.cat_min_comps).map(([k]) => k).sort();
  const featureNames = ['log(tvl_usd)', 'log(chains)', ...cats.map((c) => `fe:${c}`)];
  const design = (p: SnapshotProtocol): number[] => [
    Math.log(p.tvl_usd),
    Math.log(Math.max(1, p.chains.length)),
    ...cats.map((c) => (categoryOf(p) === c ? 1 : 0)),
  ];
  // The record terms enter as a fixed offset (the GLM sense): the ridge fits the level on what is
  // left once 7-day growth and seasoning are priced at their stated elasticities.
  const offset = (p: SnapshotProtocol): number => recordLog(p.change_7d, ageDays(snapshot.as_of, p.listed_at), model).total;
  const F = comps.map(design);
  const Y0 = comps.map((c) => Math.log(c.mcap_usd!));
  const OFF = comps.map(offset);
  const wLo = quantile(Y0, model.winsor_lo);
  const wHi = quantile(Y0, model.winsor_hi);
  const Yw = Y0.map((y, i) => clamp(y, wLo, wHi) - OFF[i]!);
  const idx = comps.map((_, i) => i);
  const meanActual = Y0.reduce((a, b) => a + b, 0) / Y0.length;
  const pen = (t: number, nz: number, lc: number) => [t, nz, ...cats.map(() => lc)];

  // The penalty triple that maximizes leave-one-out R2 on the rows of `train` alone. Every caller
  // passes only the rows it may see: the full fit all 87, a nested fold 86, a walk-forward fold its past.
  const selectLam = (train: number[]): [number, number, number] => {
    const ac = train.map((i) => Y0[i]!);
    const mean = ac.reduce((a, b) => a + b, 0) / ac.length;
    let best: { lam: [number, number, number]; r2: number } | null = null;
    for (const t of model.lam_size_grid) for (const nz of model.lam_noise_grid) for (const lc of model.lam_category_grid) {
      const pr = train.map((i) => ridgeFit(F, Yw, train.filter((j) => j !== i), pen(t, nz, lc)).predict(F[i]!) + OFF[i]!);
      const r2 = r2Of(pr, ac, mean);
      if (best === null || r2 > best.r2) best = { lam: [t, nz, lc], r2 };
    }
    return best!.lam;
  };
  const lam = selectLam(idx);
  const fitRidge = ridgeFit(F, Yw, idx, pen(lam[0], lam[1], lam[2]));

  // Strict nested LOO: for each comp, the penalties are re-selected by an inner LOO on the other 86
  // and only then is the held-out comp predicted - the selection itself never sees the comp it scores.
  const nestedLam: string[] = [];
  const nestedPred = idx.map((i) => {
    const train = idx.filter((j) => j !== i);
    const l = selectLam(train);
    nestedLam.push(l.join('/'));
    return ridgeFit(F, Yw, train, pen(l[0], l[1], l[2])).predict(F[i]!) + OFF[i]!;
  });
  const nestedM = metrics(nestedPred, Y0, meanActual);
  const nestedSame = nestedLam.filter((l) => l === lam.join('/')).length;

  // Full LOO pass at the selected lambdas: metrics, signed residuals, scatter points.
  const looPred = idx.map((i) => ridgeFit(F, Yw, idx.filter((j) => j !== i), pen(lam[0], lam[1], lam[2])).predict(F[i]!) + OFF[i]!);
  const looResid = looPred.map((p, i) => round(p - Y0[i]!, 4));
  const looM = metrics(looPred, Y0, meanActual);

  // Temporal walk-forward: dated comps into `wf_cohorts` equal cohorts by listed_at; undated comps
  // in every train fold, never a test fold; each fold re-selects its lambdas by LOO on train alone.
  const dated = idx
    .filter((i) => comps[i]!.listed_at !== null)
    .sort((a, b) => (comps[a]!.listed_at! < comps[b]!.listed_at! ? -1 : comps[a]!.listed_at! > comps[b]!.listed_at! ? 1 : a - b));
  const nullIdx = idx.filter((i) => comps[i]!.listed_at === null);
  const chunks: number[][] = [];
  for (let q = 0; q < model.wf_cohorts; q++) chunks.push(dated.slice(Math.floor((q * dated.length) / model.wf_cohorts), Math.floor(((q + 1) * dated.length) / model.wf_cohorts)));
  const folds: WfFold[] = [];
  const pooledPred: number[] = [];
  const pooledAc: number[] = [];
  for (let f = 0; f < chunks.length - 1; f++) {
    const train = [...nullIdx, ...chunks.slice(0, f + 1).flat()].sort((a, b) => a - b);
    const test = chunks[f + 1]!;
    const sel = { lam: selectLam(train) };
    const mf = ridgeFit(F, Yw, train, pen(sel.lam[0], sel.lam[1], sel.lam[2]));
    const pr = test.map((i) => mf.predict(F[i]!) + OFF[i]!);
    const ac = test.map((i) => Y0[i]!);
    pooledPred.push(...pr);
    pooledAc.push(...ac);
    folds.push({
      from: comps[test[0]!]!.listed_at!,
      to: comps[test[test.length - 1]!]!.listed_at!,
      train_n: train.length,
      test_n: test.length,
      lam: sel.lam,
      metrics: metrics(pr, ac, train.reduce((a, i) => a + Y0[i]!, 0) / train.length),
    });
  }
  const pooledM = metrics(pooledPred, pooledAc, pooledAc.reduce((a, b) => a + b, 0) / pooledAc.length);

  // Baselines under the same LOO pass: the shrink-median multiple model and the plain global-median
  // multiple (the hand-picked 0.48x class of model this radar replaces).
  const ratios = comps.map((c) => clamp(c.mcap_usd! / c.tvl_usd, 0.02, 20));
  const gm = median(ratios);
  const byCat = new Map<string, number[]>();
  comps.forEach((c, i) => {
    const list = byCat.get(categoryOf(c)) ?? [];
    list.push(i);
    byCat.set(categoryOf(c), list);
  });
  const shrinkPr: number[] = [];
  const globalPr: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const peers = (byCat.get(categoryOf(comps[i]!)) ?? []).filter((j) => j !== i).map((j) => ratios[j]!);
    const peerMedian = median(peers.length > 0 ? peers : [gm]);
    const w = peers.length / (peers.length + 4);
    shrinkPr.push(Math.log(comps[i]!.tvl_usd * (w * clamp(peerMedian, 0.1, 3) + (1 - w) * gm)));
    globalPr.push(Math.log(comps[i]!.tvl_usd * peerMedian));
  }
  // TVL alone: log(mcap) on log(tvl) by OLS, the same LOO pass - what the other terms add.
  const Yraw = Y0.map((y) => clamp(y, wLo, wHi));
  const tvlOnly = idx.map((i) => ridgeFit(F.map((r) => [r[0]!]), Yraw, idx.filter((j) => j !== i), [0]).predict([F[i]![0]!]));
  // The same ridge with the record terms dropped: what pricing growth and seasoning costs or buys.
  const noRecord = idx.map((i) => ridgeFit(F, Yraw, idx.filter((j) => j !== i), pen(lam[0], lam[1], lam[2])).predict(F[i]!));
  const baselines = [
    { name: 'same ridge, no growth or seasoning terms', note: 'the identical level fit with the record offset set to zero', metrics: metrics(noRecord, Y0, meanActual) },
    { name: 'log-log on TVL alone (OLS)', note: 'log(mcap) = a + b*log(tvl), no category, momentum, age or breadth terms', metrics: metrics(tvlOnly, Y0, meanActual) },
    { name: 'shrink-median FDV/TVL (hand-calibrated multiples)', note: 'category median of comp FDV/TVL ratios clamped to [0.1, 3] and shrunk to the market median by w = n/(n+4): the hand-set constant this radar replaces', metrics: metrics(shrinkPr, Y0, meanActual) },
    { name: 'category median multiple (no shrinkage)', note: 'each comp priced at its own category LOO median FDV/TVL multiple', metrics: metrics(globalPr, Y0, meanActual) },
  ];

  const looPoints: LooPoint[] = comps.map((c, i) => ({
    slug: c.slug,
    name: c.name,
    category: categoryOf(c),
    mcap_usd: c.mcap_usd!,
    pred_usd: Math.round(Math.exp(looPred[i]!)),
    resid: looResid[i]!,
  }));

  const fit: ModelFit = {
    equation: 'log(mcap_usd) = b0 + b1*log(tvl_usd) + b2*log(chains) + sum(fe_category) + g*chg7d + log(1 - d*exp(-age/T))',
    target: `log(mcap), winsorized p${model.winsor_lo * 100}-p${model.winsor_hi * 100} for the fit; every error metric measures the actual, unwinsorized log(mcap)`,
    n_comps: comps.length,
    lam,
    lam_grid: [model.lam_size_grid, model.lam_noise_grid, model.lam_category_grid],
    winsorized: [round(wLo, 4), round(wHi, 4)],
    cats,
    mu: fitRidge.mu.map((v) => round(v, 4)),
    sd: fitRidge.sd.map((v) => round(v, 4)),
    ybar: round(fitRidge.ybar, 4),
    beta: fitRidge.beta.map((v) => round(v, 4)),
    feature_names: featureNames,
    elasticity_at_mean: round(fitRidge.beta[0]! / fitRidge.sd[0]!, 4),
    in_sample_r2: metrics(idx.map((i) => fitRidge.predict(F[i]!) + OFF[i]!), Y0, meanActual).r2,
    nested: { metrics: nestedM, same_lam: nestedSame },
    loo: {
      metrics: looM,
      resid_q10: round(quantile(looResid, 0.1), 4),
      resid_q25: round(quantile(looResid, model.band_quantiles[0]), 4),
      resid_q75: round(quantile(looResid, model.band_quantiles[1]), 4),
      resid_q90: round(quantile(looResid, 0.9), 4),
    },
    wf: { folds, pooled: pooledM, cohorts: model.wf_cohorts },
    loo_points: looPoints,
    baselines,
  };
  return { fit, comps, design, offset };
}

/**
 * The record terms, in log space. Growth: g x the 7-day TVL change clamped to +-GROWTH_CAP_PCT
 * (+10% -> x1.078 at g 0.75; a falling TVL always lowers the value). Seasoning: TVL that has
 * stayed with no token for longer is stickier, so a young protocol keeps 1 - d*exp(-age/T) of its
 * level (d 0.35, T 180 days: 30 days -> x0.70, 1 year -> x0.95). Unlisted protocols take UNKNOWN_AGE_DAYS.
 */
export function recordLog(change7d: number | null, age: number | null, model: ModelConstants = MODEL): { growth: number; season: number; total: number } {
  const growth = (model.growth_elasticity * clamp(change7d ?? 0, -model.growth_cap_pct, model.growth_cap_pct)) / 100;
  const season = Math.log(1 - model.season_depth * Math.exp(-(age ?? model.unknown_age_days) / model.season_days));
  return { growth, season, total: growth + season };
}

/** Named anchor comps for one scored row: same category first, then size-similar protocol comps;
 *  product comps (bridges/CEX/staking receipts) anchor only product-category rows. */
function anchorsFor(p: SnapshotProtocol, comps: SnapshotProtocol[], n: number): BoardRow['anchor_comps'] {
  const rowProduct = PRODUCT_CATEGORIES.has(categoryOf(p));
  return comps
    .map((c) => {
      const sameCat = categoryOf(c) === categoryOf(p) ? 0 : 1;
      const prodPenalty = !rowProduct && PRODUCT_CATEGORIES.has(categoryOf(c)) ? 1 : 0;
      const dist = Math.abs(Math.log(c.tvl_usd / Math.max(1, p.tvl_usd)));
      return { c, key: sameCat * 100 + prodPenalty * 50 + dist };
    })
    .sort((a, b) => a.key - b.key || (a.c.slug < b.c.slug ? -1 : 1))
    .slice(0, n)
    .map(({ c }) => ({ slug: c.slug, name: c.name, category: categoryOf(c), tvl_usd: c.tvl_usd, mcap_usd: c.mcap_usd!, multiple: round(c.mcap_usd! / c.tvl_usd, 3) }));
}

// ---------------------------------------------------------------- the board

/** The board and the dashboard's data, built from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { fit, comps, design, offset } = fitModel(snapshot, model);
  // Predictions for shipped rows use the SAME rounded coefficients and rounded features the page
  // will recompute from: exp(ybar + Σ beta_j (x_j - mu_j)/sd_j) reproduces the board to the dollar.
  const predictX = (x: number[]) => x.reduce((acc, v, j) => acc + fit.beta[j]! * ((v - fit.mu[j]!) / fit.sd[j]!), fit.ybar);
  const predictLog = (p: SnapshotProtocol) => predictX(design(p).map((v) => round(v, 4))) + offset(p);
  const watchSet = new Set(snapshot.watchlist);
  const band = fit.loo;

  // Whole-snapshot accounting + the board's own selection.
  const tokenized = snapshot.protocols.filter(recordsToken);
  const tokenizedNoMcap = tokenized.filter((p) => p.mcap_usd === null);
  const tokenizedSmall = tokenized.filter((p) => p.mcap_usd !== null && p.mcap_usd < model.comp_min_usd);
  const pre = snapshot.protocols.filter(isPreToken);
  const preAbove = pre.filter((p) => p.tvl_usd >= snapshot.floor_usd);
  const preBelow = pre.filter((p) => p.tvl_usd < snapshot.floor_usd);

  const chosen: SnapshotProtocol[] = [];
  const aside: AsideRow[] = [];
  const asideReasons = new Map<string, number>();
  const excludedReasons = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (watchSet.has(p.slug)) {
      chosen.push(p);
      continue;
    }
    if (!isPreToken(p)) continue;
    const screen = productScreen(p);
    if (screen !== null) {
      const bucket = screenBucket(screen);
      if (p.tvl_usd >= snapshot.floor_usd) asideReasons.set(bucket, (asideReasons.get(bucket) ?? 0) + 1);
      else excludedReasons.set(bucket, (excludedReasons.get(bucket) ?? 0) + 1);
      aside.push({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason: screen, above_floor: p.tvl_usd >= snapshot.floor_usd });
      continue;
    }
    if (p.tvl_usd < snapshot.floor_usd) chosen.push(p);
    else {
      const parented = 'off the house watchlist: DefiLlama records a parent protocol for it (a product arm of a group whose token may already trade) - the snapshot does not carry that field';
      asideReasons.set(parented, (asideReasons.get(parented) ?? 0) + 1);
      aside.push({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason: parented, above_floor: true });
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!chosen.some((p) => p.slug === slug)) {
      const p = snapshot.protocols.find((x) => x.slug === slug);
      if (p !== undefined) chosen.push(p);
    }
  }

  const scored = chosen
    .map((p) => {
      const x = design(p).map((v) => round(v, 4));
      const implied = Math.max(1, Math.round(Math.exp(predictX(x) + offset(p))));
      const age = ageDays(snapshot.as_of, p.listed_at);
      const farm = farmEconomics(p.tvl_usd, implied, p.chains, age, model);
      const steps = farmSteps(p, age, farm);
      return { p, implied, farm, age, steps, x };
    })
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    segment: watchSet.has(s.p.slug) ? 'pre_token_watchlist' : 'pre_token_emerging',
    token_status: 'pre-token',
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    age_days: s.age,
    implied_value_usd: s.implied,
    implied_low_usd: Math.max(1, Math.round(s.implied * Math.exp(band.resid_q25))),
    implied_high_usd: Math.max(1, Math.round(s.implied * Math.exp(band.resid_q75))),
    fitted_multiple: round(s.implied / s.p.tvl_usd, 6),
    verdict: s.farm.verdict,
    net_ev_pct_1000: s.farm.net1k_pct,
    net_ev_pct_5000: s.farm.net5k_pct,
    net_ev_pct_25000: s.farm.net25k_pct,
    anchor_comps: anchorsFor(s.p, comps, 2),
    farm: s.farm,
    farm_steps: s.steps.map(stepText),
  }));

  const live: LiveRow[] = comps
    .map((c) => {
      const pred = Math.round(Math.exp(predictLog(c)));
      return {
        slug: c.slug,
        name: c.name,
        category: categoryOf(c),
        chains: c.chains,
        tvl_usd: c.tvl_usd,
        mcap_usd: c.mcap_usd!,
        change_7d: c.change_7d,
        age_days: ageDays(snapshot.as_of, c.listed_at),
        multiple: round(c.mcap_usd! / c.tvl_usd, 3),
        pred_usd: pred,
        resid: round(Math.log(c.mcap_usd! / pred), 4),
      };
    })
    .sort((a, b) => b.mcap_usd - a.mcap_usd || (a.slug < b.slug ? -1 : 1));

  const asideAboveN = [...asideReasons.values()].reduce((a, n) => a + n, 0);
  const excludedBelowN = [...excludedReasons.values()].reduce((a, n) => a + n, 0);
  const watchCount = board.filter((r) => r.segment === 'pre_token_watchlist').length;
  const emergingCount = board.length - watchCount;
  const funnel: RadarData['funnel'] = {
    total: snapshot.protocols.length,
    steps: [
      { label: 'protocols on the snapshot (TVL >= $5M)', n: snapshot.protocols.length, detail: 'every record in protocols[], one sealed fetch' },
      { label: 'record a token (gecko_id or symbol)', n: tokenized.length, detail: `${fit.n_comps} of them carry mcap >= $5M and fit the model; ${tokenizedSmall.length} carry mcap under $5M; ${tokenizedNoMcap.length} record a token but no market cap` },
      { label: 'tokenized comps the model is fitted on', n: fit.n_comps, detail: 'the valuation evidence; never ranked on the board' },
      { label: 'record no token at all', n: pre.length, detail: `${preAbove.length} at or above the $${snapshot.floor_usd / 1_000_000}M floor, ${preBelow.length} below it` },
      { label: 'watchlist: on the house list, all ranked', n: watchCount, detail: 'every slug of the snapshot watchlist appears once on the board' },
      { label: 'above floor, off the list: set aside', n: asideAboveN, detail: 'each carries its exact exclusion reason in the Set-aside view' },
      { label: 'below floor, product-screened out', n: excludedBelowN, detail: 'bridged, staked, wrapped, versioned or exchange-fronted names' },
      { label: 'emerging pre-token finds, scored', n: emergingCount, detail: 'below the floor, passing the same product screens the house rule applies' },
    ],
    aside_reasons_above: [...asideReasons.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || (a.reason < b.reason ? -1 : 1)),
    excluded_reasons_below: [...excludedReasons.entries()].map(([reason, n]) => ({ reason, n })).sort((a, b) => b.n - a.n || (a.reason < b.reason ? -1 : 1)),
  };

  const radar: RadarData = {
    as_of: snapshot.as_of,
    snapshot_date: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    gas_usd: GAS_USD,
    fit,
    funnel,
    kpis: {
      total: snapshot.protocols.length,
      comps: fit.n_comps,
      tokenized_no_mcap: tokenizedNoMcap.length,
      tokenized_small_mcap: tokenizedSmall.length,
      pre_token: pre.length,
      watchlist: snapshot.watchlist.length,
      watchlist_ranked: watchCount,
      emerging: emergingCount,
      board: board.length,
      aside_above: asideAboveN,
      excluded_below: excludedBelowN,
      total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
      med_fitted_multiple: round(median(board.map((r) => r.fitted_multiple)), 3),
      farm: board.filter((r) => r.verdict === 'FARM').length,
      thin: board.filter((r) => r.verdict === 'THIN').length,
      skip: board.filter((r) => r.verdict === 'SKIP').length,
    },
    rows: scored.map((s, i) => ({
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      segment: watchSet.has(s.p.slug) ? 'watchlist' as const : 'emerging' as const,
      category: categoryOf(s.p),
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.age,
      implied_value_usd: s.implied,
      implied_low_usd: board[i]!.implied_low_usd,
      implied_high_usd: board[i]!.implied_high_usd,
      fitted_multiple: board[i]!.fitted_multiple,
      verdict: s.farm.verdict,
      net_ev_pct_1000: s.farm.net1k_pct,
      net_ev_pct_5000: s.farm.net5k_pct,
      net_ev_pct_25000: s.farm.net25k_pct,
      anchor_comps: anchorsFor(s.p, comps, 3),
      farm: s.farm,
      x: s.x,
      steps: s.steps,
    })),
    aside: aside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)),
    live,
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug)).map((r) => r.slug);
  if (invented.length > 0) return `the board names protocols the snapshot does not: ${invented.slice(0, 5).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 the gate takes`;
  if (board.length > 4000) return `the board holds ${board.length} rows, over the 4000 the gate takes`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.trim().length < 20 || s.trim().length > 600) return `${r.slug} has a farm step of ${s.trim().length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.name.length === 0) return `${r.slug} has an empty name`;
  }
  return null;
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** The dashboard's data.js: the whole dataset as one script tag, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}
