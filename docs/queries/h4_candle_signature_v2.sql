-- H4 Mathematical Candle Signature — V2 measurement run
--
-- Companion to docs/experiments/2026-09-03-mathematical-candle-signature.md section ฐ.
-- Gate 0 (population counts, run before any of this) is in h4_candle_signature_gate0.sql.
--
-- Read-only. Project sckdriuwfyittcybnbhz. Recorded 2026-09-03.
--
-- Two things in here were NOT obvious from the frozen plan and decide the result, so
-- they are called out where they appear rather than buried in the SQL:
--
--   1. Bars must be STRICTLY adjacent (exactly 5 minutes apart). An earlier run of this
--      same query allowed <= 10 minutes, which silently admits one missing bar and turns
--      a two-bar move into a one-bar "gap". That inflated the largest observed
--      close -> next_open gap from 1.0R to 20.4R and changed every cell's numbers.
--   2. The baseline must be MATCHED on range expansion. 1R is the signal bar's range and
--      the condition selects large-range bars, so an all-bars baseline compares returns
--      measured against denominators that differ by ~2x. The matched baseline holds the
--      denominator regime fixed and isolates what body/close-location/volume add.
--
-- The window is pinned (opened_at < 2026-09-03 12:00Z) because bars keep arriving every
-- five minutes; without the pin this file returns a different answer every time it runs.
-- The out-of-sample window (2026-09-04 onward) is deliberately outside that pin.

-- ------------------------------------------------------------------ shared base
create temporary view h4_v2_base as
with b as (
  select b.instrument_id, i.symbol, b.opened_at, b.open, b.high, b.low, b.close, b.volume,
         row_number() over (partition by b.instrument_id order by b.opened_at) as rn
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.is_closed
    and b.opened_at < timestamptz '2026-09-03 12:00:00+00'
),
f as (
  select b.*,
         (b.high - b.low) as rng,
         case when b.high > b.low then (b.close - b.open) / (b.high - b.low) end as body_share,
         case when b.high > b.low then (b.close - b.low)  / (b.high - b.low) end as close_loc,
         m.med_range, m.med_vol, m.hi50, m.lo50,
         lead(b.open, 1) over w as e_open,
         lead(b.high, 1) over w as h1, lead(b.low, 1) over w as l1,
         lead(b.high, 2) over w as h2, lead(b.low, 2) over w as l2,
         lead(b.high, 3) over w as h3, lead(b.low, 3) over w as l3,
         lead(b.high, 4) over w as h4, lead(b.low, 4) over w as l4,
         lead(b.high, 5) over w as h5, lead(b.low, 5) over w as l5,
         lead(b.close, 5) over w as cc5,
         lead(b.opened_at, 1) over w as t1, lead(b.opened_at, 2) over w as t2,
         lead(b.opened_at, 3) over w as t3, lead(b.opened_at, 4) over w as t4,
         lead(b.opened_at, 5) over w as t5
  from b
  left join lateral (
    select percentile_cont(0.5) within group (order by (p.high - p.low)) as med_range,
           percentile_cont(0.5) within group (order by p.volume)         as med_vol,
           max(p.high) as hi50, min(p.low) as lo50
    from b p
    where p.instrument_id = b.instrument_id and p.rn between b.rn - 50 and b.rn - 1
  ) m on true
  -- lead() runs over the UNFILTERED bar set on purpose: filtering first (e.g. dropping
  -- zero-range bars, of which BTCUSDT has 24) would make lead() skip over the hole and
  -- silently pair a bar with the wrong successor.
  window w as (partition by b.instrument_id order by b.opened_at)
)
select *,
       (rng > 1.5 * med_range) as expanded,
       (rng > 1.5 * med_range and abs(body_share) > 0.6 and volume > 1.2 * med_vol) as strong,
       case when hi50 > lo50 then (close - lo50) / (hi50 - lo50) end as range_pos_50
from f
where med_range is not null and med_range > 0 and med_vol > 0 and rng > 0 and hi50 is not null
  -- point 1 above: strict adjacency, not a tolerance window
  and t1 = opened_at + interval '5 minutes'
  and t2 = t1 + interval '5 minutes'
  and t3 = t2 + interval '5 minutes'
  and t4 = t3 + interval '5 minutes'
  and t5 = t4 + interval '5 minutes'
  and e_open is not null and cc5 is not null;

