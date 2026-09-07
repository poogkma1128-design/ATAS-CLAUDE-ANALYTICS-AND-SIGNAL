-- Strategy frequency & data-readiness Gate 0 (step 1 of the revised strategy plan).
--
-- Purpose: answer, from the live database rather than from an older Handoff
-- section, three questions the revised plan (HANDOFF §0AB) asks before any
-- strategy spec is written:
--
--   A. Which windows can be used to measure opportunity frequency at all?
--   B. Is the tick a fact we can divide by, or a chart setting that moves?
--   C. Which decisions are closed today because their input is unreconciled?
--
-- Read-only. Every statement here is a SELECT; nothing writes, applies a
-- migration, or deploys anything.
--
-- Run against project `sckdriuwfyittcybnbhz` (atas-signal).
-- Results recorded below each section are from 2026-09-07 so a later run can
-- be compared instead of trusted.

-- ============================================================ A1. what is applied
-- The production migration head. Everything the strategy plan proposes queues
-- behind whatever is missing here.
select version, name
  from supabase_migrations.schema_migrations
 order by version desc
 limit 5;

-- Result 2026-09-07: head is 20260902142002 `a_sweep_that_finishes_beats_one_that_does_not`.
-- Migrations 0033, 0034, 0035, 0036, 0037 and 0038 are ALL unapplied.

-- Which strategy-engine objects exist in production.
select table_name
  from information_schema.tables
 where table_schema = 'public'
 order by table_name;

-- Result 2026-09-07: 25 tables. `key_levels`, session definitions,
-- `strategies`, `strategy_versions`, `strategy_candidates` and `news_events`
-- are all ABSENT, and `signal_outcomes` has no `tick_size_used` column.
-- Phase 1 is therefore inert in production, exactly as §0AA claimed.

-- ============================================================ B1. tick identity today
-- What the database says the tick is, against the smallest gap between traded
-- prices the same feed recorded. Same method as
-- docs/queries/instrument_tick_identity.sql; repeated here because the answer
-- has changed since that file recorded it.
with lv as (
  select i.symbol, c.price
    from public.cluster_levels c
    join public.bars b        on b.id = c.bar_id
    join public.instruments i on i.id = b.instrument_id
   where b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
),
dp as (select distinct symbol, price from lv),
gaps as (
  select symbol, price,
         price - lag(price) over (partition by symbol order by price) as step
    from dp
),
observed as (
  select symbol,
         count(*)                          as distinct_prices,
         min(step) filter (where step > 0)  as smallest_step
    from gaps
   group by symbol
)
select o.symbol,
       i.tick_size    as recorded_tick_size,
       o.smallest_step as observed_price_step,
       round(i.tick_size / nullif(o.smallest_step, 0), 2) as ratio,
       case when i.tick_size = o.smallest_step then 'agrees' else 'DISAGREES' end as verdict,
       i.tick_value   as recorded_tick_value,
       o.distinct_prices
  from observed o
  join public.instruments i on i.symbol = o.symbol
 order by o.symbol;

-- Result 2026-09-07 (compare against instrument_tick_identity.sql, 2026-09-06):
--   symbol   recorded  observed  ratio  verdict      2026-09-06 recorded
--   BTCUSDT      0.10      0.10     1x  agrees       10.00
--   GC           0.40      0.10     4x  DISAGREES     0.30
--   MNQU6        0.25      0.25     1x  agrees        0.75
--   NQU6         0.25      0.25     1x  agrees        0.25
-- Three of four recorded ticks changed in one day with migration 0038 still
-- unapplied. The only writer that can do that is the ingest upsert (§0Z.1).
-- `tick_value` is still null on all four.

-- ============================================================ B2. the tick each row was divided by
-- The decisive test. `evaluate_pending_outcomes()` (migration 0030, lines
-- 89 and 176-184) divides by `instruments.tick_size` as it stands at resolve
-- time, and `exit_price`/`entry_price` are unchanged observed prices. So the
-- divisor each stored row actually used is recoverable:
--
--     tick_used = |exit_price - entry_price| / |pnl_ticks|
--
-- Rows with |pnl_ticks| >= 2 only, because pnl_ticks is numeric(12,2) and
-- small magnitudes make the ratio noisy.
with r as (
  select i.symbol,
         round(abs(so.exit_price - coalesce(s.entry_price, s.price))
               / nullif(abs(so.pnl_ticks), 0), 3) as implied_tick,
         so.resolved_at::date as d
    from public.signal_outcomes so
    join public.signals s     on s.id = so.signal_id
    join public.instruments i on i.id = s.instrument_id
   where so.status = 'resolved'
     and so.pnl_ticks is not null
     and so.exit_price is not null
     and abs(so.pnl_ticks) >= 2
)
select symbol, implied_tick, count(*) as rows, min(d) as first_day, max(d) as last_day
  from r
 group by symbol, implied_tick
