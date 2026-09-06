# Plan — deep BTCUSDT history from the Binance public archive

**Status: proposal. Nothing is built, nothing is downloaded in bulk, no table exists, no model is
trained.** This document exists so the owner can approve or reject a scope before any of that starts.

The v2 run (`2026-09-06-hybrid-ml-training-v2.md`) ended with the featureless baseline scoring better
than every fitted model in seven of eight cells. Its largest evaluation cell held **294 candidates**.
At that size the run cannot distinguish "these features carry no information" from "this interval was
too short to tell", and no amount of re-fitting the same 5,049 candidates will separate them. The
binding constraint is sample count, and BTCUSDT is the only instrument where that can change without
buying data.

---

## 1. The instrument was identified first, and it is not what the name suggests

Before proposing a source, the obvious question: **is the public archive even the same instrument the
feed has been recording?** Measured 2026-09-06, comparing `public.bars` for BTCUSDT against two
Binance archives on 2026-09-03 UTC, 141 overlapping 5-minute bars:

| candidate source | close difference (median) | bars within 0.5 USD | volume difference (median) | bars within 0.05 BTC |
|---|---:|---:|---:|---:|
| **futures/um (USDⓈ-M perpetual)** | **+0.00** | **141 / 141** | **+0.002** | **139 / 141** |
| spot | −35.70 | 0 / 141 | +303.061 | 0 / 141 |

**The ATAS feed's "BTCUSDT" is the Binance USDⓈ-M perpetual, not spot.** The residual 0.5 USD is our
own integer rounding of the close; the residual volume is the first decimal.

This mattered enough to check first. Spot tracks the perpetual closely in *movement* — on 2026-09-05
the two series correlate 0.97 on 5-minute returns — so a plan built on spot would have looked
plausible on a chart while being **35 USD and roughly 300 BTC per bar wrong**, on a market whose
whole edge question lives inside a few tens of dollars. A cross-check that only compared shapes would
have passed it.

Timestamp alignment was tested at the same time: shifting our series against the archive by ±6 bars,
the difference is smallest and the return correlation highest at **shift 0** (correlation 0.97,
difference standard deviation 6.1 USD, against 31–60 USD at every other shift). **The feed's clock is
not offset.** That is worth knowing given §0L's timeframe contamination.

### Two feed problems this comparison exposed, unrelated to Binance

- **The recorded price precision changed mid-session and has not changed back.** Census over
  2026-08-28 onward (second query in `docs/queries/btcusdt_identity_series.sql`): from 08-29 to 09-04
  only 4–15 closes a day land on a multiple of ten, which is what chance gives. On **2026-09-05 it is
  192 of 225**, and every off-grid close that day falls at or before **02:45 UTC**. On 09-06 it is
  54 of 54. The instrument did not change — the chart's price step did, partway through a session,
  and it is still that way. This is the same class of silent chart-setting change that produced §0L,
  caught this time because a comparison against an outside source made it visible.
- **The feed is not continuous on a market that never closes.** Bars recorded per UTC day since
  08-28: 258, 159, 224, 228, **288**, 192, 193, 225. Only 2026-09-02 is complete; 08-30 is missing
  129 of 288. The terminal being closed is the obvious explanation, and it is a reason not to treat
  "BTCUSDT sessions" as comparable units — and a reason the archive is worth having, since it has no
  such gaps.

An earlier count in this session put the 09-05 split at 194/31 rather than 192/33. That count was
computed from an export rounded to whole units, which turns a close of 79589.5 into an on-grid 79590.
The census query above reads the unrounded column and is the number to trust — a small illustration
of why the rounded series is fine for identifying an instrument and not for counting a grid.

### And one that strengthens an earlier flag