-- --------------------------------------------------------------------- events
-- One row per (bar, direction, measurement origin). Both origins are always produced:
-- the plan requires reporting close-origin (what V1 did) beside next_open-origin, because
-- the difference between them IS the measurement-bias question V2 was built to answer.
create temporary view h4_v2_events as
select
  t.symbol,
  (t.opened_at at time zone 'UTC')::date as sess,
  d.dir,
  o.origin,
  t.rng,
  t.expanded,
  case when o.origin = 'next_open' then t.e_open else t.close end as entry,
  t.h1, t.l1, t.h2, t.l2, t.h3, t.l3, t.h4, t.l4, t.h5, t.l5, t.cc5,
  (t.strong and ((d.dir = 'long'  and t.close_loc > 0.8)
              or (d.dir = 'short' and t.close_loc < 0.2))) as is_cond,
  case when d.dir = 'long' then
         case when t.range_pos_50 > 0.8 then 'H2_extreme'
              when t.range_pos_50 between 0.2 and 0.8 then 'H1_mid'
              else 'opposite' end
       else
         case when t.range_pos_50 < 0.2 then 'H2_extreme'
              when t.range_pos_50 between 0.2 and 0.8 then 'H1_mid'
              else 'opposite' end
  end as ctx
from h4_v2_base t
cross join lateral (values ('long'), ('short')) d(dir)
cross join lateral (values ('next_open'), ('close')) o(origin);

-- ---------------------------------------------------------------- outcome walk
-- SL = entry -/+ 1.0R, TP = entry +/- 2.0R, walked bar by bar over t+1..t+5.
-- A bar holding both levels resolves as the STOP, following _shared/backtest.ts:204-209:
-- OHLC carries no intrabar ordering, and assuming the good fill inflates every statistic.
-- Unresolved positions are marked to the close of bar t+5.
create temporary view h4_v2_scored as
select e.*,
  coalesce(case when dir = 'long'
    then (case when l1 <= entry - rng then 1 when l2 <= entry - rng then 2 when l3 <= entry - rng then 3
               when l4 <= entry - rng then 4 when l5 <= entry - rng then 5 end)
    else (case when h1 >= entry + rng then 1 when h2 >= entry + rng then 2 when h3 >= entry + rng then 3
               when h4 >= entry + rng then 4 when h5 >= entry + rng then 5 end)
  end, 99) as k_stop,
  coalesce(case when dir = 'long'
    then (case when h1 >= entry + 2*rng then 1 when h2 >= entry + 2*rng then 2 when h3 >= entry + 2*rng then 3
               when h4 >= entry + 2*rng then 4 when h5 >= entry + 2*rng then 5 end)
    else (case when l1 <= entry - 2*rng then 1 when l2 <= entry - 2*rng then 2 when l3 <= entry - 2*rng then 3
               when l4 <= entry - 2*rng then 4 when l5 <= entry - 2*rng then 5 end)
  end, 99) as k_tp,
  case when dir = 'long' then (greatest(h1,h2,h3,h4,h5) - entry) / rng
                         else (entry - least(l1,l2,l3,l4,l5)) / rng end as mfe,
  case when dir = 'long' then (entry - least(l1,l2,l3,l4,l5)) / rng
                         else (greatest(h1,h2,h3,h4,h5) - entry) / rng end as mae,
  case when dir = 'long' then (cc5 - entry) / rng else (entry - cc5) / rng end as r_at_end
from h4_v2_events e;

