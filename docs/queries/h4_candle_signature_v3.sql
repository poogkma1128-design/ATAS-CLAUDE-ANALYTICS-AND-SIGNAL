-- H4 Mathematical Candle Signature — V3 measurement run
--
-- Companion to docs/experiments/2026-09-03-candle-signature-v3.md section ญ.
-- V2's queries are in h4_candle_signature_v2.sql; Gate 0 in h4_candle_signature_gate0.sql.
--
-- Read-only. Project sckdriuwfyittcybnbhz. Recorded 2026-09-03.
--
-- Three things carry over from V2 as hard requirements rather than choices:
--
--   1. STRICT adjacency. Every bar in the horizon must sit exactly five minutes after the
--      last. V2 first ran with a ten-minute tolerance, which admits a missing bar and folds
--      two bars of travel into one; it inflated the largest close-to-open gap from 1.0R to
--      20.4R and moved every cell.
--   2. MATCHED baselines. 1R is the signal bar's range and the condition selects large-range
--      bars, so an all-bars baseline divides the two arms by denominators differing about
--      twofold. V3 goes further than V2 and matches on instrument, session, volatility
--      tercile and regime, comparing each candidate against its own stratum.
--   3. A PINNED window. Bars arrive every five minutes; without the pin this file answers a
--      different question each run. The out-of-sample window (2026-09-04 onward) sits
--      outside the pin deliberately and must stay unread until V4.
--
-- The horizon is carried as a column rather than four near-copies of the same query, and
-- the forward bars travel as arrays so that "the bar holding the extreme" is an argmax
-- instead of a ten-branch CASE.

-- ------------------------------------------------------------------ shared base
create temporary view v3_base as
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
    m.med_range, m.med_vol, m.hi50, m.lo50, m.close50,
    lead(b.open, 1) over w as e_open,
    array[lead(b.high,1) over w, lead(b.high,2) over w, lead(b.high,3) over w, lead(b.high,4) over w, lead(b.high,5) over w,
          lead(b.high,6) over w, lead(b.high,7) over w, lead(b.high,8) over w, lead(b.high,9) over w, lead(b.high,10) over w] as highs,
    array[lead(b.low,1) over w, lead(b.low,2) over w, lead(b.low,3) over w, lead(b.low,4) over w, lead(b.low,5) over w,
          lead(b.low,6) over w, lead(b.low,7) over w, lead(b.low,8) over w, lead(b.low,9) over w, lead(b.low,10) over w] as lows,
    array[lead(b.close,1) over w, lead(b.close,2) over w, lead(b.close,3) over w, lead(b.close,4) over w, lead(b.close,5) over w,
          lead(b.close,6) over w, lead(b.close,7) over w, lead(b.close,8) over w, lead(b.close,9) over w, lead(b.close,10) over w] as closes,
    array[lead(b.opened_at,1) over w, lead(b.opened_at,2) over w, lead(b.opened_at,3) over w, lead(b.opened_at,4) over w, lead(b.opened_at,5) over w,
          lead(b.opened_at,6) over w, lead(b.opened_at,7) over w, lead(b.opened_at,8) over w, lead(b.opened_at,9) over w, lead(b.opened_at,10) over w] as times
  from b
  left join lateral (
    select percentile_cont(0.5) within group (order by (p.high - p.low)) as med_range,
           percentile_cont(0.5) within group (order by p.volume)         as med_vol,
           max(p.high) as hi50, min(p.low) as lo50,
           min(p.close) filter (where p.rn = b.rn - 50) as close50
    from b p
    where p.instrument_id = b.instrument_id and p.rn between b.rn - 50 and b.rn - 1
  ) m on true
  -- lead() spans the unfiltered bar set: filtering first would let it skip a hole and pair
  -- a bar with the wrong successor.
  window w as (partition by b.instrument_id order by b.opened_at)
)
select *,
  (opened_at at time zone 'UTC')::date as sess,
  (rng > 1.5 * med_range) as expanded,
  (rng > 1.5 * med_range and abs(body_share) > 0.6 and volume > 1.2 * med_vol) as strong,
  -- six-way label recorded for V4/V5 to reuse; V3 never significance-tests it
  case when close > hi50 then 'breakout_up'
       when close < lo50 then 'breakout_down'
       when high  > hi50 then 'sweep_high'
       when low   < lo50 then 'sweep_low'
       when abs(close - close50) / nullif(hi50 - lo50, 0) > 0.5 then 'trend'
       else 'range' end as regime6,
  case when close > hi50 or close < lo50 or high > hi50 or low < lo50
         or abs(close - close50) / nullif(hi50 - lo50, 0) > 0.5
       then 'directional' else 'range' end as regime2,
  ntile(3) over (partition by instrument_id order by rng / nullif(med_range, 0)) as vol_tercile
