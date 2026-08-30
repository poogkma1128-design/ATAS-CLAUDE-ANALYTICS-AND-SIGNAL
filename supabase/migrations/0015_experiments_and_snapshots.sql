-- Trying a change without letting it reach anyone, and being able to go back.
--
-- Two things were missing. Threshold changes could only be judged by running
-- them live, which means the phone rings for every experiment and a bad idea
-- costs real trades before it is recognised. And there was no record of which
-- settings had actually worked, so "put it back the way it was" depended on
-- someone remembering.
--
-- A backtest result is deliberately NOT a signal. It never touches
-- public.signals, so there is no path from an experiment to Telegram at all --
-- that is a property of the schema, not a flag anyone has to remember to set.

-- ------------------------------------------------------------ experiments

create table public.experiments (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  note        text,
  -- What was changed, against what. Both are whole params objects rather than
  -- diffs, so a result stays readable after the live settings move on.
  baseline    jsonb not null default '{}'::jsonb,
  variants    jsonb not null default '[]'::jsonb,
  -- Which data it was run over, so a result is never read as covering more
  -- than it did.
  symbols     text[] not null default '{}',
  bars_from   timestamptz,
  bars_to     timestamptz,
  status      text not null default 'running'
                check (status in ('running','done','failed')),
  error       text,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.experiments is
  'One backtest run: what was changed, over which data. Never produces signals — results live in experiment_results and cannot be announced.';

create table public.experiment_results (
  id            bigint generated always as identity primary key,
  experiment_id uuid not null references public.experiments(id) on delete cascade,
  -- 'baseline' for the settings currently live, otherwise the variant's label.
  variant       text not null,
  params        jsonb not null default '{}'::jsonb,
  symbol        text,
  rule_key      text,
  direction     text check (direction is null or direction in ('long','short')),
  trades        integer not null default 0,
  wins          integer not null default 0,
  win_rate      numeric(5,4),
  total_r       numeric(12,2),
  hit_target    integer not null default 0,
  hit_stop      integer not null default 0,
  hit_trail     integer not null default 0,
  timed_out     integer not null default 0,
  created_at    timestamptz not null default now()
);

create index experiment_results_experiment_idx
  on public.experiment_results (experiment_id, variant);

comment on table public.experiment_results is
  'Scored outcome of one variant. A row with symbol/rule_key/direction null is that variant''s total across everything it was run on.';

-- ------------------------------------------------------------- snapshots

-- Settings worth being able to return to.
--
-- Every experiment that gets adopted should be preceded by one of these, so
-- going back is a restore rather than an attempt to reconstruct what the
-- numbers used to be. `is_best_known` marks the arrangement with the best
-- evidence behind it so far, which is not always the one currently live.
create table public.rule_snapshots (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,
  note          text,
  -- {rule_key: params} for every rule at the moment it was taken.
  params        jsonb not null,
  -- What the evidence said when it was taken, for comparing later.
  measured_r    numeric(12,2),
  measured_win_rate numeric(5,4),
  measured_trades   integer,
  is_best_known boolean not null default false,
  taken_at      timestamptz not null default now()
);

comment on table public.rule_snapshots is
  'A full copy of every rule''s params, so any change can be undone exactly. is_best_known marks the arrangement with the strongest evidence, which may not be the live one.';

-- Only one arrangement can hold the title.
create unique index rule_snapshots_one_best
  on public.rule_snapshots (is_best_known) where is_best_known;

-- Takes a snapshot of every rule exactly as it stands.
create or replace function public.snapshot_rules(
  snapshot_label text,
  snapshot_note  text default null
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  insert into public.rule_snapshots (label, note, params)
  select snapshot_label,
         snapshot_note,
         jsonb_object_agg(r.key, r.params)
    from public.rules r
  returning id;
$$;

-- Puts every rule back to a snapshot. Rules added since are left alone rather
-- than deleted: a snapshot says what those rules were set to, not which rules
-- ought to exist.
create or replace function public.restore_rules(snapshot uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  saved   jsonb;
  changed integer := 0;
begin
  select params into saved from public.rule_snapshots where id = snapshot;
  if saved is null then
    raise exception 'no such snapshot: %', snapshot;
  end if;

  update public.rules r
     set params = saved -> r.key,
         updated_at = now()
   where saved ? r.key
     and r.params is distinct from (saved -> r.key);

  get diagnostics changed = row_count;
  return changed;
end;
$$;

alter table public.experiments        enable row level security;
alter table public.experiment_results enable row level security;
alter table public.rule_snapshots     enable row level security;

create policy "authenticated read experiments"
  on public.experiments for select to authenticated using (true);
create policy "authenticated read experiment_results"
  on public.experiment_results for select to authenticated using (true);
create policy "authenticated read rule_snapshots"
  on public.rule_snapshots for select to authenticated using (true);

-- Restoring is done from the dashboard, so a signed-in user may mark and
-- manage snapshots. Experiments are written by the runner using the service
-- role, which bypasses RLS.
create policy "authenticated write rule_snapshots"
  on public.rule_snapshots for all to authenticated using (true) with check (true);
