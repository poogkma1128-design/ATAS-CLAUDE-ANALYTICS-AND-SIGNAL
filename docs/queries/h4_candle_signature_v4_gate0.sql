-- H4 Mathematical Candle Signature — V4 Gate 0 / readiness monitor
--
-- Companion to docs/experiments/2026-09-04-candle-signature-v4.md.
-- Read-only. Project sckdriuwfyittcybnbhz. First recorded 2026-09-04.
--
-- WHY THIS FILE IS SAFE TO RUN ON ANY DAY, INCLUDING OVER THE OUT-OF-SAMPLE WINDOW
--
--   It selects no outcome column. There is no realized_r, no MFE, no MAE, no win rate and
--   no baseline contrast anywhere below - only counts of how many candidate bars exist per
--   cell. A head count cannot reveal the sign or the size of the effect, which is exactly
--   why EXPERIMENT_REVIEW_PROTOCOL.md section 2 requires Gate 0 to run BEFORE the sweep
--   rather than after it. Running this does not spend the out-of-sample reserve.
--
--   The measurement query that does read outcomes is h4_candle_signature_v4.sql, and it
--   stays unrun until the gate in Q2 reports open for all four cells.
--
-- The candidate definition, the regime split and the strict-adjacency rule are copied from
-- h4_candle_signature_v3.sql without modification. V4 was pinned as "same plan, no change
-- of criteria"; a Gate 0 monitor that quietly used a looser definition would report a gate
-- opening on a population the measurement query will never see.

-- ------------------------------------------------------------------ Q0 INTEGRITY
-- public.bars holds rows labelled '5m' that are not 5-minute bars, in two shapes:
--
--   COARSER: 255 pre-feed rows whose range and volume are one to three orders of magnitude
--   too large - daily and H4 bars, written 2026-09-03 during the ATAS history check.
--   FINER:   1,283 rows inside the feed era sitting off the five-minute grid - some
--   minute-aligned (a 1m chart), some sub-second (a tick chart), across four sessions.
--
-- One cause for both: TimeframeLabel is a free-text setting defaulting to "5m"
-- (SignalBridgeIndicator.cs) rather than the chart's period, and ingest only checked it was
-- a non-empty string. The full census is docs/queries/timeframe_contamination_census.sql;
-- the repair is migration 0035, and the guard against a repeat is in ingest.ts validate().
--
-- Run this first. Anything flagged here poisons the rolling 50-bar median that every
-- threshold below is measured against.
select i.symbol,
  case when b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
       then 'feed era' else 'pre-feed' end as era,
  count(*) as n_rows,
  round(percentile_cont(0.5) within group (order by (b.high - b.low))::numeric, 4) as med_range,
  round(percentile_cont(0.5) within group (order by b.volume)::numeric, 1) as med_volume,
  count(distinct (b.opened_at at time zone 'UTC')::date) as utc_dates,
  round((count(*)::numeric
         / nullif(count(distinct (b.opened_at at time zone 'UTC')::date), 0)), 1) as rows_per_date
from public.bars b
join public.instruments i on i.id = b.instrument_id
where b.timeframe = '5m' and b.is_closed
group by 1, 2
order by 1, 2;

