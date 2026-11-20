# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols (all 40 watchlist names plus 137 emerging finds below the $50M floor that pass the house's product screens) by implied FDV if a token launches. Each one also gets its odds of launching within 12 months and a two-outcome farm verdict at a $1k, $10k or $50k deposit. All 758 protocols in the snapshot are accounted for, each in exactly one bucket.

**Value model (kestrel-8).** A ridge regression fitted on the snapshot's 87 traded comps:

`log FDV = ybar + b1·z(log TVL) + b2·z(pass-through) + k·clamp(chg7d, ±30%) + log(1 − d·e^(−age/180))`

- *Pass-through family*: 1 when a category's TVL is depositors' capital routed through someone else's strategy (curators, capital allocators, RWA, CDP, yield, basis).
- *Record terms, sign-constrained*: the comps cannot identify 7-day growth or seasoning, so k and d sit in a box whose floors are economic priors (k ∈ [0.25, 1], d ∈ [0.15, 0.5]), and leave-one-out picks the point inside it, together with λ.
- *Feature search*: 15 designs each run the full protocol with their own λ, k and d. v7 added (log TVL)² and the category token rate of all 758 peers. A design ships only if it beats the kept one on LOO R² and walk-forward ρ together. None does, so the v5 core stays.

| | LOO R² | nested LOO R² | walk-forward ρ | P(token) LOO AUC |
|---|---|---|---|---|
| R3 | 0.153 | 0.106 | 0.216 | none (P ≡ 1) |
| v4 | 0.133 | 0.091 | 0.183 | none (P ≡ 1) |
| v5 / v6 | 0.207 | 0.203 | 0.396 | none (P ≡ 1) |
| **v7 (this)** | **0.207** | **0.203** | **0.396** | **0.755** |

**Launch odds P(token).** A logistic launch curve F fitted on all 758 protocols (416 record a token): log age, an undated flag, the category's empirical-Bayes token rate (encoded out-of-fold, m = 10) and log TVL. Read as cohorts, F(a) is the share of look-alike protocols that carry a token by age a. A protocol with no token at age a then launches within a year with odds `P = (F(a + 365) − F(a)) / (1 − F(a))`. Terms enter by forward search only when they lower both the LOO and the walk-forward log-loss. log(chains) brought no held-out gain. 7-day growth came out negative (points campaigns pull TVL into pre-token protocols), so the sign rule refused it.

| held-out | Brier | base-rate Brier | log-loss | ROC-AUC |
|---|---|---|---|---|
| LOO (758 refits) | 0.2005 | 0.2483 | 0.588 | 0.755 |
| walk-forward (3 folds, 484 rows) | 0.2618 | 0.3158 | 0.784 | 0.655 |

LOO calibration by quintile: predicted 22 / 45 / 57 / 69 / 81% against observed 21 / 44 / 57 / 70 / 82%. Board odds run from 6% (young curators) to 51% (Bittensor dTAO). Curated vaults sit at 7-10%, young DEXs at 40-50%. The cross-section assumes launch behaviour is stable across listing cohorts; walk-forward is the check on that.

**Farm planner, two outcomes.** `EV_q = deposit/TVL × drop share × route share × FDV_q × time share` at p25/p50/p75. A: a token ships (odds P) and the drop pays EV_q. B: no token, no drop. Gas, bridge and carry (4.5% benchmark + route risk premium − the route's base APY) are paid either way. The blended net is `P × EV_q − costs`. FARM needs a blended p50 net APR of at least 4% (on top of the benchmark and premium) and a p25 that does not lose. THIN is any positive blended p50. Every row shows the blended APR beside the if-token APR, and break-even uses the blended edge.

| deposit | FARM | THIN | SKIP |
|---|---|---|---|
| $1k | 7 | 45 | 125 |
| $10k | 11 | 113 | 53 |
| $50k | 13 | 131 | 33 |

v6 assumed every protocol launches and showed 67 FARM at $10k. Pricing the no-token outcome leaves 11. The 40 watchlist names are 0 FARM / 9 THIN / 31 SKIP at $10k. A drop spread over billions of TVL at 7-30% odds is worth less than the gas. For the 21 zero-carry rows, the no-token outcome costs only gas.

**Farm basket.** `basket()` splits capital into 4 equal sleeves, filled greedily by blended p50 APR at the sleeve's own size, among FARM rows only, one sleeve per home chain and at most 2 per category. At $10k (4 × $2,500) it holds GoonFi, Granite, Vena Finance and Temple: blended APR +7.0%, p50 profit $314 (p25 $64), $21 of gas and bridge, and an 84% chance that at least one of the four launches within a year. At $1k no sleeve clears FARM.

**758 / 758 accounting.** 40 watchlist + 137 emerging (ranked) + 87 traded comps + 329 other tokened protocols + 92 set aside at or above the floor + 73 screened below it = 758. The *All 758 / Audit* tab lists each one with its exact reason and its held-out launch-curve probability.

**Dashboard.** Dark terminal page:
- *Integrity strip*, computed in the browser on boot: 758/758 accounted, 40/40 watchlist ranked, 177/177 rows whose FDV, P(token) and three two-outcome verdicts recompute to board.json, and 708/708 monotone sign checks (growth up never lowers FDV, growth down never raises it, older never lowers FDV, older never raises P).
- *Board*: $1k / $10k / $50k switcher, a sortable table (TVL, 7d, P(token), implied FDV Q25–Q75, risk-adj net APR with the if-token APR, break-even, verdict), search and segment / verdict / category / chain filters. The sidebar shows the top 5 farm setups and a 40-cell watchlist grid. With the FARM filter on it shows the 4-sleeve allocator and category / home-chain breakdown bars.
- *Detail drawer*: valuation waterfall and peer-multiple chart checked against board.json, the launch-odds derivation, a token-ships / no-token / blended table at all three tiers, a sensitivity chart with the FARM bar and break-even, a cost and risk checklist, and the 7-step plan.
- *Methodology*: both equations, coefficient signs, the monotonicity proof, the 12-launch airdrop calibration, the blind LOO scatter, the P(token) calibration curve, walk-forward folds for both models, the version ablation, the 758 accounting and both feature searches.

Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
node tools/verify.mjs ../token-radar-01-kit/input/snapshot.json out   # gate replica + cross-checks
python3 tools/shoot.py out                                               # E2E + screenshots (written to out/screenshots)
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
