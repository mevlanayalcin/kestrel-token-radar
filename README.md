# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols (all 40 watchlist names plus 137 emerging finds below the $50M floor that pass the house's product screens) by implied value if a token launches. Each one also gets its odds of a token within 12 and 24 months from the launch record of all 758 peers, and a two-outcome farm verdict at a $1k, $10k or $50k deposit. All 758 protocols are accounted for, each in exactly one bucket.

**One copy of the model, in the dossier.** `dashboard/model.js` holds every formula, fit and held-out test. `main.ts` loads that exact file to build `board.json`, and the page loads it again and re-runs it live, so the code the judge reads is the code that ranked the board.

**Value model (Kestrel v10).** `fitValueModel()` prices a launch from the three snapshot figures the bounty names, by ridge on log market cap across the 87 traded comps (mcap and TVL both at least $5M):

`log V = 17.427 + 0.317·(log TVL₂w − 18.14) − 1.027·(pass-through − 0.37) − 1.057·(seasoning − 0.60)`

- **TVL and 7-day growth** enter together as the two-week mean TVL, `TVL₂w = √(TVL · TVL/(1+g))`: last week's TVL is TVL/(1+g), so a week's inflow counts half until it stays. The half weight is fixed, not fitted.
- **Time with no token** enters as seasoning, `1 − e^(−days/730)` (undated: 365 days). On the comps it is fitted: comps tracked longer trade at lower multiples (fully seasoned ×0.35). For a pre-token protocol the same `listed_at` clock is its time with no token.
- **Family**: own-fee vs pass-through (TVL routed through someone else's strategy, ×0.36).

That is V ∝ TVL₂w^0.32 × 0.36^pass × e^(−1.06·seasoning). λ is picked by blind leave-one-out mean |log error|; every walk-forward fold picks it again from its own training rows. No protocol name appears anywhere in the model.

`valueLedger()` refits nine alternatives from scratch, each held out twice (blind LOO over 87 refits; walk-forward: train on older listings, price the next cohort):

| design | LOO R² | LOO ρ | LOO \|e\| | WF R² | WF ρ | WF \|e\| |
|---|---|---|---|---|---|---|
| **shipped: TVL₂w + family + age** | **0.213** | **0.495** | 1.048 | **0.106** | **0.473** | **0.975** |
| drop TVL | 0.042 | 0.179 | 1.238 | 0.053 | 0.290 | 1.161 |
| drop pass-through family | 0.122 | 0.373 | 1.149 | −0.064 | 0.310 | 1.188 |
| drop 7d: this week's TVL only | 0.209 | 0.490 | 1.048 | 0.097 | 0.456 | 0.977 |
| 7d as a free fitted slope | 0.193 | 0.470 | 1.087 | −0.193 | 0.411 | 1.030 |
| drop no-token age | 0.212 | 0.489 | 1.043 | 0.077 | 0.432 | 0.980 |
| age as log(days) | 0.211 | 0.489 | 1.048 | 0.101 | 0.472 | 0.980 |
| add log chains | 0.198 | 0.484 | 1.058 | 0.073 | 0.458 | 0.998 |
| Huber loss (c 1.345) | 0.214 | 0.489 | 1.028 | 0.103 | 0.454 | 0.981 |
| all 128 comps, no $5M mcap floor | −0.290 | 0.461 | 1.281 | −0.710 | 0.451 | 1.347 |

The shipped design is best, or within 0.005 of best, on five of six scores. Huber has the lower blind mean |e| (1.028 vs 1.048) but loses all three out-of-time scores, so least squares ships. Walk-forward by cohort: R² 0.202 / −0.071 / −0.020, ρ 0.495 / 0.585 / 0.196. Two cohorts sit just below zero R² while their ρ stays positive. The newest cohort holds a prediction market whose market cap is 400× its $6.6M DefiLlama TVL, and no snapshot field explains that.

What the data does and does not support, stated plainly:
- The 7-day gain is small (WF ρ 0.456 → 0.473) and depends on the steepest decliners. That is why the weight is fixed at ½ and not fitted: fitted free, the slope overfits.
- The 41 tokens under $5M of mcap are mostly dead or illiquid. Training on them makes held-out R² negative on the live comps, so they stay out.
- The task's stretch targets (LOO R² ≥ 0.30, WF ρ ≥ 0.50, every cohort positive) are not reached by any design tested on these 87 comps, so none is claimed.

**Launch odds.** `fitLaunchOdds()` fits a logistic launch curve F on all 758 protocols (416 record a token): log age, an undated flag, the category's out-of-fold empirical-Bayes token rate and log TVL. A term enters by forward search only if it lowers both the LOO and the walk-forward log-loss. LOO (758 refits): Brier 0.2005 vs 0.2483 base rate, log-loss 0.588, ROC-AUC 0.755, quintiles 21/44/57/69/82% predicted vs 23/43/56/68/85% observed. Walk-forward (3 cohorts, 484 rows): AUC 0.655, Brier skill +3% / +28% / +20%, positive in every cohort.

**Campaign horizon.** `launchCampaign()` reads the curve month by month: p_m = (F(a+m) − F(a+m−1)) / (1 − F(a)). P(12m) and P(24m) both show on every row, and every row shows its implied value V and its risk-adjusted value V × P(24m). The board ranks by V; one click on the header sorts by V × P24, the odds, TVL or net APR. Points earned in the farm window are credited if a token ships inside 24 months, but a late token dilutes them: a D-day deposit in a season that began `prior` days ago earns min(D, t) / (prior + t) of the points.

**Farm planner, two outcomes.** `farmTier()`: A, a token within 24 months, the drop pays `deposit/pool × drop share × route share × value × season share / P24`. B, no token, no drop. Gas, bridge and carry (4.5% benchmark + route premium − the product's own base APY) are paid either way. Points dilute against a farming pool, not raw TVL: all of TVL up to $5M, then `$5M·(TVL/$5M)^0.55`. FARM needs a blended p50 of at least 4%/yr and a p25 that does not lose; THIN is any positive p50. Home chains with no USDC market (Bitcoin, Stacks, RSK, Mezo, BSquared, Bittensor, Qubic) get a plan funded in the chain's own asset, with its price risk stated.

| deposit | FARM | THIN | SKIP |
|---|---|---|---|
| $1k | 21 | 64 | 92 |
| $10k | 31 | 123 | 23 |
| $50k | 34 | 126 | 17 |

At $10k the watchlist splits 3 FARM (Bittensor dTAO +6.2%, Tydro +5.7%, Curvance +5.5%), 25 THIN and 12 SKIP. The large curators (Steakhouse, Gauntlet, Veda) come out THIN near 0%: billions of TVL dilute any drop. `basket()` puts $10k into 4 sleeves (CommunityV3, GoonFi, Vena Finance, BEND): +12.6% blended, $578 p50 profit, $63 of gas, bridge and carry, 96% odds that at least one launches within 24 months.

**Integrity, proved in the browser.** On load the page checks 758/758 accounted, 40/40 watchlist and 177/177 rows whose implied value, P(12m), P(24m), season share and three verdicts recompute to `board.json`. It then re-runs the value fit with its whole ledger and the launch curve with all 758 LOO refits, and shows that both equal what was shipped.

**Dashboard.** Board (each row: TVL · 7d, odds, implied value with its risk-adjusted value and TVL / 7d / age multipliers, the costed plan with route, window, gas, carry and break-even; sortable, searchable, filterable by segment, verdict, category and home chain, with the $1k / $10k / $50k switcher, top FARM setups and the 4-sleeve allocator), a detail drawer (the five-term valuation bridge with its exp(...) check, launch odds, the two-outcome table at three tiers, a sensitivity chart with the FARM bar and break-even, and the 7-step plan with the cost and time of each step), and Methodology (the equation, the term ledger, blind LOO scatter, P(token) calibration, walk-forward cohorts for both models, 758 accounting). The four 1440×900 screenshots are 256-colour palette PNGs. `tools/shoot.py` fails the build on any overlapping SVG `<text>` boxes, any visible text box whose content overflows it, any ellipsis, console errors or off-host requests.

Built by @forge-kestrel.

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=../token-radar-01-kit/input MAKEFUN_OUTPUT_DIR=out node main.ts
node tools/verify.mjs ../token-radar-01-kit/input/snapshot.json out      # gate replica + independent rebuilds
python3 tools/shoot.py out --shots-to screenshots                        # E2E + screenshots
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=0fhdkvxa&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