having count(*) >= 5
 order by symbol, min(d);

-- Result 2026-09-07 — no instrument has one divisor:
--   MNQU6    0.75 x 760 | 0.25 x 502 | 0.50 x 147
--   NQU6     0.75 x 197 | 0.25 x 288        <- the "correct" instrument is not clean either
--   GC       0.30 x 444 | 0.10 x 357 | 0.20 x 58 | 0.40 x 28
--   BTCUSDT  0.30 x 519 | 0.10 x 356 | 0.20 x 222 | 10.0 x 50
-- This kills the single-multiplier rescale table in HANDOFF §0Z.4: there is no
-- one ratio that converts MNQU6 (or any other instrument) to true ticks.

-- Same day, both divisors — proof the value oscillates rather than being
-- corrected once.
with r as (
  select round(abs(so.exit_price - coalesce(s.entry_price, s.price))
               / nullif(abs(so.pnl_ticks), 0), 2) as implied_tick,
         date_trunc('hour', so.resolved_at) as h
    from public.signal_outcomes so
    join public.signals s     on s.id = so.signal_id
    join public.instruments i on i.id = s.instrument_id
   where i.symbol = 'MNQU6'
     and so.status = 'resolved'
     and abs(so.pnl_ticks) >= 2
     and so.resolved_at >= timestamptz '2026-09-03 00:00:00+00'
     and so.resolved_at <  timestamptz '2026-09-04 00:00:00+00'
)
select h, implied_tick, count(*) from r group by 1, 2 order by h, implied_tick;

-- Result: 2026-09-03 00:00-06:00 UTC resolved at 0.25 (89 rows);
--         2026-09-03 12:00-20:00 UTC resolved at 0.75 (259 rows).
-- One instrument, one day, two divisors. Nothing was corrected in between;
-- the chart step that ingest writes changed.

-- ============================================================ C1. how many blocks exist
-- Session x instrument is the resampling unit the design review fixed. This is
-- the numerator of that gate, re-run rather than copied. Same definitions as
-- docs/queries/strategy_block_census.sql.
with on_grid as (
  select i.symbol, b.opened_at, (b.opened_at at time zone 'America/Chicago') as loc
    from public.bars b
    join public.instruments i on i.id = b.instrument_id
   where b.timeframe = '5m' and b.is_closed
     and (extract(epoch from b.opened_at)::bigint % 300) = 0
),
stamped as (
  select symbol, opened_at,
         ((loc + interval '7 hours')::date) as trading_day,
         (extract(hour from loc) * 60 + extract(minute from loc))::int as loc_min
    from on_grid
),
per_day as (
  select symbol, trading_day, count(*) as day_bars,
         count(*) filter (where loc_min >= 510 and loc_min < 900) as us_bars
    from stamped
   group by symbol, trading_day
)
select symbol,
       count(*)                                as days_with_any_bar,
       count(*) filter (where us_bars >= 39)   as blocks_us_half_covered,
       count(*) filter (where us_bars >= 70)   as blocks_us_usable,
       max(us_bars)                            as best_us_day_bars,
       min(trading_day) as first_day, max(trading_day) as last_day
  from per_day
 group by symbol
 order by symbol;

-- Result 2026-09-07: BTCUSDT 4 usable · GC 6 · MNQU6 6 · NQU6 4.
-- Unchanged from 2026-09-06 despite a further trading day passing.
-- GC/MNQU6's 103 "days" still include the §0L one-bar-per-day artefact.

-- ============================================================ C2. contiguity of the trailing window
-- Any percentile or volatility threshold reads a trailing window. This is how
-- often that window spans a hole, which HANDOFF §0V.1 P1 #2 requires to return
-- `insufficient_history` rather than a number.
with on_grid as (
  select i.symbol, b.opened_at
    from public.bars b
    join public.instruments i on i.id = b.instrument_id
   where b.timeframe = '5m' and b.is_closed
     and (extract(epoch from b.opened_at)::bigint % 300) = 0
     and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
),
w as (
  select symbol, opened_at,
         lag(opened_at, 1)  over (partition by symbol order by opened_at) as prev1,
         lag(opened_at, 20) over (partition by symbol order by opened_at) as prev20
    from on_grid
)
select symbol,
       count(*) filter (where prev20 is not null) as bars_with_full_20,
       round(100.0 * count(*) filter (where prev1 is not null
                                        and prev1 <> opened_at - interval '5 minutes')
             / nullif(count(*) filter (where prev1 is not null), 0), 1) as pct_prev_not_adjacent,
       round(100.0 * count(*) filter (where prev20 is not null
                                        and prev20 < opened_at - interval '100 minutes')
             / nullif(count(*) filter (where prev20 is not null), 0), 1) as pct_window_spans_hole
  from w
 group by symbol
 order by symbol;

