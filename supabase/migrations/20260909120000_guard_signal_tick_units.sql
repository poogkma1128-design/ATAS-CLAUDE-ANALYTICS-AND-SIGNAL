-- REVIEW REQUIRED. Do not apply automatically. No signals/outcomes are rewritten.
-- Scorer and reporting views use instruments.tick_size. Freeze that denominator
-- once signals exist, including against the old metadata override flag.
begin;

-- A durable latch avoids snapshot-isolation races in an EXISTS(signals) guard.
-- A first signal changes the instrument row, so a concurrent metadata UPDATE
-- must see the latch or fail serialization, including under REPEATABLE READ.
alter table public.instruments
  add column signal_tick_locked boolean not null default false;
update public.instruments i set signal_tick_locked = true
where exists (select 1 from public.signals s where s.instrument_id = i.id);

create or replace function public.guard_referenced_instrument_tick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.signal_tick_locked and
     (new.tick_size is distinct from old.tick_size or not new.signal_tick_locked) then
    raise exception 'tick_size_locked_by_signals: instrument %; use an independently reviewed rescore migration', old.id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Alphabetically BEFORE instruments_keep_curated_metadata if installed, so an
-- unsafe requested update raises rather than silently being ignored by it.
create trigger aaa_instruments_guard_signal_tick
before update of tick_size, signal_tick_locked on public.instruments
for each row execute function public.guard_referenced_instrument_tick();

create or replace function public.guard_signal_execution_units()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  instrument_tick numeric;
  units jsonb;
begin
  -- Serialize the FIRST signal with metadata updates, without SHARE->UPDATE
  -- lock upgrades between concurrent first inserts. Later signals only read.
  update public.instruments set signal_tick_locked = true
    where id = new.instrument_id and not signal_tick_locked
    returning tick_size into instrument_tick;
  if not found then
    select tick_size into strict instrument_tick from public.instruments
      where id = new.instrument_id for share;
  end if;
  units := new.payload -> 'executionUnits';
  if units ->> 'version' = 'market-tick-v2' then
    if (units ->> 'marketTickSize')::numeric is distinct from instrument_tick
       or (units ->> 'planTickSize')::numeric is distinct from instrument_tick then
      raise exception 'signal_tick_unit_mismatch: instrument %', new.instrument_id
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger signals_guard_execution_units
before insert or update of instrument_id, payload on public.signals
for each row execute function public.guard_signal_execution_units();

comment on function public.guard_referenced_instrument_tick() is
  'Freeze scorer/report tick denominator after first signal, including legacy rows. Durable latch cannot be cleared by ordinary UPDATE. Metadata correction requires reviewed price-based rescore; app.allow_instrument_metadata_change cannot bypass.';

commit;

-- Roll back application code/disable affected Telegram keys, NOT tick metadata.
-- Do not drop these guards as routine rollback. Removal permits silent R drift
-- and needs separate owner approval with a historical rescore/evidence plan.
