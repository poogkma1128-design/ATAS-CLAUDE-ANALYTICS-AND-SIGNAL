-- Repair the independently-reviewed gaps in 0034 without changing its merged
-- history.  This migration remains offline-only: it does not score, fit,
-- enable Telegram, or change any live trading rule.
--
-- 0034 itself cannot be made replay-safe here: PostgreSQL executes it before
-- this migration, and editing that merged migration is prohibited.  Production
-- applies the migration chain once; 0035 is idempotent where PostgreSQL allows
-- it and the disposable regression test below is the acceptance evidence.

-- ------------------------------------------------------------------ P0: ACL
-- The manifest tables are a database-owned artifact.  service_role may invoke
-- the SECURITY DEFINER freeze function, but must not be able to manufacture or
-- alter a manifest row directly.  State the full mutation set explicitly: the
-- platform's default ACL currently grants these privileges to service_role.
revoke insert, update, delete, truncate, references, trigger
  on public.trail_rescore_runs from service_role;
revoke insert, update, delete, truncate, references, trigger
  on public.trail_rescore_expected from service_role;

-- All six analytical views are read-only contracts.  Revoke first so a future
-- default grant cannot silently make a view writable; then restore only reads.
revoke all on public.trail_counterfactual_parity from anon, authenticated;
revoke all on public.trail_counterfactual_denominator_mismatches from anon, authenticated;
revoke all on public.trail_counterfactual from anon, authenticated;
revoke all on public.confidence_v2_cohort from anon, authenticated;
revoke all on public.confidence_v2_cohort_audit from anon, authenticated;
revoke all on public.confidence_v2_features from anon, authenticated;

grant select on public.trail_counterfactual_parity to authenticated;
grant select on public.trail_counterfactual_denominator_mismatches to authenticated;
grant select on public.trail_counterfactual to authenticated;
grant select on public.confidence_v2_cohort to authenticated;
grant select on public.confidence_v2_cohort_audit to authenticated;
grant select on public.confidence_v2_features to authenticated;

-- opportunity_results is raw offline evidence, never an anonymous API.
revoke all on public.opportunity_results from anon;

-- -------------------------------------------- P1: freeze the complete plan
alter table public.trail_rescore_expected
  add column if not exists live_entry_price numeric,
  add column if not exists live_stop_price numeric,
  add column if not exists live_risk_ticks numeric;

comment on column public.trail_rescore_expected.live_entry_price is
  'Entry-price plan anchor copied from signals by the sole freeze function.';
comment on column public.trail_rescore_expected.live_stop_price is
  'Stop-price plan anchor copied from signals by the sole freeze function.';
comment on column public.trail_rescore_expected.live_risk_ticks is
  'Risk-ticks plan anchor copied from signals by the sole freeze function.';

