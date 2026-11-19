# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols: all 40 watchlist names plus every emerging find below the floor that passes the house's product screens. Each one is priced by a ridge regression, `log(mcap) ~ log(tvl) + 7d momentum + log(time tracked with no token) + log(chains) + category fixed effects`, fitted on the snapshot's own 87 traded comps.

- **Board.** The page opens on the five best FARM opportunities (net expected return on a $1,000 deposit after gas, bridge and lock-up carry) and a verdict mix. Below them sits the full board ranked by implied FDV, with an inline Q25–Q75 band bar, named traded anchors and a net-EV bar on every row.
- **Detail view.** Each protocol gets a value bridge (typical comp × TVL × momentum × age × breadth × category = implied FDV), three named anchors that already trade, the farm economics at $1,000 / $5,000 / $25,000 with a pure pro-rata sensitivity row, a live page recompute that must match the board (`✓ matches board`), and a six-step plan with a cost and a time on every step.
- **Radar.** A log-log scatter of TVL against implied FDV, drawn over the 87 comps at their market cap with the fitted TVL elasticity line and the $50M floor. It follows the same filters as the board.
- **Methodology.** The fitted equation and coefficients, a leave-one-out calibration scatter with the ±2x band, a strict nested LOO (penalties re-selected inside each of the 87 folds), a temporal walk-forward, baselines (TVL-only OLS, shrink-median, category median), and a 758-protocol funnel bar that adds up exactly.

The validation numbers are reported as measured: LOO R² 0.153 (ρ 0.341); nested LOO R² 0.106; walk-forward pooled ρ 0.216. The shrink-median baseline scores R² −0.62. Re-tuned blind, the full ridge does not beat TVL alone (R² 0.136), and the page says so. That gap is why every row ships a dollar band and the verdict uses the mid-band. Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
