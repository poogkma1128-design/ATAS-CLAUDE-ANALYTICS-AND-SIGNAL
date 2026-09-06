-- Strategy-engine block census.
--
-- Purpose: settle, with data rather than argument, how many independent
-- session x instrument blocks the repository actually holds. The §5 design
-- review (docs/reviews/2026-09-06-strategy-engine-section-5-design-review.md)
-- makes "session x instrument" the resampling unit and requires a minimum
-- number of independent blocks from a power calculation before any Phase 2
-- performance verdict. This query produces the numerator for that gate.
--
-- Read-only. Run against the live project; it writes nothing.
--
-- Definitions used here, chosen to match the plan rather than to flatter it:
--   * on-grid       = 5m bar whose opened_at falls exactly on a 300s boundary
--   * trading day   = America/Chicago date after a 17:00 local rollover
--                     (local + 7h, then take the date)
--   * us_regular    = 08:30 <= local time < 15:00, i.e. 78 possible 5m bars
--   * usable block  = a (symbol, trading day) whose us_regular window holds
--                     at least 70 of those 78 bars (~90% coverage)
--
-- Section A: block census per instrument.
-- Section B: how often a 20-bar trailing percentile window spans a hole,
--            which is the same feed-gap exposure recorded as P1 #2 in
--            docs/reviews/2026-09-06-strategy-engine-phase-1-independent-review.md.

-- ---------------------------------------------------------------- Section A
with on_grid as (
  select i.symbol,
         b.opened_at,
         (b.opened_at at time zone 'America/Chicago') as loc
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m'
    and b.is_closed
    and (extract(epoch from b.opened_at)::bigint % 300) = 0
),
stamped as (
  select symbol,
         opened_at,
         ((loc + interval '7 hours')::date) as trading_day,
         (extract(hour from loc) * 60 + extract(minute from loc))::int as loc_min
  from on_grid
),
per_day as (
  select symbol,
         trading_day,
         count(*) as day_bars,
         count(*) filter (where loc_min >= 510 and loc_min < 900) as us_bars
  from stamped
  group by symbol, trading_day
)
select symbol,
       count(*)                                        as days_with_any_bar,
       count(*) filter (where day_bars >= 144)         as days_holding_half_of_288,
       count(*) filter (where us_bars > 0)             as days_touching_us_regular,
       count(*) filter (where us_bars >= 39)           as blocks_us_half_covered,
       count(*) filter (where us_bars >= 70)           as blocks_us_usable,   -- the gate numerator
       max(us_bars)                                    as best_us_day_bars,   -- 78 is a full session
       min(trading_day)                                as first_day,
       max(trading_day)                                as last_day
from per_day
group by symbol
order by symbol;

-- Expected shape as of 2026-09-06 (recorded so a later run can be compared):
--   BTCUSDT  9 days,  4 usable US blocks
--   GC     102 days,  6 usable US blocks   <- 96 of those days hold ~1 bar each
--   MNQU6  102 days,  6 usable US blocks   <- 96 bars across 96 days = daily-bar artefact
--   NQU6     6 days,  4 usable US blocks
-- The pre-2026-08-28 rows are not 5-minute history; see HANDOFF §0L.

-- ---------------------------------------------------------------- Section B
-- How much of the trailing percentile window is actually contiguous.
-- A 20-bar window that is contiguous spans exactly 95 minutes; anything
-- longer contains a hole (terminal off, per HANDOFF §3.7b) or a session break.
with on_grid as (
  select i.symbol, b.opened_at
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m'
    and b.is_closed
    and (extract(epoch from b.opened_at)::bigint % 300) = 0
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
),
windowed as (
  select symbol,
         opened_at,
         lag(opened_at, 1)  over (partition by symbol order by opened_at) as prev1,
         lag(opened_at, 20) over (partition by symbol order by opened_at) as prev20
  from on_grid
)
select symbol,
       count(*) filter (where prev20 is not null) as bars_with_a_full_20_bar_window,
       count(*) filter (where prev1 is not null
                          and prev1 <> opened_at - interval '5 minutes')
                                                  as bars_whose_predecessor_is_not_adjacent,
       round(100.0 * count(*) filter (where prev1 is not null
                                        and prev1 <> opened_at - interval '5 minutes')
             / nullif(count(*) filter (where prev1 is not null), 0), 1)
                                                  as pct_predecessor_not_adjacent,
       count(*) filter (where prev20 is not null
                          and prev20 < opened_at - interval '100 minutes')
                                                  as windows_spanning_a_hole,
       round(100.0 * count(*) filter (where prev20 is not null
                                        and prev20 < opened_at - interval '100 minutes')
             / nullif(count(*) filter (where prev20 is not null), 0), 1)
                                                  as pct_windows_spanning_a_hole
from windowed
group by symbol
order by symbol;

-- Expected shape as of 2026-09-06:
--   GC 11.3% · NQU6 12.3% · MNQU6 7.3% · BTCUSDT 6.7% of 20-bar windows span a hole.
