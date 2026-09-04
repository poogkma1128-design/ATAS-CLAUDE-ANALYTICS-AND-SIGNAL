-- Census of rows labelled '5m' that are not 5-minute data.
--
-- Read-only. Project sckdriuwfyittcybnbhz. First recorded 2026-09-04.
--
-- This is the Gate 0 for migration 0035. Run it BEFORE applying that migration, to confirm
-- the numbers it fails closed on, and AFTER, to confirm every count has reached zero.
--
-- The Independent Reviewer must run this themselves. EXPERIMENT_REVIEW_PROTOCOL.md §1 is
-- explicit that a narrative review is never independent: the point is not to read that the
-- numbers below were 1,538 and 543, it is to watch the database say so.

-- ----------------------------------------------------------- Q0 OFF-GRID ROWS
-- The second shape, and the one that is easy to miss because these bars look ordinary.
-- A genuine 5m bar opens on a multiple of 300 seconds. These do not: some are minute
-- aligned but not 5m aligned, which is a 1-minute chart; some carry sub-second timestamps
-- like 13:30:43.147, which is a tick chart. They sit INSIDE the live window, mixed in with
-- real bars, which is why they matter more than the obvious pre-feed rows.
select i.symbol, (b.opened_at at time zone 'UTC')::date as sess,
  count(*) filter (where date_part('epoch', b.opened_at)::bigint % 300 <> 0) as off_grid,
  count(*) as total_that_session,
  min(b.opened_at) filter (where date_part('epoch', b.opened_at)::bigint % 300 <> 0) as first_off_grid,
  max(b.opened_at) filter (where date_part('epoch', b.opened_at)::bigint % 300 <> 0) as last_off_grid
from public.bars b
join public.instruments i on i.id = b.instrument_id
where b.timeframe = '5m' and b.is_closed
  and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
group by 1, 2
having count(*) filter (where date_part('epoch', b.opened_at)::bigint % 300 <> 0) > 0
order by 2, 1;

-- ------------------------------------------------------------- Q1 THE EVIDENCE
-- Volume is what settles it. A five-minute bar cannot carry a whole session's volume, and
-- these carry 171x and 717x the median of the genuine feed era. Range alone would be
-- arguable - a violent five minutes is a wide bar - but no five minutes trades a day's size.
select i.symbol,
  case when b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
       then 'feed era (genuine 5m)' else 'pre-feed (contaminated)' end as era,
  count(*) as n_rows,
  round(percentile_cont(0.5) within group (order by (b.high - b.low))::numeric, 4) as med_range,
  round(percentile_cont(0.5) within group (order by b.volume)::numeric, 1) as med_volume
from public.bars b
join public.instruments i on i.id = b.instrument_id
where b.timeframe = '5m' and b.is_closed
group by 1, 2
order by 1, 2;

-- ------------------------------------------------------------ Q2 THE SPACING
-- The same fact from the timestamps rather than the prices, and the reason the fix cannot
-- simply re-label these to a single period: GC's gaps are 71 at four hours and 66 at one
-- day, so the chart's period was changed partway through the session.
with contaminated as (
  select b.instrument_id, i.symbol, b.opened_at,
         lag(b.opened_at) over (partition by b.instrument_id order by b.opened_at) as prev
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m'
    and b.opened_at < timestamptz '2026-08-28 00:00:00+00'
)
select symbol, count(*) as n_rows,
  min(opened_at - prev) as smallest_gap,
  mode() within group (order by opened_at - prev) as modal_gap,
  count(*) filter (where opened_at - prev = interval '5 minutes')  as gaps_of_5m,
  count(*) filter (where opened_at - prev = interval '4 hours')    as gaps_of_4h,
  count(*) filter (where opened_at - prev = interval '1 day')      as gaps_of_1d
from contaminated
group by 1
order by 1;