from f
where med_range is not null and med_range > 0 and med_vol > 0 and rng > 0
  and hi50 is not null and close50 is not null and e_open is not null;

-- ----------------------------------------------------------------- outcome walk
-- SL at -1.0R, TP at +2.0R, walked over t+1..t+h. A bar holding both resolves as the STOP,
-- per _shared/backtest.ts:204-209 - OHLC carries no intrabar ordering, and assuming the
-- good fill inflates every statistic. k_fav and k_adv are the bar indices of the extremes,
-- which is what makes mae_before_mfe answerable.
create temporary view v3_scored as
select t.instrument_id, t.symbol, t.sess, t.vol_tercile, t.regime2, t.regime6,
  t.rng, t.e_open as entry, d.dir, hz.h, t.strong, t.expanded,
  (t.strong and ((d.dir = 'long'  and t.close_loc > 0.8)
              or (d.dir = 'short' and t.close_loc < 0.2))) as is_cond,
  w.contig, w.mx, w.mn, w.k_fav, w.k_adv, w.k_stop, w.k_tp,
  t.closes[hz.h] as c_end
from v3_base t
cross join lateral (values ('long'), ('short')) d(dir)
cross join lateral (values (1), (3), (5), (10)) hz(h)
cross join lateral (
  select bool_and(tm is not null and tm = t.opened_at + (idx * interval '5 minutes')) as contig,
         max(hi) as mx, min(lo) as mn,
         (array_agg(idx order by case when d.dir = 'long' then hi else -lo end desc, idx))[1] as k_fav,
         (array_agg(idx order by case when d.dir = 'long' then lo else -hi end asc,  idx))[1] as k_adv,
         coalesce(min(idx) filter (where case when d.dir = 'long' then lo <= t.e_open - t.rng
                                                                  else hi >= t.e_open + t.rng end), 99) as k_stop,
         coalesce(min(idx) filter (where case when d.dir = 'long' then hi >= t.e_open + 2*t.rng
                                                                  else lo <= t.e_open - 2*t.rng end), 99) as k_tp
  from unnest(t.highs, t.lows, t.times) with ordinality as u(hi, lo, tm, idx)
  where idx <= hz.h
) w;

create temporary view v3_metrics as
select *,
  case when dir = 'long' then (mx - entry) / rng else (entry - mn) / rng end as mfe,
  case when dir = 'long' then (entry - mn) / rng else (mx - entry) / rng end as mae,
  -- NOTE: at h=1 this is false by construction - one bar holds both extremes, so k_adv =
  -- k_fav always. The h=1 row of this column is not a result and must not be read as one.
  (k_adv < k_fav) as mae_before_mfe,
  case when k_tp < 99 and k_tp < k_stop then 2.0
       when k_stop < 99 and k_stop <= k_tp then -1.0
       else case when dir = 'long' then (c_end - entry) / rng else (entry - c_end) / rng end
  end as realized_r,
  (k_stop < 99 and k_stop = k_tp) as ambiguous
from v3_scored
where contig and c_end is not null;

