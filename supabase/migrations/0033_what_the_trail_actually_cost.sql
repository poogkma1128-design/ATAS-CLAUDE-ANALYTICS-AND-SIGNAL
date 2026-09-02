-- The trail question could not be answered from the data we already had.
--
-- 943 of 2,039 resolved trades exited on the trail, none of them below entry,
-- none of them at a loss. So "trailing causes the losses" is answered: it does
-- not. The open question is the opposite one -- how much a trail leaves on the
-- table, and on which setups -- and that cannot be read out of
-- public.signal_outcomes, because mfe_ticks / mae_ticks are computed only as
-- far as the bar the trade exited on (0031:186-191). A trail exits at bar 2.9
-- on average out of a 10-bar horizon, so the part of the path that would decide
-- the question is simply not stored. Reading the stored MFE anyway classifies
-- 864 of 943 trades as "would have timed out", which is an artefact of the
-- censoring and not a result.
--
-- Answering it means walking the bars again under a second plan. That produces
-- rows that are not signals and must never be mistaken for them, so they get
-- their own table.
--
-- This migration adds storage and read-only views. It creates no signal, scores
-- nothing, changes no rule parameter, and does not touch trailAfterR,
-- trailOffsetR, any filter, or Telegram. HANDOFF §7.2-K independently forbids
-- adopting any trail value until the 0.25/0.0625 vs 0.25/0.03125 identity is
-- explained; nothing here relaxes that.

-- ------------------------------------------------------------ experiment kind
-- A rescore run is not a parameter sweep and must not be read as one: it walks
-- the same candidates twice under two plans rather than searching a grid. The
-- default keeps every existing row meaning exactly what it meant.
alter table public.experiments
  add column if not exists kind text not null default 'sweep';

do $$
begin
  alter table public.experiments
    add constraint experiments_kind_check
    check (kind in ('sweep', 'rescore'));
exception
  when duplicate_object then null;
end
$$;

comment on column public.experiments.kind is
  'sweep = searches a parameter grid. rescore = replays the same candidates under a fixed alternative plan. A rescore is not a search and its result may not be reported as one.';

