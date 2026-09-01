-- Cross-asset delivery policy and the durable information a chart needs to
-- render a completed trade on the correct bar.

create table public.instrument_signal_policies (
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  timeframe text not null,
  role text not null check (role in ('primary', 'shadow')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (instrument_id, timeframe)
);

comment on table public.instrument_signal_policies is
  'Delivery role per instrument/timeframe. Primary signals may be announced and charted; shadow signals stay stored and scored but are never trade instructions.';

alter table public.instrument_signal_policies enable row level security;

-- This table is read only by server-side functions. Do not expose a policy
-- editor through the Data API until it has an owner-specific authorization
-- model; the service role bypasses RLS for the trusted ingest path.

insert into public.instrument_signal_policies (instrument_id, timeframe, role, note)
select id,
       '5m',
       case when symbol = 'NQU6' then 'shadow' else 'primary' end,
       case when symbol = 'NQU6'
            then 'Correlated NQ contract: retain outcome evidence but do not issue trade instructions.'
            else 'Active instrument: evidence-first signals may be announced and charted.'
       end
  from public.instruments
 where symbol in ('BTCUSDT', 'GC', 'MNQU6', 'NQU6')
on conflict (instrument_id, timeframe) do update
  set role = excluded.role,
      note = excluded.note,
      updated_at = now();

alter table public.signals
  add column if not exists suppression_reason text;

comment on column public.signals.suppression_reason is
  'Why a stored signal was not actionable when it fired: shadow_instrument, rule_override, evidence_unproven, or opposite_direction_same_bar.';

alter table public.signal_outcomes
  add column if not exists exit_bar_id bigint references public.bars(id) on delete set null;

comment on column public.signal_outcomes.exit_bar_id is
  'The closed bar that resolved the outcome. Null for old rows and unresolved/expired outcomes.';

create index if not exists signal_outcomes_exit_bar_idx
  on public.signal_outcomes (exit_bar_id)
  where exit_bar_id is not null;

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
  exit_bar       bigint;
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
    exit_bar       := null;
    path_ambiguous := false;

    for b in
      select b2.id, b2.high, b2.low, b2.close, b2.opened_at
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

      if exit_px is null and stop_level is not null and target is not null then
        path_ambiguous := (is_long and b.low <= stop_level and b.high >= target)
                       or (not is_long and b.high >= stop_level and b.low <= target);
      end if;

      if exit_px is null and stop_level is not null then
        if (is_long and b.low <= stop_level) or (not is_long and b.high >= stop_level) then
          exit_px  := stop_level;
          exit_why := case when trail_on then 'trail' else 'stop' end;
          exit_bar := b.id;
        end if;
      end if;

      if exit_px is null and target is not null then
        if (is_long and b.high >= target) or (not is_long and b.low <= target) then
          exit_px  := target;
          exit_why := 'target';
          exit_bar := b.id;
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
        exit_bar := b.id;
      end if;

      update public.signal_outcomes
         set status         = 'resolved',
             bars_used      = bars_seen,
             exit_price     = exit_px,
             exit_reason    = exit_why,
             exit_bar_id    = exit_bar,
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
      update public.signal_outcomes o
         set status      = 'expired',
             bars_used   = bars_seen,
             resolved_at = now()
       where o.signal_id = rec.signal_id;
    end if;
  end loop;
  return n_resolved;
end;
$$;

revoke all on function public.evaluate_pending_outcomes(interval) from public, anon, authenticated;
