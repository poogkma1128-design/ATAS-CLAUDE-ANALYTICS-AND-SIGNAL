# SIGNAL PARAMETER — COMEX GC Level 2 / MBO, 5-minute context

**Status:** implementation-ready research specification, `PROVISIONAL / SHADOW ONLY`

**Written:** 2026-09-09 (Asia/Bangkok)

**Repository reference:** `origin/main` observed at `ffa282a`

**Instrument first:** `GCZ6@COMEX` through Rithmic

**Context timeframe:** `5m` remains unchanged

**Decision clock:** MBO and prints are processed event-by-event; a valid microstructure trigger must not wait for the next 5-minute close

> This document is a build specification, not evidence that any signal has an edge. All parameter values
> marked `STARTING VALUE` are pre-registered bootstrap values for Gate 0 and shadow collection. They must
> not alter Telegram, live rules, confidence filters, or order execution until the experiment protocol,
> independent review, and owner approval are complete.

---

## 0. Live decision for 2026-09-09

### 0.1 Decision

For **today only**, the most defensible existing GC signal is:

```yaml
selection: GC 5m speed_of_tape LONG
rule_key: speed_of_tape
direction: long
announcement_mode: evidence_first
telegram_state: already enabled in production
execution_state: OBSERVE_ONLY
real_money_go_no_go: NO_GO
```

Do not enable `speed_of_tape` short, do not switch the rule to `manual`, and do not substitute a new MBO
signal today. Production evidence currently classifies `speed_of_tape / GC / 5m / long` as `proposable`,
while the short cell is `sessions disagree`. This is a provisional operational selection, not a claim of
future profitability.

### 0.2 Why this is the quality/quantity compromise

Read-only production evidence observed at `2026-09-09T04:49:56Z`:

| Evidence slice | Trades/alerts | Wins | Sessions | Stability/result |
|---|---:|---:|---:|---|
| Stored stability, Long | 96 | not used for this gate | 8 | 7 up / 1 down, worst session `-1.50R`, `proposable` |
| Stored stability, Short | 87 | not used for this gate | 8 | 6 up / 2 down, `sessions disagree` |
| Telegram-sent Long, 2026-09-02 onward | 35 | 27 | 5 active dates | modeled expectancy `+0.385R`; about 7 alerts per active date |
| Telegram-sent Short, same slice | 4 | 1 | insufficient | modeled expectancy `-0.472R` |

These are **modeled signal outcomes**, not broker fills. They exclude commission, slippage, latency,
missed fills, and discretionary execution. The date range is short, and the parameters were not selected
on an untouched holdout sample. For the recent Telegram slice, R was recomputed from the physical
Entry-to-SL and Entry-to-Exit price distances instead of trusting the stored `risk_ticks`. Never convert
the table into an expected daily income figure.

Current production parameters remain unchanged:

```json
{
  "rule_key": "speed_of_tape",
  "timeframe": "5m",
  "direction_allowed_by_evidence_gate": "long",
  "minRateRatio": 2.0,
  "edgeShare": 0.30,
  "rateHistory": 10,
  "announcementMode": "evidence_first"
}
```

No extra filter such as delta alignment, MBO iceberg, or order-book pressure may be turned on from this
small in-sample slice. Such filters remain hypotheses under the shadow protocol in the rest of this file.

### 0.3 Blocking safety defect: live plan and outcome units disagree

The latest Telegram-sent GC signal at `2026-09-09T04:30:04.660084Z` recorded:

```text
entry = 4424.0
stop = 4420.0
stored risk_ticks = 10 chart rows
true GC tick size = 0.1
true entry-to-stop distance = 4.0 points = 40 ticks = about USD 400 per GC contract
modeled result = stop, -4.0 points = about USD -400 per GC contract before costs
```

The bridge supplied a chart price step of `0.4` to the plan builder, whereas the curated COMEX GC tick is
`0.1`. The plan therefore called a 4-point stop “10 ticks”; the outcome scorer, correctly using `0.1`,
recorded `-40 ticks`. The old Telegram formatter displayed the physical price risk (`4.0`) but did not show
true ticks or cash risk. More importantly, stored R and trailing thresholds mixed the two units, so modeled
outcomes from this path are not a valid estimate of the corrected contract.

#### Local implementation completed — not deployed

Branch `codex/gc-l2-live-readiness`, implementation commit `f34d0d9`, now separates the units:

```text
chartTickSize      = payload.tickSize       # footprint adjacency only
instrumentTickSize = instruments.tick_size # plan, score and true ticks
tickValue          = instruments.tick_value
```