create or replace function public.freeze_trail_rescore_cohort(
  requested_run_id uuid,
  requested_evaluator_version text,
  requested_data_version text,
  requested_timeframe text default '5m'
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  exp public.experiments%rowtype;
  frozen_at timestamptz := clock_timestamp();
  frozen_count integer;
begin
  if btrim(coalesce(requested_evaluator_version, '')) = ''
     or btrim(coalesce(requested_data_version, '')) = ''
     or btrim(coalesce(requested_timeframe, '')) = '' then
    raise exception 'evaluator_version, data_version and timeframe are required';
  end if;

  select * into exp from public.experiments
   where id = requested_run_id for update;
  if not found then
    raise exception 'experiment % does not exist', requested_run_id;
  end if;
  if exp.kind <> 'rescore' then
    raise exception 'experiment % has kind %, expected rescore', requested_run_id, exp.kind;
  end if;
  if exp.status <> 'running' then
    raise exception 'experiment % is %, expected running', requested_run_id, exp.status;
  end if;
  if exp.bars_from is null or exp.bars_to is null or exp.bars_from > exp.bars_to then
    raise exception 'experiment % needs a valid frozen bars_from/bars_to window', requested_run_id;
  end if;
  if coalesce(cardinality(exp.symbols), 0) = 0 then
    raise exception 'experiment % needs at least one frozen symbol', requested_run_id;
  end if;
  if exists (select 1 from public.trail_rescore_runs where run_id = requested_run_id)
     or exists (select 1 from public.opportunity_results where run_id = requested_run_id) then
    raise exception 'cohort for experiment % is already frozen or scoring already began', requested_run_id;
  end if;

  -- Do not silently freeze a cohort whose plan cannot be audited later.
  if exists (
    select 1
      from public.signals s
      join public.instruments i on i.id = s.instrument_id
      join public.bars b on b.id = s.bar_id
      join public.signal_outcomes o on o.signal_id = s.id
     where i.symbol = any(exp.symbols)
       and s.timeframe = requested_timeframe
       and b.opened_at between exp.bars_from and exp.bars_to
       and o.status = 'resolved'
       and o.exit_reason is not null
       and o.bars_used is not null
       and o.pnl_ticks is not null
       and (s.entry_price is null or s.stop_price is null or s.risk_ticks is null
            or s.risk_ticks <= 0)
  ) then
    raise exception 'experiment % has resolved signals without a complete plan anchor', requested_run_id;
  end if;

  insert into public.trail_rescore_runs (
    run_id, evaluator_version, data_version, timeframe, cohort_frozen_at
  ) values (
    requested_run_id, requested_evaluator_version, requested_data_version,
    requested_timeframe, frozen_at
  );

  insert into public.trail_rescore_expected (
    run_id, symbol, timeframe, rule_key, direction, bar_opened_at,
    signal_id, bar_id, live_exit_reason, live_bars_used, live_pnl_ticks,
    live_entry_price, live_stop_price, live_risk_ticks
  )
  select requested_run_id, i.symbol, s.timeframe, s.rule_key, s.direction,
         b.opened_at, s.id, b.id, o.exit_reason, o.bars_used, o.pnl_ticks,
         s.entry_price, s.stop_price, s.risk_ticks
    from public.signals s
    join public.instruments i on i.id = s.instrument_id
    join public.bars b on b.id = s.bar_id
    join public.signal_outcomes o on o.signal_id = s.id
   where i.symbol = any(exp.symbols)
     and s.timeframe = requested_timeframe
     and b.opened_at between exp.bars_from and exp.bars_to
     and o.status = 'resolved'
     and o.exit_reason is not null
     and o.bars_used is not null
     and o.pnl_ticks is not null;

  get diagnostics frozen_count = row_count;
  if frozen_count = 0 then
    raise exception 'experiment % produced an empty expected cohort', requested_run_id;
  end if;
  update public.trail_rescore_runs set expected_count = frozen_count
   where run_id = requested_run_id;
  return frozen_count;
end;
$$;

comment on function public.freeze_trail_rescore_cohort(uuid, text, text, text) is
  'The sole manifest writer. It freezes resolved signals and their outcome plus entry/stop/risk plan anchors before either arm is written.';

-- A baseline row may be a legitimate, recorded exclusion.  It remains in the
-- frozen population and must be mirrored by no_trail (the denominator gate and
-- completion trigger enforce that); it is not a missing or fabricated result.
-- Rows absent from the manifest are still explicit mismatches.
create or replace view public.trail_counterfactual_parity
with (security_invoker = true) as
  with compared as (
    select coalesce(e.run_id, o.run_id) as run_id,
           coalesce(e.candidate_key, o.candidate_key) as candidate_key,
           e.signal_id as expected_signal_id,
           o.signal_id as rescored_signal_id,
           o.exit_reason as rescored_exit_reason,
           e.live_exit_reason,
           o.bars_used as rescored_bars_used,
           e.live_bars_used,
           o.pnl_ticks as rescored_pnl_ticks,
           e.live_pnl_ticks,
           case
             when e.candidate_key is null then 'extra_baseline'
             when o.candidate_key is null then 'missing_baseline'
             when o.signal_id is null then 'null_linked_baseline'
             when o.signal_id is distinct from e.signal_id then 'wrong_signal_link'
             when e.signal_id is not null and (
               e.live_entry_price is distinct from s.entry_price
               or e.live_stop_price is distinct from s.stop_price
               or e.live_risk_ticks is distinct from s.risk_ticks
             ) then 'live_plan_drift'
             when o.included and (
               o.entry_price is distinct from e.live_entry_price
               or o.stop_price is distinct from e.live_stop_price
               or o.risk_ticks is distinct from e.live_risk_ticks
             ) then 'plan_mismatch'
             when o.included and o.status <> 'resolved' then 'baseline_not_resolved'
             when o.included and (
               o.exit_reason is distinct from e.live_exit_reason
               or o.bars_used is distinct from e.live_bars_used
               or o.pnl_ticks is null
               or abs(o.pnl_ticks - e.live_pnl_ticks) > 0.01
             ) then 'outcome_mismatch'
           end as mismatch_reason,
           e.live_entry_price,
           e.live_stop_price,
           e.live_risk_ticks
      from public.trail_rescore_expected e
      full outer join (
        select * from public.opportunity_results where variant = 'baseline'
      ) o on o.run_id = e.run_id and o.candidate_key = e.candidate_key
      left join public.signals s on s.id = e.signal_id
  )
  select * from compared where mismatch_reason is not null;

comment on view public.trail_counterfactual_parity is
  'Fail-closed baseline parity against a database-frozen manifest. A paired skipped exclusion is legitimate evidence and is not a parity failure; every absent, extra, linked, plan or outcome mismatch is emitted.';

-- ----------------------------------------- P1: seal completed raw artifacts
create or replace function public.guard_completed_rescore_artifact()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  artifact_run_id uuid := coalesce(new.run_id, old.run_id);
begin
  if exists (
    select 1 from public.experiments
     where id = artifact_run_id and kind = 'rescore' and status = 'done'
  ) then
    raise exception using
      errcode = 'P0001',
      message = format('rescore artifact %s is sealed after completion', artifact_run_id);
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunity_results_seal_after_done on public.opportunity_results;
create trigger opportunity_results_seal_after_done
  before insert or update or delete on public.opportunity_results
  for each row execute function public.guard_completed_rescore_artifact();

-- Add run-level proof status to the public result artifact.  A completed run
-- should show both denominator and baseline-parity states; consumers must not
-- infer validity from an aggregate return alone.
create or replace view public.trail_counterfactual
with (security_invoker = true) as
  with per_cell as (
    select o.run_id, o.variant, o.symbol, o.timeframe, o.rule_key, o.direction,
           o.session_day,
           count(*)::integer as opportunities,
           count(*) filter (where o.included)::integer as taken,
           count(*) filter (where not o.included)::integer as not_taken,
           round(sum(case when o.included then o.r else 0 end), 4) as total_r,
           round(sum(case when o.included then o.r else 0 end)
                 / nullif(count(*), 0), 4) as r_per_opportunity,
           round(avg(o.r) filter (where o.included), 4) as r_per_trade,
           min(o.r) filter (where o.included) as worst_r
      from public.opportunity_results o
      join public.experiments e on e.id = o.run_id
     where e.kind = 'rescore' and e.status = 'done'
       and o.status in ('resolved', 'skipped')
     group by 1, 2, 3, 4, 5, 6, 7
  ), mismatch_cells as (
    select distinct run_id, symbol, timeframe, rule_key, direction, session_day
      from public.trail_counterfactual_denominator_mismatches
  ), parity_by_run as (
    select r.run_id,
           count(p.run_id)::integer as parity_mismatch_count
      from public.trail_rescore_runs r
      left join public.trail_counterfactual_parity p on p.run_id = r.run_id
     group by r.run_id
  )
  select coalesce(b.run_id, n.run_id) as run_id,
         coalesce(b.symbol, n.symbol) as symbol,
         coalesce(b.timeframe, n.timeframe) as timeframe,
         coalesce(b.rule_key, n.rule_key) as rule_key,
         coalesce(b.direction, n.direction) as direction,
         coalesce(b.session_day, n.session_day) as session_day,
         b.opportunities as baseline_opportunities,
         n.opportunities as no_trail_opportunities,
         b.taken as baseline_taken,
         n.taken as no_trail_taken,
         b.not_taken as baseline_not_taken,
         n.not_taken as no_trail_not_taken,
         b.total_r as baseline_total_r,
         n.total_r as no_trail_total_r,
         b.r_per_opportunity as baseline_r_per_opportunity,
         n.r_per_opportunity as no_trail_r_per_opportunity,
         b.r_per_trade as baseline_r_per_trade,
         n.r_per_trade as no_trail_r_per_trade,
         b.worst_r as baseline_worst_r,
         n.worst_r as no_trail_worst_r,
         n.r_per_opportunity - b.r_per_opportunity as delta_r_per_opportunity,
         not exists (
           select 1 from mismatch_cells m
            where m.run_id = coalesce(b.run_id, n.run_id)
              and m.symbol = coalesce(b.symbol, n.symbol)
              and m.timeframe = coalesce(b.timeframe, n.timeframe)
              and m.rule_key = coalesce(b.rule_key, n.rule_key)
              and m.direction = coalesce(b.direction, n.direction)
              and m.session_day = coalesce(b.session_day, n.session_day)
         ) as arms_agree_on_denominator,
         coalesce(p.parity_mismatch_count, 0) as parity_mismatch_count,
         coalesce(p.parity_mismatch_count, 0) = 0 as baseline_parity_passed,
         true as artifact_sealed
    from (select * from per_cell where variant = 'baseline') b
    full outer join (select * from per_cell where variant = 'no_trail') n
      on n.run_id = b.run_id and n.symbol = b.symbol
     and n.timeframe = b.timeframe and n.rule_key = b.rule_key
     and n.direction = b.direction and n.session_day = b.session_day
    left join parity_by_run p on p.run_id = coalesce(b.run_id, n.run_id);

comment on view public.trail_counterfactual is
  'Completed baseline vs no_trail evidence with exact-candidate denominator status, baseline parity status and completed-artifact seal status. No significance is computed here.';

-- --------------------------------------------- P2: consistency and indexes
create index if not exists opportunity_results_bar_id_idx
  on public.opportunity_results (bar_id);
create index if not exists opportunity_results_exit_bar_id_idx
  on public.opportunity_results (exit_bar_id);

-- The training-safe cohort is resolved-only.  Audit must describe the same
-- population before exposing delivery fields, otherwise its denominators are
-- not comparable to the cohort it audits.
create or replace view public.confidence_v2_cohort_audit
with (security_invoker = true) as
  select s.id as signal_id,
         i.symbol,
         s.timeframe,
         s.rule_key,
         s.direction,
         b.opened_at as bar_opened_at,
         (b.opened_at at time zone 'UTC')::date as session_day,
         s.payload->'confidenceV2'->>'modelVersion' as model_version,
         s.payload->'confidenceV2'->>'target' as target,
         s.muted,
         s.suppression_reason,
         s.telegram_message_id,
         o.status,
         o.exit_reason,
         o.bars_used,
         o.pnl_ticks,
         round(o.pnl_ticks / nullif(s.risk_ticks, 0), 4) as r,
         (o.pnl_ticks / nullif(s.risk_ticks, 0)) > 0 as label_positive_r,
         o.horizon_bars,
         o.ambiguous_path
    from public.signals s
    join public.instruments i on i.id = s.instrument_id
    join public.bars b on b.id = s.bar_id
    join public.signal_outcomes o on o.signal_id = s.id
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow'
     and o.status = 'resolved';

comment on view public.confidence_v2_cohort_audit is
  'Audit-only, resolved-only confidence-v2 population keyed by signal_id. Delivery fields may be inspected but must never enter fitting.';
