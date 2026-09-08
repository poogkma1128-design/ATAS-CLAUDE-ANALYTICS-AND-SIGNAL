-- Executable regression test for the three 2026-09-08 migrations:
--   20260908085500_keep_richer_closed_bar_atomic
--   20260908085800_record_telegram_delivery
--   20260908090000_strategy_setups_idempotent
--   20260908150000_keep_richer_cluster_level
--
-- Run after all migrations on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/20260908_signal_ingest_audit_gaps_test.sql
-- The transaction is always rolled back. Never point TEST_DATABASE_URL at production.
--
-- Why this file exists at all: `strategy_setups_test.ts` and `ingest_test.ts` run
-- against a fake Supabase client. They assert the SHAPE of the call -- that the
-- upsert names the right conflict target, that the guard compares ticks -- and
-- every one of them passes with the unique index missing and the triggers never
-- created. That is precisely the failure the review filed as F1: deploying the
-- function ahead of the migration makes `ON CONFLICT` raise 42P10 into a
-- swallowed catch, and setups stop being written with nothing in the tests to
-- notice. Only the database can answer whether the invariants are actually there.

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
values ('a0260908-0000-0000-0000-000000000001', 'T20260908', 'TEST', 0.25);

-- =============================================================== 20260908090000
-- One durable evidence row per strategy touch.

insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  'a0260908-0000-0000-0000-000000000001', '5m',
  'prev_day_high', 'prev_day_high@2026-09-08T03:10:00.000Z', 'long', 29684.25,
  '2026-09-08 03:10:00+00', '2026-09-08 03:10:00+00', 1, 1
);

-- The replay that produced the 2026-09-08 duplicates resolved its copy before
-- writing it, so the row it tried to add was already closed. The old partial
-- index only covered status='open' and let that through; this one does not.
select pg_temp.expect_error(
  'the same touch cannot be recorded twice, not even already resolved',
  $$insert into public.strategy_setups (
       strategy_key, contract_version, instrument_id, timeframe,
       anchor_identity, anchor_touch_id, direction, anchor_price,
       opened_at, last_seen_at, age_bars, touch_bars,
       status, outcome_reason, resolved_at
     ) values (
       'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
       'a0260908-0000-0000-0000-000000000001', '5m',
       'prev_day_high', 'prev_day_high@2026-09-08T03:10:00.000Z', 'long', 29684.25,
       '2026-09-08 03:10:00+00', '2026-09-08 03:15:00+00', 2, 1,
       'triggered', 'triggered:stacked_imbalance', '2026-09-08 03:15:00+00'
     )$$,
  '23505', 'strategy_setups_one_row_per_touch'
);

-- This is the shape ingest v24 actually writes. It must be a silent no-op, which
-- is the whole point: a replay stops being a second evidence row.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  'a0260908-0000-0000-0000-000000000001', '5m',
  'prev_day_high', 'prev_day_high@2026-09-08T03:10:00.000Z', 'long', 29684.25,
  '2026-09-08 03:10:00+00', '2026-09-08 03:10:00+00', 1, 1
)
on conflict (strategy_key, instrument_id, timeframe, anchor_touch_id) do nothing;

select pg_temp.assert_true(
  'the replay upsert leaves exactly one row',
  (select count(*) from public.strategy_setups
    where anchor_touch_id = 'prev_day_high@2026-09-08T03:10:00.000Z') = 1
);

-- The index must not go further than the touch. A later touch of the same level
-- is a different opportunity and has to be recordable.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars,
  status, outcome_reason, resolved_at
) values (
  'mnq_pullback_v1', 'MNQ_PULLBACK_V1@live-preview-1',
  'a0260908-0000-0000-0000-000000000001', '5m',
  'prev_day_high', 'prev_day_high@2026-09-08T05:30:00.000Z', 'long', 29684.25,
  '2026-09-08 05:30:00+00', '2026-09-08 05:30:00+00', 1, 1,
  'rejected', 'expired_unfired', '2026-09-08 06:00:00+00'
);

select pg_temp.assert_true(
  'a later touch of the same level is still its own row',
  (select count(*) from public.strategy_setups
    where anchor_identity = 'prev_day_high') = 2
);

-- Two strategies watching the same level at the same moment are two opportunities.
insert into public.strategy_setups (
  strategy_key, contract_version, instrument_id, timeframe,
  anchor_identity, anchor_touch_id, direction, anchor_price,
  opened_at, last_seen_at, age_bars, touch_bars
) values (
  'mnq_reversal_v1', 'MNQ_REVERSAL_V1@live-preview-1',
  'a0260908-0000-0000-0000-000000000001', '5m',
  'prev_day_high', 'prev_day_high@2026-09-08T03:10:00.000Z', 'short', 29684.25,
  '2026-09-08 03:10:00+00', '2026-09-08 03:10:00+00', 1, 1
);

select pg_temp.assert_true(
  'the touch identity is scoped per strategy',
  (select count(*) from public.strategy_setups
    where anchor_touch_id = 'prev_day_high@2026-09-08T03:10:00.000Z') = 2
);

-- =============================================================== 20260908085500
-- A closed bar never loses ticks to a thinner re-send.

insert into public.bars (
  instrument_id, timeframe, opened_at, open, high, low, close, ticks, is_closed
) values (
  'a0260908-0000-0000-0000-000000000001', '5m', '2026-09-08 03:15:00+00',
  29688.50, 29703.50, 29687.75, 29699.00, 2218, true
);

update public.bars set ticks = 1500, close = 29000.00
where instrument_id = 'a0260908-0000-0000-0000-000000000001'
  and opened_at = '2026-09-08 03:15:00+00';

