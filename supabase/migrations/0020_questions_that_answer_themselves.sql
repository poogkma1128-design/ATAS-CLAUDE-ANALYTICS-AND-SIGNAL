-- Two questions that were parked in a document, moved into the database.
--
-- HANDOFF section 5.9 and section 8.1 both ended the same way: "re-run this
-- query when there are enough trades." That is a reminder, and reminders are
-- the thing this project keeps trying to delete. Section 5.5 had the same
-- shape and became public.setup_stability, which now answers on its own
-- whether a cell is ready to act on. These two views finish that job.
--
-- Neither view changes anything. They report, and they say when they cannot
-- yet answer -- which is a different statement from a bad answer, and the
-- reason both carry a verdict column instead of just numbers.

-- ------------------------------------------------- did the settings help?

-- Trades grouped by the plan geometry each one actually fired with.
--
-- The query this replaces split trades on a hard-coded timestamp, the moment
-- migration 0014 was applied. That worked exactly once. The moment a second
-- setting changes -- 0019 moving the target -- everything after that timestamp
-- differs from everything before it in two ways at once, and the comparison
-- stops answering the question it was written for.
--
-- Nothing has to be remembered, because every signal already records the plan
-- it fired with: reward_ticks, risk_ticks, trail_trigger_ticks and
-- trail_offset_ticks are written at fire time and are never rewritten when the
-- settings move on. Dividing them recovers the settings that trade was actually
-- given. A settings change therefore opens a new group by itself, and the
-- existing groups keep their numbers -- the same property that makes
-- signals.muted safe to read months later.
--
-- Reproduces the old query exactly where they overlap: 275 trades on
-- trail 1/0.5 and 24 on trail 0.5/0.25, without knowing any dates.
create view public.settings_effect
with (security_invoker = true) as
  with per_trade as (
    select round((s.reward_ticks        / nullif(s.risk_ticks, 0))::numeric, 2) as reward_r,
           round((s.trail_trigger_ticks / nullif(s.risk_ticks, 0))::numeric, 2) as trail_after_r,
           round((s.trail_offset_ticks  / nullif(s.risk_ticks, 0))::numeric, 2) as trail_offset_r,
           i.symbol,
           (s.fired_at at time zone 'UTC')::date               as session_day,
           s.fired_at,
           o.exit_reason,
           o.pnl_ticks / nullif(s.risk_ticks, 0)               as r
      from public.signals s
      join public.instruments i     on i.id = s.instrument_id
      join public.signal_outcomes o on o.signal_id = s.id
     where o.status = 'resolved'
  ),
  -- What the rules are set to right now, so a group can say whether it is the
  -- arrangement currently running. Taken per rule rather than as one value:
  -- rules are allowed to diverge, and a view that assumes they agree would
  -- quietly mislabel the day they stop.
  live as (
    select distinct
           round((params->>'rewardRatio')::numeric,  2) as reward_r,
           round((params->>'trailAfterR')::numeric,  2) as trail_after_r,
           round((params->>'trailOffsetR')::numeric, 2) as trail_offset_r
      from public.rules
     where enabled
  ),
  rolled as (
    select reward_r, trail_after_r, trail_offset_r,
           count(*)::integer                                         as trades,
           count(distinct symbol)::integer                           as symbols,
           count(distinct session_day)::integer                      as sessions,
           count(*) filter (where r > 0)::integer                    as wins,
           round(sum(r), 2)                                          as total_r,
           -- Never reported without total_r beside it, and never the other way
           -- round: a setting that changes how many trades fire can lift the
           -- total while making every trade worse (HANDOFF section 11 rule 13).
           round(avg(r), 3)                                          as r_per_trade,
           count(*) filter (where exit_reason = 'stop')::integer     as hit_stop,
           count(*) filter (where exit_reason = 'target')::integer   as hit_target,
           count(*) filter (where exit_reason = 'trail')::integer    as hit_trail,
           count(*) filter (where exit_reason = 'timeout')::integer  as timed_out,
           min(fired_at)                                             as first_fired,
           max(fired_at)                                             as last_fired
      from per_trade
     group by 1, 2, 3
  )
  select r.*,
         round(r.wins::numeric / nullif(r.trades, 0), 4) as win_rate,
         exists (
           select 1 from live l
            where l.reward_r       is not distinct from r.reward_r
              and l.trail_after_r  is not distinct from r.trail_after_r
              and l.trail_offset_r is not distinct from r.trail_offset_r
         )                                               as is_live,
         -- The bar section 5.9 set for itself before it would accept an answer:
         -- 30 trades and more than one instrument. A group under it is not
         -- evidence of anything, in either direction.
         case
           when r.trades  < 30 then 'need more trades'
           when r.symbols <  2 then 'need more symbols'
           else 'comparable'
         end                                             as verdict
    from rolled r;