- existing instruments are loaded with curated `tick_size` and `tick_value`;
- rules continue to evaluate aggregated footprint rows with the chart step;
- Entry/SL/TP and all plan tick distances use the curated market tick, matching backtest semantics;
- every new signal payload records `executionUnits.version = market-tick-v1` plus all three unit values;
- Telegram now displays price risk, true ticks, and approximate USD risk per one contract when `tick_value`
  is known.

For the same observed bar, the corrected `speed_of_tape` plan would be:

```text
entry = 4424.0
stop = 4420.6
target = 4434.2
risk = 3.4 points = 34 true GC ticks = about USD 340 per GC contract
```

This changes future plan geometry from the defective live contract. Historical results produced by the old
unit path must not be pooled with `market-tick-v1`; collect and evaluate the corrected version separately.
Until independent review and deployment verification are complete, Telegram may remain live **only as an
observation channel**.

### 0.4 MBO cannot be promoted today on current evidence

The Rithmic configuration requests `MarketByOrder`, but the current machine is not ready to use it as a
trade gate:

- the current ATAS log repeatedly reports `get_order_book error : 13` after reconnect;
- no local Icebergs/Stops/Sweeps history directory was found, so signal frequency and outcome cannot be
  measured;
- the system drive has only about `247 MB` free and ATAS disabled Heatmap recording for low disk space;
- the DLL loaded by ATAS is bridge `1.4.0`, while the repository source is `1.5.0`;
- no event-completeness, freshness, or decision-latency acceptance test has passed.

Consequently, `GC_MBO_FAILED_BREAK_V1`, native iceberg, sweep, stop-run, pressure, and liquidity-vacuum
signals stay `SHADOW_ONLY`. Any claim that one of them will provide a profitable number of signals today
would be fabricated because the required event history does not exist yet.

### 0.5 GO checklist for real-money use

Another AI or operator must keep the result `NO_GO` until every item below has evidence attached:

1. Free at least 10 GB on the ATAS data volume; record the free-space measurement.
2. Reconnect Rithmic with aggregated quotes disabled and prove `GCZ6@COMEX` MBO snapshots and incremental
   events run for at least 15 minutes without `get_order_book error : 13`.
3. **LOCAL DONE / NOT DEPLOYED:** correct the plan/risk unit so Entry, SL, true ticks, and USD per contract
   agree for GC tick size `0.1`.
4. **LOCAL DONE:** regression tests cover the observed `0.4` chart-step versus `0.1` market-tick case and
   Telegram cash risk. Full suite: `237 passed, 0 failed`; typecheck, format and revision checks pass.
5. Deploy only the reviewed risk-unit fix; confirm one fresh Telegram test message displays the correct
   physical and cash risk. Do not place a broker order for this test.
6. Collect MBO events in shadow, prove event completeness/latency, and run the pre-registered walk-forward
   evaluation defined below.
7. Obtain independent reviewer evidence and a written owner GO for the exact artifact/version.

Rollback/kill switch: set `rules.telegram_enabled = false` for the exact rule if a live message has stale
data, wrong units, duplicate delivery, conflicting direction, or a feed-health failure. This is an operator
instruction, not authorization for an AI to mutate production without the required gate.

---

## 1. Executive decision

The Level 2/MBO feed available now can support six useful signal families for GC:

1. **MBO failed-break reversal** — highest priority; upgrades the existing `gc_sweep_v1` with real-time
   sweep/stop/iceberg and book-recovery evidence.
2. **Native-iceberg absorption reversal** — highest-quality passive-liquidity confirmation when native
   priority refresh is visible.
3. **Sweep continuation** — aggressive flow consumes several levels and the book fails to rebuild against it.
4. **Stop-run exhaustion reversal** — a stop cascade crosses a known 5m level but immediately loses
   follow-through and the opposite book refills.
5. **Liquidity-vacuum breakout continuation** — the near book becomes thin before price moves through a
   pre-existing 5m level.
6. **5m pullback micro-entry** — the existing 5m directional setup remains the reason to trade; MBO/OFI
   supplies a faster entry trigger during the next live bar.

The first implementation must build **one shared shadow microstructure pipeline**, then register signal
families separately. Do not build six unrelated collectors.

Recommended build order:

| Priority | Contract | Expected decision time after confirming event | Reason |
|---|---|---:|---|
| P0 | Feed capability + health probe | n/a | No result is valid until event completeness and latency are measurable. |
| P1 | `GC_MBO_FAILED_BREAK_V1` | 0.5–3 seconds | Direct fit with the existing GC failed-break mechanism and known levels. |
| P1 | `GC_ICEBERG_ABSORPTION_V1` | 1–5 seconds | Adds information not present in bar footprints: refill, order identity, persistence. |
| P2 | `GC_MBO_SWEEP_CONTINUATION_V1` | 0.5–2 seconds | Tradable only if book response is measured immediately. |
| P2 | `GC_STOP_RUN_REVERSAL_V1` | 1–5 seconds | Valuable around named levels; must separate stop flow from ordinary sweeps. |
| P3 | `GC_LIQUIDITY_VACUUM_V1` | 0.25–2 seconds | Potentially fast but noisy and vulnerable to pulled liquidity. |
| P3 | `GC_5M_PULLBACK_MBO_ENTRY_V1` | 0.25–3 seconds | Useful after the GC trend/pullback context is specified and validated. |

