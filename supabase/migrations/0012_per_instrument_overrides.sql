-- Settings that can differ per instrument, and the evidence to decide them by.
--
-- A rule's row in public.rules applies to every chart at once. The recorded
-- outcomes say that is the wrong shape: the same rule earns money on one
-- instrument and loses it on another, in the same direction, over the same
-- days.
--
--     rule + direction        BTCUSDT                  MNQU6
--     poc_shift short         18 trades  67%  +9.41R   36 trades  31%  -9.09R
--     absorption long         34 trades  68% +26.10R   (1 trade)
--     absorption short        30 trades  27%  -9.57R   (1 trade)
--
-- poc_shift short is close to a mirror image of itself. One switch shared by
-- both instruments is guaranteed to be wrong for one of them.
--
-- Worse, public.setup_stats could not have shown this: it groups by rule and
-- direction only, so the two instruments were averaged into each other and the
-- mirror cancelled out. A view that cannot express the problem cannot be used
-- to find it, which is why setup_stats_by_instrument exists below.

-- ------------------------------------------------------------- overrides

create table public.rule_overrides (
  rule_key      text not null references public.rules(key) on delete cascade,
  instrument_id uuid not null references public.instruments(id) on delete cascade,
  timeframe     text not null,
  -- Direction is part of the key because the data says it matters as much as
  -- the instrument does: on BTCUSDT, absorption long is +26.10R and absorption
  -- short is -9.57R. 'any' is the fallback row for both directions.
  direction     text not null default 'any'
                  check (direction in ('any','long','short')),
  -- Muted, not disabled. A muted setup is still evaluated, still stored and
  -- still scored — it simply is not announced, so it is a trade not taken
  -- rather than a measurement not made. That is what lets a muted setup earn
  -- its way back: the statistics keep accruing while it is off.
  muted         boolean not null default false,
  -- Merged over rules.params for this instrument. Direction is ignored here:
  -- params are read while a rule is still deciding, before a direction exists.
  params        jsonb not null default '{}'::jsonb,
  note          text,
  updated_at    timestamptz not null default now(),
  primary key (rule_key, instrument_id, timeframe, direction)
);

comment on table public.rule_overrides is
  'Per-instrument settings layered over public.rules. Most specific row wins: (rule, instrument, timeframe, direction) then direction ''any'', then the rules row itself.';
comment on column public.rule_overrides.muted is
  'Do not announce this setup. It is still evaluated, stored and scored, so muting costs no data and can be reversed on evidence.';
comment on column public.rule_overrides.params is
  'Merged over rules.params for this instrument. Read before a direction exists, so it is not direction-specific.';

alter table public.rule_overrides enable row level security;

create policy "authenticated read rule_overrides"
  on public.rule_overrides for select to authenticated using (true);

-- Unlike public.rules, these rows may be created and dropped from the
-- dashboard: an override is only settings, and removing one just falls back to
-- the rule's own row. A rules row, by contrast, only means something if a
-- matching evaluator file is deployed.
create policy "authenticated write rule_overrides"
  on public.rule_overrides for all to authenticated using (true) with check (true);

-- Whether the signal was announced or was muted at the moment it fired.
-- Snapshotted so that muting a setup later cannot rewrite the history of
-- trades that were actually taken.
alter table public.signals
  add column if not exists muted boolean not null default false;

comment on column public.signals.muted is
  'True when a rule_overrides row muted this setup as it fired: recorded and scored, but never announced.';

create index if not exists signals_muted_idx on public.signals (muted) where muted;

-- --------------------------------------------------- per-instrument stats

drop view if exists public.setup_stats_by_instrument;