-- --------------------------------------------------------------------- Q1 MAIN
-- The result the verdict rests on. cond vs MATCHED baseline (point 2 above); the all-bars
-- baseline the plan pre-registered is reported alongside so the confound stays visible
-- rather than being quietly corrected away.
with r as (
  select *, case when k_tp < 99 and k_tp < k_stop then 2.0
                 when k_stop < 99 and k_stop <= k_tp then -1.0
                 else r_at_end end as realized_r
  from h4_v2_scored where ctx in ('H1_mid','H2_extreme')
)
select dir, ctx, origin,
  count(*) filter (where is_cond)                                    as n_cond,
  round(avg(realized_r) filter (where is_cond)::numeric, 4)          as cond_r,
  round(stddev_samp(realized_r) filter (where is_cond)::numeric, 4)  as cond_sd,
  count(*) filter (where not is_cond and expanded)                   as n_matched,
  round(avg(realized_r) filter (where not is_cond and expanded)::numeric, 4)         as matched_r,
  round(stddev_samp(realized_r) filter (where not is_cond and expanded)::numeric, 4) as matched_sd,
  round((avg(realized_r) filter (where is_cond)
       - avg(realized_r) filter (where not is_cond and expanded))::numeric, 4)       as diff_vs_matched,
  round(avg(realized_r) filter (where not is_cond)::numeric, 4)      as allbars_r,
  -- the confound, stated as a number: mean 1R size in each arm
  round(avg(rng) filter (where is_cond)::numeric, 2)                 as cond_R_size,
  round(avg(rng) filter (where not is_cond)::numeric, 2)             as allbars_R_size,
  round(100.0 * avg(case when k_stop < 99 and k_stop = k_tp then 1 else 0 end)
        filter (where is_cond), 2)                                   as ambiguous_pct
from r
group by 1,2,3
order by dir, ctx, origin;

-- --------------------------------------------------------------------- Q2 SIGN
-- Criterion 2: per-instrument agreement. Cells hold 8-33 candidates, far too few to
-- estimate from, so only the SIGN of each instrument's difference is read.
with r as (
  select *, case when k_tp < 99 and k_tp < k_stop then 2.0
                 when k_stop < 99 and k_stop <= k_tp then -1.0
                 else r_at_end end as realized_r
  from h4_v2_scored where ctx in ('H1_mid','H2_extreme') and origin = 'next_open'
)
select dir, ctx, symbol,
  count(*) filter (where is_cond) as n_cond,
  round((avg(realized_r) filter (where is_cond)
       - avg(realized_r) filter (where not is_cond and expanded))::numeric, 4) as diff_vs_matched,
  case when avg(realized_r) filter (where is_cond)
          > avg(realized_r) filter (where not is_cond and expanded) then '+' else '-' end as sign
from r
group by 1,2,3
order by dir, ctx, symbol;

-- ------------------------------------------------------------------ Q3 SESSION
-- Criterion 3: leave-one-session-out. An effect that disappears when one of six sessions
-- is removed is that session, not an effect.
with r as (
  select *, case when k_tp < 99 and k_tp < k_stop then 2.0
                 when k_stop < 99 and k_stop <= k_tp then -1.0
                 else r_at_end end as realized_r
  from h4_v2_scored where ctx in ('H1_mid','H2_extreme') and origin = 'next_open'
),
sessions as (select distinct sess from r)
select r.dir, r.ctx, s.sess as dropped_session,
  count(*) filter (where r.is_cond and r.sess <> s.sess) as n_cond_left,
  round((avg(r.realized_r) filter (where r.is_cond and r.sess <> s.sess)
       - avg(r.realized_r) filter (where not r.is_cond and r.expanded and r.sess <> s.sess))::numeric, 4)
    as diff_without_session
from r cross join sessions s
group by r.dir, r.ctx, s.sess
order by r.dir, r.ctx, diff_without_session;

-- ----------------------------------------------------------------- Q4 BAR JOIN
-- Not part of the 12 tests. Data hygiene: in a continuously traded market the next bar's
-- open should equal this bar's close. BTCUSDT manages that 73.9% of the time; the three
-- futures manage 25-32%. Nothing here exceeds 1R, so it is an open question rather than a
-- proven defect - but "enter at next_open" rests on this field, so it must be settled
-- against ATAS before another experiment leans on it.
select symbol,
  count(*) as n_strictly_adjacent,
  count(*) filter (where next_open = close) as exact_continuous,
  round(100.0 * count(*) filter (where next_open = close) / count(*), 1) as pct_exact,
  round(avg(abs(next_open - close) / nullif(rng, 0))::numeric, 4) as avg_abs_gap_R,
  round(max(abs(next_open - close) / nullif(rng, 0))::numeric, 2) as max_abs_gap_R
from (
  select i.symbol, b.close, (b.high - b.low) as rng,
         lead(b.open, 1) over w as next_open,
         b.opened_at, lead(b.opened_at, 1) over w as t1
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.is_closed
    and b.opened_at < timestamptz '2026-09-03 12:00:00+00'
  window w as (partition by b.instrument_id order by b.opened_at)
) x
where t1 = opened_at + interval '5 minutes' and next_open is not null and rng > 0
group by symbol
order by symbol;