-- ------------------------------------------------------------------------- base
-- v3_base with two filters added, both excluding rows that are not 5m bars.
--
-- The lower bound drops the 255 pre-feed daily and H4 rows. That one is nearly free: the
-- 50-bar warm-up discarded those bars either way, so it moves counts by at most one.
--
-- The grid filter drops the 1,283 in-window rows and is NOT free, which is the point. Those
-- bars sit among genuine ones, so they were feeding the rolling median and the 50-bar high
-- and low. Removing them moves cell counts by at most 4 - but four long candidates change
-- REGIME, and the regime split is the whole of V4's hypothesis. A count that barely moves
-- is not evidence that nothing moved.
create temporary view v4_base as
with b as (
  select b.instrument_id, i.symbol, b.opened_at, b.open, b.high, b.low, b.close, b.volume,
         row_number() over (partition by b.instrument_id order by b.opened_at) as rn
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.is_closed
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
    -- On the five-minute grid. 1,283 closed bars inside this window are labelled
    -- '5m' but sit off it - some minute-aligned (a 1m chart), some sub-second (a
    -- tick chart) - from the same free-text label bug. Strict adjacency already
    -- keeps them out of the candidate set, but NOT out of the rolling 50-bar
    -- window below, and a median taken over a mix of 1m, tick and 5m bars sets
    -- the wrong threshold for the genuine bars around them. Measured effect of
    -- removing them: cell counts move by at most 4, but four long candidates
    -- change regime - and regime is the variable V4's hypothesis is about.
    and date_part('epoch', b.opened_at)::bigint % 300 = 0
),
f as (
  select b.*,
    (b.high - b.low) as rng,
    case when b.high > b.low then (b.close - b.open) / (b.high - b.low) end as body_share,
    case when b.high > b.low then (b.close - b.low)  / (b.high - b.low) end as close_loc,
    m.med_range, m.med_vol, m.hi50, m.lo50, m.close50,
    lead(b.open, 1) over w as e_open,
    array[lead(b.opened_at,1) over w, lead(b.opened_at,2) over w, lead(b.opened_at,3) over w,
          lead(b.opened_at,4) over w, lead(b.opened_at,5) over w, lead(b.opened_at,6) over w,
          lead(b.opened_at,7) over w, lead(b.opened_at,8) over w, lead(b.opened_at,9) over w,
          lead(b.opened_at,10) over w] as times,
    array[lead(b.close,1) over w, lead(b.close,2) over w, lead(b.close,3) over w,
          lead(b.close,4) over w, lead(b.close,5) over w, lead(b.close,6) over w,
          lead(b.close,7) over w, lead(b.close,8) over w, lead(b.close,9) over w,
          lead(b.close,10) over w] as closes
  from b
  left join lateral (
    select percentile_cont(0.5) within group (order by (p.high - p.low)) as med_range,
           percentile_cont(0.5) within group (order by p.volume)         as med_vol,
           max(p.high) as hi50, min(p.low) as lo50,
           min(p.close) filter (where p.rn = b.rn - 50) as close50
    from b p
    where p.instrument_id = b.instrument_id and p.rn between b.rn - 50 and b.rn - 1
  ) m on true
  window w as (partition by b.instrument_id order by b.opened_at)
)
select *,
  (opened_at at time zone 'UTC')::date as sess,
  (rng > 1.5 * med_range) as expanded,
  (rng > 1.5 * med_range and abs(body_share) > 0.6 and volume > 1.2 * med_vol) as strong,
  case when close > hi50 then 'breakout_up'
       when close < lo50 then 'breakout_down'
       when high  > hi50 then 'sweep_high'
       when low   < lo50 then 'sweep_low'
       when abs(close - close50) / nullif(hi50 - lo50, 0) > 0.5 then 'trend'
       else 'range' end as regime6,
  case when close > hi50 or close < lo50 or high > hi50 or low < lo50
         or abs(close - close50) / nullif(hi50 - lo50, 0) > 0.5
       then 'directional' else 'range' end as regime2
from f
where med_range is not null and med_range > 0 and med_vol > 0 and rng > 0
  and hi50 is not null and close50 is not null and e_open is not null;

-- h = 10 is the binding horizon: strict adjacency over ten bars costs roughly 30% of the
-- sample, so whichever cell is smallest at h = 10 is the cell that decides the gate.
create temporary view v4_heads as
select t.symbol, t.sess, t.regime2, t.regime6, d.dir, t.expanded, t.strong,
  (t.strong and ((d.dir = 'long'  and t.close_loc > 0.8)
              or (d.dir = 'short' and t.close_loc < 0.2))) as is_cond
from v4_base t
cross join lateral (values ('long'), ('short')) d(dir)
where t.closes[10] is not null
  and (select bool_and(tm is not null and tm = t.opened_at + (idx * interval '5 minutes'))
       from unnest(t.times) with ordinality as u(tm, idx) where idx <= 10);