create view public.setup_stats_by_instrument
with (security_invoker = true) as
  select i.symbol,
         s.timeframe,
         s.rule_key,
         s.direction,
         count(*)::integer                                              as trades,
         round(avg(case when o.pnl_ticks > 0 then 1 else 0 end), 4)     as win_rate,
         round(sum(o.pnl_ticks / nullif(s.risk_ticks, 0)), 2)           as total_r,
         round(avg(o.pnl_ticks / nullif(s.risk_ticks, 0)), 3)           as avg_r,
         -- Live and muted are reported apart so that "what I traded" and "what
         -- I would have traded" never get added together by accident.
         count(*) filter (where not s.muted)::integer                   as trades_live,
         round(sum(o.pnl_ticks / nullif(s.risk_ticks, 0))
               filter (where not s.muted), 2)                           as total_r_live,
         count(*) filter (where s.muted)::integer                       as trades_muted,
         round(sum(o.pnl_ticks / nullif(s.risk_ticks, 0))
               filter (where s.muted), 2)                               as total_r_muted,
         count(*) filter (where o.exit_reason = 'target')::integer      as hit_target,
         count(*) filter (where o.exit_reason = 'stop')::integer        as hit_stop,
         count(*) filter (where o.exit_reason = 'trail')::integer       as hit_trail,
         count(*) filter (where o.exit_reason = 'timeout')::integer     as timed_out,
         max(s.fired_at)                                                as last_signal_at
    from public.signals s
    join public.instruments i      on i.id = s.instrument_id
    join public.signal_outcomes o  on o.signal_id = s.id
   where o.status = 'resolved'
   group by i.symbol, s.timeframe, s.rule_key, s.direction;

comment on view public.setup_stats_by_instrument is
  'Resolved-signal performance split by instrument, which public.setup_stats cannot show. Live and muted trades are reported separately.';

-- -------------------------------------------------------- stability gate

drop view if exists public.setup_stability;

-- Whether a cell has held up long enough to act on.
--
-- This exists because the first look at per-instrument numbers was tempting
-- and wrong. Over the only two sessions on record, MNQU6 stacked_imbalance
-- long ran 12 trades at 25% for -5.37R on one day and 9 trades at 89% for
-- +7.82R on the next: the same setup, opposite verdicts, back to back. Tuning
-- on the first day alone would have muted the setup that then paid best.
--
-- So a cell is only worth proposing a change for when it is big enough
-- (MIN_TRADES), has been seen on enough separate sessions (MIN_SESSIONS), and
-- those sessions mostly agree with each other (at most one dissenting). The
-- thresholds are deliberately conservative: the cost of waiting is a few days,
-- and the cost of acting early is muting a setup that works.
create view public.setup_stability
with (security_invoker = true) as
  with per_session as (
    select i.symbol,
           s.timeframe,
           s.rule_key,
           s.direction,
           (s.fired_at at time zone 'UTC')::date          as session_day,
           count(*)                                        as trades,
           sum(o.pnl_ticks / nullif(s.risk_ticks, 0))      as r
      from public.signals s
      join public.instruments i     on i.id = s.instrument_id
      join public.signal_outcomes o on o.signal_id = s.id
     where o.status = 'resolved'
     group by 1, 2, 3, 4, 5
  ),
  rolled as (
    select symbol, timeframe, rule_key, direction,
           sum(trades)::integer                     as trades,
           count(*)::integer                        as sessions,
           round(sum(r), 2)                         as total_r,
           count(*) filter (where r > 0)::integer   as sessions_up,
           count(*) filter (where r < 0)::integer   as sessions_down,
           round(min(r), 2)                         as worst_session_r,
           round(max(r), 2)                         as best_session_r
      from per_session
     group by 1, 2, 3, 4
  )
  select r.*,
         case
           when r.trades   < 30 then 'need more trades'
           when r.sessions <  3 then 'need more sessions'
           when r.total_r > 0 and r.sessions_up   < r.sessions - 1 then 'sessions disagree'
           when r.total_r < 0 and r.sessions_down < r.sessions - 1 then 'sessions disagree'
           else 'proposable'
         end                                                       as verdict,
         -- Only meaningful once verdict is 'proposable'. Stated as a proposal,
         -- never applied here: nothing in this migration mutes anything.
         case when r.total_r < 0 then 'mute' else 'keep' end       as proposal
    from rolled r;

comment on view public.setup_stability is
  'Per-cell evidence and whether it is strong enough to act on: >=30 trades, >=3 sessions, at most one session disagreeing with the total. Proposes only; muting stays a human decision.';
