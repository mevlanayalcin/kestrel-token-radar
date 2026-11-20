# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols (all 40 watchlist names plus 137 emerging finds below the $50M floor that pass the house's product screens) by an implied FDV, and nets each one to a farm verdict at a $1k, $10k or $50k deposit.

**Value model (kestrel-6).** A ridge regression fitted on the snapshot's 87 traded comps:

`log FDV = ybar + b1·z(log TVL) + b2·z(pass-through) + k·clamp(chg7d, ±30%) + log(1 − d·e^(−age/180))`

- *Pass-through family*: 1 when a category's TVL is depositors' capital routed through someone else's strategy (curators, capital allocators, RWA, CDP, yield, basis). A feature search scored seven candidate designs under one LOO pass. This flag was the only addition that raised blind R². Category fixed effects, home-chain fixed effects and chain count all lowered it.
- *Record terms, sign-constrained*: the comps cannot identify 7-day growth or seasoning. Their 7-day window runs −100%..+3%, and their age is time since listing, not time with no token, so a free fit puts both terms slightly negative. k and d are therefore held in a box whose floors are economic priors (k ∈ [0.25, 1], d ∈ [0.15, 0.5]), and leave-one-out picks the point inside it, together with λ. Rising TVL always raises a value, and older no-token TVL is never priced below new TVL. The terms cost 0.004 of LOO R².

| | LOO R² | nested LOO R² | walk-forward ρ |
|---|---|---|---|
| R3 | 0.153 | 0.106 | 0.216 |
| v4 | 0.133 | 0.091 | 0.183 |
| **v5 (this)** | **0.207** | **0.203** | **0.396** |

LOO ρ is 0.478, and 43% of comps land within 2× blind. The global and category median-multiple baselines score R² −0.80 and −0.48.

**Farm planner.** `EV = deposit/TVL × drop share × route share × FDV × time share`, at p25/p50/p75:
- *Drop share*: p25/p50/p75 of 12 documented community airdrops (6.93 / 9.25 / 12.45% of supply).
- *Route share*: 0.75 for deposit products, 0.4 for trading venues.
- *Time share*: the part of the points season the deposit is present for.

Costs are home-chain gas, a $3 bridge off Ethereum, and carry = 4.5% benchmark + route risk premium − the route's base APY. The deposit sits in the protocol's own yield product, so a curated vault paying 6% carries for free. FARM needs a p50 net APR of at least 8% with a p25 that does not lose. THIN is any positive p50. At $10k the board reads 67 FARM / 100 THIN / 10 SKIP. The 40 large watchlist vaults are 31 THIN / 9 SKIP there: a drop spread over billions of TVL is worth a fraction of a per cent, so they are a free option on stables already parked, never a reason to open a wallet. Each row carries 7 steps on its home chain, each with a cost and a time.

**Dashboard.** Dark terminal page:
- *Board*: a $1k / $10k / $50k capital switcher that recomputes every row, sortable columns, search, segment / verdict / category / chain filters, best setups, a 40-cell watchlist coverage matrix, and a verdict breakdown by category and chain.
- *Detail drawer*: a valuation waterfall, traded anchors, three-tier economics, a sensitivity chart and the plan.
- *Radar*: a log-log scatter of every row against the traded comps.
- *Traded & set aside*: the 87 comps and the 165 kept off the board, each with its reason.
- *Methodology*: the fitted equation, coefficient signs, the k×d grid, the blind LOO scatter, walk-forward folds, the feature search and the farm assumptions.

The page recomputes every implied FDV and every verdict from the shipped coefficients, and they match board.json for all 177 rows.

Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
node tools/verify.mjs ../token-radar-01-kit/input/snapshot.json out   # gate replica + cross-checks
python3 tools/shoot.py out                                               # E2E + screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