-- ---------------------------------------------------------- candidate identity
-- The key has to be generated rather than supplied, because the whole guarantee
-- below rests on the baseline writer and the variant writer producing byte-
-- identical keys for the same opportunity; if they can disagree about format,
-- the unique constraint stops catching duplicates and the exclusion accounting
-- silently breaks.
--
-- Postgres will only accept an immutable expression in a generated column, and
-- the obvious spelling -- to_char(...) inline -- is rejected, because to_char is
-- marked stable in general. It is nevertheless deterministic for *this* call:
-- the timezone is pinned with `at time zone 'UTC'` (itself immutable), DateStyle
-- does not affect an explicit to_char pattern, and lc_time affects only TM-
-- prefixed patterns, which this one does not use. So the marking below is a
-- statement of fact about this exact expression, not a wish.
--
-- Do not redefine this function. Generated columns are computed on write, so a
-- redefinition leaves already-stored keys on the old format and lets two rows
-- for the same opportunity coexist -- exactly the failure it prevents. If the
-- format must change, add a differently named function and rebuild the column.
create or replace function public.opportunity_candidate_key(
  symbol text, timeframe text, bar_opened_at timestamptz, rule_key text, direction text
) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select symbol || '|' || timeframe || '|'
      || to_char(bar_opened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      || '|' || rule_key || '|' || direction;
$$;

comment on function public.opportunity_candidate_key(text, text, timestamptz, text, text) is
  'Stable textual identity of one opportunity. Used by a generated column; never redefine it in place.';

-- ------------------------------------------------------ opportunity_results
create table if not exists public.opportunity_results (
  id      bigint generated always as identity primary key,
  run_id  uuid not null references public.experiments(id) on delete cascade,
  variant text not null,

  -- The identity of an *opportunity*, not of a trade. This is the whole point
  -- of the table. HANDOFF §5.18a found that when a candidate is present in one
  -- arm and absent from the other, the absence disappears silently and the
  -- comparison quietly becomes "the trades both arms agreed to take" -- which
  -- is precisely the set a plan change does not move. Keying on the candidate
  -- forces every absence to be written down as an exclusion instead.
  --
  -- Generated rather than supplied, so the baseline writer and the variant
  -- writer cannot disagree about formatting and defeat the unique constraint
  -- below by accident.
  symbol        text not null,
  timeframe     text not null,
  rule_key      text not null,
  direction     text not null check (direction in ('long', 'short')),
  bar_opened_at timestamptz not null,

  candidate_key text generated always as (
    public.opportunity_candidate_key(symbol, timeframe, bar_opened_at, rule_key, direction)
  ) stored,

  -- The resampling unit, frozen with the row. Same definition migrations 0012 /
  -- 0020 / 0023 / 0029 already use, and the one the evidence packet froze before
  -- any number was seen. Known limitation, stated here so a reader meets it
  -- rather than discovers it: this is the UTC calendar date, which is a real
  -- session boundary for BTCUSDT and only an approximation of one for CME
  -- futures, whose session runs 17:00-16:00 CT. Changing it means changing this
  -- one expression and re-running -- never adjusting it per instrument after
  -- seeing which choice reads better.
  session_day date generated always as ((bar_opened_at at time zone 'UTC')::date) stored,

  -- Nullable on purpose: a candidate can exist without a signal row ever having
  -- been written, and that case is exactly the one the table exists to record.
  signal_id uuid   references public.signals(id) on delete set null,
  bar_id    bigint references public.bars(id)    on delete set null,

  included         boolean not null,
  exclusion_reason text,

  -- The plan actually walked, snapshotted, so a later retune cannot rewrite the
  -- terms of a comparison that has already been read.
  entry_price         numeric(18,8),
  stop_price          numeric(18,8),
  target_price        numeric(18,8),
  risk_ticks          numeric(12,2),
  trail_trigger_ticks numeric(12,2),
  trail_offset_ticks  numeric(12,2),
  horizon_bars        integer,
  tick_size           numeric(18,8),

  -- Outcome, mirroring what 0031:179-196 writes for a live trade so the two can
  -- be diffed field by field.
  status text not null default 'pending'
           check (status in ('pending', 'resolved', 'expired', 'skipped')),
  exit_price     numeric(18,8),
  exit_reason    text check (exit_reason is null
                             or exit_reason in ('stop', 'target', 'trail', 'timeout')),
  exit_bar_id    bigint references public.bars(id) on delete set null,
  bars_used      integer,
  ambiguous_path boolean,
  pnl_ticks      numeric(12,2),

  -- Stored rather than derived. Every view in this repo currently recomputes
  -- pnl_ticks / risk_ticks, which means every view can disagree about what to
  -- do when risk_ticks is zero.
  r numeric(12,4),

  -- Censored at the exit bar, like the live columns, kept only so the two can be
  -- compared.
  mfe_ticks numeric(12,2),
  mae_ticks numeric(12,2),

  -- Measured to the full horizon regardless of when the trade exited. These are
  -- the columns whose absence made the shortcut above invalid: without them
  -- there is no way to ask what the trade gave up after it was stopped out of.
  mfe_horizon_ticks numeric(12,2),
  mae_horizon_ticks numeric(12,2),
  bars_to_mfe       integer,
  bars_to_mae       integer,
  horizon_bars_seen integer,

  -- public.bars is mutable: is_closed flips and 0001 installs an updated_at
  -- trigger. A result that does not say which code read which snapshot of the
  -- bars is not reproducible, so neither stamp is nullable.
  evaluator_version text not null,
  data_version      text not null,
  created_at        timestamptz not null default now(),

  -- An opportunity that was dropped must say why. Free text would turn the
  -- exclusion census into forty spellings of "no liquidity", so the vocabulary
  -- is closed; adding a reason takes a migration, which is the intended cost of
  -- introducing a new way for trades to vanish.
  constraint opportunity_results_exclusion_reason_check
    check (exclusion_reason is null or exclusion_reason in (
      'no_plan',              -- signal carried no entry/stop (0008 columns are nullable)
      'zero_risk',            -- risk_ticks null or <= 0, so R is undefined
      'no_tick_size',         -- instrument tick_size missing, so ticks are meaningless
      'insufficient_bars',    -- forward window not fully present at data_version
      'unclosed_bar',         -- window contains a bar with is_closed = false
      'outside_data_window'   -- candidate falls outside the frozen run window
    )),
  constraint opportunity_results_exclusion_stated
    check (included or exclusion_reason is not null),
  constraint opportunity_results_included_has_no_reason
    check (not included or exclusion_reason is null),
  -- An excluded candidate is part of the denominator and contributes no R. It
  -- must not be able to carry an outcome that some later view averages in.
  constraint opportunity_results_excluded_has_no_outcome
    check (included or (status = 'skipped'
                        and exit_price is null
                        and pnl_ticks is null
                        and r is null)),
  constraint opportunity_results_included_has_plan
    check (not included or (entry_price is not null
                            and stop_price is not null
                            and risk_ticks is not null
                            and horizon_bars is not null)),
  constraint opportunity_results_r_needs_risk
    check (r is null or (risk_ticks is not null and risk_ticks > 0)),

  -- One row per opportunity per arm. Without this a retry writes a second copy
  -- and the arm silently doubles its own denominator.
  unique (run_id, variant, candidate_key)
);

comment on table public.opportunity_results is
  'One row per opportunity per variant of a rescore run, including the opportunities a variant did not take. Never produces signals and cannot be announced. Its purpose is that a variant difference is read over a fixed denominator rather than over the trades both arms happened to agree on.';
comment on column public.opportunity_results.candidate_key is
  'symbol|timeframe|bar_opened_at(UTC)|rule_key|direction. Generated, so arms cannot disagree about its format.';
comment on column public.opportunity_results.included is
  'False means this arm did not take the opportunity. The row still counts in the denominator; that is what makes the comparison honest.';
comment on column public.opportunity_results.session_day is
  'UTC calendar date of the signal bar: the block-resampling unit, frozen with the row. An approximation of the CME session for futures.';
comment on column public.opportunity_results.mfe_horizon_ticks is
  'MFE measured over the whole horizon, not truncated at the exit bar. Absent from signal_outcomes, which is why the counterfactual could not be derived in SQL alone.';
comment on column public.opportunity_results.evaluator_version is
  'Which scorer produced the row, e.g. scorePlan@<sha>. Required: an unstamped result is not reproducible.';
comment on column public.opportunity_results.data_version is
  'Which snapshot of public.bars was read. Required, because public.bars is mutable.';

create index if not exists opportunity_results_block_idx
  on public.opportunity_results (run_id, symbol, session_day);
create index if not exists opportunity_results_candidate_idx
  on public.opportunity_results (run_id, candidate_key);
create index if not exists opportunity_results_signal_idx
  on public.opportunity_results (signal_id) where signal_id is not null;

alter table public.opportunity_results enable row level security;

-- Read-only for signed-in users, as with experiments in 0015. Rows are written
-- by the runner under the service role, which bypasses RLS. Guarded so the whole
-- migration stays re-runnable, matching the if-not-exists used above.
do $$
begin
  create policy "authenticated read opportunity_results"
    on public.opportunity_results for select to authenticated using (true);
exception
  when duplicate_object then null;
end
$$;

-- ------------------------------------------------------------- parity gate
-- The decisive check of the whole exercise, shipped as a view rather than left
-- as a query somebody remembers to run. If the baseline arm cannot reproduce
-- what actually happened, then neither arm's walk is trustworthy and the
-- no_trail number means nothing. The evidence packet froze this before the run:
-- on any mismatch the run is marked failed and no_trail must not be written.
--
-- This view returns ONLY mismatches. Empty is a pass. Non-empty voids the run.
create or replace view public.trail_counterfactual_parity
with (security_invoker = true) as
  select o.run_id,
         o.candidate_key,
         o.signal_id,
         o.exit_reason  as rescored_exit_reason,
         so.exit_reason as live_exit_reason,
         o.bars_used    as rescored_bars_used,
         so.bars_used   as live_bars_used,
         o.pnl_ticks    as rescored_pnl_ticks,
         so.pnl_ticks   as live_pnl_ticks
    from public.opportunity_results o
    join public.signal_outcomes so on so.signal_id = o.signal_id
   where o.variant = 'baseline'
     and o.included
     and so.status = 'resolved'
     and (o.exit_reason is distinct from so.exit_reason
          or o.bars_used is distinct from so.bars_used
          or abs(coalesce(o.pnl_ticks, 0) - coalesce(so.pnl_ticks, 0)) > 0.01);

comment on view public.trail_counterfactual_parity is
  'Rows where the baseline arm failed to reproduce the live outcome. Empty is a pass; any row voids the run and forbids writing or reporting the no_trail arm.';

-- --------------------------------------------------------- trail_counterfactual
-- Deliberately keeps session_day in the grain rather than collapsing to one
-- number per rule. The adoption criteria require that an improvement not be
-- carried by fewer than three distinct session_days (forbidden item 14), and a
-- view that has already summed across days cannot show that. R per *opportunity*
-- is reported alongside R per trade for the same reason: the two differ by
-- exactly the exclusions, and reading only the second is the bias this table
-- was built to prevent.
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
           count(*)::integer                              as opportunities,
           count(*) filter (where o.included)::integer     as taken,
           count(*) filter (where not o.included)::integer as not_taken,
           -- An opportunity not taken contributes 0 R, not null. Averaging over
           -- taken trades only would answer a different question.
           round(sum(coalesce(o.r, 0)), 4)                 as total_r,
           round(sum(coalesce(o.r, 0)) / nullif(count(*), 0), 4) as r_per_opportunity,
           round(avg(o.r) filter (where o.included), 4)    as r_per_trade,
           min(o.r) filter (where o.included)              as worst_r
      from public.opportunity_results o
     where o.status <> 'pending'
     group by 1, 2, 3, 4, 5, 6, 7
  )
  -- Full outer join, so a cell written for one arm and missing from the other is
  -- visible as a null rather than dropped from the comparison.
  select coalesce(b.run_id, v.run_id)             as run_id,
         coalesce(b.symbol, v.symbol)             as symbol,
         coalesce(b.timeframe, v.timeframe)       as timeframe,
         coalesce(b.rule_key, v.rule_key)         as rule_key,
         coalesce(b.direction, v.direction)       as direction,
         coalesce(b.session_day, v.session_day)   as session_day,
         b.opportunities       as baseline_opportunities,
         v.opportunities       as no_trail_opportunities,
         b.taken               as baseline_taken,
         v.taken               as no_trail_taken,
         b.not_taken           as baseline_not_taken,
         v.not_taken           as no_trail_not_taken,
         b.total_r             as baseline_total_r,
         v.total_r             as no_trail_total_r,
         b.r_per_opportunity   as baseline_r_per_opportunity,
         v.r_per_opportunity   as no_trail_r_per_opportunity,
         b.r_per_trade         as baseline_r_per_trade,
         v.r_per_trade         as no_trail_r_per_trade,
         b.worst_r             as baseline_worst_r,
         v.worst_r             as no_trail_worst_r,
         v.r_per_opportunity - b.r_per_opportunity as delta_r_per_opportunity,
         -- Both arms walk the same candidate set by construction, so a false
         -- here means a write was lost and the cell must not be read.
         (b.opportunities is not distinct from v.opportunities) as arms_agree_on_denominator
    from (select * from per_cell where variant = 'baseline') b
    full outer join
         (select * from per_cell where variant = 'no_trail') v
      on  v.run_id      = b.run_id
      and v.symbol      = b.symbol
      and v.timeframe   = b.timeframe
      and v.rule_key    = b.rule_key
      and v.direction   = b.direction
      and v.session_day = b.session_day;

