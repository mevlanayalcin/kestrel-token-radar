// Kestrel Token Radar: the valuation model and the board builder.
//
// One sealed snapshot in, one ranked board out. The board covers every slug on the snapshot's
// watchlist (the floor, never a ceiling) plus every pre-token protocol below the watchlist floor
// that passes the same product screens the house's rule applies (no bridge, liquid-staking, CEX or
// wrapped/staked/versioned product, no exchange-fronted name): those are the emerging rows the
// radar exists to find. Protocols whose token already trades never enter the ranking; they are the
// comps the model is calibrated from, and the dashboard shows them apart, priced by the market.
//
// The implied value is a peer-calibrated FDV/TVL model, driven only by the snapshot's own figures:
//
//   comps        every tokenized protocol (mcap recorded) with tvl >= COMP_MIN_USD and mcap >=
//                COMP_MIN_USD; each comp's FDV/TVL ratio is winsorized to [RATIO_FLOOR, RATIO_CAP]
//   global       GLOBAL_MEDIAN = median of all comps' ratios
//   cat_median   per category, the median of its comps' ratios, clamped to [CAT_FLOOR, CAT_CAP]
//   peer_mult    cat_median shrunk toward GLOBAL_MEDIAN by sample size: w = n/(n + SHRINK_COMPS)
//                (an empirical-Bayes shrinkage: one comp carries 1/5 of the category's weight)
//   momentum     1 + clamp(change_7d, -60, +120)/100 x 0.5
//   maturity     0.70 + min(age_days, 1460)/1460 x 0.35  (age unknown: the band midpoint, 0.875)
//                age = days the protocol has run on DefiLlama's record with no token
//   breadth      1 + 0.025 x (min(chains, 12) - 1)
//   implied      max(1, round(tvl_usd x peer_mult x momentum x maturity x breadth))
//
// No protocol name is special-cased anywhere: the same functions score every row, watchlist or
// emerging, and the page recomputes each row from the same constants to prove it.

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

/** The model's constants, stated in the dashboard and used by its recompute check. */
export interface ModelConstants {
  comp_min_usd: number;
  ratio_floor: number;
  ratio_cap: number;
  cat_mult_floor: number;
  cat_mult_cap: number;
  shrink_comps: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  maturity_unknown: number;
  breadth_step: number;
  breadth_max_chains: number;
}

export const MODEL: ModelConstants = {
  comp_min_usd: 5_000_000,
  ratio_floor: 0.02,
  ratio_cap: 20,
  cat_mult_floor: 0.1,
  cat_mult_cap: 3.0,
  shrink_comps: 4,
  momentum_weight: 0.5,
  momentum_floor_pct: -60,
  momentum_cap_pct: 120,
  maturity_floor: 0.7,
  maturity_range: 0.35,
  maturity_days: 1460,
  maturity_unknown: 0.875,
  breadth_step: 0.025,
  breadth_max_chains: 12,
};

/** The model's version label: the dashboard names it, the board carries it. */
export const MODEL_VERSION = 'kestrel-2';

/** One category's peer calibration: what the comps say a TVL dollar is worth there. */
export interface CategoryCalibration {
  category: string;
  comps: number;
  raw_median: number;
  peer_multiple: number;
  /** The category's own dispersion: its interquartile comp multiples, shrunk the same way. */
  peer_low: number;
  peer_high: number;
  /** peer_multiple / global median: the category's capital-efficiency weight vs the market. */
  efficiency: number;
}