-- The whole row is kept, not just the tick count: a re-send that remembers less
-- is one snapshot, and taking half of it would invent a bar that never traded.
select pg_temp.assert_true(
  'a thinner re-send cannot overwrite a richer closed bar',
  (select ticks = 2218 and close = 29699.00 from public.bars
    where instrument_id = 'a0260908-0000-0000-0000-000000000001'
      and opened_at = '2026-09-08 03:15:00+00')
);

update public.bars set ticks = 2600, close = 29701.00
where instrument_id = 'a0260908-0000-0000-0000-000000000001'
  and opened_at = '2026-09-08 03:15:00+00';

select pg_temp.assert_true(
  'a re-send that is at least as complete still lands',
  (select ticks = 2600 and close = 29701.00 from public.bars
    where instrument_id = 'a0260908-0000-0000-0000-000000000001'
      and opened_at = '2026-09-08 03:15:00+00')
);

-- An unfinished bar is still filling in, so it must stay writable in both
-- directions; the guard is about finished bars only.
insert into public.bars (
  instrument_id, timeframe, opened_at, open, high, low, close, ticks, is_closed
) values (
  'a0260908-0000-0000-0000-000000000001', '5m', '2026-09-08 03:20:00+00',
  29698.75, 29705.25, 29693.00, 29696.75, 900, false
);

update public.bars set ticks = 100
where instrument_id = 'a0260908-0000-0000-0000-000000000001'
  and opened_at = '2026-09-08 03:20:00+00';

select pg_temp.assert_true(
  'an open bar is not guarded',
  (select ticks = 100 from public.bars
    where instrument_id = 'a0260908-0000-0000-0000-000000000001'
      and opened_at = '2026-09-08 03:20:00+00')
);

-- =============================================================== 20260908150000
-- The ladder gets the same protection as the bar it belongs to.

insert into public.cluster_levels (bar_id, price, ask, bid, between, volume, ticks)
select id, 29700.00, 120, 80, 0, 200, 64 from public.bars
where instrument_id = 'a0260908-0000-0000-0000-000000000001'
  and opened_at = '2026-09-08 03:15:00+00';

update public.cluster_levels set ask = 10, bid = 5, volume = 15, ticks = 8
where price = 29700.00;

select pg_temp.assert_true(
  'a thinner re-send cannot overwrite a richer footprint row',
  (select ticks = 64 and volume = 200 from public.cluster_levels where price = 29700.00)
);

update public.cluster_levels set ask = 200, bid = 140, volume = 340, ticks = 96
where price = 29700.00;

select pg_temp.assert_true(
  'accumulating volume still lands',
  (select ticks = 96 and volume = 340 from public.cluster_levels where price = 29700.00)
);

-- =============================================================== 20260908085800
-- Telegram delivery is recorded, and only in words the code actually uses.

insert into public.signals (bar_id, instrument_id, timeframe, rule_key, direction, price)
select id, 'a0260908-0000-0000-0000-000000000001', '5m', 'stacked_imbalance', 'long', 29699.00
from public.bars
where instrument_id = 'a0260908-0000-0000-0000-000000000001'
  and opened_at = '2026-09-08 03:15:00+00';

-- Not 'sent', and not silence either. A brand new row has not been decided yet,
-- and that is its own state.
select pg_temp.assert_true(
  'a new signal starts as pending',
  (select telegram_status = 'pending' and telegram_error is null
     from public.signals where rule_key = 'stacked_imbalance')
);

select pg_temp.expect_error(
  'a status the code never writes is refused',
  $$update public.signals set telegram_status = 'delivered'
     where rule_key = 'stacked_imbalance'$$,
  '23514', 'signals_telegram_status_is_known'
);

-- Every value in TelegramStatus, plus the two the migration itself introduces.
-- If someone adds a state in ingest.ts and not to the constraint, the write
-- fails in production at the moment it matters; this is where that is caught.
do $$
declare s text;
begin
  foreach s in array array[
    'pending', 'legacy_unknown', 'skipped_historical', 'skipped_rule_disabled',
    'skipped_muted', 'skipped_unconfigured', 'sent', 'failed'
  ] loop
    update public.signals set telegram_status = s where rule_key = 'stacked_imbalance';
  end loop;
end
$$;

select pg_temp.assert_true(
  'every status the Edge Function can write is accepted',
  (select telegram_status = 'failed' from public.signals
    where rule_key = 'stacked_imbalance')
);

update public.signals
set telegram_status = 'failed', telegram_error = 'bot was blocked'
where rule_key = 'stacked_imbalance';

select pg_temp.assert_true(
  'a failure keeps its reason',
  (select telegram_error = 'bot was blocked' from public.signals
    where rule_key = 'stacked_imbalance')
);

-- =============================================================== object checks
-- The indexes and triggers above are inferred from behaviour. Name them too, so
-- that a rollback that drops one fails here rather than in production.

select pg_temp.assert_true(
  'the one-row-per-touch index exists',
  exists (select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'strategy_setups'
      and indexname = 'strategy_setups_one_row_per_touch')
);

select pg_temp.assert_true(
  'both re-send guards are installed',
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal
      and (c.relname, t.tgname) in (
        ('bars', 'keep_richer_closed_bar_before_update'),
        ('cluster_levels', 'keep_richer_cluster_level_before_update')
      )) = 2
);

select pg_temp.assert_true(
  'failed deliveries stay cheap to find',
  exists (select 1 from pg_indexes
    where schemaname = 'public' and tablename = 'signals'
      and indexname = 'signals_telegram_failures')
);

rollback;