-- Result 2026-09-07 (2026-09-06 value in brackets):
--   NQU6 14.3% [12.3] · GC 12.1% [11.3] · MNQU6 8.3% [7.3] · BTCUSDT 7.3% [6.7]
-- Every figure got worse, not better, over one more day of collection.

-- ============================================================ C3. footprint reconciliation
-- The share of bars whose own footprint does not reconcile with the bar. Under
-- the repaired Phase 1 contract these bars null the whole VWAP/value-area/POC
-- profile, so this is the share of bars where any level-based decision is
-- closed by data, not by the market.
with per_bar as (
  select i.symbol, b.id, b.ticks as bar_ticks,
         sum(c.ticks)                                              as level_ticks,
         count(*) filter (where c.price > b.high or c.price < b.low) as out_of_range
    from public.bars b
    join public.instruments i  on i.id = b.instrument_id
    join public.cluster_levels c on c.bar_id = b.id
   where b.timeframe = '5m' and b.is_closed
     and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
   group by i.symbol, b.id, b.ticks
)
select symbol,
       count(*) as bars_with_footprint,
       round(100.0 * count(*) filter (where out_of_range > 0) / count(*), 1)
         as pct_level_outside_bar,
       round(100.0 * count(*) filter (where level_ticks is distinct from bar_ticks) / count(*), 1)
         as pct_tick_sum_mismatch,
       round(100.0 * count(*) filter (where out_of_range > 0
                                        or level_ticks is distinct from bar_ticks) / count(*), 1)
         as pct_bar_rejected
  from per_bar
 group by symbol
 order by symbol;

-- Result 2026-09-07: GC 51.0% rejected · NQU6 31.8% · MNQU6 30.5% · BTCUSDT 15.4%.
-- On GC, a level-anchored decision is unavailable on half of all bars.

-- ============================================================ C4. coverage by hour of day
-- HANDOFF §3.7b warns that the holes are "when the owner was at the desk", so a
-- time-of-day bias could be invisible. `days` is the number of dates on which
-- that hour recorded anything at all; `fill_ratio` is coverage CONDITIONAL on
-- the hour being present, so read the two columns together.
with g as (
  select i.symbol,
         extract(hour from (b.opened_at at time zone 'Asia/Bangkok'))::int as th_hour,
         b.opened_at::date as d
    from public.bars b
    join public.instruments i on i.id = b.instrument_id
   where b.timeframe = '5m' and b.is_closed
     and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
     and (extract(epoch from b.opened_at)::bigint % 300) = 0
)
select symbol, th_hour, count(*) as bars, count(distinct d) as days,
       round(count(*)::numeric / (12 * nullif(count(distinct d), 0)), 2) as fill_ratio
  from g
 where symbol in ('MNQU6', 'GC')
 group by symbol, th_hour
 order by symbol, th_hour;

-- Result 2026-09-07: hour 04 ICT is absent for both (= 21:00-21:59 UTC, the CME
-- daily break). Every other hour is present on 5-7 dates with a conditional
-- fill ratio of 0.85-1.00. So within a recorded day the coverage is fairly flat
-- by hour: what is lost is whole sessions, not particular hours.

-- ============================================================ C5. current signal frequency, as a reference
-- Not the frequency of the proposed strategies, which do not exist yet. This is
-- what the present eight-rule engine emits, i.e. the number the strategy layer
-- has to cut down from.
select i.symbol, s.rule_key, count(*) as signals,
       count(distinct (s.fired_at at time zone 'America/Chicago')::date) as days_with_signal
  from public.signals s
  join public.instruments i on i.id = s.instrument_id
 where s.fired_at >= timestamptz '2026-08-28 00:00:00+00'
 group by i.symbol, s.rule_key
 order by i.symbol, signals desc;

-- Result 2026-09-07: MNQU6 1,418 signals across 8 days with signals
-- (stacked_imbalance 512, poc_shift 320, speed_of_tape 147, lvn 130,
--  naked_poc 125, delta_divergence 110, delta_flip 68, absorption 6);
-- GC 899; NQU6 486; BTCUSDT 1,154.
-- MNQU6 averages ~177 signals per day with signals. That is the "every rule can
-- fire on its own" behaviour the strategy layer exists to replace, and it is the
-- baseline any frequency target must be stated against.
