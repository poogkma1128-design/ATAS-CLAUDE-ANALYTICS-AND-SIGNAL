-- H1 — trend as a filter, not a new rule. Result query.
--
-- Frozen plan: docs/HANDOFF.md §5.24 (definitions, the two policies, the five
-- failure criteria — none of that is repeated or restated here; this query
-- only implements what §5.24 already fixed before any outcome was read).
--
-- Read-only. Project sckdriuwfyittcybnbhz.
--
-- Two things this query enforces that the frozen plan implies but does not
-- spell out in SQL, both discovered while writing it:
--
--   1. session_day comes from bars.opened_at, not signals.fired_at, exactly
--      as §5.24 requires (citing the ingest-lag finding from the 0033
--      review). The join is signals -> bars via bar_id.
--   2. The population must be bounded to bars.opened_at >= 2026-08-28. Two
--      instruments (GC, MNQU6) carry 77 stray bars each dated back to
--      2026-04-15 — sparse, non-continuous, almost certainly leftover
--      seed/test data from before this project's "evidence-first" era. §5.24
--      itself documents the intended population as "6 session (28 ส.ค.–2
--      ก.ย.)"; the unbounded query pulls in 79 distinct calendar days
--      instead of 7, which is what surfaced the anomaly. This is a data
--      hygiene finding, not an H1 finding, and needs separate investigation
--      before anything else touches unbounded bars/signals history.

with h1_base as (
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
    -- §5.24 §ค: aligned = (up+long)|(down+short), counter = (up+short)|(down+long),
    -- range = structure='range', unknown = structure is null. Frozen, not tunable.
    case
      when (s.payload->'priceAction'->>'structure' = 'up'   and s.direction = 'long')
        or (s.payload->'priceAction'->>'structure' = 'down' and s.direction = 'short') then 'aligned'
      when (s.payload->'priceAction'->>'structure' = 'up'   and s.direction = 'short')
        or (s.payload->'priceAction'->>'structure' = 'down' and s.direction = 'long')  then 'counter'
      when s.payload->'priceAction'->>'structure' = 'range' then 'range'
      else 'unknown'
    end as label,
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
    r as r_a,                                          -- policy A: accept every signal
    case when label = 'aligned' then r else 0 end as r_b  -- policy B: accept only aligned, else 0
  from h1_base
  where r is not null
)

-- ------------------------------------------------------------------ Q1 MAIN
-- Criterion 1: total R of B vs A on the identical candidate set. This is the
-- estimand §5.24 froze — mean R per opportunity, not mean R per trade taken.
select
  count(*) as n_candidate,
  count(*) filter (where label = 'aligned') as n_aligned,
  round(sum(r_a)::numeric, 3)  as total_r_a,
  round(avg(r_a)::numeric, 4)  as mean_r_a_per_opportunity,
  round(sum(r_b)::numeric, 3)  as total_r_b,
  round(avg(r_b)::numeric, 4)  as mean_r_b_per_opportunity,
  round((sum(r_b) - sum(r_a))::numeric, 3) as delta_total_r
from scored;

-- --------------------------------------------------------------------- Q2
-- Diagnostic (not the estimand — §5.24 forbids using this comparison as the
-- decision criterion): mean R per trade actually taken, by label. Shows
-- where policy B's total-R loss comes from.
select label, count(*) as n,
  round(sum(r)::numeric, 2) as total_r,
  round(avg(r)::numeric, 4) as mean_r
from scored
group by label
order by total_r desc;

-- --------------------------------------------------------------------- Q3
-- Criterion 5 (H1-specific): is a counter-trend loss, if any, concentrated
-- in one rule (a reversal-natured rule doing what it's built to do) rather
-- than systemic? Per rule, per label.
select rule_key, label, count(*) as n,
  round(sum(r)::numeric, 2) as total_r,
  round(avg(r)::numeric, 4) as mean_r
from scored
group by rule_key, label
order by rule_key, label;

-- --------------------------------------------------------------------- Q4
-- Data hygiene check referenced in the header comment: confirms the 77-row
-- pre-August anomaly is real and isolated to GC/MNQU6, not a symptom present
-- across all instruments.
select i.symbol, count(*) as n, min(b.opened_at) as earliest, max(b.opened_at) as latest,
  count(*) filter (where b.opened_at < '2026-08-01') as pre_aug_rows
from public.bars b
join public.instruments i on i.id = b.instrument_id
where b.timeframe = '5m'
group by i.symbol
order by n desc;
