-- Repair the contracts introduced by 0033 without rewriting its merged history.
--
-- This migration still does not score a trade, fit a model, change a live rule,
-- or announce anything. It makes the offline artifacts fail closed:
--   * a database-frozen manifest, not the rows a writer happened to emit, is
--     the expected baseline cohort;
--   * parity and arm-denominator gates expose omissions as rows;
--   * invalid plans, outcomes, variants, R values and version mixtures cannot
--     be stored as completed evidence;
--   * the confidence training and audit contracts are physically separate.

-- ---------------------------------------------------- one immutable run stamp
-- A composite foreign key from every result row to this one-row-per-run table
-- is stronger than a trigger which asks what the first row happened to contain:
-- concurrent inserts cannot introduce a second evaluator or data version.
do $$
begin
  alter table public.experiments
    add constraint experiments_id_kind_key unique (id, kind);
exception
  when duplicate_object then null;
end
$$;

create table public.trail_rescore_runs (
  run_id             uuid primary key,
  experiment_kind    text not null default 'rescore'
                       check (experiment_kind = 'rescore'),
  evaluator_version  text not null check (btrim(evaluator_version) <> ''),
  data_version       text not null check (btrim(data_version) <> ''),
  timeframe          text not null check (btrim(timeframe) <> ''),
  cohort_frozen_at   timestamptz not null default clock_timestamp(),
  expected_count     integer check (expected_count > 0),

  constraint trail_rescore_runs_experiment_kind_fk
    foreign key (run_id, experiment_kind)
    references public.experiments (id, kind) on delete cascade,
  constraint trail_rescore_runs_version_key
    unique (run_id, evaluator_version, data_version)
);

comment on table public.trail_rescore_runs is
  'One immutable evaluator/data stamp and one frozen-cohort count per trail rescore run. The composite FK to experiments makes attaching this artifact to a sweep impossible.';

-- ------------------------------------------------ frozen expected population
-- The manifest is independent of both scored arms. Parity therefore cannot
-- pass merely because the baseline writer omitted the same opportunity that a
-- report would otherwise have used as its anchor.
create table public.trail_rescore_expected (
  run_id          uuid not null references public.trail_rescore_runs(run_id)
                    on delete cascade,
  symbol          text not null,
  timeframe       text not null,
  rule_key        text not null,
  direction       text not null check (direction in ('long', 'short')),
  bar_opened_at   timestamptz not null,
  candidate_key   text generated always as (
    public.opportunity_candidate_key(
      symbol, timeframe, bar_opened_at, rule_key, direction
    )
  ) stored,
  signal_id       uuid not null references public.signals(id) on delete restrict,
  bar_id          bigint not null references public.bars(id) on delete restrict,
  live_exit_reason text not null
                     check (live_exit_reason in ('stop', 'target', 'trail', 'timeout')),
  live_bars_used   integer not null check (live_bars_used > 0),
  live_pnl_ticks   numeric(12,2) not null,
  created_at       timestamptz not null default clock_timestamp(),

  primary key (run_id, candidate_key),
  unique (run_id, signal_id)
);

comment on table public.trail_rescore_expected is
  'Database-frozen baseline cohort and live outcomes captured before either arm is written. Parity is anchored here, never in opportunity_results.';

create index trail_rescore_expected_signal_idx
  on public.trail_rescore_expected (signal_id);
create index trail_rescore_expected_bar_idx
  on public.trail_rescore_expected (bar_id);

