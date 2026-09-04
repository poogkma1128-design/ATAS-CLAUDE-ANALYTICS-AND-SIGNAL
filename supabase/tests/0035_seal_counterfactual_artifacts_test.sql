-- Executable regression test for migration 0035.
-- Run after migrations 0001-0035 on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0035_seal_counterfactual_artifacts_test.sql
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

-- An expected failure is evidence only when its SQLSTATE (and, where useful,
-- its stable message) is asserted.  A syntax, fixture, or permission error may
-- not masquerade as a passed behavioral test.
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
  raise exception 'expected statement to be rejected: %', label;
end;
$$;

insert into public.rules (key, name, horizon_bars)
values ('t0035_rule', '0035 regression fixture', 10);

insert into public.instruments (id, symbol, exchange, tick_size, tick_value)
values ('35000000-0000-0000-0000-000000000001', 'T0035', 'TEST', 0.25, 1);

insert into public.bars (
  id, instrument_id, timeframe, opened_at, open, high, low, close, is_closed
) values
  (35001, '35000000-0000-0000-0000-000000000001', '5m',
   '2026-01-03 00:00:00+00', 100, 104, 99, 103, true),
  (35002, '35000000-0000-0000-0000-000000000001', '5m',
   '2026-01-03 00:05:00+00', 100, 104, 99, 103, true),
  (35003, '35000000-0000-0000-0000-000000000001', '5m',
   '2026-01-03 00:10:00+00', 100, 104, 99, 103, true),
  (35099, '35000000-0000-0000-0000-000000000001', '5m',
   '2026-01-03 00:15:00+00', 100, 104, 99, 103, true);

insert into public.signals (
  id, bar_id, instrument_id, timeframe, rule_key, direction, price, payload,
  fired_at, muted, entry_price, stop_price, target_price, risk_ticks,
  reward_ticks, trail_trigger_ticks, trail_offset_ticks, hold_bars
) values
  ('35000000-0000-0000-0000-000000000011', 35001,
   '35000000-0000-0000-0000-000000000001', '5m', 't0035_rule', 'long', 103,
   '{"confidenceV2":{"mode":"shadow","modelVersion":"shadow-1","target":"positive_r","features":{"shared":{},"rule":{}}}}',
   '2026-01-03 00:00:01+00', true, 100, 99, 103, 4, 12, 2, 1, 10),
  ('35000000-0000-0000-0000-000000000012', 35002,
   '35000000-0000-0000-0000-000000000001', '5m', 't0035_rule', 'long', 103,
   '{"confidenceV2":{"mode":"shadow","modelVersion":"shadow-1","target":"positive_r","features":{"shared":{},"rule":{}}}}',
   '2026-01-03 00:05:01+00', false, 100, 99, 103, 4, 12, 2, 1, 10);

update public.signal_outcomes
   set status = 'resolved', mfe_ticks = 12, mae_ticks = 0,
       exit_price = 103, pnl_ticks = 12, bars_used = 1,
       resolved_at = '2026-01-03 00:16:00+00', exit_reason = 'target',
       ambiguous_path = false, exit_bar_id = 35099
 where signal_id in ('35000000-0000-0000-0000-000000000011',
                     '35000000-0000-0000-0000-000000000012');

insert into public.experiments (id, name, symbols, bars_from, bars_to, kind)
values ('35000000-0000-0000-0000-000000000021', '0035 sealed contract',
        array['T0035'], '2026-01-03 00:00:00+00', '2026-01-03 00:05:00+00',
        'rescore');

select pg_temp.assert_true(
  'freeze captures both plan-anchored candidates',
  public.freeze_trail_rescore_cohort(
    '35000000-0000-0000-0000-000000000021', 'scorePlan@0035', 'bars@0035', '5m'
  ) = 2
);

select pg_temp.assert_true(
  'freeze stored entry stop and risk anchors from signals',
  (select count(*) = 2
     from public.trail_rescore_expected
    where run_id = '35000000-0000-0000-0000-000000000021'
      and live_entry_price = 100 and live_stop_price = 99 and live_risk_ticks = 4)
);

-- P0-1: even the service role cannot write a manifest directly.
set local role service_role;
select pg_temp.expect_error(
  'service_role direct run insert is denied',
  $$insert into public.trail_rescore_runs
      (run_id, evaluator_version, data_version, timeframe, expected_count)
    values ('35000000-0000-0000-0000-000000000022', 'x', 'x', '5m', 1)$$,
  '42501'
);
select pg_temp.expect_error(
  'service_role direct expected insert is denied',
  $$insert into public.trail_rescore_expected
      (run_id, symbol, timeframe, rule_key, direction, bar_opened_at, signal_id,
       bar_id, live_exit_reason, live_bars_used, live_pnl_ticks)
    values ('35000000-0000-0000-0000-000000000021', 'T0035', '5m', 't0035_rule',
      'long', '2026-01-03 00:00:00+00', '35000000-0000-0000-0000-000000000011',
      35001, 'target', 1, 12)$$,
  '42501'
);
reset role;

