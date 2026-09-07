-- Executable regression test for migration 0037.
-- Run after migrations 0001-0037 on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0037_strategy_engine_phase_1_test.sql
-- The transaction is always rolled back. Never point TEST_DATABASE_URL at production.

begin;

create or replace function pg_temp.assert_true(label text, condition boolean)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', label;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(
  label text,
  statement text,
  expected_sqlstate text,
  expected_message_fragment text default null
)
returns void language plpgsql as $$
declare actual_state text;
        actual_message text;
begin
  begin
    execute statement;
  exception when others then
    get stacked diagnostics actual_state = returned_sqlstate,
                            actual_message = message_text;
    if actual_state <> expected_sqlstate then
      raise exception 'assertion failed: % returned SQLSTATE %, expected %',
        label, actual_state, expected_sqlstate;
    end if;
    if expected_message_fragment is not null
       and position(expected_message_fragment in actual_message) = 0 then
      raise exception 'assertion failed: % returned %, expected message containing %',
        label, actual_message, expected_message_fragment;
    end if;
    return;
  end;
  raise exception 'assertion failed: % did not raise', label;
end;
$$;

insert into public.instruments (id, symbol, exchange, tick_size)
values ('37000000-0000-0000-0000-000000000001', 'T0037', 'TEST', 0.25);

insert into public.market_session_definitions (
  id, instrument_id, version, trading_day_timezone, trading_day_rollover_minute, windows
) values (
  '37000000-0000-0000-0000-000000000011',
  '37000000-0000-0000-0000-000000000001',
  'test-session-v1', 'America/Chicago', 1020,
  '[{"key":"us_regular","timeZone":"America/Chicago","startMinute":510,"endMinute":900}]'::jsonb
);

select pg_temp.expect_error(
  'every session window needs its own time zone',
  $$insert into public.market_session_definitions (
       instrument_id, version, trading_day_timezone, trading_day_rollover_minute, windows
     ) values (
       '37000000-0000-0000-0000-000000000001', 'bad-window-shape',
       'America/Chicago', 1020,
       '[{"key":"asia","startMinute":540,"endMinute":660}]'::jsonb
     )$$,
  '23514', 'market_session_definitions_windows_check'
);

select pg_temp.expect_error(
  'session window time zones must be valid IANA identifiers',
  $$insert into public.market_session_definitions (
       instrument_id, version, trading_day_timezone, trading_day_rollover_minute, windows
     ) values (
       '37000000-0000-0000-0000-000000000001', 'bad-window-zone',
       'America/Chicago', 1020,
       '[{"key":"asia","timeZone":"Not/A_Time_Zone","startMinute":540,"endMinute":660}]'::jsonb
     )$$,
  '22023', 'time zone'
);

-- Draft definitions can be corrected, then activation seals their contract.
update public.market_session_definitions
   set windows = '[{"key":"us_regular","timeZone":"America/Chicago","startMinute":510,"endMinute":900},{"key":"initial_balance","timeZone":"America/Chicago","startMinute":510,"endMinute":570}]'::jsonb,
       status = 'active'
 where id = '37000000-0000-0000-0000-000000000011';

select pg_temp.expect_error(
  'active session windows are immutable',
  $$update public.market_session_definitions
       set trading_day_rollover_minute = 0
     where id = '37000000-0000-0000-0000-000000000011'$$,
  'P0001', 'immutable'
);
select pg_temp.expect_error(
  'active session definitions cannot be deleted',
  $$delete from public.market_session_definitions
     where id = '37000000-0000-0000-0000-000000000011'$$,
  'P0001', 'immutable'
);

insert into public.bars (
  id, instrument_id, timeframe, opened_at, open, high, low, close, is_closed,
  trading_day, session_definition_id, session_tags
) values (
  37001, '37000000-0000-0000-0000-000000000001', '5m',
  '2026-09-07 13:30:00+00', 100, 102, 99, 101, true,
  '2026-09-07', '37000000-0000-0000-0000-000000000011',
  array['us_regular', 'initial_balance']
);

insert into public.key_levels (
  bar_id, session_definition_id, engine_version, trading_day, profile_session_tag,
  vwap, vah, val, session_poc, session_high, session_low,
  initial_balance_high, initial_balance_low, profile_status
) values (
  37001, '37000000-0000-0000-0000-000000000011', 'key-levels@1',
  '2026-09-07', 'us_regular', 100.4, 101, 100, 101, 102, 99, 102, 99, 'complete'
);

select pg_temp.expect_error(
  'incomplete profiles cannot carry partial profile values',
  $$insert into public.key_levels (
       bar_id, session_definition_id, engine_version, trading_day, profile_session_tag,
       vwap, profile_status
     ) values (
       37001, '37000000-0000-0000-0000-000000000011', 'bad-profile@1',
       '2026-09-07', 'us_regular', 100, 'missing_footprint'
     )$$,
  '23514', 'key_levels_profile_complete'
);

insert into public.key_levels (
  bar_id, session_definition_id, engine_version, trading_day, profile_session_tag,
  profile_status, diagnostics
) values
  (37001, '37000000-0000-0000-0000-000000000011', 'bad-levels@2',
   '2026-09-07', 'us_regular', 'invalid_footprint_levels',
   '{"invalid_footprint_levels":1}'::jsonb),
  (37001, '37000000-0000-0000-0000-000000000011', 'tick-mismatch@2',
   '2026-09-07', 'us_regular', 'footprint_tick_mismatch',
   '{"footprint_tick_mismatch":1}'::jsonb);

select pg_temp.assert_true(
  'new tables have RLS enabled',
  (select bool_and(relrowsecurity)
     from pg_class
    where oid in ('public.market_session_definitions'::regclass,
                  'public.key_levels'::regclass))
);
select pg_temp.assert_true(
  'authenticated is read-only',
  has_table_privilege('authenticated', 'public.key_levels', 'SELECT')
  and not has_table_privilege('authenticated', 'public.key_levels', 'INSERT')
  and not has_table_privilege('authenticated', 'public.market_session_definitions', 'UPDATE')
);
select pg_temp.assert_true(
  'service role may append but not rewrite key levels',
  has_table_privilege('service_role', 'public.key_levels', 'INSERT')
  and not has_table_privilege('service_role', 'public.key_levels', 'UPDATE')
  and not has_table_privilege('service_role', 'public.key_levels', 'DELETE')
);

select '0037 regression: PASS' as result;
rollback;
