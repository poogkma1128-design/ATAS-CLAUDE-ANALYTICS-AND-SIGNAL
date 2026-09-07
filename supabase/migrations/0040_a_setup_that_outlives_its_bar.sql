-- Somewhere for a pullback setup to wait.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────┐
-- │ APPLIED TO PRODUCTION 2026-09-07, ahead of the `ingest` deploy that writes to it.     │
-- │ Owner approved the change of scope the same day (L3, HANDOFF §0AE). This order is     │
-- │ deliberate: an empty table nothing writes to changes no behaviour, while deploying    │
-- │ `ingest` first would make every bar log a failed write against a table that is not    │
-- │ there. Until that deploy the table stays empty and the live rule keeps its single-bar │
-- │ scope. Verified after applying: RLS on, four indexes, and the privileges the grants    │
-- │ below describe — service_role may select/insert/update and may not delete.            │
-- │ Rollback is at the foot of this file.                                                 │
-- └──────────────────────────────────────────────────────────────────────────────────────┘
--
-- WHY
--
-- MNQ_PULLBACK_V1 allows a setup six bars to find its confirmation. The live rule could
-- use none of them: an Edge Function keeps nothing between invocations, so a setup that
-- opened on one bar was gone before the next one arrived, and only a confirmation landing
-- on the touch bar itself could ever be emitted.
--
-- That is not a small corner of the strategy. Measured over MNQU6 5m bars from 2026-08-28
-- to 2026-09-07, after the 0035 quarantine, with the same evaluator the live rule runs
-- (docs/experiments/2026-09-07-mnq-pullback-frequency-probe.md):
--
--   30   opportunities the six-bar contract opens
--    5   confirmed by a trigger
--    1   confirmed on the touch bar, and therefore emittable without this table
--
-- Widening the entry zone does not recover the other four. Tripling it (0.5 -> 1.5 median
-- true ranges) takes what the stateless rule can emit from 1 to 3 while the confirmations
-- it still cannot reach grow from 5 to 12. The missing piece is memory, not tolerance.
--
-- WHAT A ROW IS
--
-- One row is one setup: a named level was touched in the trend direction, and the strategy
-- is waiting to see whether order flow confirms it before it expires or is invalidated.
-- The columns are exactly the fields the evaluator already held in memory between bars
-- (PullbackOpenSetup in supabase/functions/_shared/strategy/pullback.ts). Nothing here is
-- computed by SQL: this table stores a decision the evaluator made and hands it back
-- unchanged, so the live path and a backtest cannot judge the same bar differently.
--
-- Resolved rows are kept rather than deleted. A confirmation becomes a row in
-- public.signals, but a rejection becomes nothing at all, and "the strategy saw fourteen
-- setups expire unconfirmed" is the number that says whether the trigger is too strict.
-- At roughly four setups a day the whole history is a rounding error against one day of
-- bars.

create table if not exists public.strategy_setups (
  id bigint generated always as identity primary key,

  -- Identity of the strategy and of the exact contract that opened the setup. The
  -- contract version is not decoration: a setup opened under one zone width must not be
  -- resumed under another, and the reader compares this before carrying a row forward.
  strategy_key text not null,
  contract_version text not null,

  instrument_id uuid not null references public.instruments(id) on delete cascade,
  timeframe text not null,

  -- The event. anchor_touch_id is the evaluator's own key for "this touch of this level",
  -- and is what a signal's payload carries, so a signal can be traced back to the setup
  -- it came from without a foreign key that would order the two writes.
  anchor_identity text not null,
  anchor_touch_id text not null,
  direction text not null check (direction in ('long', 'short')),
  anchor_price numeric not null,

  opened_at timestamptz not null,
  -- The last decision bar this setup was advanced over. The maximum of these across the
  -- open rows of one feed is the previous decision bar, which is how a gap in the feed is
  -- detected across a restart: without it a five-hour silence would look like the next bar.
  last_seen_at timestamptz not null,

  age_bars integer not null check (age_bars >= 1),
  touch_bars integer not null check (touch_bars >= 1),

  -- Why a setup ended matters as much as that it ended, and these four are what the
  -- evaluator distinguishes "the market declined to confirm" from "nothing could be
  -- measured" with. Storing them keeps that distinction alive across a restart.
  saw_evaluable_trigger boolean not null default false,
  saw_opposing_trigger boolean not null default false,
  saw_missing_bias boolean not null default false,
  saw_missing_volatility boolean not null default false,

  status text not null default 'open'
    check (status in ('open', 'triggered', 'rejected')),
  -- The evaluator's own reason string on a resolved row: expired_unfired,
  -- invalidated:closed_through_anchor, data_unavailable:footprint, and so on. Null while
  -- open, and never a summary invented here.
  outcome_reason text,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An open setup cannot know how it ended, and a resolved one cannot not know.
  constraint strategy_setups_resolution_is_complete check (
    (status = 'open' and outcome_reason is null and resolved_at is null) or
    (status <> 'open' and outcome_reason is not null and resolved_at is not null)
  ),
  constraint strategy_setups_last_seen_not_before_open check (last_seen_at >= opened_at)
);

