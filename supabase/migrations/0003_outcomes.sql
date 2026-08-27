-- Outcome tracking: "which setup actually makes money?"
--
-- The key idea is that no external price feed is needed. ATAS keeps streaming
-- bars in, so the bars that arrive *after* a signal are exactly the forward
-- price data required to score it.

-- Every signal immediately gets a pending outcome row, with the horizon taken
-- from the rule that fired it.
create or replace function public.create_pending_outcome()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  h integer;
begin
  select r.horizon_bars into h from public.rules r where r.key = new.rule_key;

  insert into public.signal_outcomes (signal_id, horizon_bars)
  values (new.id, coalesce(h, 10))
  on conflict (signal_id) do nothing;

  return new;
end;
$$;

create trigger signals_create_outcome
  after insert on public.signals
  for each row execute function public.create_pending_outcome();

-- Scores every pending signal that now has enough bars behind it.
--
-- mfe_ticks / mae_ticks are clamped at zero, so they read as "furthest it ever
-- ran in favour" and "worst heat it took" rather than going negative when price
-- never traded through the entry.
create or replace function public.evaluate_pending_outcomes(expire_after interval default '24 hours')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  rec        record;
  fut        record;
  n_resolved integer := 0;
begin
  for rec in
    select o.signal_id,
           o.horizon_bars,
           s.direction,
           s.price,
           s.instrument_id,
           s.timeframe,
           s.fired_at,
           b.opened_at as signal_bar_open,
           i.tick_size
      from public.signal_outcomes o
      join public.signals s     on s.id = o.signal_id
      join public.bars b        on b.id = s.bar_id
      join public.instruments i on i.id = s.instrument_id
     where o.status = 'pending'
  loop
    select count(*)::integer                                    as cnt,
           max(q.high)                                          as hi,
           min(q.low)                                           as lo,
           (array_agg(q.close order by q.opened_at desc))[1]    as last_close
      into fut
      from (
        select b2.high, b2.low, b2.close, b2.opened_at
          from public.bars b2
         where b2.instrument_id = rec.instrument_id
           and b2.timeframe     = rec.timeframe
           and b2.opened_at     > rec.signal_bar_open
           and b2.is_closed
         order by b2.opened_at
         limit rec.horizon_bars
      ) q;

    if fut.cnt >= rec.horizon_bars then
      update public.signal_outcomes
         set status      = 'resolved',
             bars_used   = fut.cnt,
             exit_price  = fut.last_close,
             mfe_ticks   = greatest(0, case when rec.direction = 'long'
                                            then (fut.hi - rec.price) / rec.tick_size
                                            else (rec.price - fut.lo) / rec.tick_size end),
             mae_ticks   = greatest(0, case when rec.direction = 'long'
                                            then (rec.price - fut.lo) / rec.tick_size
                                            else (fut.hi - rec.price) / rec.tick_size end),
             pnl_ticks   = case when rec.direction = 'long'
                                then (fut.last_close - rec.price) / rec.tick_size
                                else (rec.price - fut.last_close) / rec.tick_size end,
             resolved_at = now()
       where signal_id = rec.signal_id;

      n_resolved := n_resolved + 1;

    elsif rec.fired_at < now() - expire_after then
      -- The chart was closed before enough bars arrived. Park it as expired so
      -- it never contaminates the win rate.
      update public.signal_outcomes
         set status      = 'expired',
             bars_used   = fut.cnt,
             resolved_at = now()
       where signal_id = rec.signal_id;
    end if;
  end loop;

  return n_resolved;
end;
$$;

-- The answer to "which setup makes money", one row per rule and direction.
create view public.setup_stats
with (security_invoker = true) as
  select s.rule_key,
         s.direction,
         count(*)::integer                                              as trades,
         count(*) filter (where o.pnl_ticks > 0)::integer               as wins,
         round(avg(case when o.pnl_ticks > 0 then 1 else 0 end), 4)     as win_rate,
         round(avg(o.pnl_ticks), 2)                                     as avg_pnl_ticks,
         round(sum(o.pnl_ticks), 2)                                     as total_pnl_ticks,
         round(avg(o.mfe_ticks), 2)                                     as avg_mfe_ticks,
         round(avg(o.mae_ticks), 2)                                     as avg_mae_ticks,
         round(avg(s.confidence), 3)                                    as avg_confidence,
         max(s.fired_at)                                                as last_signal_at
    from public.signals s
    join public.signal_outcomes o on o.signal_id = s.id
   where o.status = 'resolved'
   group by s.rule_key, s.direction;

comment on view public.setup_stats is 'Resolved-signal performance per rule and direction. security_invoker keeps RLS applied.';