-- --------------------------------------------------------------------- Q1 HEADS
-- Population per pre-registered cell. n_cond is the number that has to reach 285.
select dir, regime2 as regime,
  count(*) filter (where is_cond) as n_cond,
  count(*) filter (where expanded and not strong) as n_matched_pool,
  count(distinct sess) filter (where is_cond) as sessions_contributing,
  count(distinct symbol) filter (where is_cond) as instruments_contributing
from v4_heads
group by 1, 2
order by 1, 2;

-- ---------------------------------------------------------------------- Q2 GATE
-- The start condition. n >= 285 per cell is the power requirement (0.25R effect, sd 0.95R,
-- p < 0.0031, power 80%); "21 sessions" in the V3 roadmap was an ESTIMATE of when 285
-- arrives, not a second condition. The gate is open only when all four cells are green.
--
-- Accrual rate is measured on COMPLETE sessions only - the first and last UTC dates in the
-- data are partial by construction (feed start, and today still running) and including
-- them understates the rate. The rule is mechanical and does not look at any outcome.
with per_sess as (
  select sess, dir, regime2, count(*) filter (where is_cond) as n
  from v4_heads group by 1, 2, 3
),
bounds as (select min(sess) as first_sess, max(sess) as last_sess from per_sess),
rate as (
  select dir, regime2,
    avg(n) filter (where extract(isodow from sess) <= 5) as per_weekday,
    avg(n) filter (where extract(isodow from sess) >= 6) as per_weekend
  from per_sess, bounds
  where sess > first_sess and sess < last_sess
  group by 1, 2
),
now_n as (
  select dir, regime2, count(*) filter (where is_cond) as n_cond
  from v4_heads group by 1, 2
)
select n.dir, n.regime2 as regime, n.n_cond, 285 as n_required,
  round(100.0 * n.n_cond / 285, 1) as pct_of_target,
  case when n.n_cond >= 285 then 'OPEN' else 'CLOSED' end as cell_gate,
  round(coalesce(r.per_weekday, 0)::numeric, 1) as cond_per_weekday,
  round(coalesce(r.per_weekend, 0)::numeric, 1) as cond_per_weekend,
  -- five weekdays plus two weekend days per calendar week
  round((greatest(285 - n.n_cond, 0)
         / nullif(5 * coalesce(r.per_weekday, 0) + 2 * coalesce(r.per_weekend, 0), 0))::numeric, 2)
    as weeks_remaining,
  (current_date + (7 * ceil(greatest(285 - n.n_cond, 0)
     / nullif(5 * coalesce(r.per_weekday, 0) + 2 * coalesce(r.per_weekend, 0), 0)))::int)
    as projected_open_date
from now_n n
join rate r on r.dir = n.dir and r.regime2 = n.regime2
order by pct_of_target;

-- ------------------------------------------------------------------ Q3 ACCRUAL
-- Session-by-session history, so the projection in Q2 can be checked by eye rather than
-- trusted. Weekend rows carry BTCUSDT only; the three futures do not trade.
select sess,
  to_char(sess, 'Dy') as dow,
  count(*) filter (where is_cond and dir = 'long'  and regime2 = 'range')       as long_range,
  count(*) filter (where is_cond and dir = 'short' and regime2 = 'range')       as short_range,
  count(*) filter (where is_cond and dir = 'long'  and regime2 = 'directional') as long_dir,
  count(*) filter (where is_cond and dir = 'short' and regime2 = 'directional') as short_dir,
  count(distinct symbol) as instruments
from v4_heads
group by 1
order by 1;

-- ----------------------------------------------------------------- Q4 SUBLABEL
-- V5's start condition is sweep >= 100 candidates per direction. Counted here so the answer
-- is a number rather than a guess when V5 comes up. Descriptive; never significance-tested.
select regime6, dir, count(*) filter (where is_cond) as n_cond
from v4_heads
group by 1, 2
order by 1, 2;
