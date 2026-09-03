-- Executable regression test for migration 0034.
-- Run after migrations 0001-0034 on a disposable PostgreSQL database:
--   psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 \
--     -f supabase/tests/0034_make_the_counterfactual_fail_closed_test.sql
-- The transaction is always rolled back. Never point TEST_DATABASE_URL at production.

begin;

create or replace function pg_temp.assert_true(label text, condition boolean)
returns void
language plpgsql
as $$
begin
  if condition is not true then
    raise exception 'assertion failed: %', label;
  end if;
end;
$$;

create or replace function pg_temp.expect_error(label text, statement text)
returns void
language plpgsql
as $$
begin
  begin
    execute statement;
  exception when others then
    return;
  end;
  raise exception 'expected statement to be rejected: %', label;
end;
$$;

-- --------------------------------------------------------------- fixtures
insert into public.rules (key, name, horizon_bars)
values ('t0034_rule', '0034 regression fixture', 10);

insert into public.instruments (
  id, symbol, exchange, tick_size, tick_value
) values (
  '34000000-0000-0000-0000-000000000001',
  'T0034',
  'TEST',
  0.25,
  1
);

insert into public.bars (
  id, instrument_id, timeframe, opened_at,
  open, high, low, close, is_closed
) values
  (34001, '34000000-0000-0000-0000-000000000001', '5m',
   '2026-01-01 23:55:00+00', 100, 104, 99, 103, true),
  (34002, '34000000-0000-0000-0000-000000000001', '5m',
   '2026-01-02 00:00:00+00', 100, 104, 99, 103, true),
  (34003, '34000000-0000-0000-0000-000000000001', '5m',
   '2026-01-02 00:05:00+00', 100, 104, 99, 103, true),
  (34004, '34000000-0000-0000-0000-000000000001', '5m',
   '2026-01-02 00:10:00+00', 100, 104, 99, 103, true),
  (34099, '34000000-0000-0000-0000-000000000001', '5m',
   '2026-01-02 00:15:00+00', 100, 104, 99, 103, true);

insert into public.signals (
  id, bar_id, instrument_id, timeframe, rule_key, direction, price,
  payload, fired_at, telegram_message_id, muted, suppression_reason,
  entry_price, stop_price, target_price, risk_ticks, reward_ticks,
  trail_trigger_ticks, trail_offset_ticks, hold_bars
) values
  (
    '34000000-0000-0000-0000-000000000011', 34001,
    '34000000-0000-0000-0000-000000000001', '5m', 't0034_rule', 'long', 103,
    '{"confidenceV2":{"mode":"shadow","modelVersion":"shadow-1","target":"positive_r","features":{"shared":{"legacyScore":0.5,"barRange":5,"bodyShare":0.6,"closeLocation":0.8,"volume":100,"volumeRatioToHistoryMedian":1.2,"ticks":90,"tickRatioToHistoryMedian":1.1,"rangeRatioToHistoryMedian":1.3,"delta":20,"absoluteDelta":20,"historyBars":30,"priceActionSweep":"none","priceActionZone":"premium","priceActionStructure":"bos"},"rule":{"level.delta":20}}}}'::jsonb,
    '2026-01-02 00:05:00+00', null, true, 'evidence_unproven',
    100, 99, 103, 4, 12, 2, 1, 10
  ),
  (
    '34000000-0000-0000-0000-000000000012', 34002,
    '34000000-0000-0000-0000-000000000001', '5m', 't0034_rule', 'short', 97,
    '{"confidenceV2":{"mode":"shadow","modelVersion":"shadow-1","target":"positive_r","features":{"shared":{"legacyScore":0.4,"barRange":5,"bodyShare":0.4,"closeLocation":0.2,"volume":90,"volumeRatioToHistoryMedian":1.1,"ticks":80,"tickRatioToHistoryMedian":1.0,"rangeRatioToHistoryMedian":1.2,"delta":-20,"absoluteDelta":20,"historyBars":30,"priceActionSweep":"high","priceActionZone":"discount","priceActionStructure":"choch"},"rule":{"level.delta":-20}}}}'::jsonb,
    '2026-01-02 00:01:00+00', 34012, false, null,
    100, 101, 97, 4, 12, 2, 1, 10
  );