/** The whole peer calibration, computed from the snapshot's tokenized protocols. */
export interface Calibration {
  global_median: number;
  /** The market's own Q25..Q75 FDV/TVL band, the fallback dispersion for thin categories. */
  global_band: [number, number];
  comp_count: number;
  categories: CategoryCalibration[];
  /** Leave-one-out backtest of the multiple itself: how far the model lands from the market. */
  loo: { comps: number; median_abs_error_pct: number; median_miss_x: number; within_2x_pct: number; rank_corr: number };
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  action: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  conviction_score: number;
  model: {
    peer_multiple: number;
    category_efficiency: number;
    category_comps: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one row, with its structured farm plan and factors. */
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
  implied_low: number;
  implied_high: number;
  conviction_score: number;
  peer_multiple: number;
  peer_low: number;
  peer_high: number;
  category_efficiency: number;
  category_comps: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  steps: FarmStep[];
}

/** A tokenized peer: it already trades, so its FDV/TVL multiple is a fact, not a model. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number;
}

/** A pre-token protocol the house's watchlist rule set aside above the floor: flagged, never ranked. */
export interface AsideRow {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  reason: string;
}

/** Everything the dashboard renders, built from the same board. */
export interface RadarData {
  as_of: string;
  snapshot_date: string;
  floor_usd: number;
  model_version: string;
  model: ModelConstants;
  kpis: {
    watchlist: number;
    emerging: number;
    board: number;
    total_implied_usd: number;
    median_peer_multiple: number;
    comp_count: number;
    live_count: number;
  };
  calibration: { global_median: number; comp_count: number; categories: CategoryCalibration[] };
  rows: RadarRow[];
  live: LiveRow[];
  aside: AsideRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

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

/** The q-quantile of `values` (linear interpolation), used for the comp-dispersion band. */
const quantile = (values: number[], q: number): number => {
  const a = [...values].sort((x, y) => x - y);
  if (a.length === 0) return 0;
  if (a.length === 1) return a[0]!;
  const at = q * (a.length - 1);
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return a[lo]! + (a[hi]! - a[lo]!) * (at - lo);
};

/** Category medians shrink toward the market median by w = n/(n + shrink_comps). */
const shrink = (categoryMedian: number, globalMedian: number, n: number, model: ModelConstants): { multiple: number; w: number } => {
  const w = n / (n + model.shrink_comps);
  return { multiple: w * clamp(categoryMedian, model.cat_mult_floor, model.cat_mult_cap) + (1 - w) * globalMedian, w };
};

/** The category key a protocol calibrates and displays under. */
export const categoryOf = (p: SnapshotProtocol): string => p.category ?? 'Uncategorized';

/**
 * Calibrate peer FDV/TVL multiples from the snapshot's own tokenized protocols: every comp with
 * tvl and mcap at least COMP_MIN_USD, each ratio winsorized to [ratio_floor, ratio_cap]; per
 * category the median is clamped to [cat_mult_floor, cat_mult_cap] and shrunk toward the global
 * median by w = n/(n + shrink_comps). The same treatment gives the category's IQR band (peer_low /
 * peer_high), and a leave-one-out pass measures how far the multiple lands from the market when
 * each comp is predicted from the other comps alone. Deterministic in the snapshot's bytes alone.
 */
export function calibrate(snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const comps = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd >= model.comp_min_usd && p.tvl_usd >= model.comp_min_usd);
  const ratios = comps.map((p) => clamp(p.mcap_usd! / p.tvl_usd, model.ratio_floor, model.ratio_cap));
  const global_median = ratios.length > 0 ? median(ratios) : 1;
  const global_q25 = ratios.length > 0 ? quantile(ratios, 0.25) : global_median;
  const global_q75 = ratios.length > 0 ? quantile(ratios, 0.75) : global_median;
  const byCat = new Map<string, { ratio: number; tvl: number; mcap: number }[]>();
  for (let i = 0; i < comps.length; i++) {
    const cat = categoryOf(comps[i]!);
    const list = byCat.get(cat) ?? [];
    list.push({ ratio: ratios[i]!, tvl: comps[i]!.tvl_usd, mcap: comps[i]!.mcap_usd! });
    byCat.set(cat, list);
  }
  const categories: CategoryCalibration[] = [...byCat.entries()]
    .map(([category, list]) => {
      const rs = list.map((c) => c.ratio);
      const raw = median(rs);
      const { multiple, w } = shrink(raw, global_median, rs.length, model);
      // The band is the category's Q25..Q75 comp multiples, shrunk toward the market's own spread:
      // a thin category inherits the market's dispersion instead of pretending to have none.
      const low = w * clamp(quantile(rs, 0.25), model.cat_mult_floor, model.cat_mult_cap) + (1 - w) * global_q25;
      const high = w * clamp(quantile(rs, 0.75), model.cat_mult_floor, model.cat_mult_cap) + (1 - w) * global_q75;
      return { category, comps: rs.length, raw_median: round3(raw), peer_multiple: round3(multiple), peer_low: round3(low), peer_high: round3(high), efficiency: round3(multiple / global_median) };
    })
    .sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  // Leave-one-out: predict each comp's FDV from the multiple built from the other comps of its own
  // category, and compare with the market's own value. Two honest readings: the median multiplicative
  // miss, and the Spearman rank correlation between predicted FDV and the market's market cap.
  const errors: number[] = [];
  const predictedFdv: number[] = [];
  const actualMcap: number[] = [];
  let within2x = 0;
  for (const list of byCat.values()) {
    for (let j = 0; j < list.length; j++) {
      const peers = list.filter((_, k) => k !== j).map((c) => c.ratio);
      const peer = peers.length > 0 ? shrink(median(peers), global_median, peers.length, model).multiple : global_median;
      const predicted = list[j]!.tvl * peer;
      const actual = list[j]!.mcap;
      errors.push(Math.abs(predicted - actual) / actual);
      predictedFdv.push(predicted);
      actualMcap.push(actual);
      if (predicted / actual >= 0.5 && predicted / actual <= 2) within2x++;
    }
  }
  const ranks = (xs: number[]): number[] => {
    const order = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const out = new Array<number>(xs.length).fill(0);
    order.forEach((o, r) => (out[o.i] = r + 1));
    return out;
  };
  const rankCorr = (xs: number[], ys: number[]): number => {
    const n = xs.length;
    if (n < 3) return 0;
    const rx = ranks(xs);
    const ry = ranks(ys);
    const mx = (n + 1) / 2;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (rx[i]! - mx) * (ry[i]! - mx);
      dx += (rx[i]! - mx) ** 2;
      dy += (ry[i]! - mx) ** 2;
    }
    return dx > 0 && dy > 0 ? num / Math.sqrt(dx * dy) : 0;
  };
  const loo = {
    comps: errors.length,
    median_abs_error_pct: Math.round(100 * median(errors.length > 0 ? errors : [0])),
    median_miss_x: Math.round(10 * (1 + median(errors.length > 0 ? errors : [0]))) / 10,
    within_2x_pct: errors.length > 0 ? Math.round((100 * within2x) / errors.length) : 0,
    rank_corr: Math.round(100 * rankCorr(predictedFdv, actualMcap)) / 100,
  };
  return { global_median: round3(global_median), global_band: [round3(global_q25), round3(global_q75)], comp_count: comps.length, categories, loo };
}