-- The only supported way to create the expected cohort derives it from the
-- database using the experiment's already-frozen bounds and symbols. A caller
-- supplies only reproducibility stamps, not candidate rows.
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

  select * into exp
    from public.experiments
   where id = requested_run_id
   for update;

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

  insert into public.trail_rescore_runs (
    run_id, evaluator_version, data_version, timeframe, cohort_frozen_at
  ) values (
    requested_run_id,
    requested_evaluator_version,
    requested_data_version,
    requested_timeframe,
    frozen_at
  );

  insert into public.trail_rescore_expected (
    run_id, symbol, timeframe, rule_key, direction, bar_opened_at,
    signal_id, bar_id, live_exit_reason, live_bars_used, live_pnl_ticks
  )
  select requested_run_id,
         i.symbol,
         s.timeframe,
         s.rule_key,
         s.direction,
         b.opened_at,
         s.id,
         b.id,
         o.exit_reason,
         o.bars_used,
         o.pnl_ticks
    from public.signals s
    join public.instruments i     on i.id = s.instrument_id
    join public.bars b            on b.id = s.bar_id
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

  update public.trail_rescore_runs
     set expected_count = frozen_count
   where run_id = requested_run_id;

  return frozen_count;
end;
$$;

comment on function public.freeze_trail_rescore_cohort(uuid, text, text, text) is
  'Freezes every resolved signal in a rescore experiment''s symbol/time window before scoring. Raises on an empty cohort and cannot be called after scoring starts.';

