-- Every signal carries the whole trade, and is scored against it.
--
-- Before this, a signal said only "long, here", and scoring closed the trade at
-- the market N bars later. Those are two different trades: nobody actually
-- holds through a stop, so the win rate described a trade no one would take.
-- The plan below is stated on the signal and is exactly what the scorer walks.

alter table public.signals
  -- The rule's own reference level stays in `price` (for stacked imbalance it
  -- is the top of the run, which is evidence, not a fill). `entry_price` is the
  -- bar close: the first price actually obtainable once the bar has closed and
  -- the rule can be evaluated at all.
  add column if not exists entry_price         numeric(18,8),
  add column if not exists stop_price          numeric(18,8),
  add column if not exists target_price        numeric(18,8),
  add column if not exists risk_ticks          numeric(12,2),
  add column if not exists reward_ticks        numeric(12,2),
  add column if not exists trail_trigger_ticks numeric(12,2),
  add column if not exists trail_offset_ticks  numeric(12,2),
  -- Snapshotted, so retuning a rule later cannot silently rewrite the terms of
  -- trades that have already been taken.
  add column if not exists hold_bars           integer;

comment on column public.signals.entry_price is
  'Signal bar close: the first obtainable price. Scoring runs from here, not from price.';

alter table public.signal_outcomes
  add column if not exists exit_reason text
    check (exit_reason is null or exit_reason in ('target','stop','trail','timeout'));

comment on column public.signal_outcomes.exit_reason is
  'How the plan ended: target hit, initial stop hit, trailed stop hit, or held to the horizon.';

-- Plan sizing, per rule, tunable from /rules like every other threshold.
update public.rules
   set params = params || jsonb_build_object(
         'bufferTicks',  2,
         'minRiskTicks', 4,
         'rewardRatio',  2,
         'trailAfterR',  1,
         'trailOffsetR', 0.5
       )
 where not (params ? 'rewardRatio');