`instruments.tick_size` for BTCUSDT reads **10.0**. The Binance perpetual's tick is 0.1. Combined
with MNQU6 at 0.75 (three times the contract's 0.25) and GC at 0.30 (three times 0.10), the pattern
now looks like the indicator recording a **chart-level price step or cluster grouping rather than the
instrument's minimum tick**. That is still a hypothesis — it needs someone with the terminal open to
confirm — but it is a concrete lead for the flag raised in the v2 report, and it matters beyond this
plan because `tick_size` is the unit under `minRiskTicks` and every R-multiple in `public.signals`.

## 2. What the archive actually offers, measured

Checked from this environment on 2026-09-06:

| endpoint | result |
|---|---|
| `data.binance.vision` (bulk archive) | ✅ reachable, HTTP 200 |
| `api.binance.com`, `fapi.binance.com` (REST) | ❌ **HTTP 451** — blocked here |

So the plan uses the **bulk archive only**. Any design that depends on the REST API is not runnable
from this environment, and that constraint should be assumed rather than discovered later.

| file | size | note |
|---|---:|---|
| `futures/um/monthly/klines/BTCUSDT/5m/…-2026-08.zip` | 397 KB | OHLCV + taker-buy volume + trade count |
| `futures/um/daily/klines/BTCUSDT/5m/…-2026-09-03.zip` | 14 KB | daily files lag by a day or two |
| `futures/um/monthly/aggTrades/BTCUSDT/…-2026-08.zip` | **436 MB** | per-trade, with the aggressor flag |

Twelve months of klines is roughly 5 MB. Twelve months of aggTrades is roughly **5 GB compressed**,
and that is the file the footprint has to be rebuilt from.

## 3. What it buys

We hold **2,311** BTCUSDT bars. One year of the perpetual is **105,120** bars — about **45×**.

The v2 eligibility rate was 34.6%, but that number is dominated by two exclusions that are artifacts
of the ATAS feed rather than the market: bars whose footprint does not reconcile, and off-grid bars.
A dataset rebuilt from aggTrades has neither by construction — the footprint is derived from the
trades, so it reconciles by definition, and every bar sits on the grid because the bars are built on
it. **The eligible fraction should be far higher, and it must be measured rather than assumed.** Even
at v2's pessimistic rate, a year puts the evaluation cell in the tens of thousands instead of 294.

That is the whole point. It does not make an edge appear. It makes the question answerable.

## 4. What can and cannot be reconstructed

`aggTrades` gives, per aggregated trade: price, quantity, timestamp, and `is_buyer_maker`. From that:

| current field | reconstruction | fidelity |
|---|---|---|
| open/high/low/close, volume | aggregate trades into 5-minute bins | exact |
| `ask_volume` / `bid_volume` | sum by aggressor side (`is_buyer_maker` false = taker buy) | exact, and the same definition the current footprint uses |
| `cluster_levels` per price | group trades by price bin within the bar | exact, at whatever bin size is chosen |
| `poc_price` | the price bin holding the most volume | exact, same tie rule as the current query |
| `ticks`, `trades` | count of aggregated trades | **not identical** — aggTrades merges same-price fills from one taker order, so this is an aggregated count, not the terminal's tick count |
| DOM, resting liquidity, order book | — | **impossible from trades** |

The last two rows are the honest limits. Any feature that depends on resting liquidity cannot come
from this source at any price, and `log_ticks` — one of the eleven v1/v2 features — changes meaning,
so a reconstructed dataset is **not** a drop-in extension of the ATAS-fed rows. It is a second
dataset that happens to describe the same instrument.

**The bin size must be chosen and recorded, not inherited.** The feed's own grid changed from 1 to 10
units mid-session; the reconstruction should pick one bin size, record it in the config, and treat it
as a parameter of the experiment.

## 5. Where the data goes

**Recommended: nowhere near Supabase.** Keep the reconstruction entirely local, beside the existing
research data, exactly as v1 and v2 snapshots already live outside Git and outside production. The
training pipeline reads a snapshot file, not the database, so nothing in the ML path requires a table.

That choice means **no migration, no Edge Function, no production surface, and nothing for §0L or
0035 to interact with**. The cheapest safe option is the one that adds no production state at all.

A table is worth revisiting only if the dashboard needs to display this history. If that day comes it
is a separate proposal, and it inherits the rule that has held since §ญ.11: a **separate table with
its own provenance columns, no rule evaluation, and no write to `public.bars` or `public.signals`**.
Sending reconstructed bars through `ingest` would run today's rules over historical bars and
contaminate every statistic computed on that table. That is forbidden, not discouraged.

## 6. Gate 0 — what must pass before a single row is trained on

Run and record all of it before any model sees this data. Any failure stops the work.

1. **Identity, at scale.** Repeat §1 across every month to be used, not one day: median and maximum
   close and volume difference against `public.bars` for every overlapping bar. Publish the counts.
   A month that does not match is a month that is not the same instrument, and it is excluded rather
   than adjusted.
2. **Contract continuity.** The perpetual has no expiry, but symbol history, tick-size changes and
   listing changes exist. Record the archive's own file list and any month that is missing or short.
3. **Footprint reconstruction, validated against the terminal.** For the window where both exist,
   rebuild `ask_volume`, `bid_volume`, `poc_price` and the per-price levels from aggTrades and
   compare them against what ATAS actually sent. **This is the load-bearing check**: if the
   reconstruction cannot reproduce the feed's own footprint on the overlap, it cannot be trusted on
   the years where there is nothing to compare against. Report the distribution of differences, not
   a pass/fail.
4. **Grid and completeness.** Every reconstructed bar on the 5-minute grid, no duplicate timestamps,
   one instrument identity, and an explicit census of missing bars — the archive should have no gaps,
   which is itself a difference from the feed worth stating.
5. **Timestamp convention.** The archive's kline `open_time` is the bar's opening instant, matching
   `bars.opened_at`; confirm on a sample rather than assuming, since the two archives use
   milliseconds (futures) and microseconds (spot) and getting this wrong shifts every label by a bar.
6. **Leakage review of the new fields.** `taker_buy_volume` is known only at bar close, like the
   existing aggressive-imbalance feature. Confirm no field in the reconstruction is available only
   after the decision time.

## 7. If Gate 0 passes: the experiment

A v3 config, frozen before any score is computed, in the same shape as v1 and v2:

- **Scope**: BTCUSDT perpetual only. Do not pool with the futures instruments — different venue,
  different session structure, and v2 already showed cross-venue counts are not comparable.
- **Split**: contiguous and chronological — train, then calibration, then evaluation — with the same
  maximum-horizon purge at every boundary. Reserve the most recent months and **do not look at them**
  until the rest is finished.
- **Unchanged**: features, barriers, horizon, purge rule, estimators, hyperparameters, seed. The
  point is to re-ask v2's question with enough samples to answer it, not to search for a better
  model. `log_ticks` needs an explicit decision — reconstructed or dropped — recorded in the config.
- **Reported**: the same three numbers, the same refusal to call accuracy a win rate, the same
  baseline in every cell. **With this many samples, block resampling over non-overlapping periods
  becomes possible for the first time**, which is what `EXPERIMENT_REVIEW_PROTOCOL.md` §5 requires
  before any claim of significance. That is a deliverable of v3, not an afterthought.
- **Pre-registered decision rule**: state before running what result would count as an edge, so the
  answer cannot be negotiated afterwards.

## 8. What this cannot settle

It cannot make BTCUSDT evidence about MNQ, GC or NQ — those stay sample-starved, and a paid vendor
remains the only way to change that. It cannot recover resting liquidity. It cannot repair the
timeframe contamination in `public.signals`, apply 0035, or unblock anything in §0L or §0M. It
carries no cost, fill, latency or P&L model, so even a clean result would be a forecasting result and
not a trading one. And it can perfectly well conclude, on tens of thousands of samples, that these
features carry nothing — which would be the most useful outcome available, and should be planned for
rather than treated as failure.

## 9. Effort, roles, approval

Roughly: reconstruction and Gate 0 first, on one month, as a throwaway that either validates the
footprint against the terminal or ends the plan. Only if that passes does bulk download and the v3
run follow. The download is bandwidth, not compute; the fit is a sub-minute job at v2's size and will
grow with the sample count.

This document is a proposal by the same session that ran and reported v2, so it is **not** an
independent review and cannot approve itself. The owner decides whether the scope proceeds. Gate 0
must be recorded by whoever runs it, and the reconstruction validation in §6.3 should be checked by
someone other than its author before v3 is fitted. Nothing here changes production; if the plan is
rejected, nothing needs to be rolled back, because nothing was built.