update public.signal_outcomes o
   set status = 'resolved',
       mfe_ticks = 12,
       mae_ticks = 0,
       exit_price = case when o.signal_id = '34000000-0000-0000-0000-000000000011'
                         then 103 else 97 end,
       pnl_ticks = 12,
       bars_used = 1,
       resolved_at = '2026-01-02 00:16:00+00',
       exit_reason = 'target',
       ambiguous_path = false,
       exit_bar_id = 34099
 where o.signal_id in (
   '34000000-0000-0000-0000-000000000011',
   '34000000-0000-0000-0000-000000000012'
 );

insert into public.experiments (
  id, name, symbols, bars_from, bars_to, kind
) values
  ('34000000-0000-0000-0000-000000000021', '0034 sweep rejection',
   array['T0034'], '2026-01-01 23:55:00+00', '2026-01-02 00:00:00+00', 'sweep'),
  ('34000000-0000-0000-0000-000000000022', '0034 rescore contract',
   array['T0034'], '2026-01-01 23:55:00+00', '2026-01-02 00:00:00+00', 'rescore');

-- ---------------------------------------------------- kind/freeze guarantees
select pg_temp.expect_error(
  'sweep experiment cannot own rescore artifacts',
  $$select public.freeze_trail_rescore_cohort(
      '34000000-0000-0000-0000-000000000021', 'scorePlan@test', 'bars@test', '5m'
    )$$
);

select pg_temp.assert_true(
  'database freeze captured the two resolved signals',
  public.freeze_trail_rescore_cohort(
    '34000000-0000-0000-0000-000000000022',
    'scorePlan@test', 'bars@test', '5m'
  ) = 2
);

select pg_temp.assert_true(
  'no baseline rows is two explicit parity mismatches',
  (select count(*) = 2
     from public.trail_counterfactual_parity
    where run_id = '34000000-0000-0000-0000-000000000022'
      and mismatch_reason = 'missing_baseline')
);

-- A variant may not start until baseline parity is complete.
select pg_temp.expect_error(
  'no_trail cannot start before baseline parity',
  $sql$
  insert into public.opportunity_results (
    run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
    signal_id, bar_id, included, entry_price, stop_price, target_price,
    risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
    status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
    pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
    bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
  ) values (
    '34000000-0000-0000-0000-000000000022', 'no_trail', 'T0034', '5m',
    't0034_rule', 'long', '2026-01-01 23:55:00+00',
    '34000000-0000-0000-0000-000000000011', 34001, true,
    100, 99, 103, 4, 0, 1, 10, 0.25,
    'resolved', 103, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  )
  $sql$
);

-- ----------------------------------------------- baseline parity fail-closed
insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values
  (
    '34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
    't0034_rule', 'long', '2026-01-01 23:55:00+00',
    null, 34001, true, 100, 99, 103, 4, 2, 1, 10, 0.25,
    'resolved', 103, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  ),
  (
    '34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
    't0034_rule', 'short', '2026-01-02 00:00:00+00',
    '34000000-0000-0000-0000-000000000012', 34002, true,
    100, 101, 97, 4, 2, 1, 10, 0.25,
    'resolved', 97, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  );

select pg_temp.assert_true(
  'null-linked baseline is emitted, not hidden by an inner join',
  (select count(*) = 1
     from public.trail_counterfactual_parity
    where run_id = '34000000-0000-0000-0000-000000000022'
      and mismatch_reason = 'null_linked_baseline')
);

update public.opportunity_results
   set signal_id = '34000000-0000-0000-0000-000000000011'
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'baseline'
   and direction = 'long';

select pg_temp.assert_true(
  'matching complete baseline makes parity empty',
  not exists (
    select 1 from public.trail_counterfactual_parity
     where run_id = '34000000-0000-0000-0000-000000000022'
  )
);

select pg_temp.expect_error(
  'null rescored pnl cannot be treated as live zero',
  $$update public.opportunity_results
       set pnl_ticks = null, r = null
     where run_id = '34000000-0000-0000-0000-000000000022'
       and variant = 'baseline'
       and direction = 'long'$$
);