revoke all on function public.freeze_trail_rescore_cohort(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.freeze_trail_rescore_cohort(uuid, text, text, text)
  to service_role;

-- Freeze means append once before scoring, then never edit the expected answer.
create or replace function public.guard_trail_rescore_expected_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'trail_rescore_expected is immutable; create a new run instead';
  end if;
  if exists (
    select 1 from public.opportunity_results where run_id = new.run_id
  ) then
    raise exception 'cannot extend frozen cohort % after scoring began', new.run_id;
  end if;
  return new;
end;
$$;

create trigger trail_rescore_expected_immutable
  before insert or update or delete on public.trail_rescore_expected
  for each row execute function public.guard_trail_rescore_expected_immutable();

-- --------------------------------------------------------- row-level contract
do $$
begin
  alter table public.opportunity_results
    add constraint opportunity_results_variant_0034_check
    check (variant in ('baseline', 'no_trail'));
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.opportunity_results
    add constraint opportunity_results_run_version_0034_fk
    foreign key (run_id, evaluator_version, data_version)
    references public.trail_rescore_runs
      (run_id, evaluator_version, data_version)
    on delete cascade;
exception
  when duplicate_object then null;
end
$$;

-- State machine:
--   skipped  = excluded and completely empty apart from identity/reason/stamps
--   pending  = valid plan, no result yet
--   resolved = valid plan and complete result/full-horizon measurements
--   expired  = valid plan but incomplete; it can never finalize a run
do $$
begin
  alter table public.opportunity_results
    add constraint opportunity_results_state_0034_check
    check (
      (
        not included
        and exclusion_reason is not null
        and status = 'skipped'
        and entry_price is null
        and stop_price is null
        and target_price is null
        and risk_ticks is null
        and trail_trigger_ticks is null
        and trail_offset_ticks is null
        and horizon_bars is null
        and tick_size is null
        and exit_price is null
        and exit_reason is null
        and exit_bar_id is null
        and bars_used is null
        and ambiguous_path is null
        and pnl_ticks is null
        and r is null
        and mfe_ticks is null
        and mae_ticks is null
        and mfe_horizon_ticks is null
        and mae_horizon_ticks is null
        and bars_to_mfe is null
        and bars_to_mae is null
        and horizon_bars_seen is null
      )
      or
      (
        included
        and exclusion_reason is null
        and entry_price is not null
        and stop_price is not null
        and target_price is not null
        and risk_ticks is not null
        and risk_ticks > 0
        and trail_trigger_ticks is not null
        and trail_trigger_ticks >= 0
        and trail_offset_ticks is not null
        and trail_offset_ticks >= 0
        and horizon_bars is not null
        and horizon_bars > 0
        and tick_size is not null
        and tick_size > 0
        and (variant <> 'no_trail' or trail_trigger_ticks = 0)
        and (
          (
            status = 'pending'
            and exit_price is null
            and exit_reason is null
            and exit_bar_id is null
            and bars_used is null
            and ambiguous_path is null
            and pnl_ticks is null
            and r is null
            and mfe_ticks is null
            and mae_ticks is null
            and mfe_horizon_ticks is null
            and mae_horizon_ticks is null
            and bars_to_mfe is null
            and bars_to_mae is null
            and horizon_bars_seen is null
          )
          or
          (
            status = 'resolved'
            and exit_price is not null
            and exit_reason is not null
            and exit_bar_id is not null
            and bars_used is not null
            and bars_used between 1 and horizon_bars
            and ambiguous_path is not null
            and pnl_ticks is not null
            and r is not null
            and mfe_ticks is not null
            and mfe_ticks >= 0
            and mae_ticks is not null
            and mae_ticks >= 0
            and mfe_horizon_ticks is not null
            and mfe_horizon_ticks >= 0
            and mae_horizon_ticks is not null
            and mae_horizon_ticks >= 0
            and bars_to_mfe is not null
            and bars_to_mfe between 0 and horizon_bars
            and bars_to_mae is not null
            and bars_to_mae between 0 and horizon_bars
            and horizon_bars_seen is not null
            and horizon_bars_seen = horizon_bars
          )
          or
          (
            status = 'expired'
            and exit_price is null
            and exit_reason is null
            and exit_bar_id is null
            and bars_used is not null
            and bars_used between 0 and horizon_bars - 1
            and ambiguous_path is null
            and pnl_ticks is null
            and r is null
            and mfe_ticks is null
            and mae_ticks is null
            and mfe_horizon_ticks is null
            and mae_horizon_ticks is null
            and bars_to_mfe is null
            and bars_to_mae is null
            and horizon_bars_seen is null
          )
        )
      )
    );
exception
  when duplicate_object then null;
end
$$;

do $$
begin
  alter table public.opportunity_results
    add constraint opportunity_results_r_consistent_0034_check
    check (
      r is null
      or (
        pnl_ticks is not null
        and risk_ticks is not null
        and risk_ticks > 0
        and r = round(pnl_ticks / risk_ticks, 4)
      )
    );
exception
  when duplicate_object then null;
end
$$;

-- -------------------------------------------------------------- parity gate
-- Drop first because CREATE OR REPLACE cannot change the existing output
-- contract. This source migration has not been applied to production and no
-- runtime consumer exists yet; 0034 is the required gate before either occurs.
drop view if exists public.trail_counterfactual_parity;

create view public.trail_counterfactual_parity
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
             when not o.included then 'baseline_excluded'
             when o.status <> 'resolved' then 'baseline_not_resolved'
             when o.exit_reason is distinct from e.live_exit_reason
               or o.bars_used is distinct from e.live_bars_used
               or o.pnl_ticks is null
               or abs(o.pnl_ticks - e.live_pnl_ticks) > 0.01
               then 'outcome_mismatch'
           end as mismatch_reason
      from public.trail_rescore_expected e
      full outer join (
        select * from public.opportunity_results where variant = 'baseline'
      ) o
        on o.run_id = e.run_id
       and o.candidate_key = e.candidate_key
  )
  select * from compared where mismatch_reason is not null;

comment on view public.trail_counterfactual_parity is
  'Fail-closed baseline parity gate anchored to trail_rescore_expected. Empty is a pass only after a non-empty database-frozen manifest exists; missing, extra, null/wrong links, exclusions, incomplete rows and outcome differences are emitted explicitly.';

