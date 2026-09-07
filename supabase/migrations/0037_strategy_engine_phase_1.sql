-- Phase 1 of the strategy engine: immutable session definitions and causal
-- context storage. This migration does not seed a session calendar, compute a
-- score, alter a rule, create a signal, or touch Telegram. The migration stays
-- unapplied until the 0033-0036 queue and this contract pass independent review.

create or replace function public.valid_market_session_windows(candidate jsonb)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  item jsonb;
  session_key text;
  start_minute numeric;
  end_minute numeric;
  seen_keys text[] := array[]::text[];
begin
  if candidate is null or pg_catalog.jsonb_typeof(candidate) <> 'array' then
    return false;
  end if;

  for item in
    select value from pg_catalog.jsonb_array_elements(candidate) as element(value)
  loop
    if pg_catalog.jsonb_typeof(item) is distinct from 'object'
       or pg_catalog.jsonb_typeof(item -> 'key') is distinct from 'string'
       or pg_catalog.btrim(item ->> 'key') is null
       or pg_catalog.btrim(item ->> 'key') = ''
       or pg_catalog.jsonb_typeof(item -> 'timeZone') is distinct from 'string'
       or pg_catalog.btrim(item ->> 'timeZone') is null
       or pg_catalog.btrim(item ->> 'timeZone') = ''
       or pg_catalog.jsonb_typeof(item -> 'startMinute') is distinct from 'number'
       or pg_catalog.jsonb_typeof(item -> 'endMinute') is distinct from 'number' then
      return false;
    end if;

    begin
      start_minute := (item ->> 'startMinute')::numeric;
      end_minute := (item ->> 'endMinute')::numeric;
    exception when others then
      return false;
    end;

    if start_minute <> pg_catalog.trunc(start_minute)
       or end_minute <> pg_catalog.trunc(end_minute)
       or start_minute not between 0 and 1439
       or end_minute not between 0 and 1439
       or start_minute = end_minute then
      return false;
    end if;

    session_key := pg_catalog.btrim(item ->> 'key');
    if session_key = any(seen_keys) then
      return false;
    end if;
    seen_keys := pg_catalog.array_append(seen_keys, session_key);
  end loop;

  return true;
end;
$$;

create table public.market_session_definitions (
  id uuid primary key default gen_random_uuid(),
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  version text not null check (btrim(version) <> ''),
  trading_day_timezone text not null check (btrim(trading_day_timezone) <> ''),
  trading_day_rollover_minute smallint not null
    check (trading_day_rollover_minute between 0 and 1439),
  windows jsonb not null check (public.valid_market_session_windows(windows)),
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  created_at timestamptz not null default now(),
  unique (instrument_id, version)
);

comment on table public.market_session_definitions is
  'Versioned trading-day and per-window time-zone contract. Rows start draft; no production session times are seeded by Phase 1.';
comment on column public.market_session_definitions.trading_day_timezone is
  'IANA time zone used only to derive trading_day and apply the rollover minute.';
comment on column public.market_session_definitions.windows is
  'Ordered JSON array of {key,timeZone,startMinute,endMinute}; each window owns its IANA time zone and overlapping tags are intentional.';

create unique index market_session_definitions_one_active_idx
  on public.market_session_definitions (instrument_id)
  where status = 'active';

create or replace function public.guard_market_session_definition()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  item jsonb;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'active or retired session definitions are immutable';
    end if;
    return old;
  end if;

  -- PostgreSQL validates the IANA identifiers here; the structural JSON shape
  -- is enforced separately by valid_market_session_windows().
  perform pg_catalog.timezone(new.trading_day_timezone, pg_catalog.now());
  for item in
    select value from pg_catalog.jsonb_array_elements(new.windows) as element(value)
  loop
    perform pg_catalog.timezone(item ->> 'timeZone', pg_catalog.now());
  end loop;

  if tg_op = 'INSERT' then
    return new;
  end if;

  if old.status <> 'draft' and (
    new.instrument_id is distinct from old.instrument_id
    or new.version is distinct from old.version
    or new.trading_day_timezone is distinct from old.trading_day_timezone
    or new.trading_day_rollover_minute is distinct from old.trading_day_rollover_minute
    or new.windows is distinct from old.windows
    or new.created_at is distinct from old.created_at
    or new.status not in (old.status, 'retired')
  ) then
    raise exception 'active or retired session definitions are immutable';
  end if;
  return new;
end;
$$;