comment on view public.trail_counterfactual is
  'Observed baseline vs no_trail difference per rule x direction x instrument x session_day. Reports differences only: it computes no standard error and no p-value, and per EXPERIMENT_REVIEW_PROTOCOL §5 nothing here may be called significant until the block bootstrap over (session_day, symbol) has been run.';

-- --------------------------------------------------------- confidence v2 cohort
-- The 15 shared features, one row per scored signal, wide.
--
-- Two rules are built into the shape rather than left to a reader's discipline.
-- First, every column a model may train on is prefixed f_; everything else --
-- muted, exit_reason, the outcome columns -- is not, so "select the features"
-- is a prefix match and cannot sweep up a label or a post-hoc field by accident.
-- Second, muted signals are present. Announced signals average 51.9 pnl_ticks
-- against 30.8 for muted ones, so training only on announced trades trains on
-- the trades a previous filter already liked. muted belongs in the model as a
-- stratifier for that selection, and never as a feature.
create or replace view public.confidence_v2_cohort
with (security_invoker = true) as
  select s.id                        as signal_id,
         i.symbol,
         s.timeframe,
         s.rule_key,
         s.direction,
         s.fired_at,
         (s.fired_at at time zone 'UTC')::date as session_day,
         s.payload->'confidenceV2'->>'modelVersion' as model_version,
         s.payload->'confidenceV2'->>'target'       as target,

         (c.shared->>'legacyScore')::numeric                 as f_legacy_score,
         (c.shared->>'barRange')::numeric                    as f_bar_range,
         (c.shared->>'bodyShare')::numeric                   as f_body_share,
         (c.shared->>'closeLocation')::numeric               as f_close_location,
         (c.shared->>'volume')::numeric                      as f_volume,
         (c.shared->>'volumeRatioToHistoryMedian')::numeric  as f_volume_ratio_to_history_median,
         (c.shared->>'ticks')::numeric                       as f_ticks,
         (c.shared->>'tickRatioToHistoryMedian')::numeric    as f_tick_ratio_to_history_median,
         (c.shared->>'rangeRatioToHistoryMedian')::numeric   as f_range_ratio_to_history_median,
         (c.shared->>'delta')::numeric                       as f_delta,
         (c.shared->>'absoluteDelta')::numeric               as f_absolute_delta,
         (c.shared->>'historyBars')::integer                 as f_history_bars,
         c.shared->>'priceActionSweep'                       as f_price_action_sweep,
         c.shared->>'priceActionZone'                        as f_price_action_zone,
         c.shared->>'priceActionStructure'                   as f_price_action_structure,

         -- Label and outcome. Not features.
         o.status,
         o.bars_used,
         o.pnl_ticks,
         round(o.pnl_ticks / nullif(s.risk_ticks, 0), 4) as r,
         case when o.status = 'resolved'
              then (o.pnl_ticks / nullif(s.risk_ticks, 0)) > 0 end as label_positive_r,

         -- Diagnostics and stratifiers. Not features, by the f_ convention above.
         -- exit_reason in particular is known only after the fact and would leak.
         s.muted,
         o.exit_reason,
         o.horizon_bars,
         o.ambiguous_path
    from public.signals s
    join public.instruments i on i.id = s.instrument_id
    join public.signal_outcomes o on o.signal_id = s.id
   cross join lateral (
      select s.payload->'confidenceV2'->'features'->'shared' as shared
   ) c
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow';