update public.opportunity_results
   set exit_reason = 'stop'
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'baseline'
   and direction = 'long';

select pg_temp.assert_true(
  'outcome difference is emitted',
  (select count(*) = 1
     from public.trail_counterfactual_parity
    where run_id = '34000000-0000-0000-0000-000000000022'
      and mismatch_reason = 'outcome_mismatch')
);

update public.opportunity_results
   set exit_reason = 'target'
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'baseline'
   and direction = 'long';

insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values (
  '34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
  't0034_rule', 'long', '2026-01-02 00:05:00+00',
  null, 34003, true, 100, 99, 103, 4, 2, 1, 10, 0.25,
  'resolved', 103, 'target', 34099, 1, false,
  12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
);

select pg_temp.assert_true(
  'extra baseline is emitted',
  (select count(*) = 1
     from public.trail_counterfactual_parity
    where run_id = '34000000-0000-0000-0000-000000000022'
      and mismatch_reason = 'extra_baseline')
);

delete from public.opportunity_results
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'baseline'
   and bar_opened_at = '2026-01-02 00:05:00+00';

-- ------------------------------------------------ invalid rows are rejected
select pg_temp.expect_error(
  'third variant',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, exclusion_reason, status, evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'third', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:00:00+00', false, 'no_plan',
      'skipped', 'scorePlan@test', 'bars@test')$$
);

select pg_temp.expect_error(
  'included pending row with missing target/trail/tick units',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, entry_price, stop_price, risk_ticks, horizon_bars,
       status, evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:05:00+00', true, 100, 99, 4, 10,
      'pending', 'scorePlan@test', 'bars@test')$$
);

select pg_temp.expect_error(
  'included row with non-positive risk',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, entry_price, stop_price, target_price, risk_ticks,
       trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
       status, evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:06:00+00', true, 100, 99, 103, 0,
      2, 1, 10, 0.25, 'pending', 'scorePlan@test', 'bars@test')$$
);

select pg_temp.expect_error(
  'resolved row missing result fields',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, entry_price, stop_price, target_price, risk_ticks,
       trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
       status, evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:10:00+00', true, 100, 99, 103, 4,
      2, 1, 10, 0.25, 'resolved', 'scorePlan@test', 'bars@test')$$
);

select pg_temp.expect_error(
  'excluded row carrying an ambiguity field',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, exclusion_reason, status, ambiguous_path,
       evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:15:00+00', false, 'no_plan',
      'skipped', true, 'scorePlan@test', 'bars@test')$$
);

select pg_temp.expect_error(
  'stored R inconsistent with pnl/risk',
  $$insert into public.opportunity_results (
      run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
      included, entry_price, stop_price, target_price, risk_ticks,
      trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
      status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
      pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
      bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
    ) values (
      '34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:20:00+00', true,
      100, 99, 103, 4, 2, 1, 10, 0.25,
      'resolved', 103, 'target', 34099, 1, false,
      12, 2.99, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
    )$$
);

select pg_temp.expect_error(
  'mixed evaluator/data version inside one run',
  $$insert into public.opportunity_results
      (run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
       included, exclusion_reason, status, evaluator_version, data_version)
    values ('34000000-0000-0000-0000-000000000022', 'baseline', 'T0034', '5m',
      't0034_rule', 'long', '2026-01-02 01:25:00+00', false, 'no_plan',
      'skipped', 'scorePlan@other', 'bars@other')$$
);

-- ------------------------------------- equal counts, different keys must fail
insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values
  (
    '34000000-0000-0000-0000-000000000022', 'no_trail', 'T0034', '5m',
    't0034_rule', 'long', '2026-01-02 00:05:00+00', null, 34003, true,
    100, 99, 103, 4, 0, 1, 10, 0.25,
    'resolved', 103, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  ),
  (
    '34000000-0000-0000-0000-000000000022', 'no_trail', 'T0034', '5m',
    't0034_rule', 'short', '2026-01-02 00:10:00+00', null, 34004, true,
    100, 101, 97, 4, 0, 1, 10, 0.25,
    'resolved', 97, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  );

