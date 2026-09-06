-- Which instrument is the feed's "BTCUSDT"? Export one UTC day as a compact series so it can be
-- compared bar-for-bar against a Binance public archive file.
--
-- Read-only. Project sckdriuwfyittcybnbhz. First recorded 2026-09-06 for
-- docs/experiments/2026-09-06-btcusdt-history-plan.md.
--
-- The answer measured on 2026-09-03 (141 overlapping bars) was the USDⓈ-M PERPETUAL, not spot:
--   futures/um : median close difference +0.00, 141/141 bars within 0.5 USD (our own rounding),
--                median volume difference +0.002, 139/141 within 0.05 BTC
--   spot       : median close difference -35.70, 0/141 within 0.5 USD,
--                median volume difference +303.061, 0/141 within 0.05 BTC
--
-- Spot correlates 0.97 with the feed on 5-minute returns, so a check that only compared the shape of
-- the curves would have accepted an instrument that is ~35 USD and ~300 BTC per bar wrong. Compare
-- levels and volumes, not shapes.
--
-- Archive files (bulk host data.binance.vision; the REST API answers 451 from the research
-- environment, so the archive is the only usable path):
--   futures/um/daily/klines/BTCUSDT/5m/BTCUSDT-5m-<YYYY-MM-DD>.zip   -- open_time in MILLIseconds
--   spot/daily/klines/BTCUSDT/5m/BTCUSDT-5m-<YYYY-MM-DD>.zip         -- open_time in MICROseconds
-- Getting that unit wrong shifts every bar, so check it on a sample before trusting a comparison.
--
-- Change the date to move the window. Only on-grid closed 5m bars are exported, for the same reason
-- the ML export excludes them: the off-grid rows are the timeframe contamination of section 0L and
-- migration 0035 has not been applied.
select string_agg(
         to_char(extract(epoch from b.opened_at)::bigint, 'FM9999999999') || ':' ||
         b.close::numeric(12,0) || ':' ||
         round(b.volume::numeric, 1),
         ',' order by b.opened_at) as series
from public.bars b
join public.instruments i on i.id = b.instrument_id
where i.symbol = 'BTCUSDT'
  and b.timeframe = '5m'
  and b.is_closed
  and b.opened_at >= timestamptz '2026-09-03 00:00:00+00'
  and b.opened_at <  timestamptz '2026-09-04 00:00:00+00'
  and mod(extract(epoch from b.opened_at), 300) = 0;

-- Companion census: how complete is the feed on a market that never closes, and did the recorded
-- price precision change inside the session? On 2026-09-05 the answer was 225 of 288 possible bars,
-- and the closes moved from 1-unit to a 10-unit grid at 02:45 UTC - the chart's price step changed
-- partway through, which is the same class of silent setting change that caused section 0L.
select (b.opened_at at time zone 'UTC')::date as utc_day,
       count(*) as bars,
       288 - count(*) as missing_from_a_full_day,
       count(*) filter (where b.close::numeric % 10 = 0) as closes_on_10_unit_grid,
       count(*) filter (where b.close::numeric % 10 <> 0) as closes_off_it,
       min(b.opened_at) filter (where b.close::numeric % 10 <> 0) as first_off_grid_close,
       max(b.opened_at) filter (where b.close::numeric % 10 <> 0) as last_off_grid_close
from public.bars b
join public.instruments i on i.id = b.instrument_id
where i.symbol = 'BTCUSDT'
  and b.timeframe = '5m'
  and b.is_closed
  and mod(extract(epoch from b.opened_at), 300) = 0
  and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
group by 1
order by 1;