-- Walks the bars after a signal and resolves it the way the plan says to.
--
-- Two things about bar data decide the shape of this. A bar reports only its
-- range, so when one contains both the stop and the target there is no way to
-- know which traded first: it is scored as the stop, because assuming the good
-- fill would quietly inflate every statistic this system exists to produce.
-- And the trail is advanced only after the bar has been checked for exits,
-- since a stop raised using the same bar's high would be a level that never
-- existed while the bar was forming.
create or replace function public.evaluate_pending_outcomes(expire_after interval default '24 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec         record;
  b           record;
  n_resolved  integer := 0;
  tick        numeric;
  is_long     boolean;
  entry       numeric;
  stop_level  numeric;
  target      numeric;
  trail_trig  numeric;
  trail_off   numeric;
  best        numeric;
  trail_on    boolean;   -- not `trailing`: that is a reserved word
  bars_seen   integer;
  hi          numeric;
  lo          numeric;
  last_close  numeric;
  exit_px     numeric;
  exit_why    text;
begin
  for rec in
    select o.signal_id,
           o.horizon_bars,
           s.direction,
           s.price,
           coalesce(s.entry_price, s.price)                as entry_price,
           s.stop_price,
           s.target_price,
           coalesce(s.trail_trigger_ticks, 0)              as trail_trigger_ticks,
           coalesce(s.trail_offset_ticks, 0)               as trail_offset_ticks,
           s.instrument_id,
           s.timeframe,
           s.fired_at,
           b0.opened_at                                    as signal_bar_open,
           i.tick_size
      from public.signal_outcomes o
      join public.signals s     on s.id = o.signal_id
      join public.bars b0       on b0.id = s.bar_id
      join public.instruments i on i.id = s.instrument_id
     where o.status = 'pending'
  loop
    tick       := rec.tick_size;
    is_long    := rec.direction = 'long';
    entry      := rec.entry_price;
    stop_level := rec.stop_price;
    target     := rec.target_price;
    trail_trig := rec.trail_trigger_ticks;
    trail_off  := rec.trail_offset_ticks;

    best       := entry;
    trail_on   := false;
    bars_seen  := 0;
    hi         := null;
    lo         := null;
    last_close := null;
    exit_px    := null;
    exit_why   := null;

    for b in
      select b2.high, b2.low, b2.close, b2.opened_at
        from public.bars b2
       where b2.instrument_id = rec.instrument_id
         and b2.timeframe     = rec.timeframe
         and b2.opened_at     > rec.signal_bar_open
         and b2.is_closed
       order by b2.opened_at
       limit rec.horizon_bars
    loop
      bars_seen  := bars_seen + 1;
      hi         := greatest(coalesce(hi, b.high), b.high);
      lo         := least(coalesce(lo, b.low), b.low);
      last_close := b.close;

      if exit_px is null and stop_level is not null then
        if (is_long and b.low <= stop_level) or (not is_long and b.high >= stop_level) then
          exit_px  := stop_level;
          exit_why := case when trail_on then 'trail' else 'stop' end;
        end if;
      end if;

      if exit_px is null and target is not null then
        if (is_long and b.high >= target) or (not is_long and b.low <= target) then
          exit_px  := target;
          exit_why := 'target';
        end if;
      end if;

      exit when exit_px is not null;

      -- Advance the trail for the next bar only.
      best := case when is_long then greatest(best, b.high) else least(best, b.low) end;

      if stop_level is not null and trail_trig > 0 then
        if not trail_on then
          trail_on := case when is_long then best - entry else entry - best end
                        >= trail_trig * tick;
        end if;

        if trail_on then
          stop_level := case when is_long
                             then greatest(stop_level, best - trail_off * tick)
                             else least(stop_level, best + trail_off * tick) end;
        end if;
      end if;
    end loop;

    if exit_px is not null or bars_seen >= rec.horizon_bars then
      if exit_px is null then
        exit_px  := last_close;
        exit_why := 'timeout';
      end if;

      update public.signal_outcomes
         set status      = 'resolved',
             bars_used   = bars_seen,
             exit_price  = exit_px,
             exit_reason = exit_why,
             mfe_ticks   = greatest(0, case when is_long
                                            then (hi - entry) / tick
                                            else (entry - lo) / tick end),
             mae_ticks   = greatest(0, case when is_long
                                            then (entry - lo) / tick
                                            else (hi - entry) / tick end),
             pnl_ticks   = case when is_long
                                then (exit_px - entry) / tick
                                else (entry - exit_px) / tick end,
             resolved_at = now()
       where signal_id = rec.signal_id;

      n_resolved := n_resolved + 1;

    elsif rec.fired_at < now() - expire_after then
      -- The chart was closed before enough bars arrived. Park it as expired so
      -- it never contaminates the win rate.
      update public.signal_outcomes
         set status      = 'expired',
             bars_used   = bars_seen,
             resolved_at = now()
       where signal_id = rec.signal_id;
    end if;
  end loop;

  return n_resolved;
end;
$$;

revoke all on function public.evaluate_pending_outcomes(interval) from public, anon, authenticated;

-- Same question as before, now answered in the trade's own terms: expectancy in
-- R is what says whether a setup pays, independently of how wide its stops are.
drop view if exists public.setup_stats;

create view public.setup_stats
with (security_invoker = true) as
  select s.rule_key,
         s.direction,
         count(*)::integer                                              as trades,
         count(*) filter (where o.pnl_ticks > 0)::integer               as wins,
         round(avg(case when o.pnl_ticks > 0 then 1 else 0 end), 4)     as win_rate,
         round(avg(o.pnl_ticks), 2)                                     as avg_pnl_ticks,
         round(sum(o.pnl_ticks), 2)                                     as total_pnl_ticks,
         round(avg(o.pnl_ticks / nullif(s.risk_ticks, 0)), 3)           as avg_r,
         round(sum(o.pnl_ticks / nullif(s.risk_ticks, 0)), 2)           as total_r,
         count(*) filter (where o.exit_reason = 'target')::integer      as hit_target,
         count(*) filter (where o.exit_reason = 'stop')::integer        as hit_stop,
         count(*) filter (where o.exit_reason = 'trail')::integer       as hit_trail,
         count(*) filter (where o.exit_reason = 'timeout')::integer     as timed_out,
         round(avg(o.mfe_ticks), 2)                                     as avg_mfe_ticks,
         round(avg(o.mae_ticks), 2)                                     as avg_mae_ticks,
         round(avg(o.bars_used), 1)                                     as avg_bars_held,
         round(avg(s.confidence), 3)                                    as avg_confidence,
         max(s.fired_at)                                                as last_signal_at
    from public.signals s
    join public.signal_outcomes o on o.signal_id = s.id
   where o.status = 'resolved'
   group by s.rule_key, s.direction;

comment on view public.setup_stats is
  'Resolved-signal performance per rule and direction, scored against each signal''s own plan. security_invoker keeps RLS applied.';