create trigger market_session_definitions_guard
  before insert or update or delete on public.market_session_definitions
  for each row execute function public.guard_market_session_definition();

revoke all on function public.guard_market_session_definition() from public, anon, authenticated;
revoke all on function public.valid_market_session_windows(jsonb) from public, anon, authenticated;

alter table public.bars
  add column if not exists trading_day date,
  add column if not exists session_definition_id uuid
    references public.market_session_definitions(id) on delete set null,
  add column if not exists session_tags text[],
  add column if not exists market_context jsonb,
  add column if not exists market_context_version text;

alter table public.bars
  add constraint bars_market_context_versioned
  check ((market_context is null) = (market_context_version is null));

comment on column public.bars.trading_day is
  'Trading date from the frozen definition-level time zone and rollover, not a UTC calendar date.';
comment on column public.bars.session_tags is
  'All matching window-local sessions. Multiple tags are allowed because windows may overlap.';
comment on column public.bars.market_context is
  'Causal Phase 1 context computed using bars closed at or before this bar close.';
comment on column public.bars.market_context_version is
  'Implementation/config version that produced market_context; null means context has not been computed.';

create index if not exists bars_trading_day_idx
  on public.bars (instrument_id, timeframe, trading_day, opened_at)
  where trading_day is not null;

create table public.key_levels (
  id bigint generated always as identity primary key,
  bar_id bigint not null references public.bars(id) on delete cascade,
  session_definition_id uuid not null
    references public.market_session_definitions(id) on delete restrict,
  engine_version text not null check (btrim(engine_version) <> ''),
  trading_day date not null,
  profile_session_tag text not null check (btrim(profile_session_tag) <> ''),
  vwap numeric(18,8),
  vah numeric(18,8),
  val numeric(18,8),
  session_poc numeric(18,8),
  previous_day_high numeric(18,8),
  previous_day_low numeric(18,8),
  session_high numeric(18,8),
  session_low numeric(18,8),
  initial_balance_high numeric(18,8),
  initial_balance_low numeric(18,8),
  profile_status text not null
    check (profile_status in (
      'complete', 'no_session_bars', 'missing_footprint',
      'invalid_footprint_levels', 'footprint_tick_mismatch', 'zero_volume'
    )),
  diagnostics jsonb not null default '{}'::jsonb,
  computed_at timestamptz not null default now(),
  unique (bar_id, session_definition_id, engine_version),
  constraint key_levels_profile_complete
    check (
      (profile_status = 'complete'
       and vwap is not null and vah is not null and val is not null and session_poc is not null)
      or
      (profile_status <> 'complete'
       and vwap is null and vah is null and val is null and session_poc is null)
    ),
  constraint key_levels_value_area_order check (val is null or val <= session_poc),
  constraint key_levels_value_area_order_2 check (vah is null or session_poc <= vah),
  constraint key_levels_previous_day_order
    check ((previous_day_high is null and previous_day_low is null)
           or previous_day_high >= previous_day_low),
  constraint key_levels_session_order
    check ((session_high is null and session_low is null) or session_high >= session_low),
  constraint key_levels_initial_balance_order
    check ((initial_balance_high is null and initial_balance_low is null)
           or initial_balance_high >= initial_balance_low),
  constraint key_levels_diagnostics_object check (jsonb_typeof(diagnostics) = 'object')
);

comment on table public.key_levels is
  'Point-in-time Phase 1 levels. Each row is bound to the decision bar, session contract, and engine version.';
comment on column public.key_levels.profile_status is
  'Fail-closed profile quality. VWAP/VAH/VAL/POC are null unless status is complete.';

create index key_levels_trading_day_idx
  on public.key_levels (session_definition_id, trading_day, bar_id);

alter table public.market_session_definitions enable row level security;
alter table public.key_levels enable row level security;

create policy "authenticated read market_session_definitions"
  on public.market_session_definitions for select to authenticated using (true);
create policy "authenticated read key_levels"
  on public.key_levels for select to authenticated using (true);

revoke all on public.market_session_definitions from public, anon, authenticated;
revoke all on public.key_levels from public, anon, authenticated;
revoke all on sequence public.key_levels_id_seq from public, anon, authenticated;

grant select on public.market_session_definitions to authenticated;
grant select on public.key_levels to authenticated;

grant select, insert, update, delete on public.market_session_definitions to service_role;
grant select, insert on public.key_levels to service_role;
grant usage, select on sequence public.key_levels_id_seq to service_role;
grant execute on function public.valid_market_session_windows(jsonb) to service_role;
