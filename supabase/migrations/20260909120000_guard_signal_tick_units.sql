-- REVIEW REQUIRED. Do not apply automatically. No signals/outcomes are rewritten.
-- Scorer and reporting views use instruments.tick_size. Freeze historical
-- denominators and require explicit curation before a new instrument can signal.
begin;

-- Existing evidence freezes its denominator during migration. A newly seeded
-- instrument remains unlocked until an owner-reviewed metadata UPDATE sets the
-- curated tick and signal_tick_locked=true in the same statement. Ingest keeps
-- its raw bars while unlocked but may not create a signal.
alter table public.instruments
  add column signal_tick_locked boolean not null default false;
update public.instruments i set signal_tick_locked = true
where exists (select 1 from public.signals s where s.instrument_id = i.id);

create or replace function public.guard_referenced_instrument_tick()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not old.signal_tick_locked and new.signal_tick_locked and
     coalesce(current_setting('app.allow_instrument_metadata_change', true), 'off') <> 'on' then
    raise exception 'tick_lock_requires_reviewed_curation: instrument %', old.id
      using errcode = '23514';
  end if;
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
  tick_locked boolean;
  units jsonb;
begin
  -- Instrument identity belongs to the original evidence. Comparing only NEW
  -- units with NEW metadata lets an UPDATE move a 0.1-tick signal to another
  -- instrument and change both units to 0.2, silently turning its 2R into 1R.
  -- Even another instrument with the same tick is not the original market/bar.
  if tg_op = 'UPDATE' then
    if new.instrument_id is distinct from old.instrument_id then
      raise exception 'signal_instrument_immutable: signal %; preserve historical provenance', old.id
        using errcode = '23514';
    end if;
    -- Freeze the unit subtree exactly as it was observed, including legacy or
    -- missing units. A legacy row must not be relabelled as market-tick-v2, but
    -- annotations outside executionUnits remain writable.
    if new.payload -> 'executionUnits' is distinct from old.payload -> 'executionUnits' then
      raise exception 'signal_execution_units_immutable: signal %; preserve historical provenance', old.id
        using errcode = '23514';
    end if;
    return new;
  end if;
  -- Serialize every signal with metadata changes. SELECT FOR SHARE avoids a
  -- lock upgrade and makes concurrent INSERT/metadata changes deterministic at
  -- every isolation level. The durable latch must already have been set by
  -- curation/backfill; a chart-derived first sighting cannot certify itself.
  select tick_size, signal_tick_locked
    into strict instrument_tick, tick_locked
    from public.instruments
    where id = new.instrument_id
    for share;
  if not tick_locked then
    raise exception 'signal_tick_unverified: instrument %; curate and lock market tick first', new.instrument_id
      using errcode = '23514';
  end if;
  units := new.payload -> 'executionUnits';
  if jsonb_typeof(units) is distinct from 'object'
     or units ->> 'version' is distinct from 'market-tick-v2'
     or jsonb_typeof(units -> 'chartTickSize') is distinct from 'number'
     or jsonb_typeof(units -> 'marketTickSize') is distinct from 'number'
     or jsonb_typeof(units -> 'planTickSize') is distinct from 'number'
     or (units ->> 'chartTickSize')::numeric <= 0 then
    raise exception 'signal_tick_units_required: instrument % requires market-tick-v2 numeric units', new.instrument_id
      using errcode = '23514';
  end if;
  if (units ->> 'marketTickSize')::numeric is distinct from instrument_tick
     or (units ->> 'planTickSize')::numeric is distinct from instrument_tick then
    raise exception 'signal_tick_unit_mismatch: instrument %', new.instrument_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger signals_guard_execution_units
before insert or update of instrument_id, payload on public.signals
for each row execute function public.guard_signal_execution_units();

comment on function public.guard_referenced_instrument_tick() is
  'Freeze scorer/report tick denominator for legacy referenced rows and explicitly curated new instruments. Lock activation requires the reviewed metadata override; once locked, that override cannot bypass the freeze.';

commit;

-- Roll back application code/disable affected Telegram keys, NOT tick metadata.
-- Do not drop these guards as routine rollback. Removal permits silent R drift
-- and needs separate owner approval with a historical rescore/evidence plan.