-- --------------------------------------------------------- Q3 THE BLAST RADIUS
-- What a DELETE would have taken with it. signals.bar_id and cluster_levels.bar_id are
-- ON DELETE CASCADE, so removing the bars removes these silently - which is why 0035
-- re-labels instead. n_signals is the number migration 0035 fails closed on.
with contaminated as (
  select b.id from public.bars b
  where b.timeframe = '5m'
    and (b.opened_at < timestamptz '2026-08-28 00:00:00+00'
         or date_part('epoch', b.opened_at)::bigint % 300 <> 0)
)
select
  (select count(*) from contaminated) as n_bars,
  (select count(*) from public.signals s join contaminated c on c.id = s.bar_id) as n_signals,
  (select count(*) from public.cluster_levels l join contaminated c on c.id = l.bar_id) as n_levels,
  (select count(*) from public.signal_outcomes o join contaminated c on c.id = o.exit_bar_id)
    as n_outcomes_exiting_here;

-- ------------------------------------------------------- Q4 THE SIGNAL DAMAGE
-- How much of the live signal population is affected. This is the number that matters for
-- §5.18 Gate 0, the H1/H2/H3 cohorts and confidence_v2: they are all computed over
-- public.signals, and until 0035 is applied 15.0% of that population - 543 of 3,614 - was
-- produced by rules reading a bar that was never a 5-minute bar.
--
-- 177 of those sit on the pre-feed daily bars and fired in one window on 2026-09-03 between
-- 12:35 and 15:00 UTC, which is what ties them to the ATAS history check recorded in the
-- V3.1 section of the V3 experiment. The other 366 sit on the in-window 1m and tick bars and
-- are spread across four sessions, so fired_at below spans far more than that one window.
with contaminated as (
  select b.id from public.bars b
  where b.timeframe = '5m'
    and (b.opened_at < timestamptz '2026-08-28 00:00:00+00'
         or date_part('epoch', b.opened_at)::bigint % 300 <> 0)
)
select
  (select count(*) from public.signals) as signals_total,
  count(*) as signals_contaminated,
  round(100.0 * count(*) / nullif((select count(*) from public.signals), 0), 2) as pct_of_population,
  min(s.fired_at) as first_fired,
  max(s.fired_at) as last_fired,
  count(distinct s.rule_key) as rules_touched
from public.signals s
join contaminated c on c.id = s.bar_id;

-- -------------------------------------------------------- Q5 THE STANDING TEST
-- Not tied to a date: this is the check that should stay green forever once the ingest
-- guard is deployed and 0035 is applied. Any instrument+timeframe whose bars do not sit on
-- the period they claim is a fresh instance of the same bug.
--
-- This uses the MODAL gap, not the smallest. The first draft used the smallest and reported
-- every instrument as mislabelled, including clean ones - because the off-grid rows in Q0
-- include bars a millisecond apart, and one such pair drags the minimum below any period.
-- The mode is what a chart's period actually looks like in the data and shrugs off a
-- handful of anomalies; the anomalies themselves are Q0's job to report, not this one's.
--
-- Reported per (instrument, timeframe) rather than per row, because one odd bar is a glitch
-- and a whole partition on the wrong period is a mislabelled chart.
with spaced as (
  select b.instrument_id, i.symbol, b.timeframe, b.opened_at,
         b.opened_at - lag(b.opened_at) over
           (partition by b.instrument_id, b.timeframe order by b.opened_at) as gap
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.is_closed
),
claimed as (
  select *,
    case
      when timeframe ~ '^[0-9]+\s*[dD]$'          then (regexp_replace(timeframe, '\D', '', 'g'))::int * interval '1 day'
      when timeframe ~ '^[0-9]+\s*(h|hr|hrs)$'    then (regexp_replace(timeframe, '\D', '', 'g'))::int * interval '1 hour'
      when timeframe ~ '^[0-9]+\s*(m|min|mins)$'  then (regexp_replace(timeframe, '\D', '', 'g'))::int * interval '1 minute'
    end as period
  from spaced
)
select symbol, timeframe, count(*) as n_bars,
  min(period) as claims_period,
  mode() within group (order by gap) filter (where gap > interval '0') as modal_actual_gap,
  case
    when min(period) is null then 'not time-based, not checked'
    when count(*) < 3 then 'too few bars to judge'
    when mode() within group (order by gap) filter (where gap > interval '0') = min(period)
      then 'ok'
    else 'MISLABELLED - the usual gap is not the period claimed'
  end as verdict
from claimed
group by 1, 2
order by 1, 2;
