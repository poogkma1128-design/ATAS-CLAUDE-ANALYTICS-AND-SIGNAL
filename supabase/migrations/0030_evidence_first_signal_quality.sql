-- Evidence-first is an announcement policy, not a rule filter.
--
-- Every rule still runs and every fired signal still receives an outcome. The
-- policy controls only whether a stored signal is announced, so an unproven
-- cell can earn its way into the allowed set instead of being silenced out of
-- the data forever.

alter table public.rules
  add column if not exists announcement_mode text not null default 'evidence_first';

do $$
begin
  alter table public.rules
    add constraint rules_announcement_mode_check
    check (announcement_mode in ('manual', 'evidence_first'));
exception
  when duplicate_object then null;
end
$$;

-- Existing deployments become evidence-first on migration. `manual` remains
-- an explicit owner override for a rule that must announce despite lacking a
-- qualifying setup_stability cell; the ingest code records no such override
-- implicitly and fails closed if the evidence query is unavailable.
update public.rules
   set announcement_mode = 'evidence_first'
 where announcement_mode is null;

comment on column public.rules.announcement_mode is
  'Telegram announcement policy. evidence_first announces only a setup_stability cell with verdict proposable and proposal keep for the exact symbol/timeframe/rule/direction; query failure mutes it. manual is an explicit owner override. Rules continue to be stored and scored in either mode.';

-- OHLC bars do not reveal their intrabar path. The score retains its existing
-- pessimistic stop-first convention, while this flag makes every newly scored
-- collision visible to reporting instead of pretending its route was known.
alter table public.signal_outcomes
  add column if not exists ambiguous_path boolean;

comment on column public.signal_outcomes.ambiguous_path is
  'True when the same OHLC bar crossed both the active stop and target. The result is still scored stop-first; null means it predates intrabar-path auditing or did not resolve.';

create or replace function public.evaluate_pending_outcomes(expire_after interval default '24 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec            record;
  b              record;
  n_resolved     integer := 0;
  tick           numeric;
  is_long        boolean;
  entry          numeric;
  stop_level     numeric;
  target         numeric;
  trail_trig     numeric;
  trail_off      numeric;
  best           numeric;
  trail_on       boolean;
  bars_seen      integer;
  hi             numeric;
  lo             numeric;
  last_close     numeric;
  exit_px        numeric;
  exit_why       text;
  path_ambiguous boolean;
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
    tick           := rec.tick_size;
    is_long        := rec.direction = 'long';
    entry          := rec.entry_price;
    stop_level     := rec.stop_price;
    target         := rec.target_price;
    trail_trig     := rec.trail_trigger_ticks;
    trail_off      := rec.trail_offset_ticks;

    best           := entry;
    trail_on       := false;
    bars_seen      := 0;
    hi             := null;
    lo             := null;
    last_close     := null;
    exit_px        := null;
    exit_why       := null;
    path_ambiguous := false;

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

      -- Do this before choosing an exit. With only OHLC we know both prices
      -- traded, but cannot know their order. `stop_level` is the active level
      -- before this bar: the trail still advances only after exit checks.
      if exit_px is null and stop_level is not null and target is not null then
        path_ambiguous := (is_long and b.low <= stop_level and b.high >= target)
                       or (not is_long and b.high >= stop_level and b.low <= target);
      end if;

      -- Pessimistic convention deliberately retained for continuity with all
      -- historic measurements and the TypeScript backtest scorer.
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
         set status         = 'resolved',
             bars_used      = bars_seen,
             exit_price     = exit_px,
             exit_reason    = exit_why,
             ambiguous_path = path_ambiguous,
             mfe_ticks      = greatest(0, case when is_long
                                               then (hi - entry) / tick
                                               else (entry - lo) / tick end),
             mae_ticks      = greatest(0, case when is_long
                                               then (entry - lo) / tick
                                               else (hi - entry) / tick end),
             pnl_ticks      = case when is_long
                                  then (exit_px - entry) / tick
                                  else (entry - exit_px) / tick end,
             resolved_at    = now()
       where signal_id = rec.signal_id;

      n_resolved := n_resolved + 1;

    elsif rec.fired_at < now() - expire_after then
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

-- This report is intentionally stratified before it speaks about price action.
-- The earlier all-rules table can be distorted by a rule/instrument mix: a
-- weak-looking price-action cell can merely contain a different set of rules.
-- It remains a measurement only; no value in this view filters a live signal.
create or replace view public.price_action_edge_by_setup
with (security_invoker = true) as
  with per_trade as (
    select s.rule_key,
           i.symbol,
           s.timeframe,
           s.direction,
           s.payload->'priceAction'->>'sweep'            as sweep,
           s.payload->'priceAction'->>'zone'             as zone,
           (s.fired_at at time zone 'UTC')::date         as session_day,
           o.pnl_ticks / nullif(s.risk_ticks, 0)         as r
      from public.signals s
      join public.instruments i     on i.id = s.instrument_id
      join public.signal_outcomes o on o.signal_id = s.id
     where o.status = 'resolved'
       and s.payload ? 'priceAction'
  ),
  baseline as (
    select rule_key, symbol, timeframe, direction,
           avg(r) as overall_r_per_trade
      from per_trade
     group by 1, 2, 3, 4
  ),
  rolled as (
    select rule_key, symbol, timeframe, direction, sweep, zone,
           count(*)::integer                        as trades,
           count(distinct session_day)::integer     as sessions,
           count(*) filter (where r > 0)::integer   as wins,
           round(sum(r), 2)                         as total_r,
           round(avg(r), 3)                         as r_per_trade
      from per_trade
     group by 1, 2, 3, 4, 5, 6
  )
  select r.*,
         round(r.wins::numeric / nullif(r.trades, 0), 4)  as win_rate,
         round(b.overall_r_per_trade, 3)                  as overall_r_per_trade,
         case
           when r.trades   < 30 then 'need more trades'
           when r.sessions <  3 then 'need more sessions'
           when abs(r.r_per_trade - b.overall_r_per_trade) >= 0.25 then 'separates'
           else 'no different'
         end                                              as verdict
    from rolled r
    join baseline b using (rule_key, symbol, timeframe, direction);

comment on view public.price_action_edge_by_setup is
  'Price-action measurement stratified by exact rule, symbol, timeframe, and direction. >=30 trades over >=3 sessions is required before a cell says separates/no different. It does not filter, mute, or alter a live signal.';

-- Complements the per-trade flag with a compact audit report. Earlier outcomes
-- have null because their source bar path cannot be reconstructed honestly.
create or replace view public.outcome_path_quality
with (security_invoker = true) as
  select s.rule_key,
         i.symbol,
         s.timeframe,
         s.direction,
         count(*)::integer                                              as resolved_signals,
         count(*) filter (where o.ambiguous_path is not null)::integer  as audited_signals,
         count(*) filter (where o.ambiguous_path)::integer              as ambiguous_paths,
         round(
           count(*) filter (where o.ambiguous_path)::numeric /
           nullif(count(*) filter (where o.ambiguous_path is not null), 0),
           4
         )                                                              as ambiguous_share
    from public.signals s
    join public.instruments i     on i.id = s.instrument_id
    join public.signal_outcomes o on o.signal_id = s.id
   where o.status = 'resolved'
   group by 1, 2, 3, 4;

comment on view public.outcome_path_quality is
  'OHLC path-audit coverage and collision rate per setup. ambiguous_path marks a bar that crossed both active stop and target; score stays stop-first. Null audit rows predate migration 0030.';
