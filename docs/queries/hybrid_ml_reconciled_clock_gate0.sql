-- Conservative feasibility follow-up, NOT a model dataset or trading policy.
-- SELECT only. No future returns, model fitting or outcome ranking.
-- Owner scope: MNQ (historical contract MNQU6) and GC only.
-- Future footprint quality is used only for this complete-window census; do not
-- turn it into an at-decision eligibility rule. A real label pipeline must keep
-- all at-decision candidates and record later data loss/censoring explicitly.
-- A reconciled snapshot is not proof of authentic period or original availability.
with q as (
  select b.instrument_id,b.opened_at,b.id,b.high,b.low,b.open,b.close,
         b.volume,b.ticks,b.ask_volume,b.bid_volume,i.tick_size,
         l.n,l.tick_sum,l.ask_sum,l.bid_sum,l.outside_rows
  from public.bars b
  join public.instruments i on i.id=b.instrument_id
  left join lateral (
    select count(*) n, sum(ticks::bigint) tick_sum,
           sum(ask) ask_sum,sum(bid) bid_sum,
           count(*) filter(where price<b.low or price>b.high) outside_rows
    from public.cluster_levels where bar_id=b.id
  ) l on true
  where i.symbol in ('MNQU6', 'GC') and b.timeframe='5m' and b.is_closed
    and b.opened_at>=timestamptz '2026-08-28 00:00+00'
    and b.opened_at<timestamptz '2026-09-04 00:00+00'
    and mod(extract(epoch from b.opened_at),300)=0
), reconciled as (
  select * from q
  where n>0 and tick_sum=ticks
    and abs(ask_sum-ask_volume)<=0.00005*(n+1)
    and abs(bid_sum-bid_volume)<=0.00005*(n+1)
    and outside_rows=0
    and high>=greatest(open,close) and low<=least(open,close)
    and volume>0 and tick_size>0
), w as (
  select instrument_id,opened_at,
         lag(opened_at,50) over(partition by instrument_id order by opened_at) p50,
         lead(opened_at,10) over(partition by instrument_id order by opened_at) f10
  from reconciled
)
select i.symbol,w.instrument_id,
       count(*) as reconciled_on_grid_bars,
       count(distinct (w.opened_at at time zone 'UTC')::date) utc_days,
       count(*) filter(where p50=opened_at-interval '250 minutes') contiguous_50_prior,
       count(*) filter(where p50=opened_at-interval '250 minutes'
         and f10=opened_at+interval '50 minutes') contiguous_50_prior_10_future,
       statement_timestamp() as queried_at
from w join public.instruments i on i.id=w.instrument_id
group by i.symbol,w.instrument_id order by i.symbol,w.instrument_id;