-- One anchor holds at most one open setup. This is the same rule the evaluator enforces
-- in memory, restated where two concurrent ingest calls could otherwise both open one:
-- the second write fails rather than turning one event into two opportunities. Resolved
-- rows are exempt, so the same level can be touched again tomorrow.
create unique index if not exists strategy_setups_one_open_per_anchor
  on public.strategy_setups (strategy_key, instrument_id, timeframe, anchor_identity)
  where status = 'open';

-- The read on every ingest: the open setups of one feed.
create index if not exists strategy_setups_open_by_feed
  on public.strategy_setups (instrument_id, timeframe, strategy_key)
  where status = 'open';

-- Reporting reads resolved rows by when they ended.
create index if not exists strategy_setups_resolved_at
  on public.strategy_setups (resolved_at desc)
  where status <> 'open';

alter table public.strategy_setups enable row level security;

-- Same shape as every other table in 0002: the dashboard may read, and only the service
-- role that runs the Edge Functions may write. A setup is a decision record; a client that
-- could edit one could invent an opportunity that no bar produced.
drop policy if exists "authenticated read strategy_setups" on public.strategy_setups;
create policy "authenticated read strategy_setups"
  on public.strategy_setups for select to authenticated using (true);

-- Privileges, stated rather than inherited. The policy above decides which rows a role may
-- see; these decide whether it may reach the table at all, and 0037 sets the convention
-- that both are written down instead of left to whatever the platform grants by default.
--
-- service_role may update but not delete: a setup ends by being resolved, and a strategy
-- whose rejections can be removed cannot answer "how many setups expired unconfirmed",
-- which is the number that says whether the trigger is too strict.
revoke all on public.strategy_setups from public, anon, authenticated;
revoke all on sequence public.strategy_setups_id_seq from public, anon, authenticated;

grant select on public.strategy_setups to authenticated;
grant select, insert, update on public.strategy_setups to service_role;
grant usage, select on sequence public.strategy_setups_id_seq to service_role;

-- Named separately because Supabase grants service_role everything on public by default,
-- so a grant that lists only select/insert/update leaves DELETE in place and the sentence
-- above would be describing an intention rather than a state. Verified after applying:
-- has_table_privilege('service_role', 'public.strategy_setups', 'DELETE') is false.
revoke delete, truncate on public.strategy_setups from service_role;

comment on table public.strategy_setups is
  'Open and resolved setups for strategies that span more than one bar. Written only by '
  'the ingest Edge Function, from the evaluator in _shared/strategy/pullback.ts. See '
  'docs/experiments/2026-09-07-mnq-pullback-frequency-probe.md for why it exists.';

-- ROLLBACK
--
--   begin;
--   drop table if exists public.strategy_setups;
--   commit;
--
-- Nothing else references it: signals reach their setup through the anchor_touch_id in
-- their payload, deliberately, so dropping this table cannot cascade into signal history.
-- Redeploy ingest from before the matching change first, or every bar will log a failed
-- write against a table that is no longer there.
