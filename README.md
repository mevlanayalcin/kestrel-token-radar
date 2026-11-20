# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols: all 40 watchlist names plus every emerging find below the floor that passes the house's product screens. Each one is priced from its own TVL, 7-day growth and time with no token:

`log(FDV) = ridge[log(tvl) + log(chains) + category] + g·chg7d + log(1 − d·e^(−age/T))`

The ridge is fitted on the snapshot's own 87 traded comps. The record terms enter as a stated offset (g 0.75 on 7-day growth capped at ±30%; seasoning d 0.35, T 180 days), so a falling TVL always lowers a value and young, unseasoned TVL is priced as less sticky.

- **Board.** The page opens on the five best FARM opportunities (net expected return on a $1,000 deposit after gas, bridge and lock-up carry) and a verdict mix. Below them sits the full board ranked by implied FDV, with an inline Q25–Q75 band bar, named traded anchors and a net-EV bar on every row.
- **Detail view.** Each protocol gets a value bridge (typical comp × TVL × breadth × category × 7-day growth × seasoning = implied FDV), three named anchors that already trade, the farm economics at $1,000 / $5,000 / $25,000 with a break-even deposit and a pure pro-rata sensitivity row, a live page recompute that must match the board (`✓ matches board`), and a six-step plan with a cost and a time on every step, all on the protocol's home chain.
- **Radar.** A log-log scatter of TVL against implied FDV, drawn over the 87 comps at their market cap with the fitted TVL elasticity line and the $50M floor. It follows the same filters as the board.
- **Methodology.** The fitted equation and coefficients, the stated record constants, a leave-one-out calibration scatter with the ±2x band, a strict nested LOO, a temporal walk-forward, baselines (the same ridge without the record terms, TVL-only OLS, shrink-median, category median), and a 758-protocol funnel bar that adds up exactly.

Validation, as measured: LOO R² 0.133 (ρ 0.340), nested LOO R² 0.091, walk-forward pooled ρ 0.183. The same ridge without the record terms scores LOO R² 0.151 on traded comps: a traded token's market cap carries years of history that one week of growth barely explains. The terms are kept because a pre-token value "if the record stays as it is" has to move with that record. The shrink-median baseline scores R² −0.62. Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
