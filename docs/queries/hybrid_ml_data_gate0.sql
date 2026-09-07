-- Hybrid ML data-readiness census v2. SELECT only; no empirical verdict.
-- Owner scope: MNQ and GC only. Current historical MNQ contract is MNQU6.
-- Development data: [2026-08-28, 2026-09-04) UTC. Do not extend after seeing results.
-- Older coverage reads timestamp metadata only. No row at/after development_end
-- is selected, including for a future horizon. V4/O2 gates are unchanged.
-- Save COMPLETE JSON, query SHA/commit and timestamp. Empty is not a readiness PASS.
-- Exact numeric modulo preserves fractional seconds; integer casts can round onto
-- the grid. Grid alignment does NOT prove chart period or absence of overwritten bars.
-- Current bars/levels and instrument metadata are mutable, not historical snapshots.
-- UTC days are coverage buckets, not verified exchange sessions/independent samples.
with
cfg as (
  select timestamptz '2026-08-28 00:00:00+00' as development_start,
         timestamptz '2026-09-04 00:00:00+00' as development_end,
         0.00005::numeric as half_volume_quantum
),
metadata as materialized (
  select b.id, b.instrument_id, b.timeframe, b.opened_at, b.is_closed,
         (b.opened_at at time zone 'UTC')::date as utc_day,
         mod(extract(epoch from b.opened_at), 300) = 0 as on_5m_grid,
         -- Legacy diagnostic ONLY; never use for eligibility.
         date_part('epoch', b.opened_at)::bigint % 300 = 0 as rounded_5m_grid,
         case when b.opened_at < c.development_start
              then 'pre_feed_boundary' else 'development' end as era
  from public.bars b
  join public.instruments scope_i on scope_i.id = b.instrument_id
  cross join cfg c
  where scope_i.symbol in ('MNQU6', 'GC') and b.opened_at < c.development_end
),
coverage as (
  select instrument_id, timeframe, utc_day, era, count(*) as rows,
         count(*) filter (where is_closed is true) as closed_rows,
         count(*) filter (where is_closed is not true) as not_closed_rows,
         count(*) filter (where timeframe = '5m' and is_closed and on_5m_grid)
           as closed_5m_exact_grid_rows,
         count(*) filter (where timeframe = '5m' and not on_5m_grid)
           as labelled_5m_off_grid_rows,
         count(*) filter (where timeframe = '5m' and not on_5m_grid and rounded_5m_grid)
           as off_grid_rows_hidden_by_legacy_rounding,
         count(*) filter (where timeframe = '5m' and not rounded_5m_grid)
           as legacy_rounded_off_grid_rows,
         min(opened_at) as first_opened_at, max(opened_at) as last_opened_at
  from metadata group by instrument_id, timeframe, utc_day, era
),
dev as materialized (
  select b.*, m.utc_day, m.on_5m_grid, i.tick_size
  from metadata m join public.bars b on b.id = m.id
  join public.instruments i on i.id = m.instrument_id
  where m.era = 'development' and m.timeframe = '5m' and m.is_closed
),
levels as (
  select l.bar_id, count(*) as level_count,
         sum(l.ask) as ask_sum, sum(l.bid) as bid_sum,
         sum(l.between) as between_sum, sum(l.volume) as volume_sum,
         sum(l.ticks::bigint) as ticks_sum,
         count(*) filter (where l.price is null or
           l.price::text in ('NaN','Infinity','-Infinity') or
           l.ask is null or l.bid is null or l.between is null or l.volume is null or
           l.ask < 0 or l.bid < 0 or l.between < 0 or l.volume < 0 or
           l.ask::text in ('NaN','Infinity','-Infinity') or
           l.bid::text in ('NaN','Infinity','-Infinity') or
           l.between::text in ('NaN','Infinity','-Infinity') or
           l.volume::text in ('NaN','Infinity','-Infinity') or
           l.ticks is null or l.ticks < 0) as invalid_level_rows,
         count(*) filter (where l.price < b.low or l.price > b.high)
           as levels_outside_bar_range,
         count(*) filter (where abs(l.volume - l.ask - l.bid - l.between) > 0.0002)
           as component_sum_mismatch_rows
  from public.cluster_levels l join dev b on b.id = l.bar_id
  group by l.bar_id
),
quality_flags as (
  select b.instrument_id, b.utc_day, b.on_5m_grid,
         b.volume, b.ticks, b.trades,
         coalesce(l.level_count, 0) as level_count,
         b.open is null or b.high is null or b.low is null or b.close is null or
           b.open::text in ('NaN','Infinity','-Infinity') or
           b.high::text in ('NaN','Infinity','-Infinity') or
           b.low::text in ('NaN','Infinity','-Infinity') or
           b.close::text in ('NaN','Infinity','-Infinity') or
           b.low > b.high or b.open < b.low or b.open > b.high or
           b.close < b.low or b.close > b.high as bad_ohlc,
         b.high = b.low as zero_range,
         b.volume is null or b.ask_volume is null or b.bid_volume is null or
           b.volume < 0 or b.ask_volume < 0 or b.bid_volume < 0 or
           b.volume::text in ('NaN','Infinity','-Infinity') or
           b.ask_volume::text in ('NaN','Infinity','-Infinity') or
           b.bid_volume::text in ('NaN','Infinity','-Infinity') as bad_volume,
         b.delta is null or b.delta::text in ('NaN','Infinity','-Infinity')
           as bad_delta,
         b.tick_size is null or b.tick_size <= 0 or
           b.tick_size::text in ('NaN','Infinity','-Infinity') as bad_tick_size,
         b.updated_at is null or b.updated_at >= c.development_end
           as last_write_after_window_or_unknown,
         coalesce(l.invalid_level_rows, 0) as invalid_level_rows,
         coalesce(l.levels_outside_bar_range, 0) as levels_outside_bar_range,
         coalesce(l.component_sum_mismatch_rows, 0) as component_sum_mismatch_rows,
         -- Worst-case independent numeric(20,4) rounding for emitted-level sums.
         abs(l.ask_sum - b.ask_volume) > c.half_volume_quantum * (l.level_count + 1)
           as ask_sum_mismatch,
         abs(l.bid_sum - b.bid_volume) > c.half_volume_quantum * (l.level_count + 1)
           as bid_sum_mismatch,
         l.ticks_sum is distinct from b.ticks::bigint as ticks_sum_mismatch,
         abs(l.volume_sum - b.volume) > c.half_volume_quantum * (l.level_count + 1)
           as candle_volume_sum_difference,
         abs((l.ask_sum - l.bid_sum) - b.delta) >
           c.half_volume_quantum * (2 * l.level_count + 1)
           as candle_delta_sum_difference
  from dev b left join levels l on l.bar_id = b.id cross join cfg c
),
quality as (
  select instrument_id, utc_day, on_5m_grid, count(*) as closed_5m_rows,
         count(*) filter (where on_5m_grid) as exact_grid_rows,
         count(*) filter (where bad_ohlc) as bad_ohlc_rows,
         count(*) filter (where zero_range) as zero_range_rows,
         count(*) filter (where bad_volume) as bad_volume_rows,
         count(*) filter (where volume = 0) as zero_volume_rows,
         count(*) filter (where bad_delta) as bad_delta_rows,
         count(*) filter (where bad_tick_size) as bad_tick_size_rows,
         count(*) filter (where ticks is null) as null_ticks_rows,
         count(*) filter (where ticks = 0) as zero_ticks_rows,
         count(*) filter (where ticks < 0) as negative_ticks_rows,
         count(*) filter (where trades is null) as null_trades_rows,
         count(*) filter (where trades = 0) as zero_trades_rows,
         count(*) filter (where trades < 0) as negative_trades_rows,
         count(*) filter (where level_count = 0) as no_footprint_rows,
         count(*) filter (where level_count > 0) as footprint_present_rows,
         sum(level_count) as footprint_level_rows,
         sum(invalid_level_rows) as invalid_level_rows,
         sum(levels_outside_bar_range) as levels_outside_bar_range,
         sum(component_sum_mismatch_rows) as component_sum_mismatch_rows,
         count(*) filter (where level_count > 0 and ask_sum_mismatch) as ask_sum_mismatch_bars,
         count(*) filter (where level_count > 0 and bid_sum_mismatch) as bid_sum_mismatch_bars,
         count(*) filter (where level_count > 0 and ticks_sum_mismatch) as ticks_sum_mismatch_bars,
         count(*) filter (where level_count > 0 and candle_volume_sum_difference)
           as candle_volume_sum_difference_bars,
         count(*) filter (where level_count > 0 and candle_delta_sum_difference)
           as candle_delta_sum_difference_bars,
         count(*) filter (where last_write_after_window_or_unknown)
           as last_write_after_window_or_unknown_rows
  from quality_flags group by instrument_id, utc_day, on_5m_grid
),
-- Timestamp-only branch, independent of price/quality filters. On a unique exact
-- grid, 50 predecessors spanning 250 minutes proves all intervening steps exist.
clock_rows as (
  select distinct m.instrument_id, m.opened_at
  from metadata m cross join cfg c
  where m.era = 'development' and m.timeframe = '5m' and m.is_closed
    and m.on_5m_grid and m.opened_at + interval '5 minutes' <= c.development_end
),
clock_offsets as (
  select instrument_id, opened_at,
         lag(opened_at, 50) over w as previous_50,
         lead(opened_at, 3) over w as future_3,
         lead(opened_at, 6) over w as future_6,
         lead(opened_at, 10) over w as future_10
  from clock_rows
  window w as (partition by instrument_id order by opened_at)
),
clock_counts as (
  select instrument_id, (opened_at at time zone 'UTC')::date as utc_day,
         count(*) as exact_grid_closed_clock_rows,
         count(*) filter (where previous_50 = opened_at - interval '250 minutes')
           as candidates_with_50_previous_bars,
         count(*) filter (where previous_50 = opened_at - interval '250 minutes'
           and future_3 = opened_at + interval '15 minutes') as eligible_15m_clock_only,
         count(*) filter (where previous_50 = opened_at - interval '250 minutes'
           and future_6 = opened_at + interval '30 minutes') as eligible_30m_clock_only,
         count(*) filter (where previous_50 = opened_at - interval '250 minutes'
           and future_10 = opened_at + interval '50 minutes') as eligible_50m_clock_only
  from clock_offsets group by instrument_id, (opened_at at time zone 'UTC')::date
)
select jsonb_build_object(
  'query_version', 'hybrid-ml-data-gate0-v2-mnq-gc',
  'target_markets', jsonb_build_array('MNQ', 'GC'),
  'target_symbols', jsonb_build_array('MNQU6', 'GC'),
  'executed_at', statement_timestamp(),
  'development_start', c.development_start,
  'development_end_exclusive', c.development_end,
  'status', 'readiness observations only; independent review and feature Gate 0 required',
  'coverage_before_end_by_instrument_day', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.instrument_id, x.timeframe, x.utc_day)
    from (select i.symbol, i.exchange, a.* from coverage a
          join public.instruments i on i.id = a.instrument_id) x
  ), '[]'::jsonb),
  'development_quality_by_instrument_day', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.instrument_id, x.utc_day, x.on_5m_grid)
    from (select i.symbol, i.exchange, a.* from quality a
          join public.instruments i on i.id = a.instrument_id) x
  ), '[]'::jsonb),
  'development_clock_availability_by_instrument_day', coalesce((
    select jsonb_agg(to_jsonb(x) order by x.instrument_id, x.utc_day)
    from (select i.symbol, i.exchange, a.* from clock_counts a
          join public.instruments i on i.id = a.instrument_id) x
  ), '[]'::jsonb),
  'interpretation', jsonb_build_array(
    'Outcome-blind census; clock counts are not clean/independent ML samples or a power calculation.',
    '50 lookback bars exclude the candidate; future h bars begin after candidate close.',
    'Candidate, lookback and horizon timestamps stay inside the frozen development window.',
    'Quality is partitioned by exact-grid flag; clock counts exclude off-grid rows.',
    'bars.ticks sums footprint ticks; bars.trades is historically dead/zero. Do not substitute.',
    'Ask/bid/ticks should reconcile to emitted levels; candle volume/delta can differ with partial/stale footprints.',
    'Historical MaxLevels, chart period, exchange tick size and original arrival snapshots remain unverified.',
    'V4/O2 status, holdout reservations and production permissions remain unchanged.'
  )
) as hybrid_ml_gate0
from cfg c;