-- ------------------------------------------------ exact denominator gate
create or replace view public.trail_counterfactual_denominator_mismatches
with (security_invoker = true) as
  select coalesce(b.run_id, n.run_id) as run_id,
         coalesce(b.candidate_key, n.candidate_key) as candidate_key,
         coalesce(b.symbol, n.symbol) as symbol,
         coalesce(b.timeframe, n.timeframe) as timeframe,
         coalesce(b.rule_key, n.rule_key) as rule_key,
         coalesce(b.direction, n.direction) as direction,
         coalesce(b.session_day, n.session_day) as session_day,
         case when b.candidate_key is null then 'missing_from_baseline'
              else 'missing_from_no_trail' end as mismatch_reason
    from (
      select * from public.opportunity_results where variant = 'baseline'
    ) b
    full outer join (
      select * from public.opportunity_results where variant = 'no_trail'
    ) n
      on n.run_id = b.run_id
     and n.candidate_key = b.candidate_key
   where b.candidate_key is null or n.candidate_key is null;

comment on view public.trail_counterfactual_denominator_mismatches is
  'Exact candidate-key set difference between baseline and no_trail. Empty means set equality; equal counts with different keys never pass.';

-- Rebuild the summary so its boolean is based on exact keys, not count equality,
-- and half-written runs cannot appear as completed evidence.
create or replace view public.trail_counterfactual
with (security_invoker = true) as
  with per_cell as (
    select o.run_id,
           o.variant,
           o.symbol,
           o.timeframe,
           o.rule_key,
           o.direction,
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
     where e.kind = 'rescore'
       and e.status = 'done'
       and o.status in ('resolved', 'skipped')
     group by 1, 2, 3, 4, 5, 6, 7
  ), mismatch_cells as (
    select distinct run_id, symbol, timeframe, rule_key, direction, session_day
      from public.trail_counterfactual_denominator_mismatches
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
         ) as arms_agree_on_denominator
    from (select * from per_cell where variant = 'baseline') b
    full outer join (select * from per_cell where variant = 'no_trail') n
      on n.run_id = b.run_id
     and n.symbol = b.symbol
     and n.timeframe = b.timeframe
     and n.rule_key = b.rule_key
     and n.direction = b.direction
     and n.session_day = b.session_day;

comment on view public.trail_counterfactual is
  'Completed baseline vs no_trail results per rule x direction x instrument x UTC session. arms_agree_on_denominator compares exact candidate keys. No uncertainty or significance is computed here.';

-- No no_trail row may be written until the frozen baseline is complete and
-- exact. This turns the Phase-3 instruction into a machine gate.
create or replace function public.guard_no_trail_after_parity()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.variant = 'no_trail' then
    if not exists (
      select 1 from public.trail_rescore_runs r
       where r.run_id = new.run_id
         and r.expected_count is not null
         and r.expected_count = (
           select count(*) from public.trail_rescore_expected x
            where x.run_id = new.run_id
         )
    ) then
      raise exception 'run % has no complete frozen cohort', new.run_id;
    end if;
    if exists (
      select 1 from public.trail_counterfactual_parity p
       where p.run_id = new.run_id
    ) then
      raise exception 'run % baseline parity has not passed', new.run_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger opportunity_results_no_trail_after_parity
  before insert or update on public.opportunity_results
  for each row execute function public.guard_no_trail_after_parity();

