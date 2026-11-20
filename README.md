# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols (all 40 watchlist names plus 137 emerging finds below the $50M floor that pass the house's product screens) by implied FDV if a token launches. Each one also gets its odds of a token within 12 and 24 months from the launch record of all 758 peers, and a two-outcome farm verdict at a $1k, $10k or $50k deposit. All 758 protocols are accounted for, each in exactly one bucket.

**One copy of the model, in the dossier.** `dashboard/model.js` holds every formula, fit and held-out test. `main.ts` loads that exact file to build `board.json`, and the page loads it again and re-runs it live, so the code the judge reads is the code that ranked the board.

**Value model (kestrel-9).** Ridge on the snapshot's 87 traded comps, λ picked by LOO:

`log FDV = ybar + b1·z(log TVL) + b2·z(pass-through)` (×2.04 per 10× TVL, ×0.41 when TVL is routed capital)

`valueLedger()` fits 13 candidate terms free (no sign box, no clamp) and tests each held-out twice: leave-one-out over the 87 comps and walk-forward by `listed_at` (train older, predict newer, λ re-picked per fold). A term ships only if it raises LOO R² and walk-forward ρ, with a sign that agrees with its rank correlation to the core residuals. The candidates are 7-day growth in five forms (clamp ±30%, excess over category median, asinh, log(1+g), clamp ±15% under Huber loss), age in three forms (each with an undated flag), multi-chain, (log TVL)², split elasticities, Huber loss and no target winsorizing. None passes. 7-day growth fits negative only because four comps that lost 22-37% of TVL in the week carry the slope (rank correlation +0.07). Age gains only through the 365-day stand-in for missing dates and loses once an undated flag absorbs it. So growth and age enter where they hold up: the launch odds, the farm window and the entry tranche.

| | LOO R² | LOO ρ | walk-forward ρ | P(token) LOO AUC |
|---|---|---|---|---|
| v5 / v6 | 0.207 | 0.478 | 0.396 | none (P ≡ 1) |
| v7 (sign-boxed growth/age) | 0.207 | 0.478 | 0.396 | 0.755 |
| **v8 (this)** | **0.211** | **0.481** | **0.446** | **0.755** |

**Launch odds.** `fitOdds()` fits a logistic launch curve F on all 758 protocols (416 record a token): log age, an undated flag, the category's out-of-fold empirical-Bayes token rate and log TVL. A term enters by forward search only if it lowers both the LOO and the walk-forward log-loss; log chains brought no gain and 7-day growth came out negative, so both stay out. LOO (758 refits): Brier 0.2005 vs 0.2483 base rate, log-loss 0.588, ROC-AUC 0.755, quintiles 21/44/57/69/82% predicted vs 23/43/56/68/85% observed. Walk-forward (3 folds, 484 rows): AUC 0.655, Brier skill +17%.

**Campaign horizon.** `campaign()` reads the curve month by month: p_m = (F(a+m) − F(a+m−1)) / (1 − F(a)). P(12m) and P(24m) both show on every row. Points earned in the farm window are credited if a token ships inside 24 months, but a late token dilutes them: a D-day deposit in a season that began `prior` days ago earns min(D, t) / (prior + t) of the points. The season share is Σ p_m × that dilution.

**Farm planner, two outcomes.** `farmTier()`: A, a token within 24 months, the drop pays `deposit/TVL × drop share × route share × FDV × season share / P24`. B, no token, no drop. Gas, bridge and carry (4.5% benchmark + route premium − the product's own base APY) are paid either way. FARM needs a blended p50 of at least 4%/yr and a p25 that does not lose; THIN is any positive p50.

| deposit | FARM | THIN | SKIP |
|---|---|---|---|
| $1k | 4 | 46 | 127 |
| $10k | 10 | 113 | 54 |
| $50k | 10 | 133 | 34 |

No watchlist name clears FARM: a drop spread over $51M to $2.75B of TVL at 13-65% odds within 24 months is worth less than the carry. Even if a token were certain, none of the top 11 ranks clears the bar at $10k (best if-token APR +3.8%), so the FARM setups are small emerging protocols (ranks 34-172). `basket()` puts $10k into 4 sleeves (GoonFi, Granite, Vena Finance, Temple): +6.2% blended, $277 p50 profit, $21 of gas and bridge, 95% odds that at least one launches within 24 months.

**Integrity, proved in the browser.** On load the page checks 758/758 accounted, 40/40 watchlist and 177/177 rows whose FDV, P(12m), P(24m), season share and three verdicts recompute to `board.json`. It then re-runs the value fit with its whole ledger and the launch curve with all 758 LOO refits, and shows that both equal what was shipped (about 1 s).

**Dashboard.** Board (sortable, searchable, filterable by segment, verdict, category and home chain, with the $1k / $10k / $50k switcher, top FARM setups and the 4-sleeve allocator), a detail drawer (valuation, launch odds, the two-outcome table at three tiers, a sensitivity chart with the FARM bar and break-even, and the 7-step plan with the cost and time of each step), and Methodology (the term ledger, blind LOO scatter, P(token) calibration, walk-forward folds for both models, version ablation, 758 accounting). The four screenshots are 256-colour palette PNGs. `tools/shoot.py` fails the build on any overlapping SVG `<text>` boxes, clipped labels, console errors or off-host requests.

Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
node tools/verify.mjs ../token-radar-01-kit/input/snapshot.json out      # gate replica + independent rebuilds
python3 tools/shoot.py out --shots-to screenshots                        # E2E + screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