-- --------------------------------------------------------------------- Q1 MAIN
-- The 16 pre-registered cells. Each candidate is compared against the mean of its OWN
-- stratum, so the reported delta is a stratified estimate rather than a pooled difference.
-- n_unmatched counts candidates whose stratum holds no partner: two of them, reported
-- rather than dropped silently.
with pool as (
  select instrument_id, sess, vol_tercile, regime2, dir, h,
         avg(realized_r) as base_r, avg(mfe) as base_mfe, avg(mae) as base_mae,
         avg(case when mae_before_mfe then 1.0 else 0 end) as base_maefirst,
         count(*) as n_partners
  from v3_metrics
  where expanded and not strong
  group by 1,2,3,4,5,6
),
joined as (
  select c.*, p.base_r, p.base_mfe, p.base_mae, p.base_maefirst
  from v3_metrics c
  left join pool p using (instrument_id, sess, vol_tercile, regime2, dir, h)
  where c.is_cond
)
select dir, regime2 as regime, h,
  count(*) as n_cond_total,
  count(*) filter (where base_r is null) as n_unmatched,
  count(*) filter (where base_r is not null) as n_used,
  round(avg(realized_r - base_r) filter (where base_r is not null)::numeric, 4) as delta_r,
  round((stddev_samp(realized_r - base_r) filter (where base_r is not null)
        / sqrt(count(*) filter (where base_r is not null)))::numeric, 4) as se,
  round(avg(mfe - base_mfe) filter (where base_r is not null)::numeric, 4) as delta_mfe,
  round(avg(mae - base_mae) filter (where base_r is not null)::numeric, 4) as delta_mae,
  round((100.0 * avg(case when mae_before_mfe then 1.0 else 0 end)
         filter (where base_r is not null))::numeric, 1) as cond_mae_first_pct,
  round((100.0 * avg(base_maefirst) filter (where base_r is not null))::numeric, 1) as base_mae_first_pct,
  round((100.0 * avg(case when ambiguous then 1.0 else 0 end))::numeric, 2) as ambiguous_pct
from joined
group by 1,2,3
order by dir, regime, h;

-- ---------------------------------------------------------------- Q2 QUANTILES
-- The question the owner actually asked is about distributions, not means. This is the
-- query that answers it: in the range regime the adverse tail (MAE p90) collapses while
-- the favourable tail barely moves.
select dir, regime2 as regime, h,
  case when is_cond then 'COND' else 'matched' end as grp,
  count(*) as n,
  round(percentile_cont(0.10) within group (order by mfe)::numeric, 3) as mfe_p10,
  round(percentile_cont(0.50) within group (order by mfe)::numeric, 3) as mfe_p50,
  round(percentile_cont(0.90) within group (order by mfe)::numeric, 3) as mfe_p90,
  round(percentile_cont(0.10) within group (order by mae)::numeric, 3) as mae_p10,
  round(percentile_cont(0.50) within group (order by mae)::numeric, 3) as mae_p50,
  round(percentile_cont(0.90) within group (order by mae)::numeric, 3) as mae_p90
from v3_metrics
where is_cond or (expanded and not strong)
group by 1,2,3,4
order by dir, regime, h, grp;

-- --------------------------------------------------------------------- Q3 SIGN
-- Criterion B, plus the six-way sublabels. Cells hold 2-41 candidates, so only signs and
-- magnitudes are read - never a significance claim. The sweep rows (n = 2-6) are printed
-- to show they remain as unusable as Gate 0 predicted.
with pool as (
  select instrument_id, sess, vol_tercile, regime2, dir, avg(realized_r) as base_r
  from v3_metrics where expanded and not strong and h = 5
  group by 1,2,3,4,5
),
j as (
  select c.symbol, c.regime2, c.regime6, c.dir, c.realized_r - p.base_r as delta
  from v3_metrics c
  join pool p using (instrument_id, sess, vol_tercile, regime2, dir)
  where c.is_cond and c.h = 5
)
select dir, regime2 as regime, symbol, count(*) as n,
  round(avg(delta)::numeric, 3) as delta_r,
  case when avg(delta) > 0 then '+' else '-' end as sign
from j group by 1,2,3
union all
select 'SUBLABEL(descriptive)', regime6, dir, count(*),
  round(avg(delta)::numeric, 3),
  case when avg(delta) > 0 then '+' else '-' end
from j group by 2,3
order by 1,2,3;