-- P2/R1: manifest rows are immutable even to the migration owner.
select pg_temp.expect_error(
  'expected manifest update is immutable',
  $$update public.trail_rescore_expected set live_risk_ticks = 99
     where run_id = '35000000-0000-0000-0000-000000000021'$$,
  'P0001', 'immutable'
);

-- A wrong risk plan must be visible in parity rather than being averaged away.
insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values (
  '35000000-0000-0000-0000-000000000021', 'baseline', 'T0035', '5m',
  't0035_rule', 'long', '2026-01-03 00:00:00+00',
  '35000000-0000-0000-0000-000000000011', 35001, true,
  100, 99, 103, 5, 2, 1, 10, 0.25,
  'resolved', 103, 'target', 35099, 1, false,
  12, 2.4, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@0035', 'bars@0035'
);

insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, exclusion_reason, status,
  evaluator_version, data_version
) values (
  '35000000-0000-0000-0000-000000000021', 'baseline', 'T0035', '5m',
  't0035_rule', 'long', '2026-01-03 00:05:00+00',
  '35000000-0000-0000-0000-000000000012', 35002, false,
  'insufficient_bars', 'skipped', 'scorePlan@0035', 'bars@0035'
);

select pg_temp.assert_true(
  'baseline risk different from signals is a plan mismatch',
  exists (select 1 from public.trail_counterfactual_parity
           where run_id = '35000000-0000-0000-0000-000000000021'
             and mismatch_reason = 'plan_mismatch')
);

update public.opportunity_results set risk_ticks = 4, r = 3
 where run_id = '35000000-0000-0000-0000-000000000021'
   and variant = 'baseline' and included;

select pg_temp.assert_true(
  'paired legitimate exclusion passes baseline parity',
  not exists (select 1 from public.trail_counterfactual_parity
               where run_id = '35000000-0000-0000-0000-000000000021')
);

-- A no_trail arm with an equal count but a different candidate set is still
-- recorded and caught.  This is constructible after baseline parity passes.
insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values (
  '35000000-0000-0000-0000-000000000021', 'no_trail', 'T0035', '5m',
  't0035_rule', 'long', '2026-01-03 00:10:00+00', null, 35003, true,
  100, 99, 103, 4, 0, 1, 10, 0.25,
  'resolved', 103, 'target', 35099, 1, false,
  12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@0035', 'bars@0035'
);

select pg_temp.assert_true(
  'no_trail candidate outside a complete baseline is caught',
  exists (select 1 from public.trail_counterfactual_denominator_mismatches
           where run_id = '35000000-0000-0000-0000-000000000021')
);

delete from public.opportunity_results
 where run_id = '35000000-0000-0000-0000-000000000021' and variant = 'no_trail';

insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values (
  '35000000-0000-0000-0000-000000000021', 'no_trail', 'T0035', '5m',
  't0035_rule', 'long', '2026-01-03 00:00:00+00',
  '35000000-0000-0000-0000-000000000011', 35001, true,
  100, 99, 103, 4, 0, 1, 10, 0.25,
  'resolved', 103, 'target', 35099, 1, false,
  12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@0035', 'bars@0035'
);

insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, exclusion_reason, status,
  evaluator_version, data_version
) values (
  '35000000-0000-0000-0000-000000000021', 'no_trail', 'T0035', '5m',
  't0035_rule', 'long', '2026-01-03 00:05:00+00',
  '35000000-0000-0000-0000-000000000012', 35002, false,
  'insufficient_bars', 'skipped', 'scorePlan@0035', 'bars@0035'
);

update public.experiments set status = 'done', finished_at = clock_timestamp()
 where id = '35000000-0000-0000-0000-000000000021';

select pg_temp.assert_true(
  'legitimate exclusions finalize and remain in the opportunity denominator',
  (select baseline_not_taken = 1 and no_trail_not_taken = 1
          and baseline_r_per_opportunity <> baseline_r_per_trade
     from public.trail_counterfactual
    where run_id = '35000000-0000-0000-0000-000000000021')
);

select pg_temp.assert_true(
  'completed summary exposes parity and artifact seal status',
  (select parity_mismatch_count = 0 and baseline_parity_passed
          and arms_agree_on_denominator and artifact_sealed
     from public.trail_counterfactual
    where run_id = '35000000-0000-0000-0000-000000000021')
);

select pg_temp.expect_error(
  'completed opportunity update is sealed',
  $$update public.opportunity_results set target_price = 104
     where run_id = '35000000-0000-0000-0000-000000000021' and included$$,
  'P0001', 'sealed after completion'
);
select pg_temp.expect_error(
  'completed opportunity delete is sealed',
  $$delete from public.opportunity_results
     where run_id = '35000000-0000-0000-0000-000000000021' and included$$,
  'P0001', 'sealed after completion'
);

select pg_temp.assert_true(
  'audit and train views use the same resolved population',
  (select (select count(*) from public.confidence_v2_cohort
            where signal_id in ('35000000-0000-0000-0000-000000000011',
                                '35000000-0000-0000-0000-000000000012'))
        = (select count(*) from public.confidence_v2_cohort_audit
            where signal_id in ('35000000-0000-0000-0000-000000000011',
                                '35000000-0000-0000-0000-000000000012')))
);

select '0035 regression: PASS' as result;
rollback;