/** The model's four factors and the implied value they give one protocol. */
export interface Factors {
  peer_multiple: number;
  peer_low: number;
  peer_high: number;
  category_efficiency: number;
  category_comps: number;
  momentum_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  implied: number;
  implied_low: number;
  implied_high: number;
  age_days: number | null;
}

/** Score one protocol under the calibration: peer multiple, momentum, maturity, breadth, implied FDV and its comp band. */
export function score(protocol: SnapshotProtocol, asOf: string, calibration: Calibration, model: ModelConstants = MODEL): Factors {
  const cat = calibration.categories.find((c) => c.category === categoryOf(protocol));
  const peer_multiple = cat?.peer_multiple ?? round3(calibration.global_median);
  const peer_low = cat?.peer_low ?? round3(calibration.global_band[0]);
  const peer_high = cat?.peer_high ?? round3(calibration.global_band[1]);
  const category_efficiency = cat?.efficiency ?? 1;
  const category_comps = cat?.comps ?? 0;
  const growth = clamp(protocol.change_7d ?? 0, model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum_multiplier = round3(1 + (growth / 100) * model.momentum_weight);
  const age = ageDays(asOf, protocol.listed_at);
  const maturity_multiplier = round3(age === null ? model.maturity_unknown : model.maturity_floor + (Math.min(age, model.maturity_days) / model.maturity_days) * model.maturity_range);
  const chainCount = Math.max(1, protocol.chains.length);
  const breadth_multiplier = round3(1 + model.breadth_step * (Math.min(chainCount, model.breadth_max_chains) - 1));
  const tail = momentum_multiplier * maturity_multiplier * breadth_multiplier;
  const implied = Math.max(1, Math.round(protocol.tvl_usd * peer_multiple * momentum_multiplier * maturity_multiplier * breadth_multiplier));
  const implied_low = Math.max(1, Math.round(protocol.tvl_usd * peer_low * tail));
  const implied_high = Math.max(implied_low, Math.round(protocol.tvl_usd * peer_high * tail));
  return { peer_multiple, peer_low, peer_high, category_efficiency, category_comps, momentum_multiplier, maturity_multiplier, breadth_multiplier, implied, implied_low, implied_high, age_days: age };
}

/**
 * The conviction score (0-100): how hard the radar says farm this now, as distinct from the implied
 * FDV (how big the prize would be). A weighted blend of momentum, TVL standing on the board, age
 * without a token, chain breadth and the category multiple, each normalized to [0, 1].
 */
export function conviction(protocol: SnapshotProtocol, factors: Factors, boardMaxTvl: number, model: ModelConstants = MODEL): number {
  const momN = (clamp(protocol.change_7d ?? 0, model.momentum_floor_pct, model.momentum_cap_pct) - model.momentum_floor_pct) / (model.momentum_cap_pct - model.momentum_floor_pct);
  const lo = 5_000_000;
  const tvlN = boardMaxTvl > lo ? clamp(Math.log10(protocol.tvl_usd / lo) / Math.log10(boardMaxTvl / lo), 0, 1) : 1;
  const ageN = (factors.age_days ?? model.maturity_days / 2) / model.maturity_days;
  const brN = Math.min(Math.max(protocol.chains.length, 1), model.breadth_max_chains) / model.breadth_max_chains;
  const multN = clamp((factors.peer_multiple - model.cat_mult_floor) / (model.cat_mult_cap - model.cat_mult_floor), 0, 1);
  return Math.round(100 * (0.35 * momN + 0.3 * tvlN + 0.15 * ageN + 0.1 * brN + 0.1 * multN));
}

// ------------------------------------------------------------------ screens

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

/** Why a pre-token protocol is screened out of the board, or null when it is not. */
export function productScreen(p: SnapshotProtocol): string | null {
  if (PRODUCT_CATEGORIES.has(p.category ?? '')) return `${p.category ?? 'Bridge'}: a bridged, staked or custodial product screen`;
  const n = p.name.toLowerCase();
  if (/\b(wrapped|staked|staking|restaked)\b/.test(n)) return 'name carries wrapped/staked: a product of a token that may already trade';
  if (/\bst[A-Z]/.test(p.name)) return 'name carries a liquid-staking receipt token (stETH-style): a product of a token that already trades';
  if (VERSIONED.test(p.name)) return 'versioned name: a release pool of another protocol';
  if (EXCHANGE_PREFIX.test(p.name)) return 'exchange-fronted name: a CEX product, not a launch candidate';
  return null;
}

// ------------------------------------------------------------------ farm plans

/** One transaction's gas on a chain, as an honest range (the snapshot names 100+ chains; a default covers the rest). */
const GAS: Record<string, string> = {
  Ethereum: '$3-15 per transaction on mainnet',
  Bitcoin: '$1-5 per on-chain move',
  Solana: 'well under $0.01 per transaction',
  Base: 'under $0.10 per transaction',
  Arbitrum: 'under $0.30 per transaction',
  Optimism: 'under $0.30 per transaction',
  Linea: 'under $0.30 per transaction',
  Scroll: 'under $0.30 per transaction',
  'zkSync Era': 'under $0.50 per transaction',
  Mantle: 'under $0.30 per transaction',
  Unichain: 'under $0.10 per transaction',
  Ink: 'under $0.10 per transaction',
  'World Chain': 'under $0.30 per transaction',
  Starknet: 'under $0.30 per transaction',
  Sonic: 'under $0.10 per transaction',
  Binance: 'under $0.30 per transaction',
  Avalanche: 'under $0.30 per transaction',
  Polygon: 'under $0.30 per transaction',
  Sui: 'under $0.05 per transaction',
  Sei: 'under $0.10 per transaction',
  Aptos: 'under $0.10 per transaction',
  Flare: 'under $0.10 per transaction',
  Algorand: 'under $0.01 per transaction',
  Stellar: 'under $0.01 per transaction',
  Monad: 'well under $0.10 per transaction',
  'Hyperliquid L1': 'under $0.10 per transaction',
  Plasma: 'under $0.10 per transaction',
  Berachain: 'under $0.30 per transaction',
};
const GAS_DEFAULT = 'typically under $1 per transaction';

function gasOn(chain: string): string {
  return GAS[chain] ?? GAS_DEFAULT;
}

/** The first chain the snapshot names for a protocol (DefiLlama lists the primary first). */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** How much capital one farm position needs, from the protocol's own TVL tier. */
function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 250;
  if (tvl >= 500_000_000) return 200;
  if (tvl >= 250_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  if (tvl >= 50_000_000) return 75;
  if (tvl >= 20_000_000) return 60;
  return 50;
}

/** How long to hold: a younger protocol's snapshot window is longer, so the farm runs longer. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 180) return 90;
  if (age < 365) return 75;
  if (age < 730) return 60;
  return 45;
}

/** The category's core action, in words a farmer can follow this week. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): { action: string; cost: string; time: string; exit: string } {
  const c = categoryOf(p).toLowerCase();
  const n = p.name;
  if (c === 'lending' || c === 'uncollateralized lending' || c === 'collateral markets') {
    return {
      action: `Supply $${capital} of USDC into ${n}'s lending market on ${chain} as a first-position lender, then borrow back 15-25% of it against the deposit so both sides of the book register to the wallet.`,
      cost: `$${capital} of capital at risk plus gas`,
      time: '20 minutes to open',
      exit: 'repay the borrow, then withdraw the supply',
    };
  }
  if (c === 'cdp' || c === 'dual-token stablecoin' || c === 'algo-stables' || c === 'stablecoin wrapper' || c === 'stablecoin issuer') {
    return {
      action: `Lock $${capital} of ETH or BTC as collateral in ${n} on ${chain} and mint its stablecoin at a conservative 2.5-3x ratio; keep the minted amount in the farming wallet rather than repaying it at once.`,
      cost: `$${capital} of collateral at risk plus gas`,
      time: '20 minutes to open',
      exit: 'repay the minted stable and redeem the collateral',
    };
  }
  if (c === 'dexs' || c === 'farm') {
    return {
      action: `Provide $${capital} of liquidity to ${n}'s deepest blue-chip pool on ${chain} (a WETH/USDC-class pair, never a meme pair), and leave the LP position fee-accruing for the hold window.`,
      cost: `$${capital} of capital at risk plus gas`,
      time: '15 minutes to open',
      exit: 'pull the LP position and swap out the pool token',
    };
  }
  if (c === 'yield' || c === 'yield aggregator' || c === 'liquidity manager') {
    return {
      action: `Deposit $${capital} of USDC or a liquid staked-ETH asset into ${n}'s flagship auto-compounding vault on ${chain}, and leave the receipt token untouched so the compounding streak accrues.`,
      cost: `$${capital} of capital at risk plus gas`,
      time: '10 minutes to open',
      exit: 'exit the vault and swap the receipt back to the deposit asset',
    };
  }
  if (c === 'risk curators' || c === 'onchain capital allocator' || c === 'governance incentives') {
    return {
      action: `Deposit $${capital} into ${n}'s highest-yield curated vault on ${chain}, then move or re-balance it once into a second curated strategy so the wallet registers as an active allocator, not a parked depositor.`,
      cost: `$${capital} of capital at risk plus twice the gas`,
      time: '25 minutes across two sessions',
      exit: 'withdraw from the curated vault in one transaction',
    };
  }
  if (c === 'rwa') {
    return {
      action: `Finish ${n}'s onboarding (KYC where the tokenized asset requires it) and mint or buy $${capital} of its tokenized yield asset on ${chain}; hold the receipt token, which is the piece a future drop would snapshot.`,
      cost: `$${capital} of capital at risk plus gas`,
      time: '30-45 minutes including onboarding',
      exit: 'redeem the yield asset back to USDC',
    };
  }
  if (c === 'basis trading' || c === 'leveraged farming') {
    return {
      action: `Fund $${capital} into ${n}'s basis or spread strategy on ${chain} at the minimum leverage it offers, and let at least one full funding or harvest cycle settle before touching the position.`,
      cost: `$${capital} of margin at risk plus gas`,
      time: '15 minutes to open',
      exit: 'de-claim the strategy and withdraw the margin',
    };
  }
  if (c === 'derivatives' || c === 'perpetuals' || c === 'interest rate derivatives' || c === 'options' || c === 'options vault' || c === 'synthetics' || c === 'indexes') {
    return {
      action: `Open a $${capital} margin account on ${n} on ${chain}, place one small two-sided or hedged position (notional at most 2x the margin), and close it the next day so maker and taker activity both register.`,
      cost: `$${capital} of margin at risk plus gas`,
      time: '20 minutes over two days',
      exit: 'flatten the position and withdraw the margin',
    };
  }
  if (c === 'prediction market') {
    return {
      action: `Fund $${capital} on ${n} and take both sides of one near-dated market at roughly even odds, so activity registers at close to zero net exposure while the position stays live.`,
      cost: `$${capital} of stake at risk plus gas`,
      time: '15 minutes to place',
      exit: 'let the market settle, then withdraw',
    };
  }
  if (c === 'insurance') {
    return {
      action: `Buy $${capital} of cover on ${n} for a blue-chip vault the farming wallet already uses, and stake a matching amount into the capital pool if membership is open, registering both buyer and backer roles.`,
      cost: `$${capital} of premium and stake at risk`,
      time: '20 minutes to place',
      exit: 'let the policy lapse and unstake the capital',
    };
  }
  if (c === 'staking pool' || c === 'restaking' || c === 'anchor btc' || c === 'decentralized btc' || c === 'liquid staking') {
    return {
      action: `Stake $${capital} of the chain's native or BTC asset through ${n} on ${chain} and keep the staking receipt in the farming wallet; if epochs matter, stay in for at least two.`,
      cost: `$${capital} of capital at risk plus gas`,
      time: '10 minutes to stake',
      exit: 'unstake and wait out the unbonding period',
    };
  }
  if (c === 'chain' || c === 'payments') {
    return {
      action: `Route real activity through ${n} on ${chain}: fund the wallet with $${capital} of the chain's gas asset, make 8-10 transactions across its flagship app over two weeks, and keep a running balance rather than draining it.`,
      cost: `$${capital} of working capital plus gas`,
      time: 'spread over two weeks',
      exit: 'spend down or sweep the balance back to an exchange',
    };
  }
  if (c === 'cedefi' || c === 'crypto card issuer') {
    return {
      action: `Open the ${n} account, fund it with $${capital} of USDC, and place one on-chain yield position it wraps, so the wallet shows as an end-user of both the account and the underlying product.`,
      cost: `$${capital} of capital at risk`,
      time: '30 minutes including account setup',
      exit: 'close the wrapped position and withdraw',
    };
  }
  if (c === 'nft marketplace') {
    return {
      action: `Buy and list one floor-priced collection item (about $${Math.max(25, Math.round(capital / 4))}) on ${n} on ${chain}, and leave the listing live so the address reads as a marketplace user.`,
      cost: `about a quarter of the position size plus gas`,
      time: '15 minutes to place',
      exit: 'cancel the listing and sell or hold the item',
    };
  }
  return {
    action: `Deposit $${capital} of USDC into ${n}'s main product on ${chain} and keep the position open; if it offers more than one market, split the deposit across two so the wallet shows breadth.`,
    cost: `$${capital} of capital at risk plus gas`,
    time: '15 minutes to open',
    exit: 'withdraw the deposit in one transaction',
  };
}

/**
 * A protocol's farm plan: six steps, each with a concrete action, a cost and a time. Every number
 * is derived from the protocol's own record (category, chains, TVL tier, age, 7-day growth), never
 * from a hand-written list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasOn(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(age);
  const core = coreAction(p, capital, chain);
  const weeks = Math.max(4, Math.round(hold / 7));
  const growth = p.change_7d;
  let monitor: string;
  if (growth !== null && growth >= 15) {
    monitor = `Size in two tranches: commit half now and the rest only if TVL holds its level for two more weeks. ${p.name} grew ${growth.toFixed(1)}% in the snapshot's 7-day window, and one hot week can be a migration, an incentive campaign or noise the model cannot tell apart.`;
  } else if (growth !== null && growth <= -15) {
    monitor = `Enter at half size and log TVL weekly: ${p.name} shed ${Math.abs(growth).toFixed(1)}% over the snapshot's 7 days, so treat the current level as unstable and exit the farm entirely if TVL slides another 25% from your entry print.`;
  } else {
    monitor = `Track ${p.name}'s TVL against this snapshot's $${Math.round(p.tvl_usd / 1_000_000)}M print each week; if it falls more than 25% below your entry level, or the protocol ships a token, close the farm and re-read the board.`;
  }
  return [
    {
      action: `Open a dedicated farming wallet for this position only (a fresh seed phrase, stored offline), and fund it with the $${capital} of USDC plus the ${chain} gas token.`,
      cost: `${gas} for the two or three setup transactions`,
      time: '15 minutes',
    },
    { action: core.action, cost: `${core.cost} (${gas})`, time: core.time },
    {
      action: `Every 5-7 days make one small on-chain action on ${p.name} from the same wallet - a swap, a vault re-balance, a claim-and-restake or a small top-up - so the address reads as a repeat user across the whole ${hold}-day window, not a one-shot visitor.`,
      cost: `${gas} per weekly action, about ${weeks} of them`,
      time: `10 minutes a week for ${hold} days`,
    },
    { action: monitor, cost: 'free to check on the protocol\'s own stats page', time: '5 minutes a week' },
    {
      action: `Bookmark ${p.name}'s official points, streak or rewards page from its own docs today - never from a DM or a search ad - and claim only through the protocol's own claimer when a drop lands. A claim site that asks for a seed phrase is always a scam.`,
      cost: 'nothing; a legitimate claim never charges a deposit',
      time: '10 minutes when a claim opens',
    },
    {
      action: `Treat the whole $${capital} as venture-sized risk: a young ${categoryOf(p)} protocol can lose 100% of it to a bug or a rogue admin key, and ${chain} activity is unrecoverable once sent. Cap exposure there, keep the seed offline, and unwind in one session (${core.exit} on ${chain}).`,
      cost: `${gas} to unwind`,
      time: '20 minutes to unwind',
    },
  ];
}

/** A step as one string for board.json: action, cost, time - always inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and re-check the protocol's own page.`;
  return s;
}

// ------------------------------------------------------------------ the board

/** The board and the dashboard's data, built from one snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const calibration = calibrate(snapshot, model);
  const watchSet = new Set(snapshot.watchlist);

  // The board: every watchlist slug (the floor), plus every pre-token protocol below the floor that
  // passes the same product screens. Above the floor, off the watchlist, a pre-token protocol is
  // set aside and flagged, never ranked: the house's rule kept it off for a reason the snapshot
  // cannot name (a parented or wrapped product arm), and the board does not second-guess it.
  const chosen: SnapshotProtocol[] = [];
  const aside: AsideRow[] = [];
  for (const p of snapshot.protocols) {
    if (watchSet.has(p.slug)) {
      chosen.push(p);
      continue;
    }
    if (!isPreToken(p)) continue;
    const screen = productScreen(p);
    if (screen !== null) {
      if (p.tvl_usd >= snapshot.floor_usd) aside.push({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason: screen });
      continue;
    }
    if (p.tvl_usd < snapshot.floor_usd) chosen.push(p);
    else aside.push({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d, reason: 'pre-token and above the floor, yet off the house watchlist: typically a product arm of a group whose token may already trade' });
  }
  for (const slug of snapshot.watchlist) {
    if (!chosen.some((p) => p.slug === slug)) {
      const p = snapshot.protocols.find((x) => x.slug === slug);
      if (p !== undefined) chosen.push(p);
    }
  }

  const scored = chosen.map((p) => {
    const f = score(p, snapshot.as_of, calibration, model);
    return { p, f, segment: watchSet.has(p.slug) ? ('pre_token_watchlist' as const) : ('pre_token_emerging' as const) };
  });
  scored.sort((a, b) => b.f.implied - a.f.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const boardMaxTvl = scored.reduce((m, s) => Math.max(m, s.p.tvl_usd), 1);

  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    segment: s.segment,
    token_status: 'pre-token',
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    age_days: s.f.age_days,
    implied_value_usd: s.f.implied,
    conviction_score: conviction(s.p, s.f, boardMaxTvl, model),
    model: {
      peer_multiple: s.f.peer_multiple,
      category_efficiency: s.f.category_efficiency,
      category_comps: s.f.category_comps,
      momentum_multiplier: s.f.momentum_multiplier,
      maturity_multiplier: s.f.maturity_multiplier,
      breadth_multiplier: s.f.breadth_multiplier,
    },
    farm_steps: farmSteps(s.p, s.f.age_days).map(stepText),
  }));

  // The tokenized peers: the market's own prices, shown apart and used as the model's comps.
  const live: LiveRow[] = snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd >= model.comp_min_usd && p.tvl_usd >= model.comp_min_usd)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || (a.slug < b.slug ? -1 : 1))
    .slice(0, 24)
    .map((p) => ({ slug: p.slug, name: p.name, category: categoryOf(p), chains: p.chains, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd!, change_7d: p.change_7d, multiple: round3(clamp(p.mcap_usd! / p.tvl_usd, model.ratio_floor, model.ratio_cap)) }));

  const watchCount = board.filter((r) => r.segment === 'pre_token_watchlist').length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    snapshot_date: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    kpis: {
      watchlist: watchCount,
      emerging: board.length - watchCount,
      board: board.length,
      total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
      median_peer_multiple: round3(median(board.map((r) => r.model.peer_multiple))),
      comp_count: calibration.comp_count,
      live_count: live.length,
    },
    calibration,
    rows: board.map((r, i) => {
      const src = scored[i]!;
      return {
        rank: r.rank,
        slug: r.slug,
        name: r.name,
        segment: r.segment === 'pre_token_watchlist' ? ('watchlist' as const) : ('emerging' as const),
        category: r.category ?? 'Uncategorized',
        chains: r.chains,
        tvl_usd: r.tvl_usd,
        change_7d: r.change_7d,
        listed_at: r.listed_at,
        age_days: r.age_days,
        implied_value_usd: r.implied_value_usd,
        implied_low: src.f.implied_low,
        implied_high: src.f.implied_high,
        conviction_score: r.conviction_score,
        peer_multiple: r.model.peer_multiple,
        peer_low: src.f.peer_low,
        peer_high: src.f.peer_high,
        category_efficiency: r.model.category_efficiency,
        category_comps: r.model.category_comps,
        momentum_multiplier: r.model.momentum_multiplier,
        maturity_multiplier: r.model.maturity_multiplier,
        breadth_multiplier: r.model.breadth_multiplier,
        steps: farmSteps(src.p, src.f.age_days),
      };
    }),
    live,
    aside: aside.sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1)),
  };
  return { board, radar };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared value, farm steps. */
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