**Do not use as standalone signals:** a large DOM wall, one snapshot of queue imbalance, one cancellation,
one iceberg detection, raw sweep volume, or ATAS heatmap color. Each is context or confirmation, not a
complete trading reason.

---

## 2. What is verified on this machine

### 2.1 Feed and platform

- Installed ATAS assemblies report version `8.0.14.398`.
- The 2026-09-09 ATAS log shows a Rithmic connection with aggregated quotes disabled and a subscription for
  `GCZ6@COMEX` to `Prints, Best, Quotes, MarketByOrder, Summary`.
- The inspected session is a Rithmic paper connection. A prior APEX connector emitted an expired-license
  error; a future live/funded connector therefore needs its own capability probe.
- CME MBO supplies anonymous order-level depth, individual size, order ID, and queue priority. It does not
  reveal trader identity.

### 2.2 Public API present in the installed SDK

The installed SDK exposes:

- `SubscribeMarketByOrderData()`
- `MarketByOrders`
- `OnMarketByOrdersChanged(IEnumerable<MarketByOrder>)`
- `GetMarketByOrdersCache(TimeSpan)`
- `GetMarketByOrdersWithTradesCache(TimeSpan)`
- `OnNewTrade(MarketDataArg)` with `ExchangeOrderId` and `AggressorExchangeOrderId`

Each `MarketByOrder` item exposes:

```text
Security, Time, Type(Snapshot|New|Change|Delete), Side,
Priority, ExchangeOrderId, Price, Volume
```

The online ATAS documentation also describes a higher-level `IMboAnalyticsDataProvider`, but that interface
is **not exported by the installed 8.0.14.398 assemblies**. Do not compile the first version against that
newer API. Use the verified raw MBO + prints API and put detectors behind interfaces so a future ATAS upgrade
can replace the internal implementation.

### 2.3 Current project limitation

The present bridge sends candle OHLCV, delta, tick/trade totals, and executed bid/ask volume at each
footprint price. It does not send resting-book events, order IDs, priority, order lifetime, refill events,
cancel events, or millisecond trade groups.

The current `gc_sweep_v1` is a **5m failed break of previous-day high/low with footprint confirmation**.
Its word “sweep” does not mean that a real MBO multi-level sweep has been detected. The existing contract must
remain unchanged; the MBO version receives a new strategy key and contract version.

---

## 3. Timing model: keep 5m without producing a late signal

Use two clocks:

```text
last completed 5m bars ──> context, bias, named levels, setup eligibility
live MBO + prints       ──> immediate confirmation, invalidation, and entry timestamp
```

Rules:

1. `5m` remains the only structural timeframe.
2. Named levels and historical context use completed bars only.
3. Once a 5m setup is armed, MBO/prints are evaluated continuously inside the live bar.
4. The MBO trigger fires at its event timestamp; it does **not** wait for the current or next 5m candle to
   close.
5. Every decision records both exchange/event time and local receive time.
6. A signal older than the freshness limit is rejected as stale rather than delivered as if current.
7. No future-bar data may be used to label or trigger an opportunity.

### 3.1 Starting latency budget

These are engineering SLOs to measure, not currently verified performance:

| Parameter | STARTING VALUE | Meaning |
|---|---:|---|
| `feature_publish_interval_ms` | `250` | Derived feature snapshot cadence; raw events are still processed immediately. |
| `fast_window_ms` | `500` | Sweep and immediate queue-change window. |
| `primary_window_ms` | `1000` | Main OFI/pressure decision window. |
| `recovery_window_ms` | `3000` | Book recovery, failed-break return, and exhaustion confirmation. |
| `decision_latency_p95_ms` | `1000` | Target from final confirming event received to local decision persisted. |
| `notification_latency_p95_ms` | `3000` | Target from confirming event received to Telegram/API delivery attempt. |
| `max_feature_age_ms` | `1500` | Older feature snapshots cannot confirm a new trade. |
| `max_signal_age_ms` | `5000` | Do not announce/enter after this age. Record `stale_signal`. |
| `mbo_warmup_seconds` | `60` | Minimum stable subscription period before signals are eligible. |
| `mbo_silent_while_trades_ms` | `2000` | If prints continue but MBO is silent this long, mark MBO unavailable. |

