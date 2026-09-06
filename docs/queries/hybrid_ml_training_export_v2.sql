-- SELECT-only local research export, v2: every market the feed has recorded.
--
-- Same shape as hybrid_ml_training_export_v1.sql. Only the scope changed: all four
-- instruments instead of MNQU6/GC, and the window runs to the last complete UTC day
-- instead of stopping at 2026-09-04. Nothing here selects on an outcome, and no reserved
-- V4 out-of-sample interval is read: V4 reserves the sessions AFTER its gate opens
-- (2026-09-18 at the earliest, per HANDOFF section 0L), which is later than every row below.
--
-- Snapshot consistency does not establish historical signal-time availability, original
-- chart period, or delivery-contract provenance. Those remain unverified, exactly as in v1.
--
-- Timeframe contamination: migration 0035 is still unapplied, so rows labelled '5m' that
-- are not 5-minute bars are still present. Two shapes were censused on 2026-09-04
-- (docs/queries/timeframe_contamination_census.sql):
--   * pre-feed coarse bars (Daily/H4) live entirely before 2026-08-28 and are excluded by
--     the window predicate below;
--   * in-window off-grid bars (1-minute aligned, or sub-second tick bars) are kept in the
--     export and carry exact_grid = false, so the causal builder excludes them by reason
--     'off_grid' and the exclusion is counted in the candidate ledger rather than hidden.
-- The export therefore never silently repairs or drops a row: it reports the flag.
with selected as materialized (
  select b.*, i.symbol, i.exchange, i.tick_size, i.tick_value
  from public.bars b join public.instruments i on i.id=b.instrument_id
  where i.symbol in ('MNQU6','GC','NQU6','BTCUSDT') and b.timeframe='5m' and b.is_closed
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
    and b.opened_at < timestamptz '2026-09-06 00:00:00+00'
), footprint as (
  select l.bar_id, count(*) as level_count,
    sum(l.volume) as level_volume_sum, sum(l.ask) as ask_sum,
    sum(l.bid) as bid_sum, sum(l.between) as between_sum,
    sum(l.ticks::bigint) as tick_sum, max(l.volume) as max_level_volume,
    (array_agg(l.price order by l.volume desc, l.price asc))[1] as derived_poc,
    count(*) filter (where l.price < b.low or l.price > b.high) as outside_level_count,
    count(*) filter (where l.price is null or l.price::text in ('NaN','Infinity','-Infinity')
      or l.volume is null or l.ask is null or l.bid is null or l.between is null
      or l.ticks is null or l.volume<0 or l.ask<0 or l.bid<0 or l.between<0 or l.ticks<0
      or l.volume::text in ('NaN','Infinity','-Infinity')
      or l.ask::text in ('NaN','Infinity','-Infinity')
      or l.bid::text in ('NaN','Infinity','-Infinity')
      or l.between::text in ('NaN','Infinity','-Infinity')) as invalid_level_count,
    count(*) filter (where abs(l.volume-l.ask-l.bid-l.between)>0.0002)
      as component_mismatch_count
  from public.cluster_levels l join selected b on b.id=l.bar_id
  group by l.bar_id
), exported as (
  select b.*, 300 as timeframe_sec,
    mod(extract(epoch from b.opened_at),300)=0 as exact_grid,
    coalesce(f.level_count,0) as level_count, f.level_volume_sum,f.ask_sum,f.bid_sum,
    f.between_sum,f.tick_sum,f.max_level_volume,f.derived_poc,
    coalesce(f.outside_level_count,0) as outside_level_count,
    coalesce(f.invalid_level_count,0) as invalid_level_count,
    coalesce(f.component_mismatch_count,0) as component_mismatch_count
  from selected b left join footprint f on f.bar_id=b.id
)
select jsonb_build_object(
  'schema_version','hybrid-ml-training-export-v2',
  'executed_at',statement_timestamp(),
  'project_ref','sckdriuwfyittcybnbhz',
  'target_symbols',jsonb_build_array('MNQU6','GC','NQU6','BTCUSDT'),
  'development_start','2026-08-28T00:00:00Z',
  'development_end_exclusive','2026-09-06T00:00:00Z',
  'row_count',(select count(*) from exported),
  'scope_census',(select jsonb_agg(c order by c->>'symbol') from (
      select jsonb_build_object(
        'symbol',symbol,
        'rows',count(*),
        'off_grid_rows',count(*) filter (where not exact_grid),
        'utc_days',count(distinct (opened_at at time zone 'UTC')::date),
        'first_bar',min(opened_at),'last_bar',max(opened_at),
        'rows_without_footprint',count(*) filter (where level_count=0),
        'rows_with_outside_levels',count(*) filter (where outside_level_count>0),
        'rows_with_tick_mismatch',count(*) filter (where tick_sum is distinct from ticks::bigint)
      ) as c
      from exported group by symbol) s),
  'rows',coalesce((select jsonb_agg(to_jsonb(e) order by instrument_id,opened_at,id)
                  from exported e),'[]'::jsonb),
  'limitations',jsonb_build_array(
    'Mutable latest snapshot: original arrival, period and delivery-contract provenance unverified.',
    'Closed labelled 5m bars include off-grid and inconsistent footprints for explicit exclusions.',
    'POC is derived from emitted levels; ties choose lowest price. This is not resting DOM.',
    'Reused development interval; not pristine OOS or approved production training.',
    'v2 scope adds NQU6 and BTCUSDT and extends the window; the v1 evaluation day is inside the v2 training and calibration span, so v2 scores are not independent of what v1 already reported.',
    'BTCUSDT is a 24/7 crypto perpetual venue and the three futures symbols are not; a shared UTC calendar split does not give them comparable session counts.'
  )
) as hybrid_ml_training_export;
