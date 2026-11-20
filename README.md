# kestrel-token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mevlanayalcin/kestrel-token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A pre-token farming radar over the sealed DefiLlama snapshot. It ranks 177 protocols (all 40 watchlist names plus 137 emerging finds below the $50M floor that pass the house's product screens) by an implied FDV, and nets each one to a farm verdict at a $1k, $10k or $50k deposit.

**Value model (kestrel-7).** A ridge regression fitted on the snapshot's 87 traded comps:

`log FDV = ybar + b1·z(log TVL) + b2·z(pass-through) + k·clamp(chg7d, ±30%) + log(1 − d·e^(−age/180))`

- *Pass-through family*: 1 when a category's TVL is depositors' capital routed through someone else's strategy (curators, capital allocators, RWA, CDP, yield, basis).
- *Record terms, sign-constrained*: the comps cannot identify 7-day growth or seasoning (their 7-day window runs −100%..+3%, and their age is time since listing, not time with no token), so a free fit puts both slightly negative. k and d are held in a box whose floors are economic priors (k ∈ [0.25, 1], d ∈ [0.15, 0.5]), and leave-one-out picks the point inside it, together with λ. Rising TVL always raises a value and older no-token TVL is never priced below new TVL; the page rechecks this on all 177 rows.
- *v6 feature search*: 13 designs each run the full protocol (their own λ, k, d by LOO, and their own walk-forward selection): pass × log TVL interaction, split own-fee / pass-through elasticities, a 3-family taxonomy (core trading/infra, credit/staking, pass-through), category and home-chain fixed effects, chain count, TVL per chain, category TVL share and rank, and a Huber loss. A design ships only if it beats the kept one on LOO R² and walk-forward ρ together. None does, so v6 keeps the v5 core. Split elasticities come out own-fee 0.26 vs pass-through 0.18 per log TVL: own-fee watchlist names (Bittensor dTAO, Curvance, Tydro) would move about +1%, and $1B+ vaults would fall a further 20-25%, at lower blind skill.

| | LOO R² | nested LOO R² | walk-forward ρ |
|---|---|---|---|
| R3 | 0.153 | 0.106 | 0.216 |
| v4 | 0.133 | 0.091 | 0.183 |
| v5 | 0.207 | 0.203 | 0.396 |
| **v6 (this)** | **0.207** | **0.203** | **0.396** |

LOO ρ is 0.478, and 43% of comps land within 2× blind. The global and category median-multiple baselines score R² −0.80 and −0.48.

**Farm planner.** `EV = deposit/TVL × drop share × route share × FDV × time share`, at p25/p50/p75:
- *Drop share*: p25/p50/p75 of 12 documented community airdrops (6.93 / 9.25 / 12.45% of supply).
- *Route share*: 0.75 for deposit products, 0.4 for trading venues.
- *Time share*: the part of the points season the deposit is present for.

Costs are home-chain gas, a $3 bridge off Ethereum, and carry = 4.5% benchmark + route risk premium − the route's base APY. The deposit sits in the protocol's own yield product, so a curated vault paying 6% carries for free. FARM needs a p50 net APR of at least 8% with a p25 that does not lose. THIN is any positive p50. At $10k the board reads 67 FARM / 100 THIN / 10 SKIP. The 40 large watchlist vaults are 31 THIN / 9 SKIP there: a drop spread over billions of TVL is worth a fraction of a per cent, so they are a free option on stables already parked, never a reason to open a wallet. Each row carries 7 steps on its home chain, each with a cost and a time.

**Farm basket.** For the selected capital, `basket()` splits it into 4 equal sleeves and fills them greedily by p50 net APR at the sleeve's own size, among FARM rows only, with no two sleeves on one home chain or in one category. At $10k (4 × $2,500) it holds Granite, GoonFi, 3Jane Lending and HertzFlow: blended p50 APR +21.7%, p50 profit $841 (p25 $216), $33 of gas and bridge. lib/model.ts ships the baskets in data.js, and the page and tools/verify.mjs rebuild them.

**Watchlist nuance.** 21 of the 31 THIN watchlist rows are *zero-carry free options*: the route's base APY covers the benchmark plus its risk premium, so stables parked there lose nothing and the drop is upside. Their plans and drawers say so. The 5 own-fee names (Bittensor dTAO, Hive, Curvance, Tydro, Noble) are marked as active signals, where usage and not just balance earns points.

**Dashboard.** Dark terminal page:
- *Board*: a $1k / $10k / $50k capital switcher that recomputes every row, sortable columns, search, segment / verdict (including p50 > 0) / category / chain filters, the farm basket, and a 40-cell watchlist coverage matrix with free-option and active-signal marks.
- *Detail drawer*: a valuation waterfall checked against board.json, a peer-multiple chart against three traded anchors, three-tier economics with Base / Conservative 1.5× dilution / Fast 12-week scenarios, a sensitivity chart with the FARM bar and break-even, and the 7-step plan.
- *Radar*: an opportunity map (log TVL against p50 net APR, bubble area = implied FDV, FARM bar, collision-free callouts), a category × home-chain yield matrix and the top FARM cards.
- *Traded & set aside*: the 87 comps and the 165 kept off the board, each with its reason.
- *Methodology*: the fitted equation, coefficient signs, the k×d grid with a monotonicity recheck, the 12-launch airdrop calibration, the blind LOO scatter, walk-forward folds, the R3 → v6 ablation and the full v6 feature search.

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
