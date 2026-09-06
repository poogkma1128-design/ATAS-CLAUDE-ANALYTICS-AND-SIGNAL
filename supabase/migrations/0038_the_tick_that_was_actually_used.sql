-- The recorded tick was the chart's price step, not the contract's tick.
--
-- HANDOFF §0Y/§0Z: the ATAS bridge sends `InstrumentInfo.TickSize`, which is
-- the chart price step, and `upsertInstrument()` wrote it over `tick_size` on
-- every ingest. Measured against the traded prices in the same feed
-- (`docs/queries/instrument_tick_identity.sql`), three of four instruments
-- disagree with their own data: MNQU6 0.75 against 0.25, GC 0.30 against 0.10,
-- BTCUSDT 10.00 against 0.10. NQU6's 0.25 is correct.
--
-- `evaluate_pending_outcomes()` divides by `tick_size` to store mfe_ticks,
-- mae_ticks and pnl_ticks, so every resolved outcome on those three carries a
-- tick count scaled by the wrong divisor.
--
-- The owner's decision (2026-09-06) is to keep the original numbers rather than
-- overwrite them. So this migration does not rewrite a single stored measurement.
-- It records *which tick produced each row*, corrects the instrument rows, and
-- exposes the corrected values through a view. Every stored mfe/mae/pnl value is
-- left exactly as it was written.
--
-- Ordering matters and is enforced rather than trusted: the backfill must capture
-- the pre-correction tick, so the migration refuses to run if the instrument rows
-- no longer hold the values it was written against.
--
-- This migration does not create a signal, change a rule, touch Telegram, or
-- alter any recorded price, volume or delta.

-- ------------------------------------------------------- 1. the missing fact
alter table public.signal_outcomes
  add column tick_size_used numeric(18,8)
    check (tick_size_used is null or tick_size_used > 0);

comment on column public.signal_outcomes.tick_size_used is
  'The instrument tick that divided this row''s mfe/mae/pnl_ticks. Recorded because the tick was wrong for MNQU6, GC and BTCUSDT before 0038; see HANDOFF §0Z.';

-- ------------------------------------------------ 2. refuse to run out of order
do $$
declare
  expected constant jsonb := jsonb_build_object(
    'MNQU6', 0.75, 'GC', 0.30, 'BTCUSDT', 10.0, 'NQU6', 0.25
  );
  wrong integer;
begin
  select count(*) into wrong
    from public.instruments i
   where expected ? i.symbol
     and i.tick_size is distinct from (expected ->> i.symbol)::numeric;

  if wrong > 0 then
    raise exception
      '0038 refuses to backfill: % instrument row(s) no longer hold the pre-correction tick this migration was written against. The stamped tick would be wrong. Reconcile by hand before applying.',
      wrong;
  end if;
end $$;

-- ------------------------------------- 3. stamp the tick each row actually used
-- Safe because the guard above proved the instrument rows are still pre-correction,
-- and because `tick_size` has only ever been written by the ingest upsert, which
-- wrote the same chart step on every request for the life of each symbol.
update public.signal_outcomes o
   set tick_size_used = i.tick_size
  from public.signals s
  join public.instruments i on i.id = s.instrument_id
 where s.id = o.signal_id
   and o.mae_ticks is not null;

-- ------------------------------------------------- 4. correct the contract facts
-- Metadata, not measurement: these are exchange facts, and the database's own
-- traded prices independently witness them.
update public.instruments set tick_size = 0.25 where symbol = 'MNQU6';
update public.instruments set tick_size = 0.10 where symbol = 'GC';
update public.instruments set tick_size = 0.10 where symbol = 'BTCUSDT';
-- NQU6 is already correct and is deliberately left alone.

-- `tick_value` stays null. It is a money figure per contract that nothing in this
-- repository has ever observed, and inventing one would be fabrication rather
-- than correction. The owner supplies it when the after-cost SESOI is set.

-- ------------------------------------- 4b. and defend them where they actually live
--
-- The ingest upsert is being fixed in the same change, but a corrected tick that
-- depends on an Edge Function staying deployed is not actually safe: a rollback,
-- a redeploy of an older bundle, or any other writer puts the chart step straight
-- back. The invariant belongs next to the data. This trigger is why the correction
-- above survives whether or not the function fix ships.
create or replace function public.keep_curated_instrument_metadata()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A deliberate correction sets the flag for its transaction:
  --   set local app.allow_instrument_metadata_change = 'on';
  if coalesce(current_setting('app.allow_instrument_metadata_change', true), 'off') = 'on' then
    return new;
  end if;

  -- Otherwise the contract facts are held, not overwritten. Everything else on
  -- the row updates normally.
  new.tick_size := old.tick_size;
  if new.tick_value is null then
    new.tick_value := old.tick_value;
  end if;
  return new;
end;
$$;

comment on function public.keep_curated_instrument_metadata() is
  'Holds tick_size and a set tick_value against blind overwrites. The ATAS bridge sends the chart price step as tickSize and never sends tickValue, so an unguarded upsert silently undoes a correction (HANDOFF §0Z).';

create trigger instruments_keep_curated_metadata
  before update on public.instruments
  for each row
  execute function public.keep_curated_instrument_metadata();

-- ------------------------------------------- 5. stamp it going forward as well
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
             -- The only change from 0003: record the divisor alongside the result,
             -- so a later tick correction never again leaves rows unattributable.
             tick_size_used = rec.tick_size,
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

-- --------------------------------------- 6. the corrected reading, not a rewrite
create view public.signal_outcomes_true_ticks as
  select o.signal_id,
         o.status,
         o.horizon_bars,
         o.bars_used,
         o.exit_price,
         o.resolved_at,
         o.tick_size_used,
         i.tick_size as tick_size_current,
         o.mfe_ticks as mfe_ticks_as_recorded,
         o.mae_ticks as mae_ticks_as_recorded,
         o.pnl_ticks as pnl_ticks_as_recorded,
         case when o.tick_size_used is null or i.tick_size is null or i.tick_size = 0
              then null
              else round(o.mfe_ticks * o.tick_size_used / i.tick_size, 2) end as mfe_ticks_true,
         case when o.tick_size_used is null or i.tick_size is null or i.tick_size = 0
              then null
              else round(o.mae_ticks * o.tick_size_used / i.tick_size, 2) end as mae_ticks_true,
         case when o.tick_size_used is null or i.tick_size is null or i.tick_size = 0
              then null
              else round(o.pnl_ticks * o.tick_size_used / i.tick_size, 2) end as pnl_ticks_true,
         o.tick_size_used is distinct from i.tick_size as needed_correction
    from public.signal_outcomes o
    join public.signals s     on s.id = o.signal_id
    join public.instruments i on i.id = s.instrument_id;

comment on view public.signal_outcomes_true_ticks is
  'Stored tick counts beside the ones the corrected tick implies. Nothing is rewritten: *_as_recorded are the original values and *_true are re-derived from the unchanged prices. A null true value means the row predates tick_size_used and cannot be attributed.';

-- ---------------------------------------------------------------- 7. the receipt
do $$
declare
  stamped integer;
  corrected integer;
begin
  select count(*) into stamped
    from public.signal_outcomes where tick_size_used is not null;
  select count(*) into corrected
    from public.signal_outcomes_true_ticks where needed_correction;

  raise notice '0038: stamped % outcome row(s); % now read differently under the corrected tick.',
    stamped, corrected;
end $$;
