-- Instrument tick identity: what the database *says* the tick is, against what
-- the price data itself shows.
--
-- Background: HANDOFF §0Q/§0R and STRATEGY_ENGINE_PLAN §3 item 2 recorded a
-- suspicion that `instruments.tick_size` holds a chart price step rather than
-- the contract tick. This query settles it without asking the terminal, by
-- reading the smallest gap between distinct traded prices in the footprint
-- levels the same feed recorded.
--
-- Read-only. It writes nothing.
--
-- Why the smallest observed gap is a valid witness: prices in these instruments
-- are dense over their range (MNQU6 shows 3,132 distinct prices across ~884
-- index points, i.e. most of the 0.25 grid), so the minimum positive gap
-- between adjacent distinct prices is the real increment, not an artefact of
-- thin sampling. Check `distinct_prices` against `points_of_range / step`
-- before trusting the result on a new instrument.

-- ------------------------------------------------- A. recorded vs observed
with lv as (
  select i.symbol, c.price
  from public.cluster_levels c
  join public.bars b       on b.id = c.bar_id
  join public.instruments i on i.id = b.instrument_id
  where b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
),
distinct_prices as (
  select distinct symbol, price from lv
),
gaps as (
  select symbol,
         price,
         price - lag(price) over (partition by symbol order by price) as step
  from distinct_prices
),
observed as (
  select symbol,
         count(*)                                   as distinct_prices,
         min(step) filter (where step > 0)          as smallest_step,
         mode() within group (order by step)        as most_common_step,
         min(price)                                 as min_price,
         max(price)                                 as max_price
  from gaps
  group by symbol
)
select o.symbol,
       i.tick_size                                    as recorded_tick_size,
       o.smallest_step                                as observed_price_step,
       o.most_common_step,
       round(i.tick_size / nullif(o.smallest_step, 0), 2) as recorded_over_observed,
       case when i.tick_size = o.smallest_step then 'agrees'
            else 'DISAGREES' end                     as verdict,
       i.tick_value                                   as recorded_tick_value,
       o.distinct_prices,
       o.min_price, o.max_price
from observed o
join public.instruments i on i.symbol = o.symbol
order by o.symbol;

-- Result as of 2026-09-06 (recorded so a later run can be compared):
--   symbol   recorded  observed  ratio  verdict
--   BTCUSDT     10.00      0.10   100x  DISAGREES
--   GC           0.30      0.10     3x  DISAGREES
--   MNQU6        0.75      0.25     3x  DISAGREES   <- the chosen instrument
--   NQU6         0.25      0.25     1x  agrees
--   tick_value is NULL on all four, so no money figure can be computed at all.

-- ------------------------------- B. are MNQU6 and NQU6 the same series?
-- They track the same index, so a reasonable worry is that one feed is being
-- recorded twice. It is not: on bars sharing a timestamp, OHLC matches on a
-- small minority and volume/ticks never match.
with n as (
  select b.opened_at, b.open, b.high, b.low, b.close, b.volume, b.ticks
  from public.bars b join public.instruments i on i.id = b.instrument_id
  where i.symbol = 'NQU6' and b.timeframe = '5m' and b.is_closed
),
m as (
  select b.opened_at, b.open, b.high, b.low, b.close, b.volume, b.ticks
  from public.bars b join public.instruments i on i.id = b.instrument_id
  where i.symbol = 'MNQU6' and b.timeframe = '5m' and b.is_closed
)
select count(*) as overlapping_bars,
       count(*) filter (where n.open = m.open and n.high = m.high
                          and n.low = m.low and n.close = m.close) as identical_ohlc,
       count(*) filter (where n.volume = m.volume) as identical_volume,
       count(*) filter (where n.ticks  = m.ticks)  as identical_ticks
from n join m on n.opened_at = m.opened_at;

-- Result as of 2026-09-06: 1,162 overlapping bars, 31 identical OHLC,
-- 0 identical volume, 0 identical ticks. Two genuinely separate order books.
