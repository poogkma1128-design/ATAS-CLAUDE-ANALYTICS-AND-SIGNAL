-- Executable regression test for migration 0040.
-- Run after migrations 0001-0040 on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0040_a_setup_that_outlives_its_bar_test.sql
-- The transaction is always rolled back. Never point TEST_DATABASE_URL at production.
--
-- What is being defended: this table is the only thing standing between the live rule and
-- the single-bar behaviour it had before. Every check here is a way the store could be
-- wrong without anyone noticing, because a strategy running at a fifth of its frequency
-- looks exactly like a quiet market.

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
values ('40000000-0000-0000-0000-000000000001', 'T0040', 'TEST', 0.25);

-- A setup opens.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  '40000000-0000-0000-0000-000000000001', '5m',
  'prev_day_low', 'prev_day_low@2026-09-07T14:00:00.000Z', 'long', 24000.25,
  '2026-09-07 14:00:00+00', '2026-09-07 14:00:00+00', 1, 1
);

select pg_temp.assert_true(
  'a new setup is open, with nothing claimed about how it ended',
  (select count(*) from public.strategy_setups
    where status = 'open' and outcome_reason is null and resolved_at is null) = 1
);

-- One anchor, one open setup. Two would turn a single touch into two opportunities,
-- which is the double-count the evaluator refuses in memory and this refuses on disk.
select pg_temp.expect_error(
  'a second open setup on the same anchor is refused',
  $$insert into public.strategy_setups (
       strategy_key, contract_version, instrument_id, timeframe,
       anchor_identity, anchor_touch_id, direction, anchor_price,
       opened_at, last_seen_at, age_bars, touch_bars
     ) values (
       'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
       '40000000-0000-0000-0000-000000000001', '5m',
       'prev_day_low', 'prev_day_low@2026-09-07T14:30:00.000Z', 'long', 24010.00,
       '2026-09-07 14:30:00+00', '2026-09-07 14:30:00+00', 1, 1
     )$$,
  '23505', 'strategy_setups_one_open_per_anchor'
);

-- The other anchor is a different event and must be allowed alongside it.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  '40000000-0000-0000-0000-000000000001', '5m',
  'prev_day_high', 'prev_day_high@2026-09-07T14:00:00.000Z', 'short', 24090.00,
  '2026-09-07 14:00:00+00', '2026-09-07 14:00:00+00', 1, 1
);

select pg_temp.assert_true(
  'two anchors may each hold one open setup',
  (select count(*) from public.strategy_setups where status = 'open') = 2
);

-- Half-resolved rows are the ones that would quietly corrupt a census: a status that says
-- the setup ended with no reason recorded, or a reason with the setup still open.
select pg_temp.expect_error(
  'a resolved setup must say how it ended',
  $$update public.strategy_setups set status = 'triggered'
     where anchor_identity = 'prev_day_low'$$,
  '23514', 'strategy_setups_resolution_is_complete'
);
select pg_temp.expect_error(
  'an open setup may not carry an outcome',
  $$update public.strategy_setups set outcome_reason = 'expired_unfired'
     where anchor_identity = 'prev_day_low'$$,
  '23514', 'strategy_setups_resolution_is_complete'
);

-- A setup cannot have been last seen before it opened, and cannot be younger than the bar
-- that opened it: both would make the age arithmetic nonsense on the way back in.
select pg_temp.expect_error(
  'a setup cannot be last seen before it opened',
  $$update public.strategy_setups set last_seen_at = '2026-09-07 13:00:00+00'
     where anchor_identity = 'prev_day_low'$$,
  '23514', 'strategy_setups_last_seen_not_before_open'
);
select pg_temp.expect_error(
  'a setup is at least one bar old',
  $$update public.strategy_setups set age_bars = 0
     where anchor_identity = 'prev_day_low'$$,
  '23514', 'strategy_setups_age_bars_check'
);

-- Resolving in full is allowed, and the reason is the evaluator's own string.
update public.strategy_setups
set status = 'rejected',
    outcome_reason = 'invalidated:closed_through_anchor',
    resolved_at = '2026-09-07 14:20:00+00',
    last_seen_at = '2026-09-07 14:20:00+00',
    age_bars = 5
where anchor_identity = 'prev_day_low';

select pg_temp.assert_true(
  'a resolved setup keeps the reason the evaluator gave',
  (select outcome_reason from public.strategy_setups where anchor_identity = 'prev_day_low')
    = 'invalidated:closed_through_anchor'
);

-- The same level can be touched again once the previous setup is closed: the uniqueness
-- rule is about open setups, not about the level ever being used twice.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  '40000000-0000-0000-0000-000000000001', '5m',
  'prev_day_low', 'prev_day_low@2026-09-07T15:00:00.000Z', 'long', 24000.25,
  '2026-09-07 15:00:00+00', '2026-09-07 15:00:00+00', 1, 1
);

select pg_temp.assert_true(
  'a closed setup does not block the next touch of the same level',
  (select count(*) from public.strategy_setups where anchor_identity = 'prev_day_low') = 2
);

select pg_temp.expect_error(
  'a direction outside the two the strategy has is refused',
  $$update public.strategy_setups set direction = 'flat'
     where anchor_identity = 'prev_day_high'$$,
  '23514', 'strategy_setups_direction_check'
);

-- A setup is a decision record. A client that could write one could invent an opportunity
-- no bar produced, so only the service role behind the Edge Functions may write.
select pg_temp.assert_true(
  'row level security is on',
  (select relrowsecurity from pg_class where oid = 'public.strategy_setups'::regclass)
);
select pg_temp.assert_true(
  'the dashboard may read setups and may not write them',
  has_table_privilege('authenticated', 'public.strategy_setups', 'SELECT')
  and not has_table_privilege('authenticated', 'public.strategy_setups', 'INSERT')
  and not has_table_privilege('authenticated', 'public.strategy_setups', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.strategy_setups', 'DELETE')
);

-- Supabase grants service_role everything on public by default, so listing only
-- select/insert/update in a grant leaves DELETE in place. The migration revokes it
-- explicitly; this is what proves the revoke is still there.
select pg_temp.assert_true(
  'the ingest role may record and resolve setups, and may not remove them',
  has_table_privilege('service_role', 'public.strategy_setups', 'SELECT')
  and has_table_privilege('service_role', 'public.strategy_setups', 'INSERT')
  and has_table_privilege('service_role', 'public.strategy_setups', 'UPDATE')
  and not has_table_privilege('service_role', 'public.strategy_setups', 'DELETE')
);

select '0040 regression: PASS' as result;
rollback;
