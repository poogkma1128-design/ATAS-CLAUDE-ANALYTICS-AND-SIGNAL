-- H2 — false break (liquidity sweep, then reversal). Result query.
--
-- Frozen plan: docs/HANDOFF.md §5.25 (definitions, the two policies, the six
-- failure criteria, and the mandatory absorption-overlap gate that must run
-- BEFORE any R number — none of that is repeated here; this query only
-- implements what §5.25 already fixed before any outcome was read).
--
-- Read-only. Project sckdriuwfyittcybnbhz.
--
-- Same population fix as H1 (h1_trend_filter_result.sql): bounded to
-- bars.opened_at >= 2026-08-28 to exclude the 77-row-per-instrument stray
-- pre-April bars in GC/MNQU6 documented there. Same reasoning applies
-- verbatim; not repeated in full here.

with h2_base as (
  select
    s.id as signal_id,
    s.rule_key,
    s.direction,
    s.instrument_id,
    i.symbol,
    s.risk_ticks,
    o.pnl_ticks,
    (b.opened_at at time zone 'UTC')::date as session_day,
    b.opened_at,
    -- §5.25 §ค: reversal_sweep = (low+long)|(high+short) - the wick swept
    -- opposite the signal's own direction. continuation_sweep = the mirror
    -- case. no_sweep = sweep is null. Frozen, not tunable.
    case
      when (s.payload->'priceAction'->>'sweep' = 'low'  and s.direction = 'long')
        or (s.payload->'priceAction'->>'sweep' = 'high' and s.direction = 'short') then 'reversal_sweep'
      when (s.payload->'priceAction'->>'sweep' = 'low'  and s.direction = 'short')
        or (s.payload->'priceAction'->>'sweep' = 'high' and s.direction = 'long')  then 'continuation_sweep'
      else 'no_sweep'
    end as sweep_label,
    (o.pnl_ticks / nullif(s.risk_ticks, 0)) as r
  from public.signals s
  join public.signal_outcomes o on o.signal_id = s.id
  join public.bars b on b.id = s.bar_id
  join public.instruments i on i.id = s.instrument_id
  where o.status = 'resolved'
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
),
scored as (
  select *,
    r as r_a,                                                  -- policy A: accept every signal
    case when sweep_label = 'reversal_sweep' then r else 0 end as r_b  -- policy B: only reversal_sweep
  from h2_base
  where r is not null
)

-- --------------------------------------------------------------------- Q0
-- MANDATORY FIRST GATE (§5.25 §จ): if sweep and absorption overlap past 50%,
-- H2 is not measuring anything absorption doesn't already capture, and the
-- plan says stop here before computing a single R number. Measured both
-- directions since neither population is a subset of the other.
select
  count(*) filter (where sweep_label = 'reversal_sweep') as n_reversal_sweep,
  count(*) filter (where sweep_label = 'reversal_sweep' and rule_key = 'absorption') as reversal_and_absorption,
  round(100.0 * count(*) filter (where sweep_label = 'reversal_sweep' and rule_key = 'absorption')
        / nullif(count(*) filter (where sweep_label = 'reversal_sweep'), 0), 1) as pct_reversal_that_is_absorption,
  count(*) filter (where rule_key = 'absorption') as n_absorption_total,
  count(*) filter (where rule_key = 'absorption' and sweep_label = 'reversal_sweep') as absorption_and_reversal,
  round(100.0 * count(*) filter (where rule_key = 'absorption' and sweep_label = 'reversal_sweep')
        / nullif(count(*) filter (where rule_key = 'absorption'), 0), 1) as pct_absorption_that_is_reversal
from scored;

-- --------------------------------------------------------------------- Q1
-- Criterion 1: total R of B vs A on the identical candidate set, gated on Q0
-- passing. Estimand is mean R per opportunity, exactly as §5.25 froze it.
select
  count(*) as n_candidate,
  count(*) filter (where sweep_label = 'reversal_sweep') as n_reversal,
  count(distinct symbol) as instruments,
  count(distinct session_day) as sessions,
  round(sum(r_a)::numeric, 3) as total_r_a,
  round(avg(r_a)::numeric, 4) as mean_r_a_per_opportunity,
  round(sum(r_b)::numeric, 3) as total_r_b,
  round(avg(r_b)::numeric, 4) as mean_r_b_per_opportunity,
  round((sum(r_b) - sum(r_a))::numeric, 3) as delta_total_r
from scored;

-- --------------------------------------------------------------------- Q2
-- Diagnostic (not the estimand): mean R per trade actually taken, by sweep
-- label. Shows whether reversal_sweep trades are themselves weak, or whether
-- B's loss is purely a denominator effect as it was in H1.
select sweep_label, count(*) as n,
  round(sum(r)::numeric, 2) as total_r,
  round(avg(r)::numeric, 4) as mean_r
from scored
group by sweep_label
order by total_r desc;

-- --------------------------------------------------------------------- Q3
-- Criterion 6: is whatever total R policy B does collect concentrated in one
-- rule? Restricted to reversal_sweep trades only.
select rule_key, count(*) as n,
  round(sum(r)::numeric, 2) as total_r,
  round(avg(r)::numeric, 4) as mean_r
from scored
where sweep_label = 'reversal_sweep'
group by rule_key
order by total_r desc;
