-- H4 Mathematical Candle Signature — Gate 0 (population counts only)
--
-- Companion to docs/experiments/2026-09-03-mathematical-candle-signature.md
--
-- These queries COUNT the population of each planned cell. They deliberately do
-- NOT touch any outcome column (MFE, MAE, expectancy, next-bar direction). Gate 0
-- exists to prove a measurement can bind BEFORE any result is seen; a Gate 0 query
-- that reads outcomes is not a gate, it is the experiment.
--
-- Read-only. Run against project sckdriuwfyittcybnbhz. Recorded 2026-09-03.
-- Every threshold here is frozen in section ง of the experiment document. Changing
-- one and re-running is a new experiment, not a re-run of this one.

-- ---------------------------------------------------------------- shared base
-- Q0. Feature construction, reused by every query below.
--
-- median20 excludes the bar itself (rn-20 .. rn-1) so nothing a bar knows about
-- itself leaks into its own baseline. The same construction is why V1 and V2 are
-- comparable: only the measurement origin changes, not the feature definition.
create temporary view h4_base as
with b as (
  select b.id, b.instrument_id, i.symbol, b.opened_at,
         b.open, b.high, b.low, b.close, b.volume, b.poc_price,
         row_number() over (partition by b.instrument_id order by b.opened_at) as rn
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.is_closed
),
feat as (
  select b.*,
         (b.high - b.low) as rng,
         case when b.high > b.low then (b.close - b.open) / (b.high - b.low) end as body_share,
         case when b.high > b.low then (b.close - b.low)  / (b.high - b.low) end as close_loc,
         m.med_range, m.med_vol, m.hi50, m.lo50
  from b
  left join lateral (
    select percentile_cont(0.5) within group (order by (p.high - p.low)) as med_range,
           percentile_cont(0.5) within group (order by p.volume)         as med_vol,
           max(p.high) as hi50,
           min(p.low)  as lo50
    from b p
    where p.instrument_id = b.instrument_id
      and p.rn between b.rn - 50 and b.rn - 1
  ) m on true
)
select *,
       -- frozen thresholds: expansion 1.5x, body 0.6, relative volume 1.2
       (rng > 1.5 * med_range and abs(body_share) > 0.6 and volume > 1.2 * med_vol) as strong,
       (close_loc > 0.8) as closed_at_high,
       (close_loc < 0.2) as closed_at_low,
       case when hi50 > lo50 then (close - lo50) / (hi50 - lo50) end as range_pos_50,
       case when rng > 0 and poc_price is not null
            then abs(close - poc_price) / rng end as poc_dist_in_range
from feat
where med_range is not null and med_range > 0 and med_vol > 0 and rng > 0 and hi50 is not null;

-- --------------------------------------------------------------------- Q1
-- Data coverage per instrument, and the two columns that decide whether an
-- order-flow layer is possible at all. cum_delta came back 0 for every bar on
-- 2026-09-03, which is why Cumulative Delta is blocked out of V2/V3.
select i.symbol,
       count(*) filter (where b.is_closed) as closed_bars,
       min(b.opened_at) as first_bar,
       max(b.opened_at) as last_bar,
       count(*) filter (where b.is_closed and b.cum_delta is not null) as with_cum_delta,
       count(*) filter (where b.is_closed and b.poc_price is not null) as with_poc
from public.bars b
join public.instruments i on i.id = b.instrument_id
where b.timeframe = '5m'
group by i.symbol
order by closed_bars desc;

-- --------------------------------------------------------------------- Q2
-- Footprint availability. 934,227 cluster_levels rows covering 5,751 of 5,751
-- closed bars is what makes an order-flow layer viable later; the constraint on
-- V3 is cell size, not missing data.
select (select count(*) from public.cluster_levels)                as cluster_level_rows,
       (select count(distinct bar_id) from public.cluster_levels)  as bars_with_footprint,
       (select count(*) from public.bars
         where timeframe = '5m' and is_closed)                     as bars_closed_total,
       (select count(*) from public.bars
         where timeframe = '5m' and is_closed and delta <> 0)      as bars_with_delta;

-- --------------------------------------------------------------------- Q3
-- Pooled cell sizes. This is the query that decides how many context dimensions
-- V2 may use: ~124 per cell at one dimension, ~60 at two, ~30 at three.
select count(*)                                                             as bars_usable,
       count(*) filter (where strong)                                       as strong_any,
       count(*) filter (where strong and closed_at_high)                    as strong_up,
       count(*) filter (where strong and closed_at_low)                     as strong_down,
       count(*) filter (where strong and closed_at_high
                          and range_pos_50 > 0.8)                           as h2_up_at_range_high,
       count(*) filter (where strong and closed_at_high
                          and range_pos_50 between 0.2 and 0.8)             as h1_up_mid_range,
       count(*) filter (where strong and closed_at_low
                          and range_pos_50 < 0.2)                           as h2_down_at_range_low,
       count(*) filter (where strong and closed_at_low
                          and range_pos_50 between 0.2 and 0.8)             as h1_down_mid_range,
       count(*) filter (where strong and poc_dist_in_range < 0.5)           as strong_near_poc
from h4_base;

-- --------------------------------------------------------------------- Q4
-- The same cells split by instrument. The smallest cell came back at 15 bars
-- (NQU6), which is inside the 4-20 band Handoff 5.25 already forbids splitting.
-- This result is why V2 pools across instruments and uses per-instrument counts
-- only as a sign test.
select symbol,
       count(*) filter (where strong and closed_at_high)               as strong_up,
       count(*) filter (where strong and closed_at_high
                          and range_pos_50 > 0.8)                      as h2_up_at_range_high,
       count(*) filter (where strong and closed_at_high
                          and range_pos_50 between 0.2 and 0.8)        as h1_up_mid_range,
       count(*) filter (where strong and closed_at_low)                as strong_down,
       count(*) filter (where strong and closed_at_low
                          and range_pos_50 < 0.2)                      as h2_down_at_range_low,
       count(*) filter (where strong and closed_at_low
                          and range_pos_50 between 0.2 and 0.8)        as h1_down_mid_range
from h4_base
group by symbol
order by strong_up desc;

-- --------------------------------------------------------------------- Q5
-- Session spread of each cell. A cell that lives in one session fails criterion 3
-- of the failure list no matter how good its numbers look.
select symbol,
       count(distinct (opened_at at time zone 'UTC')::date) as sessions,
       count(*) filter (where strong and closed_at_high)    as strong_up,
       count(*) filter (where strong and closed_at_low)     as strong_down
from h4_base
group by symbol
order by symbol;