Do not infer a feed gap from silence alone; GC can be quiet. The stronger failure test is “prints continue
while MBO stops,” connector status loss, a new snapshot epoch, clock regression, or an order-state rebuild.

---

## 4. Shared data model and formulas

### 4.1 Raw MBO state

Maintain the current book in memory by `ExchangeOrderId`:

```text
order_id -> side, price, volume, priority, first_seen_at, last_seen_at, update_count
```

- `Snapshot` rebuilds state and starts a new `book_epoch`; it must not count as an add, refill, or trading
  signal.
- `New` creates an order.
- `Change` records both previous and new volume/priority.
- `Delete` closes the order and records lifetime.
- Assign a local monotonic `event_seq` because the inspected public type does not expose an exchange sequence.
- Join prints to passive/aggressor order IDs when present; preserve `null` when the connector omits them.

### 4.2 Weighted book pressure

Use the nearest `book_levels = 10`. For level index `i` beginning at zero:

```text
weight(i) = exp(-i / weight_decay)
weighted_bid = sum(bid_qty[i] * weight(i))
weighted_ask = sum(ask_qty[i] * weight(i))
book_pressure = (weighted_bid - weighted_ask) / (weighted_bid + weighted_ask)
```

Starting values:

| Parameter | STARTING VALUE |
|---|---:|
| `book_levels` | `10` |
| `weight_decay` | `3.0` |
| `strong_pressure_abs` | `0.60` |
| `pressure_persistence_ms` | `750` |

The `0.60` threshold is provisional. Gate 0 must report its marginal and conditional pass rate by session.

### 4.3 Queue imbalance and microprice

At best bid/ask:

```text
queue_imbalance = (best_bid_qty - best_ask_qty) / (best_bid_qty + best_ask_qty)
microprice = (best_ask_price * best_bid_qty + best_bid_price * best_ask_qty)
             / (best_bid_qty + best_ask_qty)
microprice_edge_ticks = (microprice - mid_price) / market_tick_size
```

Queue imbalance is a short-horizon predictor candidate, not a 5m direction by itself.

### 4.4 Event-based order-flow imbalance (OFI)

Within each feature window, sign book events as follows:

| Event | Signed contribution |
|---|---:|
| Bid volume added/increased | positive |
| Bid volume deleted/decreased | negative |
| Ask volume added/increased | negative |
| Ask volume deleted/decreased | positive |
| Buy aggressor consumes ask | positive |
| Sell aggressor consumes bid | negative |

Compute both top-of-book and distance-weighted versions:

```text
ofi_raw = sum(signed volume changes)
ofi_normalized = ofi_raw / rolling_median(weighted_bid + weighted_ask)
```

Starting thresholds:

| Parameter | STARTING VALUE |
|---|---:|
| `ofi_window_ms` | `1000` |
| `ofi_confirm_abs_percentile` | `85` within session bucket |
| `ofi_extreme_abs_percentile` | `95` within session bucket |
| `ofi_flip_max_age_ms` | `1500` |

Prefer session-relative percentiles over a hard contract count because GC liquidity changes substantially
between Asia, Europe, US open, and US regular hours.

### 4.5 Sweep features

A sweep groups aggressive trades in the same direction that consume liquidity quickly across multiple price
levels.

| Parameter | STARTING VALUE |
|---|---:|
| `sweep_max_window_ms` | `500` |
| `sweep_min_range_ticks` | `2` |
| `sweep_min_aggressor_orders` | `1` |
| `sweep_volume_percentile` | `90` within session bucket |
| `sweep_merge_gap_ms` | `100` |
| `include_stop_volume` | `false` for ordinary sweep contract |

Persist total volume, aggressor count, passive-order count, first/last price, range ticks, duration, and side.
Stop volume must remain a separate field so a stop cascade cannot silently become an ordinary sweep.

### 4.6 Iceberg features

Native CME icebergs are the strongest case when the same order identity remains through displayed-quantity
refresh. Synthetic icebergs are inferred and must have lower confidence.

| Parameter | STARTING VALUE |
|---|---:|
| `iceberg_min_refill_count` | `2` |
| `iceberg_min_filled_percentile` | `90` within session bucket |
| `iceberg_refill_link_ms` | `250` |
| `iceberg_max_price_progress_ticks` | `1` against the passive side |
| `iceberg_confirmation_window_ms` | `3000` |
| `native_iceberg_required_for_absolute` | `true` |

Persist:

```text
side, price, native_or_inferred, order_id_hash, displayed_peak,
filled_volume, estimated_hidden_volume, refill_count, lifetime_ms,
priority_refresh_seen, delete_seen, price_progress_ticks
```

Never store a raw order ID in a user-facing signal. Hash it with an installation-specific salt for event
deduplication; MBO order IDs are anonymous but still unnecessary in alerts.

### 4.7 Book depletion and recovery