comment on view public.confidence_v2_cohort is
  'Shared confidence v2 features, wide, one row per scored signal, muted signals included. Columns prefixed f_ are the only ones a model may train on; muted is a stratifier and exit_reason is post-hoc. Frozen at signal time, so nothing here can see the future.';

-- ------------------------------------------------------- confidence v2 features
-- Long form, and the reason it carries a namespace: the shared block has a
-- feature called delta, and RULE_FEATURE_PATHS gives delta_divergence and
-- delta_flip a feature also called delta. Unqualified, the two would collide
-- into one column that means the bar's delta for six rules and the level's
-- delta for two.
--
-- Rule keys are stored verbatim, dots and all. In "level.delta" the dot is a
-- path into the signal payload, not a nesting of features; splitting on it
-- would invent a hierarchy that does not exist.
create or replace view public.confidence_v2_features
with (security_invoker = true) as
  select s.id        as signal_id,
         i.symbol,
         s.rule_key,
         s.direction,
         s.fired_at,
         b.feature_namespace,
         f.key       as feature_key,
         jsonb_typeof(f.value) as feature_type,
         case when jsonb_typeof(f.value) = 'number'
              then (f.value #>> '{}')::numeric end as value_num,
         case when jsonb_typeof(f.value) in ('string', 'boolean')
              then f.value #>> '{}' end            as value_text
    from public.signals s
    join public.instruments i on i.id = s.instrument_id
   cross join lateral (
      values ('shared', s.payload->'confidenceV2'->'features'->'shared'),
             ('rule',   s.payload->'confidenceV2'->'features'->'rule')
   ) as b(feature_namespace, block)
   cross join lateral jsonb_each(coalesce(b.block, '{}'::jsonb)) as f(key, value)
   where s.payload ? 'confidenceV2'
     and s.payload->'confidenceV2'->>'mode' = 'shadow';

comment on view public.confidence_v2_features is
  'Every confidence v2 feature in long form. feature_namespace separates shared from rule, which is required because delta exists in both. Keys keep their dots: level.delta is a payload path, not a nested feature.';