-- A rescore run cannot be called done while any gate is incomplete. This does
-- not decide whether no_trail is better; it only proves the artifact is valid.
create or replace function public.guard_rescore_completion()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.kind = 'rescore' and new.status = 'done'
     and old.status is distinct from new.status then
    if not exists (
      select 1 from public.trail_rescore_runs r
       where r.run_id = new.id and r.expected_count > 0
    ) then
      raise exception 'rescore run % has no frozen cohort', new.id;
    end if;
    if exists (
      select 1 from public.trail_counterfactual_parity p where p.run_id = new.id
    ) then
      raise exception 'rescore run % has baseline parity mismatches', new.id;
    end if;
    if exists (
      select 1 from public.trail_counterfactual_denominator_mismatches d
       where d.run_id = new.id
    ) then
      raise exception 'rescore run % has unequal candidate sets', new.id;
    end if;
    if exists (
      select 1 from public.opportunity_results o
       where o.run_id = new.id and o.status not in ('resolved', 'skipped')
    ) then
      raise exception 'rescore run % has incomplete result rows', new.id;
    end if;
    if not exists (
      select 1 from public.opportunity_results o
       where o.run_id = new.id and o.variant = 'baseline'
    ) or not exists (
      select 1 from public.opportunity_results o
       where o.run_id = new.id and o.variant = 'no_trail'
    ) then
      raise exception 'rescore run % must contain both frozen variants', new.id;
    end if;
    if exists (
      select 1
        from public.opportunity_results b
        join public.opportunity_results n
          on n.run_id = b.run_id
         and n.candidate_key = b.candidate_key
         and n.variant = 'no_trail'
       where b.run_id = new.id
         and b.variant = 'baseline'
         and (
           b.included is distinct from n.included
           or b.exclusion_reason is distinct from n.exclusion_reason
           or b.entry_price is distinct from n.entry_price
           or b.stop_price is distinct from n.stop_price
           or b.target_price is distinct from n.target_price
           or b.risk_ticks is distinct from n.risk_ticks
           or b.trail_offset_ticks is distinct from n.trail_offset_ticks
           or b.horizon_bars is distinct from n.horizon_bars
           or b.tick_size is distinct from n.tick_size
           or (n.included and n.trail_trigger_ticks <> 0)
         )
    ) then
      raise exception 'rescore run % changed more than trailTriggerTicks', new.id;
    end if;
  end if;
  return new;
end;
$$;

create trigger experiments_guard_rescore_completion
  before update on public.experiments
  for each row execute function public.guard_rescore_completion();

-- ------------------------------------------ confidence train/audit separation
drop view if exists public.confidence_v2_cohort;

create view public.confidence_v2_cohort
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

         (c.shared->>'legacyScore')::numeric as f_legacy_score,
         (c.shared->>'barRange')::numeric as f_bar_range,
         (c.shared->>'bodyShare')::numeric as f_body_share,
         (c.shared->>'closeLocation')::numeric as f_close_location,
         (c.shared->>'volume')::numeric as f_volume,
         (c.shared->>'volumeRatioToHistoryMedian')::numeric
           as f_volume_ratio_to_history_median,
         (c.shared->>'ticks')::numeric as f_ticks,
         (c.shared->>'tickRatioToHistoryMedian')::numeric
           as f_tick_ratio_to_history_median,
         (c.shared->>'rangeRatioToHistoryMedian')::numeric
           as f_range_ratio_to_history_median,
         (c.shared->>'delta')::numeric as f_delta,
         (c.shared->>'absoluteDelta')::numeric as f_absolute_delta,
         (c.shared->>'historyBars')::integer as f_history_bars,
         c.shared->>'priceActionSweep' as f_price_action_sweep,
         c.shared->>'priceActionZone' as f_price_action_zone,
         c.shared->>'priceActionStructure' as f_price_action_structure,

         round(o.pnl_ticks / nullif(s.risk_ticks, 0), 4) as r,
         (o.pnl_ticks / nullif(s.risk_ticks, 0)) > 0 as label_positive_r
    from public.signals s
    join public.instruments i     on i.id = s.instrument_id
    join public.bars b            on b.id = s.bar_id
    join public.signal_outcomes o on o.signal_id = s.id
   cross join lateral (
      select s.payload->'confidenceV2'->'features'->'shared' as shared
   ) c
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow'
     and o.status = 'resolved';

comment on view public.confidence_v2_cohort is
  'Training-safe confidence-v2 contract: all muted and announced resolved rows, feature columns, labels and join keys only. Event/session time comes from bars.opened_at. Delivery state and post-outcome reason fields are intentionally absent.';

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
         case when o.status = 'resolved'
              then (o.pnl_ticks / nullif(s.risk_ticks, 0)) > 0 end
           as label_positive_r,
         o.horizon_bars,
         o.ambiguous_path
    from public.signals s
    join public.instruments i     on i.id = s.instrument_id
    join public.bars b            on b.id = s.bar_id
    join public.signal_outcomes o on o.signal_id = s.id
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow';