For the side consumed by a sweep:

```text
depletion_ratio = 1 - depth_immediately_after / depth_before
recovery_ratio(t) = depth_at_t / depth_before
```

Starting values:

| Parameter | STARTING VALUE |
|---|---:|
| `depletion_min_ratio` | `0.60` |
| `recovery_sample_ms` | `[250, 1000, 3000]` |
| `held_recovery_min_ratio` | `0.60` |
| `continuation_recovery_max_ratio` | `0.35` at 1000ms |

Interpretation depends on side and price response. Recovery alone is not directional.

### 4.8 Liquidity persistence and pull

```text
order_lifetime_ms = delete_or_last_seen - first_seen
pull_ratio = cancelled_visible_volume / added_visible_volume
large_order_persistence = time large order remained inside top N levels
```

Starting values:

| Parameter | STARTING VALUE |
|---|---:|
| `large_order_size_percentile` | `95` within session bucket |
| `minimum_wall_persistence_ms` | `1000` |
| `pull_window_ms` | `1000` |
| `large_pull_ratio` | `0.70` |

Call the feature `fleeting_liquidity` or `large_order_pull`, not `spoofing`; public order-book data does not
prove intent.

---

## 5. Signal contracts

All contracts below are `boolean-first`. They return `eligible`, `direction`, `entry_event_time`, and a
closed rejection reason. A numeric score may be recorded in shadow but cannot decide delivery until calibrated.

### 5.1 `GC_MBO_FAILED_BREAK_V1` — recommended first

**Purpose:** distinguish a real breakout from a stop/sweep through a known level that is absorbed and returns.

**5m setup:** reuse the existing `gc_sweep_v1` previous-trading-day high/low state machine and
`setupMaxAgeBars = 6`. Do not replace or mutate the live contract.

**Short candidate at previous-day high:**

1. Existing 5m context arms a high-side failed-break opportunity.
2. Live price trades above the anchor.
3. One of:
   - buy stop run or buy sweep reaches `sweep_volume_percentile`, or
   - buy OFI reaches `ofi_extreme_abs_percentile`.
4. Price returns inside the anchor within `recovery_window_ms` or the pre-registered failed-break return
   window, whichever contract is being tested.
5. Required micro confirmation: sell-side OFI flip **and** either ask-side iceberg/refresh at the high or ask
   depth recovery `>= held_recovery_min_ratio`.
6. Signal short immediately after condition 5; do not wait for the 5m close.

Long is symmetric at previous-day low.

**Invalidate:** setup expiry, price resumes outside, MBO unavailable, book reset during event, stale feature,
or direction conflict.

**Primary comparison:** existing GC baseline vs baseline + this MBO confirmation. Report accepted and rejected
opportunities; do not compare only their intersection.

### 5.2 `GC_ICEBERG_ABSORPTION_V1`

**Purpose:** detect aggressive orders repeatedly filling into persistent hidden passive liquidity with little
price progress.

**5m setup:** price is at a pre-registered named level from completed 5m data: previous-day H/L first. Session
H/L, IB, VWAP/VAH/VAL/POC are separate future variants, never combined post-hoc.

**Long trigger:**

- bid-side native iceberg or pre-registered inferred iceberg;
- filled volume at or above the session-relative threshold;
- refill count at least `iceberg_min_refill_count`;
- sell aggressors fail to progress more than `iceberg_max_price_progress_ticks`;
- 1s OFI flips positive or bid book recovery confirms.

Short is symmetric for an ask-side iceberg.

**Signal timing:** 1–5 seconds after sufficient refill/fill evidence. An iceberg first seen after it has already
completed is historical context, not a tradable signal.

### 5.3 `GC_MBO_SWEEP_CONTINUATION_V1`

**Purpose:** enter continuation when aggressive flow clears the book and liquidity does not rebuild against it.

**5m setup:** a completed 5m bar has armed a breakout/pullback continuation candidate at a named level. No
standalone sweep trade is allowed without 5m location.

**Long trigger:**

- buy sweep passes range, time, volume, and aggressor-count gates;
- ask-side depletion `>= depletion_min_ratio`;
- ask recovery at 1s `<= continuation_recovery_max_ratio`;
- OFI remains positive and microprice is above mid;
- price remains above the crossed anchor through the confirmation window.

Short is symmetric.

**Reject:** opposing native iceberg, rapid full recovery of consumed liquidity, price returns through anchor,
stop-only flow when `include_stop_volume=false`, or signal age exceeded.

### 5.4 `GC_STOP_RUN_REVERSAL_V1`

**Purpose:** capture stop cascades that exhaust at a known level rather than follow through.

**Trigger:**