select pg_temp.assert_true(
  'two-vs-two different candidate sets emit four differences',
  (select count(*) = 4
     from public.trail_counterfactual_denominator_mismatches
    where run_id = '34000000-0000-0000-0000-000000000022')
);

select pg_temp.expect_error(
  'run cannot finish with equal counts but different keys',
  $$update public.experiments set status = 'done'
     where id = '34000000-0000-0000-0000-000000000022'$$
);

delete from public.opportunity_results
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'no_trail';

insert into public.opportunity_results (
  run_id, variant, symbol, timeframe, rule_key, direction, bar_opened_at,
  signal_id, bar_id, included, entry_price, stop_price, target_price,
  risk_ticks, trail_trigger_ticks, trail_offset_ticks, horizon_bars, tick_size,
  status, exit_price, exit_reason, exit_bar_id, bars_used, ambiguous_path,
  pnl_ticks, r, mfe_ticks, mae_ticks, mfe_horizon_ticks, mae_horizon_ticks,
  bars_to_mfe, bars_to_mae, horizon_bars_seen, evaluator_version, data_version
) values
  (
    '34000000-0000-0000-0000-000000000022', 'no_trail', 'T0034', '5m',
    't0034_rule', 'long', '2026-01-01 23:55:00+00',
    '34000000-0000-0000-0000-000000000011', 34001, true,
    100, 99, 103, 4, 0, 1, 10, 0.25,
    'resolved', 103, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  ),
  (
    '34000000-0000-0000-0000-000000000022', 'no_trail', 'T0034', '5m',
    't0034_rule', 'short', '2026-01-02 00:00:00+00',
    '34000000-0000-0000-0000-000000000012', 34002, true,
    100, 101, 96.75, 4, 0, 1, 10, 0.25,
    'resolved', 97, 'target', 34099, 1, false,
    12, 3, 12, 0, 12, 0, 1, 0, 10, 'scorePlan@test', 'bars@test'
  );

select pg_temp.assert_true(
  'matching arms have no candidate-key differences',
  not exists (
    select 1 from public.trail_counterfactual_denominator_mismatches
     where run_id = '34000000-0000-0000-0000-000000000022'
  )
);

select pg_temp.expect_error(
  'run cannot finish when no_trail changes more than trigger',
  $$update public.experiments set status = 'done'
     where id = '34000000-0000-0000-0000-000000000022'$$
);

update public.opportunity_results
   set target_price = 97
 where run_id = '34000000-0000-0000-0000-000000000022'
   and variant = 'no_trail'
   and direction = 'short';

update public.experiments
   set status = 'done', finished_at = clock_timestamp()
 where id = '34000000-0000-0000-0000-000000000022';

select pg_temp.assert_true(
  'valid complete run can finalize',
  (select status = 'done' from public.experiments
    where id = '34000000-0000-0000-0000-000000000022')
);

-- --------------------------------------------- three-layer muted separation
select pg_temp.assert_true(
  'training cohort includes both muted and announced population rows',
  (select count(*) = 2 from public.confidence_v2_cohort
    where signal_id in (
      '34000000-0000-0000-0000-000000000011',
      '34000000-0000-0000-0000-000000000012'
    ))
);

select pg_temp.assert_true(
  'training contract excludes all delivery/post-outcome fields',
  not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'confidence_v2_cohort'
       and column_name in (
         'muted', 'suppression_reason', 'telegram_message_id', 'exit_reason'
       )
  )
);

select pg_temp.assert_true(
  'cohort session comes from bar open rather than delayed fire time',
  (select session_day = date '2026-01-01'
     from public.confidence_v2_cohort
    where signal_id = '34000000-0000-0000-0000-000000000011')
);

select pg_temp.assert_true(
  'audit view carries both delivery groups and the post-outcome reason',
  (select count(*) = 2
          and count(*) filter (where muted) = 1
          and count(*) filter (where not muted) = 1
          and count(*) filter (where exit_reason = 'target') = 2
     from public.confidence_v2_cohort_audit
    where signal_id in (
      '34000000-0000-0000-0000-000000000011',
      '34000000-0000-0000-0000-000000000012'
    ))
);

select '0034 regression: PASS' as result;

rollback;
