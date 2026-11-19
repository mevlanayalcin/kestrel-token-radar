# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

An institutional pre-token radar over the sealed DefiLlama snapshot: 177 ranked protocols — all 40 watchlist names plus every emerging find that passes the product screens — each priced by a fitted log-linear ridge regression, `log(mcap) ~ log(tvl) + category fixed effects + 7d momentum + log(age) + log(chains)`, run on the snapshot's own 87 tokenized comps. The model is validated twice before it prices anything: leave-one-out (87 blind refits) and temporal walk-forward (train on older listings, predict newer cohorts blind), both scored beside the hand-set median-multiple baseline it replaces. Every row ships the named traded-token anchors behind its valuation, a dispersion band from the LOO residuals, deposit-sized net-EV farm economics at $1,000 and $5,000 (airdrop band × capture, minus gas, bridge and lock-up carry) with a solid FARM/THIN/SKIP verdict, and a six-step farm plan with cost and time tags — and the dashboard recomputes each number live to prove the board and the code agree. All 758 protocols on the snapshot are accounted for by name and reason. Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