- a classified stop run crosses a previous-day H/L;
- stop volume reaches the session-relative threshold;
- no more than one tick of progress after the final stop cluster during `recovery_window_ms`;
- OFI reverses and opposite passive liquidity recovers;
- price re-enters the level.

Do not infer whether the stops were entries or exits. The detector only classifies market mechanics.

### 5.5 `GC_LIQUIDITY_VACUUM_V1`

**Purpose:** detect a fast continuation opportunity where liquidity disappears ahead of price.

**Trigger:**

- 5m setup already points toward a named breakout level;
- opposite-side weighted depth drops below its session `10th` percentile;
- large-order pull ratio is high and persists across at least two 250ms snapshots;
- same-direction OFI is at or above its `85th` percentile;
- no opposing native iceberg is present;
- price crosses the anchor within `1500ms`.

This is lower priority because pulled orders are noisy and can reverse instantly. It needs the strictest stale
signal handling.

### 5.6 `GC_5M_PULLBACK_MBO_ENTRY_V1`

**Purpose:** preserve a slower, more reliable 5m trend/pullback reason while entering closer to the actual turn.

**Setup:** a completed 5m bar arms bullish/bearish pullback context at a named level.

**Long trigger:** at the pullback level, sell OFI decelerates, bid depth recovers, microprice turns above mid,
and either a bid iceberg is confirmed or a small buy sweep begins. Short is symmetric.

This contract changes **entry timing**, not the 5m context or stop/target model. Measure fill quality,
slippage, MAE, and missed-trade rate against the closed-bar entry baseline.

---

## 6. What should be recorded but not used as a gate initially

Record these in shadow because their incremental value is unknown:

- distance-weighted order count imbalance;
- maximum individual order size;
- median order lifetime by level;
- priority distribution and priority changes;
- cancellation burst count;
- cumulative add/delete volume;
- microprice edge;
- spread and spread changes;
- top-1, top-3, top-5, and top-10 depth separately;
- iceberg confidence (`absolute`, `medium/inferred`);
- time since sweep/stop/iceberg event;
- session bucket and seconds from session open;
- scheduled-news proximity if a reliable calendar source is added later.

Do not convert these into one hand-written “confidence score.” First measure each feature's availability,
distribution, incremental effect, and calibration.

---

## 7. Fail-closed vocabulary

Add microstructure-specific reasons without merging blindness with selectivity:

```text
no_setup
data_unavailable:mbo
data_unavailable:prints
data_unavailable:order_ids
data_unavailable:book_state
data_unavailable:session_baseline
book_reset_during_candidate
stale_feature
stale_signal
direction_conflict
duplicate_of:<candidate_id>
expired_unfired
invalidated:<condition>
```

If MBO disappears, do not silently treat zero depth or zero OFI as real market data. The original 5m rules may
continue under their own contracts, but an MBO contract must close as `data_unavailable:mbo`.

---

## 8. Storage and transport design

Do not insert every raw MBO update as an individual synchronous Supabase request.

```text
Rithmic MBO + prints
        |
        v
ATAS event handler -> in-memory order map + bounded ring buffer
        |                           |
        |                           +-> compressed append-only raw session archive
        v
250ms feature frames + detected events
        |
        v
separate microstructure ingest endpoint
        |
        +-> mbo_feature_windows
        +-> microstructure_events
        +-> strategy_opportunities / signal payload shadow fields
```

Recommended records:

### `mbo_feature_windows`

```text
instrument_id, book_epoch, window_opened_at, window_ms,
best_bid, best_ask, spread_ticks,
depth_bid_1/3/5/10, depth_ask_1/3/5/10,
weighted_bid, weighted_ask, book_pressure,
queue_imbalance, microprice_edge_ticks,
ofi_raw, ofi_normalized,
add_bid, add_ask, delete_bid, delete_ask,
buy_trade_volume, sell_trade_volume,
source_event_at, received_at, feature_age_ms,
mbo_status, prints_status, contract_version
```

### `microstructure_events`

```text
event_id, instrument_id, event_type,
side, started_at, confirmed_at, ended_at,
price_from, price_to, range_ticks, volume,
aggressor_count, passive_order_count,
native_refresh_confirmed, refill_count,
book_before_json, book_after_json,
detector_version, book_epoch, evidence_status
```

### Raw archive

- Rotate by instrument, trading day, and connector session.
- Compress and hash every closed segment.
- Store schema version, ATAS build, indicator build, timezone, and start/end event sequence.
- Never rely only on ATAS chart-local history; capture begins when the collector is running and cannot recreate
  missed MBO events after the fact.

---

## 9. Implementation handoff

### Role assignment

| Role | Assignment |
|---|---|
| Proposer | This document/session; may not approve the hypothesis. |
| Executor/Recorder | GPT/Codex implementation session. |
| Independent Reviewer | A new Claude or Codex session that did not propose or implement this hypothesis and re-runs raw evidence. |
| Owner | Approves any L3 production rule/Telegram change and all real-money consequences. |

