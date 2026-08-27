-- ATAS orderflow signal system :: core schema
-- Raw footprint data streamed from the ATAS indicator lands here.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- instruments
create table public.instruments (
  id         uuid primary key default gen_random_uuid(),
  symbol     text not null,
  exchange   text not null default '',
  tick_size  numeric(18,8) not null check (tick_size > 0),
  tick_value numeric(18,8),
  created_at timestamptz not null default now(),
  unique (symbol, exchange)
);

comment on table public.instruments is 'Traded instruments seen by the ATAS bridge. tick_size drives all tick-based statistics.';

-- ----------------------------------------------------------------------- bars
create table public.bars (
  id            bigserial primary key,
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  timeframe     text not null,
  opened_at     timestamptz not null,

  open  numeric(18,8) not null,
  high  numeric(18,8) not null,
  low   numeric(18,8) not null,
  close numeric(18,8) not null,

  volume     numeric(20,4) not null default 0,
  ask_volume numeric(20,4) not null default 0,
  bid_volume numeric(20,4) not null default 0,

  delta     numeric(20,4) not null default 0,
  min_delta numeric(20,4) not null default 0,
  max_delta numeric(20,4) not null default 0,
  cum_delta numeric(20,4),

  poc_price numeric(18,8),
  ticks     integer not null default 0,
  trades    integer not null default 0,

  is_closed  boolean not null default false,
  updated_at timestamptz not null default now(),

  unique (instrument_id, timeframe, opened_at)
);

comment on column public.bars.is_closed is 'False for the in-progress bar. Rules only ever evaluate closed bars.';

create index bars_lookup_idx on public.bars (instrument_id, timeframe, opened_at desc);
create index bars_closed_idx on public.bars (instrument_id, timeframe, opened_at) where is_closed;

-- -------------------------------------------------------------- cluster_levels
-- One row per price level of a bar's footprint. This is the heavy table.
create table public.cluster_levels (
  bar_id  bigint not null references public.bars(id) on delete cascade,
  price   numeric(18,8) not null,
  ask     numeric(20,4) not null default 0,
  bid     numeric(20,4) not null default 0,
  between numeric(20,4) not null default 0,
  volume  numeric(20,4) not null default 0,
  ticks   integer not null default 0,
  primary key (bar_id, price)
);

comment on column public.cluster_levels.ask is 'Volume traded at the ask (aggressive buyers) at this price.';
comment on column public.cluster_levels.bid is 'Volume traded at the bid (aggressive sellers) at this price.';

-- ---------------------------------------------------------------------- rules
-- Thresholds live in the database so they can be tuned without redeploying.
create table public.rules (
  key              text primary key,
  name             text not null,
  description      text,
  enabled          boolean not null default true,
  telegram_enabled boolean not null default true,
  horizon_bars     integer not null default 10 check (horizon_bars between 1 and 500),
  params           jsonb not null default '{}'::jsonb,
  updated_at       timestamptz not null default now()
);

comment on column public.rules.params is 'Rule-specific thresholds read at evaluation time. Editing this row changes behaviour immediately.';
comment on column public.rules.horizon_bars is 'How many closed bars after the signal to measure the outcome over.';

-- -------------------------------------------------------------------- signals
create table public.signals (
  id            uuid primary key default gen_random_uuid(),
  bar_id        bigint not null references public.bars(id) on delete cascade,
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  timeframe     text not null,
  rule_key      text not null references public.rules(key) on delete cascade,
  direction     text not null check (direction in ('long','short')),
  price         numeric(18,8) not null,
  confidence    numeric(4,3) not null default 0.5 check (confidence >= 0 and confidence <= 1),
  payload       jsonb not null default '{}'::jsonb,
  fired_at      timestamptz not null default now(),
  telegram_message_id bigint,

  -- Re-posting the same bar can never produce a duplicate alert.
  unique (bar_id, rule_key, direction)
);

comment on column public.signals.payload is 'Evidence for why the rule fired, so a signal can be audited months later.';

create index signals_recent_idx on public.signals (fired_at desc);
create index signals_rule_idx on public.signals (rule_key, direction);
create index signals_instrument_idx on public.signals (instrument_id, fired_at desc);

-- ------------------------------------------------------------- signal_outcomes
create table public.signal_outcomes (
  signal_id    uuid primary key references public.signals(id) on delete cascade,
  horizon_bars integer not null,
  status       text not null default 'pending' check (status in ('pending','resolved','expired')),
  mfe_ticks    numeric(12,2),
  mae_ticks    numeric(12,2),
  exit_price   numeric(18,8),
  pnl_ticks    numeric(12,2),
  bars_used    integer,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now()
);

comment on table public.signal_outcomes is 'Forward performance of each signal, measured from bars that arrive after it. No external price feed needed.';

create index signal_outcomes_pending_idx on public.signal_outcomes (status) where status = 'pending';

-- ------------------------------------------------------------------ ingest_log
create table public.ingest_log (
  id            bigserial primary key,
  received_at   timestamptz not null default now(),
  symbol        text,
  timeframe     text,
  bars_count    integer,
  levels_count  integer,
  signals_count integer,
  duration_ms   integer,
  error         text
);

create index ingest_log_recent_idx on public.ingest_log (received_at desc);

-- ------------------------------------------------------------ updated_at trigger
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger bars_touch_updated_at
  before update on public.bars
  for each row execute function public.touch_updated_at();

create trigger rules_touch_updated_at
  before update on public.rules
  for each row execute function public.touch_updated_at();

-- --------------------------------------------------------------------- realtime
-- The dashboard subscribes to this for the live feed.
alter publication supabase_realtime add table public.signals;