comment on view public.confidence_v2_cohort_audit is
  'Audit-only delivery/outcome view keyed by signal_id. It may check muted/announced balance across train/holdout and report both groups; it must never be joined into model fitting.';

-- Keep the long-form inspection view on the same event clock. It is not a fit
-- contract, but two views should not assign the same signal to different days.
drop view if exists public.confidence_v2_features;

create view public.confidence_v2_features
with (security_invoker = true) as
  select s.id as signal_id,
         i.symbol,
         s.rule_key,
         s.direction,
         b.opened_at as bar_opened_at,
         fblock.feature_namespace,
         f.key as feature_key,
         jsonb_typeof(f.value) as feature_type,
         case when jsonb_typeof(f.value) = 'number'
              then (f.value #>> '{}')::numeric end as value_num,
         case when jsonb_typeof(f.value) in ('string', 'boolean')
              then f.value #>> '{}' end as value_text
    from public.signals s
    join public.instruments i on i.id = s.instrument_id
    join public.bars b        on b.id = s.bar_id
   cross join lateral (
      values ('shared', s.payload->'confidenceV2'->'features'->'shared'),
             ('rule',   s.payload->'confidenceV2'->'features'->'rule')
   ) as fblock(feature_namespace, block)
   cross join lateral jsonb_each(coalesce(fblock.block, '{}'::jsonb)) as f(key, value)
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow';

comment on view public.confidence_v2_features is
  'Long-form confidence-v2 feature inspection. feature_namespace separates shared from rule keys; bar_opened_at is the event clock.';

-- RLS and SQL privileges are separate. State both explicitly so a platform
-- default-grant change cannot turn a policy into a false sense of protection.
alter table public.trail_rescore_runs enable row level security;
alter table public.trail_rescore_expected enable row level security;

create policy "authenticated read trail_rescore_runs"
  on public.trail_rescore_runs for select to authenticated using (true);
create policy "authenticated read trail_rescore_expected"
  on public.trail_rescore_expected for select to authenticated using (true);

revoke all on public.trail_rescore_runs from anon, authenticated;
revoke all on public.trail_rescore_expected from anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.opportunity_results from anon, authenticated;

grant select on public.trail_rescore_runs to authenticated;
grant select on public.trail_rescore_expected to authenticated;
grant select on public.opportunity_results to authenticated;
grant select on public.trail_counterfactual_parity to authenticated;
grant select on public.trail_counterfactual_denominator_mismatches to authenticated;
grant select on public.trail_counterfactual to authenticated;
grant select on public.confidence_v2_cohort to authenticated;
grant select on public.confidence_v2_cohort_audit to authenticated;
grant select on public.confidence_v2_features to authenticated;

grant select on public.trail_rescore_runs to service_role;
grant select on public.trail_rescore_expected to service_role;
grant select, insert, update, delete on public.opportunity_results to service_role;
grant usage, select on sequence public.opportunity_results_id_seq to service_role;
grant select on public.trail_counterfactual_parity to service_role;
grant select on public.trail_counterfactual_denominator_mismatches to service_role;
grant select on public.trail_counterfactual to service_role;
grant select on public.confidence_v2_cohort to service_role;
grant select on public.confidence_v2_cohort_audit to service_role;
grant select on public.confidence_v2_features to service_role;

revoke all on public.trail_counterfactual_parity from anon;
revoke all on public.trail_counterfactual_denominator_mismatches from anon;
revoke all on public.trail_counterfactual from anon;
revoke all on public.confidence_v2_cohort from anon;
revoke all on public.confidence_v2_cohort_audit from anon;
revoke all on public.confidence_v2_features from anon;