### Phase A — capability probe only

1. Add a diagnostic collector behind `EnableMboProbe=false` by default.
2. Subscribe after ATAS initializes; unsubscribe/dispose cleanly.
3. For `GCZ6@COMEX`, record counts of Snapshot/New/Change/Delete, null order IDs, null aggressor IDs, event
   latency, clock regressions, book resets, and maximum callback batch size.
4. Run during at least one active GC period and one quiet period.
5. Output a deterministic probe artifact; do not create signals.

**Acceptance:** confirmed current book rebuild; no callback exceptions; bounded memory; data-status transitions
work; feature age is measurable; restarting ATAS creates a new epoch rather than duplicating orders.

**Local implementation status (2026-09-09):** implemented at commit `f34d0d9` and compiled as indicator
REV `1.6.0`, but not
installed or run inside ATAS. `Enable MBO probe` defaults to `false`; when enabled it subscribes to the raw
MBO callback and prints one bounded JSON summary every 60 seconds plus a final dispose summary. It records:

```text
callbacks, maxCallbackBatch, bookEpoch,
Snapshot/New/Change/Delete counts, zeroOrderId,
clockRegressions, futureMboEvents, mboLatencyP95UpperMs,
trades, nullTradeOrderId, nullAggressorOrderId,
futureTradeEvents, tradeLatencyP95UpperMs
```

The latency calculation uses fixed histogram buckets, not a growing list, so probe memory is constant. It
does not retain the book, archive raw events, call Supabase, create a signal, or send Telegram. Those remain
Phase B–D work.

#### Phase A operator runbook — only after independent review

1. Free at least 10 GB on the ATAS data volume before recording anything.
2. Build REV `1.6.0`, copy the reviewed DLL into the ATAS Indicators folder, and restart ATAS. The owner must
   do the GUI/install step.
3. Open `GCZ6@COMEX` 5m with the Rithmic Level 2 connection and Aggregated Quotes disabled.
4. Add Signal Bridge, verify About/Revision shows the reviewed `1.6.0` commit, then enable `MBO Probe`.
5. Run at least 15 minutes in an active period and 15 minutes in a quiet period. Do not trade from the probe.
6. Export ATAS log lines beginning `Signal Bridge MBO probe {` as the deterministic evidence artifact.
7. Fail Gate 0 if no Snapshot epoch appears, MBO update counts stay zero while trades increase, timestamps
   regress materially, latency is stale, the callback throws, or `get_order_book error : 13` remains.

### Phase B — collector and replay

1. Implement raw archive and deterministic replay before detectors.
2. Feed the same captured stream twice and require byte-identical derived frames/events.
3. Add unit fixtures for snapshot, new, partial change, refill, delete, order-ID reuse across epoch, out-of-order
   receive, and connector reset.
4. Keep existing bar/footprint ingest unchanged.

**Acceptance:** replay idempotence; no raw-event loss under the measured peak callback rate; existing indicator
build/checks remain green.

### Phase C — shared features and detectors

1. Implement book pressure, queue imbalance, microprice, OFI, depletion/recovery.
2. Implement sweep and stop grouping separately.
3. Implement native iceberg first; inferred/synthetic iceberg is a separate detector version.
4. Store every candidate, including rejected and unavailable candidates.

**Acceptance:** formulas and units documented; no Snapshot event creates a false signal; symmetric long/short
fixtures; no future-event access.

### Phase D — shadow signal contracts

1. Register only `GC_MBO_FAILED_BREAK_V1` and `GC_ICEBERG_ABSORPTION_V1` first.
2. Keep `enabled=false` and `telegram_enabled=false`, or use an explicit shadow execution path that cannot
   write deliverable signals.
3. Preserve baseline opportunities and MBO variant opportunities independently.
4. Record latency, stale rate, missing rate, and opportunity counts before outcome comparison.

### Phase E — Gate 0 and experiment

Before any threshold sweep, report:

- marginal and conditional bind/pass rates;
- distributions and percentiles by direction and session;
- null, stale, reset, and unavailable rates;
- candidate counts, accepted counts, and rejected reasons;
- sensitivity around each proposed threshold;
- exact commit, data window, timezone, and detector version;
- latency percentiles from event receipt through persistence and notification attempt.

Use full-policy comparison, not matched intersections. Until per-opportunity artifacts and block bootstrap by
session exist, any better aggregate is an observation, not statistical proof.

### Phase F — independent review and owner gate

- Independent reviewer replays raw captures and verifies omissions, causality, units, session normalization,
  reset behavior, latency, and every attempted variant.
