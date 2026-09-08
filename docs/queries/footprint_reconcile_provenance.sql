-- Why `reconcilesFootprint()` refuses most historical bars.
--
-- The rule is that a bar's footprint ladder must sum to the bar's own tick
-- count. HANDOFF §0AE.5 measured that at 36.5% and called it the largest
-- untouched lever on signal frequency. These queries locate the cause: it is
-- not the market, the hour, or the threshold. It is that a bar re-sent by a
-- reloading chart overwrites the bar row while the ladder keeps the rows the
-- live pass wrote.
--
-- Run against the production project. Read-only.

-- 1. The direction of every mismatch.
--    A ladder is never thinner than its bar. If the live pass were double
--    counting, or the ladder were truncated, this would not hold.
with b as (
  select b.id, i.symbol, b.ticks as bar_ticks
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.opened_at > now() - interval '7 days'
), l as (
  select bar_id, sum(ticks) as lad from public.cluster_levels group by bar_id
)
select b.symbol,
       count(*) filter (where l.lad = b.bar_ticks) as equal,
       count(*) filter (where l.lad > b.bar_ticks) as ladder_richer,
       count(*) filter (where l.lad < b.bar_ticks) as ladder_thinner
from b join l on l.bar_id = b.id
group by 1 order by 1;

-- 2. Reconciliation against how long after the bar opened its row was last
--    written. `updated_at` far past `opened_at` means a chart re-sent a bar it
--    had already streamed.
with b as (
  select b.id, i.symbol, b.ticks as bar_ticks,
         extract(epoch from (b.updated_at - b.opened_at)) / 60 as age_min
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.opened_at > now() - interval '7 days'
    and i.symbol in ('MNQU6', 'GC')
), l as (
  select bar_id, sum(ticks) as lad from public.cluster_levels group by bar_id
)
select b.symbol,
       case
         when b.age_min < 10 then 'a. <10 min (live only)'
         when b.age_min < 60 then 'b. 10-60 min'
         when b.age_min < 360 then 'c. 1-6 h'
         else 'd. >6 h (late re-send)'
       end as write_age,
       count(*) as bars,
       round(100.0 * count(*) filter (where l.lad = b.bar_ticks) / count(*), 1) as pct_reconcile,
       round(avg(l.lad::numeric / nullif(b.bar_ticks, 0)), 3) as avg_ratio
from b join l on l.bar_id = b.id
group by 1, 2 order by 1, 2;

-- 3. The same split held inside each hour of the day, so "the quiet hours
--    reconcile" cannot explain it. Only hours holding both kinds are listed.
with b as (
  select b.id, b.ticks as bar_ticks,
         extract(hour from b.opened_at)::int as hh,
         (extract(epoch from (b.updated_at - b.opened_at)) / 60 < 10) as live_only
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.opened_at > now() - interval '7 days'
    and i.symbol = 'MNQU6'
), l as (
  select bar_id, sum(ticks) as lad from public.cluster_levels group by bar_id
)
select b.hh as utc_hour,
       count(*) filter (where b.live_only) as live_bars,
       round(100.0 * count(*) filter (where b.live_only and l.lad = b.bar_ticks)
             / nullif(count(*) filter (where b.live_only), 0), 1) as pct_ok_live,
       count(*) filter (where not b.live_only) as resent_bars,
       round(100.0 * count(*) filter (where not b.live_only and l.lad = b.bar_ticks)
             / nullif(count(*) filter (where not b.live_only), 0), 1) as pct_ok_resent
from b join l on l.bar_id = b.id
group by 1
having count(*) filter (where b.live_only) > 0
   and count(*) filter (where not b.live_only) > 0
order by 1;

-- 4. One mismatched bar in full. The bar row is internally consistent
--    (ask + bid = volume) and so is the ladder; they simply describe the same
--    five minutes from two different snapshots.
with b as (
  select b.id, b.ticks, b.volume, b.ask_volume, b.bid_volume, b.low, b.high,
         b.is_closed, b.opened_at, b.updated_at
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and i.symbol = 'MNQU6'
    and b.opened_at = '2026-09-07T05:00:00Z'
)
select b.opened_at, b.updated_at, b.is_closed,
       b.ticks as bar_ticks, b.volume, b.ask_volume + b.bid_volume as bar_ask_plus_bid,
       (select sum(ticks) from public.cluster_levels c where c.bar_id = b.id) as ladder_ticks,
       (select sum(ask + bid) from public.cluster_levels c where c.bar_id = b.id) as ladder_ask_plus_bid,
       (select count(*) from public.cluster_levels c
         where c.bar_id = b.id and (c.price < b.low or c.price > b.high)) as rows_outside_range
from b;
