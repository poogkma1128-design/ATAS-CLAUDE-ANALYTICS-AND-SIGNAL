-- Three gaps in how a change is judged, closed together.
--
-- 1. NOTHING MEASURED DRAWDOWN. Every number in this system was total R or R
--    per trade, which describe where the equity ended and say nothing about the
--    route. Two settings can post the same expectancy through very different
--    runs of losses, and the deeper one is the one abandoned before the
--    expectancy arrives. With stops taking about half of all trades that is not
--    a remote risk.
--
-- 2. THE MINIMUM-TRADE BAR EXISTED EVERYWHERE EXCEPT WHERE DECISIONS ARE MADE.
--    setup_stability, settings_effect and price_action_edge all refuse to speak
--    below 30 trades. experiment_results carried no such column at all, and the
--    adoption in migration 0021 leaned on a per-instrument check where GC had 17
--    trades and NQU6 had 12 — under the bar the rest of the system enforces.
--    The overall figure was 210 trades and fine; the cells that actually decided
--    it were not.
--
-- 3. EVERY SWEEP RAN ON THE DATA THAT CHOSE THE VALUE. There is a
--    cross-sectional holdout already — "no instrument may get worse" is
--    out-of-sample in the instrument dimension, and it rejected two candidates —
--    but nothing tests a value on bars it has not already seen.
--
--    A train/test split is the textbook answer and is refused here on purpose.
--    There are about two and a half days of bars, and three of four charts have
--    been closed since 28 August; splitting that produces two halves too thin to
--    read and a false sense of rigour, which is a worse failure than the one it
--    claims to fix. What is added instead is forward measurement: an adoption is
--    scored on the trades that fired AFTER it, which is genuinely out-of-sample
--    and gets stronger on its own as bars arrive.

alter table public.experiment_results
  add column max_drawdown_r      numeric(12,2) not null default 0,
  add column worst_losing_streak integer       not null default 0;

comment on column public.experiment_results.max_drawdown_r is
  'Deepest fall from a running peak, in R, over the trades in this breakdown taken in the order they opened. Read beside total_r: the same total reached through a deeper hole is not the same result.';

comment on column public.experiment_results.worst_losing_streak is
  'Longest run of consecutive losing trades. How long the drawdown had to be sat through, which is what decides whether it would have been.';

-- ------------------------------------------------------ reading experiments

-- Everything a variant says, with the two things that decide whether to believe
-- it: R per trade rather than a total that moves with trade count, and a
-- verdict that refuses to speak from too few trades.
create view public.experiment_readout
with (security_invoker = true) as
  select e.name        as experiment,
         e.created_at,
         e.bars_from,
         e.bars_to,
         r.variant,
         r.symbol,
         r.rule_key,
         r.direction,
         r.trades,
         r.win_rate,
         r.total_r,
         -- Never one without the other. A threshold that changes how many
         -- trades fire can lift the total while making every trade worse
         -- (HANDOFF rule 13).
         round(r.total_r / nullif(r.trades, 0), 3) as r_per_trade,
         r.max_drawdown_r,
         r.worst_losing_streak,
         -- Return per unit of pain. Undefined when nothing was ever given back,
         -- which is itself worth seeing rather than papering over with a zero.
         round(r.total_r / nullif(r.max_drawdown_r, 0), 2) as r_per_drawdown,
         r.hit_target, r.hit_stop, r.hit_trail, r.timed_out,
         case
           when r.trades < 30 then 'too few trades'
           else 'readable'
         end as verdict
    from public.experiments e
    join public.experiment_results r on r.experiment_id = e.id
   where e.status = 'done';

comment on view public.experiment_readout is
  'Experiment results with R per trade, drawdown, and a verdict that marks any breakdown under 30 trades as unreadable. The 30 is the same bar setup_stability and settings_effect already hold live results to; before this view the experiment side had no bar at all, and a per-instrument cell of 12 trades looked exactly like one of 200.';

-- --------------------------------------------------- forward-only measurement

-- An adopted setting, scored only on trades that fired after it was adopted.
--
-- settings_effect already groups live trades by the geometry recorded on each
-- signal, which is what makes this possible without storing anything new: the
-- first trade carrying an arrangement dates that arrangement's adoption, so
-- every trade in the group is by construction one the sweep never saw.
--
-- This is not a walk-forward, and does not pretend to be. It is the honest
-- version available on two and a half days of data, and it becomes a real
-- out-of-sample record without anyone having to remember to start it.
create view public.forward_test
with (security_invoker = true) as
  with per_trade as (
    select round((s.reward_ticks        / nullif(s.risk_ticks, 0))::numeric, 2) as reward_r,
           round((s.trail_trigger_ticks / nullif(s.risk_ticks, 0))::numeric, 2) as trail_after_r,
           round((s.trail_offset_ticks  / nullif(s.risk_ticks, 0))::numeric, 2) as trail_offset_r,
           i.symbol,
           (s.fired_at at time zone 'UTC')::date          as session_day,
           s.fired_at,
           o.pnl_ticks / nullif(s.risk_ticks, 0)          as r
      from public.signals s
      join public.instruments i     on i.id = s.instrument_id
      join public.signal_outcomes o on o.signal_id = s.id
     where o.status = 'resolved'
  ),
  -- Walked in fire order within each arrangement, so the drawdown is the one
  -- that would have been lived through while running it.
  walked as (
    select reward_r, trail_after_r, trail_offset_r, symbol, session_day, fired_at, r,
           sum(r) over (
             partition by reward_r, trail_after_r, trail_offset_r
             order by fired_at
             rows between unbounded preceding and current row
           ) as equity
      from per_trade
  ),
  peaked as (
    select w.*,
           max(equity) over (
             partition by reward_r, trail_after_r, trail_offset_r
             order by fired_at
             rows between unbounded preceding and current row
           ) as peak
      from walked w
  )
  select reward_r, trail_after_r, trail_offset_r,
         count(*)::integer                     as trades,
         count(distinct symbol)::integer       as symbols,
         count(distinct session_day)::integer  as sessions,
         min(fired_at)                         as adopted_at,
         max(fired_at)                         as last_fired,
         round(sum(r), 2)                      as total_r,
         round(avg(r), 3)                      as r_per_trade,
         round(max(peak - equity), 2)          as max_drawdown_r,
         round(count(*) filter (where r > 0)::numeric / nullif(count(*), 0), 4) as win_rate,
         case
           when count(*) < 30              then 'need more trades'
           when count(distinct symbol) < 2 then 'need more symbols'
           else 'readable'
         end                                   as verdict
    from peaked
   group by reward_r, trail_after_r, trail_offset_r;

comment on view public.forward_test is
  'Each settings arrangement scored only on the trades that fired while it was live — data no sweep that chose it could have seen. Not a walk-forward: with a few days of bars a train/test split would produce two unreadable halves and a false sense of rigour. verdict holds it to the same 30 trades and 2 instruments as everything else.';
