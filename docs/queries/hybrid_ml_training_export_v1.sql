-- SELECT-only local research export. Owner requested exploratory training after
-- reading the quality failures. No outcome-based selection or reserved OOS reads.
-- Snapshot consistency does not establish historical signal-time availability.
with selected as materialized (
  select b.*, i.symbol, i.exchange, i.tick_size, i.tick_value
  from public.bars b join public.instruments i on i.id=b.instrument_id
  where i.symbol in ('MNQU6','GC') and b.timeframe='5m' and b.is_closed
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
    and b.opened_at < timestamptz '2026-09-04 00:00:00+00'
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
  'schema_version','hybrid-ml-training-export-v1',
  'executed_at',statement_timestamp(),
  'project_ref','sckdriuwfyittcybnbhz',
  'target_symbols',jsonb_build_array('MNQU6','GC'),
  'development_start','2026-08-28T00:00:00Z',
  'development_end_exclusive','2026-09-04T00:00:00Z',
  'row_count',(select count(*) from exported),
  'rows',coalesce((select jsonb_agg(to_jsonb(e) order by instrument_id,opened_at,id)
                  from exported e),'[]'::jsonb),
  'limitations',jsonb_build_array(
    'Mutable latest snapshot: original arrival, period and delivery-contract provenance unverified.',
    'Closed labelled 5m bars include off-grid and inconsistent footprints for explicit exclusions.',
    'POC is derived from emitted levels; ties choose lowest price. This is not resting DOM.',
    'Reused development interval; not pristine OOS or approved production training.'
  )
) as hybrid_ml_training_export;