comment on view public.settings_effect is
  'Resolved trades grouped by the plan geometry recorded on each signal, so a settings change opens a new group instead of contaminating the old one. verdict says whether a group has cleared 30 trades on at least two instruments; anything under that is unanswered, not bad.';

-- --------------------------------------- are the price action flags worth it?

-- price_action has been collected since it was built and has never filtered
-- anything. That was deliberate: measure first, filter second, which is how the
-- volume gate was decided. This is the measurement, standing rather than
-- run by hand.
--
-- The rule for reading it, unchanged from section 8.1: a cell that separates
-- from the rest AND has enough trades behind it earns promotion to a filter, by
-- moving its threshold into rules.params. A cell that does not separate can be
-- deleted with nothing lost. This view proposes neither -- it only reports which
-- of the two a cell is close to being able to say.
--
-- Grouped by sweep, zone and direction, matching the query it replaces.
-- structure is deliberately left out: the largest cell here is currently 26
-- trades, and a third dimension would divide that into cells too small to read.
create view public.price_action_edge
with (security_invoker = true) as
  with per_trade as (
    select s.payload->'priceAction'->>'sweep'              as sweep,
           s.payload->'priceAction'->>'zone'               as zone,
           s.direction,
           (s.fired_at at time zone 'UTC')::date           as session_day,
           o.pnl_ticks / nullif(s.risk_ticks, 0)           as r
      from public.signals s
      join public.signal_outcomes o on o.signal_id = s.id
     where o.status = 'resolved'
       and s.payload ? 'priceAction'
  ),
  -- What a cell has to beat to be interesting: the average trade across every
  -- signal that carried price action context at all.
  overall as (
    select avg(r) as r_per_trade from per_trade
  ),
  rolled as (
    select sweep, zone, direction,
           count(*)::integer                        as trades,
           count(distinct session_day)::integer     as sessions,
           count(*) filter (where r > 0)::integer   as wins,
           round(sum(r), 2)                         as total_r,
           round(avg(r), 3)                         as r_per_trade
      from per_trade
     group by 1, 2, 3
  )
  select r.*,
         round(r.wins::numeric / nullif(r.trades, 0), 4)  as win_rate,
         round(o.r_per_trade, 3)                          as overall_r_per_trade,
         case
           when r.trades   < 30 then 'need more trades'
           when r.sessions <  3 then 'need more sessions'
           -- 0.25R per trade is a stated bar, not a discovered one. The
           -- signals carrying price action context average 0.247R between them
           -- (overall_r_per_trade), so a cell clearing this bar is roughly
           -- doubling or wiping out the average trade -- separating, rather
           -- than drifting.
           when abs(r.r_per_trade - o.r_per_trade) >= 0.25 then 'separates'
           else 'no different'
         end                                              as verdict
    from rolled r cross join overall o;

comment on view public.price_action_edge is
  'Standing measurement of the price action flags, which are stored and have never filtered anything. A cell needs >=30 trades over >=3 sessions before its verdict means anything; "separates" proposes promoting it to a filter, "no different" says it can be dropped without loss. Proposes only.';