- Owner decides whether a validated MBO contract may affect Telegram/live behavior.
- Rollback is disabling only the new MBO strategy keys. Existing 5m rules and stored evidence remain intact.

---

## 10. Build constraints

- Minimum safe change: extend the current indicator; do not rewrite the existing bar ingest.
- Keep the current `5m` strategy contracts immutable. New behavior receives new keys and versions.
- No UI scraping and no dependency on heatmap colors.
- Do not parse private ATAS indicator-storage formats as the primary integration contract.
- Event handlers must not perform blocking HTTP calls.
- Use bounded queues, batch transport, retry with idempotency keys, and backpressure telemetry.
- Never expose connection credentials or raw account identifiers in payloads/logs.
- Persist enough raw evidence to reproduce every derived detector event.
- A detected iceberg/sweep/stop is market-mechanics evidence, not proof of participant intent.
- Do not auto-place orders under this specification.

---

## 11. Final acceptance criteria

The work described here is not complete until all are true:

- [ ] ATAS SDK probe proves MBO and print fields on the target connector/instrument.
- [ ] Raw capture and deterministic replay exist.
- [ ] Book state survives Snapshot/New/Change/Delete and connector reset tests.
- [ ] Feature and signal calculations are causal and event-time stamped.
- [ ] Decision/notification latency percentiles are measured and meet or explicitly fail the SLO.
- [ ] `no_setup` remains distinct from every `data_unavailable:*` state.
- [ ] Existing 5m bar/footprint signals show no regression.
- [ ] Gate 0 artifact accounts for all candidates and parameter variants.
- [ ] Shadow forward evidence exists; no edge is claimed from a screenshot or selected winning run.
- [ ] Independent reviewer re-runs raw artifacts and signs off.
- [ ] Owner gives written approval before any Telegram/live rule change.
- [ ] Handoff records build, deploy/non-deploy state, evidence, risk, owner action, and rollback.

---

## 12. Sources

### Platform and exchange

- [ATAS — Receiving and processing data](https://docs.atas.net/en/md_DataFeedsCore_2Docs_2en_20025__ReceivingProcessingData.html)
  — tick/print callbacks, MarketDepth, MBO subscription, snapshot and New/Change/Delete fields, priority and
  exchange order IDs.
- [ATAS — `IMboAnalyticsDataProvider`](https://docs.atas.net/en/interfaceATAS_1_1DataFeedsCore_1_1IMboAnalyticsDataProvider.html)
  — newer derived MBO analytics surface referenced for future compatibility only; it is not exported by the
  installed `8.0.14.398` assemblies verified for this specification.
- [ATAS — MBO DOM](https://help.atas.net/en/support/solutions/articles/72000633231-mbo-dom)
  — Rithmic-only MBO display, per-order queue/size/priority, and requirement to disable aggregated quotes.
- [ATAS — MBO Indicators: Icebergs, Stops, Sweeps](https://help.atas.net/en/support/solutions/articles/72000660331-mbo-indicators-icebergs-stops-sweeps)
  — detector inputs, confidence classes, live/history constraints, and sweep/stop parameter vocabulary.
- [ATAS — DOM Pressure](https://help.atas.net/en/support/solutions/articles/72000648682-dom-pressure)
  — distance-weighted liquidity and exponential-decay design.
- [ATAS — Heatmap](https://help.atas.net/en/support/solutions/articles/72000660059-heatmap)
  — distinction between resting liquidity, executed flow, persistence, pull, and price response.
- [CME Group — Market by Order FAQ](https://www.cmegroup.com/articles/faqs/market-by-order-mbo.html)
  — full depth, anonymous order-level granularity, queue priority, and native iceberg OrderID refresh behavior.

### Research basis; mechanism only, not evidence for GC profitability

- Cont, Kukanov, Stoikov, [The Price Impact of Order Book Events](https://arxiv.org/abs/1011.6402)
  — short-horizon price impact from limit adds, cancellations, and trades summarized as OFI.
- Gould and Bonart, [Queue Imbalance as a One-Tick-Ahead Price Predictor](https://arxiv.org/abs/1512.03492)
  — queue imbalance as a next-mid-price predictor; applicability to GC remains unverified.
- Zotikov and Antonov, [CME Iceberg Order Detection and Prediction](https://arxiv.org/abs/1909.09495)
  — native and synthetic CME iceberg reconstruction from order logs and trade events.

### Repository references

- `atas-indicator/AtasSignalBridge/Dto.cs`
- `atas-indicator/AtasSignalBridge/SignalBridgeIndicator.cs`
- `supabase/functions/_shared/rules/gc_sweep_v1.ts`
- `supabase/functions/_shared/rules/speed_of_tape.ts`
- `docs/STRATEGY_SPEC_V1.md`
- `docs/EXPERIMENT_REVIEW_PROTOCOL.md`
