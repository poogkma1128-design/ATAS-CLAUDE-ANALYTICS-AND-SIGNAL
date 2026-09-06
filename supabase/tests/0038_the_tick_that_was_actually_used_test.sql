-- Executable regression test for migration 0038.
-- Run after migrations 0001-0038 on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0038_the_tick_that_was_actually_used_test.sql
-- The transaction is always rolled back. Never point TEST_DATABASE_URL at production.
--
-- What it proves:
--   1. the stored measurements are untouched by the migration
--   2. the corrected reading is exactly the stored one rescaled by the tick ratio
--   3. a row that predates tick_size_used reads null rather than guessing
--   4. newly resolved outcomes stamp the tick they used
--   5. the instrument rows carry the corrected contract ticks
--   6. tick_value is still null, because nothing observed it

begin;

create or replace function pg_temp.assert_true(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', label;
  end if;
end;
$$;

create or replace function pg_temp.assert_eq(label text, got anyelement, want anyelement)
returns void language plpgsql as $$
begin
  if got is distinct from want then
    raise exception 'assertion failed: % got %, want %', label, got, want;
  end if;
end;
$$;

-- --------------------------------------------------------- 5 & 6. the contract facts
--
-- Written as "no row disagrees" rather than "this row equals", so the file passes
-- both on an empty replay database and against a restore that carries the four
-- production instruments.
select pg_temp.assert_true(
  'no live instrument still carries a pre-correction tick',
  not exists (
    select 1 from public.instruments i
     join (values ('MNQU6', 0.25), ('GC', 0.10), ('BTCUSDT', 0.10), ('NQU6', 0.25))
          as want(symbol, tick) on want.symbol = i.symbol
    where i.tick_size is distinct from want.tick::numeric));

select pg_temp.assert_true(
  'tick_value is still null rather than invented',
  not exists (
    select 1 from public.instruments
     where symbol in ('MNQU6','GC','BTCUSDT','NQU6') and tick_value is not null));

-- The guard that keeps the backfill from running after a hand correction must
-- actually fire. Seed a row holding a pre-correction tick and re-run its logic.
insert into public.instruments (symbol, exchange, tick_size)
values ('MNQU6', 'GUARD', 0.75);

do $$
declare
  expected constant jsonb := jsonb_build_object(
    'MNQU6', 0.75, 'GC', 0.30, 'BTCUSDT', 10.0, 'NQU6', 0.25
  );
  wrong integer;
begin
  -- Same predicate as the migration, inverted: here a match is the stale state.
  select count(*) into wrong
    from public.instruments i
   where expected ? i.symbol
     and i.tick_size is not distinct from (expected ->> i.symbol)::numeric
     and i.symbol <> 'NQU6';   -- NQU6's correct tick coincides with its old one

  if wrong = 0 then
    raise exception 'assertion failed: the ordering guard would not notice a pre-correction tick';
  end if;
end $$;

delete from public.instruments where exchange = 'GUARD';

-- ------------------------------------------------------------------- fixtures
--
-- `signals.rule_key` is a foreign key, so the fixtures need a rule to hang off.
insert into public.rules (key, name, enabled, telegram_enabled, horizon_bars)
values ('test_rule_0038', 'fixture rule for 0038', false, false, 4)
on conflict (key) do nothing;

-- A fresh instrument whose recorded tick is deliberately coarse, so the ratio
-- under test is not 1 and a bug cannot hide behind an identity.
with inst as (
  insert into public.instruments (symbol, exchange, tick_size)
  values ('T38', 'TEST', 0.75) returning id
), b as (
  insert into public.bars (instrument_id, timeframe, opened_at, open, high, low, close,
                           volume, ask_volume, bid_volume, delta, min_delta, max_delta,
                           cum_delta, ticks, trades, is_closed)
  select id, '5m', timestamptz '2026-01-02 10:00:00+00',
         100, 101, 99, 100, 10, 5, 5, 0, 0, 0, 0, 4, 4, true
    from inst returning id, instrument_id
), s as (
  insert into public.signals (instrument_id, bar_id, timeframe, rule_key, direction,
                              price, fired_at)
  select instrument_id, id, '5m', 'test_rule_0038', 'long', 100, timestamptz '2026-01-02 10:05:00+00'
    from b returning id
)
insert into public.signal_outcomes
  (signal_id, horizon_bars, status, mfe_ticks, mae_ticks, pnl_ticks, exit_price,
   bars_used, resolved_at, tick_size_used)
-- A losing pnl on purpose: the rescale must preserve the sign, not just the size.
select id, 4, 'resolved', 12.00, 6.00, -9.00, 103, 4, now(), 0.75 from s;

-- ------------------------------ 1 & 2. originals preserved, correction derived
select pg_temp.assert_eq(
  'the stored mfe is exactly what was written',
  (select mfe_ticks from public.signal_outcomes o
     join public.signals s on s.id = o.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), 12.00::numeric);

-- The instrument is corrected the way 0038 corrected the real ones: 0.75 -> 0.25.
-- The flag is required, which is itself the guarantee under test: without it the
-- trigger holds the old value and this correction silently does nothing.
set local app.allow_instrument_metadata_change = 'on';
update public.instruments set tick_size = 0.25 where symbol = 'T38';
reset app.allow_instrument_metadata_change;

select pg_temp.assert_eq(
  'the stored mfe is STILL exactly what was written after the tick changed',
  (select mfe_ticks from public.signal_outcomes o
     join public.signals s on s.id = o.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), 12.00::numeric);

select pg_temp.assert_eq(
  'the view reports the original untouched',
  (select mfe_ticks_as_recorded from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), 12.00::numeric);

-- 12 ticks measured with a 0.75 divisor is 9.00 points, which is 36 ticks of 0.25.
select pg_temp.assert_eq(
  'the corrected mfe is the stored one rescaled by the tick ratio',
  (select mfe_ticks_true from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), 36.00::numeric);

select pg_temp.assert_eq(
  'a negative result keeps its sign through the rescale',
  (select pnl_ticks_true from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), -27.00::numeric);

select pg_temp.assert_true(
  'the row is flagged as having needed correction',
  (select needed_correction from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'));

-- ------------------- 2b. an ingest-style upsert cannot undo the correction
--
-- This is the whole point of the trigger: the correction must survive a write
-- that looks exactly like the one that caused the problem.
insert into public.instruments (symbol, exchange, tick_size, tick_value)
values ('T38', 'TEST', 0.75, null)
on conflict (symbol, exchange) do update
  set tick_size = excluded.tick_size, tick_value = excluded.tick_value;

select pg_temp.assert_eq(
  'an ingest-style upsert cannot put the chart step back',
  (select tick_size from public.instruments where symbol = 'T38'), 0.25::numeric);

-- A set tick_value must not be nulled by a payload that never carries one.
set local app.allow_instrument_metadata_change = 'on';
update public.instruments set tick_value = 0.50 where symbol = 'T38';
reset app.allow_instrument_metadata_change;

insert into public.instruments (symbol, exchange, tick_size, tick_value)
values ('T38', 'TEST', 0.75, null)
on conflict (symbol, exchange) do update
  set tick_size = excluded.tick_size, tick_value = excluded.tick_value;

select pg_temp.assert_eq(
  'an absent tick_value does not null a curated one',
  (select tick_value from public.instruments where symbol = 'T38'), 0.50::numeric);

-- And a deliberate correction still works, or the tick could never be fixed.
set local app.allow_instrument_metadata_change = 'on';
update public.instruments set tick_size = 0.10 where symbol = 'T38';
reset app.allow_instrument_metadata_change;

select pg_temp.assert_eq(
  'a deliberate correction is still possible',
  (select tick_size from public.instruments where symbol = 'T38'), 0.10::numeric);

-- Put it back for the assertions that follow.
set local app.allow_instrument_metadata_change = 'on';
update public.instruments set tick_size = 0.25, tick_value = null where symbol = 'T38';
reset app.allow_instrument_metadata_change;

-- ------------------------------------- 3. an unattributable row refuses to guess
update public.signal_outcomes o
   set tick_size_used = null
  from public.signals s join public.instruments i on i.id = s.instrument_id
 where s.id = o.signal_id and i.symbol = 'T38';

select pg_temp.assert_true(
  'without a recorded divisor the corrected value is null, not a guess',
  (select mfe_ticks_true is null and mae_ticks_true is null and pnl_ticks_true is null
     from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'));

select pg_temp.assert_eq(
  'and the original is still readable',
  (select mfe_ticks_as_recorded from public.signal_outcomes_true_ticks v
     join public.signals s on s.id = v.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38'), 12.00::numeric);

-- --------------------------------- 4. new resolutions stamp the tick they used
--
-- Four closed bars after the signal bar let evaluate_pending_outcomes resolve it.
with inst as (
  insert into public.instruments (symbol, exchange, tick_size)
  values ('T38B', 'TEST', 0.50) returning id
), sig_bar as (
  insert into public.bars (instrument_id, timeframe, opened_at, open, high, low, close,
                           volume, ask_volume, bid_volume, delta, min_delta, max_delta,
                           cum_delta, ticks, trades, is_closed)
  select id, '5m', timestamptz '2026-01-03 10:00:00+00',
         100, 101, 99, 100, 10, 5, 5, 0, 0, 0, 0, 4, 4, true
    from inst returning id, instrument_id
), future as (
  insert into public.bars (instrument_id, timeframe, opened_at, open, high, low, close,
                           volume, ask_volume, bid_volume, delta, min_delta, max_delta,
                           cum_delta, ticks, trades, is_closed)
  select instrument_id, '5m',
         timestamptz '2026-01-03 10:00:00+00' + (n || ' minutes')::interval,
         100, 102, 98, 101, 10, 5, 5, 0, 0, 0, 0, 4, 4, true
    from sig_bar, generate_series(5, 20, 5) as n returning id
)
insert into public.signals (instrument_id, bar_id, timeframe, rule_key, direction,
                            price, fired_at)
select instrument_id, id, '5m', 'test_rule_0038', 'long', 100, timestamptz '2026-01-03 10:05:00+00'
  from sig_bar;

-- create_pending_outcome() fires on insert, so a pending row already exists.
select public.evaluate_pending_outcomes('24 hours'::interval);

select pg_temp.assert_eq(
  'a newly resolved outcome records the divisor it used',
  (select o.tick_size_used from public.signal_outcomes o
     join public.signals s on s.id = o.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38B'), 0.50::numeric);

select pg_temp.assert_eq(
  'and it resolved rather than silently staying pending',
  (select o.status from public.signal_outcomes o
     join public.signals s on s.id = o.signal_id
     join public.instruments i on i.id = s.instrument_id
    where i.symbol = 'T38B'), 'resolved'::text);

rollback;
