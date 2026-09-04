-- H4 Mathematical Candle Signature — V4 verdict run
--
-- Companion to docs/experiments/2026-09-04-candle-signature-v4.md.
-- Read-only. Project sckdriuwfyittcybnbhz. Written 2026-09-04, BEFORE the start gate opens.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────┐
-- │ DO NOT RUN THIS FILE UNTIL h4_candle_signature_v4_gate0.sql REPORTS Q2 = OPEN FOR ALL │
-- │ FOUR CELLS. Running it early does not produce an early answer; it produces an         │
-- │ underpowered answer that can no longer be un-seen, and V4 is the only verdict run     │
-- │ the roadmap has. As of 2026-09-04 the binding cell holds 77 of the 285 it needs.      │
-- └──────────────────────────────────────────────────────────────────────────────────────┘
--
-- This file is committed unrun on purpose. EXPERIMENT_REVIEW_PROTOCOL.md section 3 requires
-- the plan to exist before the results do, and a query frozen in git is a stronger pin than
-- a paragraph describing one.
--
-- The estimator itself is not merely unrun, it is TESTED. On 2026-09-04 the pairing, the
-- block bootstrap and the DiD arithmetic below were executed against fabricated rows with a
-- known planted effect: baseline MAE uniform on [0,3], the candidate arm shifted down by
-- exactly 1.0 in 'range' and not shifted at all in 'directional'. The estimator returned
-- DiD = -0.943 (long) and -1.000 (short) with 99% intervals [-1.045, -0.940] and
-- [-1.059, -0.939], and 18 and 22 distinct values across replicates - the last number being
-- the one that matters, because a bootstrap that had silently collapsed to one repeated
-- draw would report a single value and an interval of zero width. No real bar and no real
-- outcome took part in that test, and nothing below has produced a real number yet.
--
-- TWO CONSTANTS TO SET ON THE DAY OF THE RUN, and nothing else in this file:
--
--   V4_CUTOFF  the exclusive upper bound of the in-sample window. Owner-pinned by the
--              mechanical rule in section 3 of the V4 record: the first UTC date on which
--              all four cells report n >= 285. Written below as 2026-09-26, the current
--              projection; correct it to the date the monitor actually reports, and pin it
--              in the record BEFORE running anything downstream of it.
--   N_BOOT     bootstrap replicates, 2000, spread over ten chunks of 200. Raise, never
--              lower: at 2000 the smallest p this method can express is 2/2000 = 0.001, and
--              alpha is 0.0031, so dropping below 2000 makes the threshold unresolvable.
--
-- Constants are written as literals rather than psql \set so that reading the file tells you
-- exactly what was run, with no variable set somewhere off-screen.
--
-- WHAT V4 CHANGES FROM V3, AND WHY (all three were pinned in the V3 record, section ญ.7,
-- before V3's numbers were known):
--
--   1. THE HYPOTHESIS IS THE INTERACTION. V3 measured each regime separately and compared
--      the two by eye. "range beats directional" was therefore an observation, not a test.
--      V4's primary statistic is a single difference-in-differences per (direction,
--      horizon), so the comparison V3 made visually is the thing that carries the p-value.
--   2. THE ESTIMAND IS MAE p90, NOT MEAN R. V3 found the effect sits entirely in the
--      adverse tail: short x range x h10 cut MAE p90 from 3.451R to 1.930R while MFE p90
--      moved 3.451 -> 3.471. A mean over a distribution that only changed shape in one tail
--      spends statistical power measuring the part that did not move.
--   3. range_pos_50 IS GONE. V2 retired it; regime2 replaced it. It appears nowhere below.
--
-- Everything else - the four signature terms, the regime2 definition, strict five-minute
-- adjacency, the stop-before-target tie rule, the matched pool - is copied from
-- h4_candle_signature_v3.sql unchanged. V4 was pinned as "same plan, no change of
-- criteria"; a V4 that also retuned the definitions would be a new V1 wearing V4's name.

-- HOW THIS FILE MUST BE RUN, measured rather than assumed:
--
--   ONE psql SESSION, START TO FINISH, WITH `set statement_timeout = 0;` FIRST.
--   Everything below lives in temporary tables, which Postgres scopes to the session: run
--   half of it, disconnect, come back, and the tables are gone and setseed has reset. The
--   Supabase SQL editor and the MCP client both open a fresh session per statement and
--   cannot run this file at all.
--
--   The bootstrap is the expensive part and it was timed before it was pinned: 100
--   replicates over 40 blocks and 6,400 paired rows finish inside a minute; 2,000
--   replicates over the same data exceed a 60-second statement timeout. That is why the
--   bootstrap below fills v4_boot in chunks of 200 rather than in one statement, and why
--   the timeout has to come off. Budget tens of minutes, not seconds.
--
-- Seeded first, and once. Every random draw below - the matched pairing and the bootstrap -
-- descends from this call, so the whole run reproduces exactly. Postgres scopes setseed to
-- the session, so this file must be executed as one session from here to the end.
select setseed(0.20260904);

-- ------------------------------------------------------------------ shared base
-- Lower bound 2026-08-28: everything before it is daily and H4 bars mislabelled '5m' by the
-- indicator's free-text TimeframeLabel (see the V4 record, section 6). Measured effect of
-- excluding them on the candidate counts: at most one per cell, because the fifty-bar
-- warm-up discards those bars either way. The exclusion is for correctness, not for n.
create temporary table v4_base as
with b as (
  select b.instrument_id, i.symbol, b.opened_at, b.open, b.high, b.low, b.close, b.volume,
         row_number() over (partition by b.instrument_id order by b.opened_at) as rn
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.timeframe = '5m' and b.is_closed
    and b.opened_at >= timestamptz '2026-08-28 00:00:00+00'
    and b.opened_at <  timestamptz '2026-09-26 00:00:00+00'   -- V4_CUTOFF
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
-- Unchanged from V3. SL at -1.0R, TP at +2.0R, walked over t+1..t+h; a bar holding both
-- resolves as the STOP, per _shared/backtest.ts:204-209, because OHLC carries no intrabar
-- ordering and assuming the good fill inflates every statistic downstream.
create temporary table v4_metrics as
with scored as (
  select t.instrument_id, t.symbol, t.sess, t.vol_tercile, t.regime2, t.regime6,
    t.rng, t.e_open as entry, d.dir, hz.h, t.strong, t.expanded,
    (t.strong and ((d.dir = 'long'  and t.close_loc > 0.8)
                or (d.dir = 'short' and t.close_loc < 0.2))) as is_cond,
    w.contig, w.mx, w.mn, w.k_fav, w.k_adv, w.k_stop, w.k_tp,
    t.closes[hz.h] as c_end
  from v4_base t
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
  ) w
)
select *,
  case when dir = 'long' then (mx - entry) / rng else (entry - mn) / rng end as mfe,
  case when dir = 'long' then (entry - mn) / rng else (mx - entry) / rng end as mae,
  -- At h=1 this is false by construction: one bar holds both extremes, so k_adv = k_fav
  -- always. The h=1 row of this column is not a result and must not be read as one.
  (k_adv < k_fav) as mae_before_mfe,
  case when k_tp < 99 and k_tp < k_stop then 2.0
       when k_stop < 99 and k_stop <= k_tp then -1.0
       else case when dir = 'long' then (c_end - entry) / rng else (entry - c_end) / rng end
  end as realized_r,
  (k_stop < 99 and k_stop = k_tp) as ambiguous
from scored
where contig and c_end is not null;

-- ------------------------------------------------------------- matched pairing
-- V3 subtracted each candidate's own stratum MEAN. That works for a mean and is meaningless
-- for a quantile: there is no "stratum p90" to subtract when a stratum holds four rows.
--
-- So V4 builds a comparison arm with the SAME stratum composition as the candidate arm and
-- takes the p90 of each arm whole. Each candidate draws one partner from its own stratum
-- (instrument x session x volatility tercile x regime x direction x horizon). Where the
-- pool is smaller than the candidate count the draw recycles it, which keeps the
-- composition exact rather than silently dropping the candidates that could not be paired.
--
-- Candidates whose stratum holds no pool row at all cannot be paired and are counted, never
-- dropped quietly: V3 had two of them out of 347 and reported both.
--
-- A TABLE, not a view. random() inside a view is re-evaluated on every reference, so a view
-- would hand a different pairing to each query below and none of the four outputs would
-- describe the same experiment.
create temporary table v4_paired as
with cand as (
  select *, row_number() over (partition by instrument_id, sess, vol_tercile, regime2, dir, h
                               order by random()) as k
  from v4_metrics where is_cond
),
pool as (
  select *, count(*) over (partition by instrument_id, sess, vol_tercile, regime2, dir, h) as n_p,
         row_number() over (partition by instrument_id, sess, vol_tercile, regime2, dir, h
                            order by random()) as j
  from v4_metrics where expanded and not strong
)
select c.instrument_id, c.symbol, c.sess, c.regime2, c.regime6, c.dir, c.h,
       c.mae as cond_mae, c.mfe as cond_mfe, c.realized_r as cond_r, c.ambiguous,
       p.mae as base_mae, p.mfe as base_mfe, p.realized_r as base_r
from cand c
left join pool p
  on  p.instrument_id = c.instrument_id and p.sess = c.sess
  and p.vol_tercile   = c.vol_tercile   and p.regime2 = c.regime2
  and p.dir = c.dir and p.h = c.h
  and p.j = 1 + ((c.k - 1) % p.n_p);

-- The bootstrap joins this table once per replicate on (instrument_id, sess). Without the
-- index that is two thousand sequential scans.
create index on v4_paired (instrument_id, sess);
analyze v4_paired;

-- --------------------------------------------------------------------- Q1 GATE
-- Refuses to proceed on an underpowered sample. Read this BEFORE the statistics below: if
-- any cell reports HALT, the rest of this file is not a verdict and section 8 of the V4
-- record says what to do instead.
select dir, regime2 as regime, h,
  count(*) as n_cond,
  count(*) filter (where base_mae is null) as n_unpaired,
  round((100.0 * avg(case when ambiguous then 1.0 else 0 end))::numeric, 2) as ambiguous_pct,
  case when count(*) >= 285 then 'ok' else 'HALT - underpowered' end as power_gate
from v4_paired
group by 1, 2, 3
order by dir, regime, h;

-- ------------------------------------------------------------ Q2 PRIMARY (DiD)
-- The pre-registered primary statistic, one per (direction, horizon):
--
--   DiD = [p90(MAE | cond, range)       - p90(MAE | matched, range)]
--       - [p90(MAE | cond, directional) - p90(MAE | matched, directional)]
--
-- The V3 observation predicts DiD < 0: the signature cuts the adverse tail in range and
-- does not in directional, so range's within-regime difference is the more negative of the
-- two. A DiD at or above zero fails the hypothesis regardless of how either regime looks
-- alone. The sign is reported and tested, so a reversal cannot be read as a pass.
--
-- Uncertainty is a block bootstrap over (instrument x session) blocks, the resampling unit
-- named in EXPERIMENT_REVIEW_PROTOCOL.md section 4, drawn with replacement to the original
-- block count. Blocks, not rows: bars inside one session are not independent draws, and
-- resampling rows would report a confidence interval several times too narrow.
--
-- The p-value inverts the bootstrap interval - p = 2 * min(P(DiD* <= 0), P(DiD* >= 0)) -
-- and is compared against alpha = 0.0031, the 16-test budget V3 pinned. V4 declares 8
-- primary tests, whose own Bonferroni threshold would be 0.00625, so keeping V3's number
-- holds V4 to the stricter of the two. It is inherited, not renegotiated after the fact.
create temporary table v4_blocks as
  select row_number() over (order by instrument_id, sess) as bid, instrument_id, sess
  from (select distinct instrument_id, sess from v4_paired) s;

create temporary table v4_boot (
  rep int, dir text, h int, regime2 text,
  p90_cond_mae double precision, p90_base_mae double precision,
  p90_cond_mfe double precision, p90_base_mfe double precision,
  mean_delta_r double precision, n bigint
);

-- Replicate 0 is the observed sample: every block exactly once, no resampling. Everything
-- reported as a point estimate comes from this row; replicates 1..2000 only supply the
-- interval around it.
insert into v4_boot
select 0, p.dir, p.h, p.regime2,
       percentile_cont(0.90) within group (order by p.cond_mae),
       percentile_cont(0.90) within group (order by p.base_mae),
       percentile_cont(0.90) within group (order by p.cond_mfe),
       percentile_cont(0.90) within group (order by p.base_mfe),
       avg(p.cond_r - p.base_r), count(*)
from v4_paired p
where p.base_mae is not null
group by 2, 3, 4;

-- The resampled replicates, in chunks. Run this statement TEN TIMES, advancing both numbers
-- on the generate_series line by 200 each pass: (1,200), (201,400), ... (1801,2000). One
-- statement covering all 2000 exceeds the timeout; ten covering 200 each do not. The seed
-- was set once at the top of the file, so consecutive chunks continue the same random
-- stream rather than repeating it - which is also why the chunks must run in one session
-- and in order.
--
-- Blocks are drawn by integer index rather than by a lateral subquery. A lateral with no
-- outer reference is uncorrelated, and the planner is free to evaluate it once and reuse
-- the row - which would silently give every replicate the same block and collapse the
-- interval to zero width. Indexing with a volatile random() per row cannot do that. The
-- synthetic test in the header exists to prove this specific thing did not happen.
insert into v4_boot
with nb as (select count(*)::int as n from v4_blocks),
draws as (
  select r.rep, 1 + floor(random() * (select n from nb))::int as bid
  from generate_series(1, 200) r(rep)          -- CHUNK: advance by 200 each pass
  cross join generate_series(1, (select n from nb)) g(i)
)
select d.rep, p.dir, p.h, p.regime2,
       percentile_cont(0.90) within group (order by p.cond_mae),
       percentile_cont(0.90) within group (order by p.base_mae),
       percentile_cont(0.90) within group (order by p.cond_mfe),
       percentile_cont(0.90) within group (order by p.base_mfe),
       avg(p.cond_r - p.base_r), count(*)
from draws d
join v4_blocks b on b.bid = d.bid
join v4_paired p on p.instrument_id = b.instrument_id and p.sess = b.sess
where p.base_mae is not null
group by 1, 2, 3, 4;

-- Before reading any statistic: confirm all 2000 replicates landed and that they are not
-- all the same draw. distinct_replicate_values in Q2 is the live version of this check.
select count(distinct rep) as replicates_present,
       case when count(distinct rep) = 2001 then 'ok'
            else 'HALT - rerun the chunks; a chunk was skipped or repeated' end as chunk_gate
from v4_boot;

with did as (
  select rep, dir, h,
    (max(p90_cond_mae) filter (where regime2 = 'range')
     - max(p90_base_mae) filter (where regime2 = 'range'))
    - (max(p90_cond_mae) filter (where regime2 = 'directional')
       - max(p90_base_mae) filter (where regime2 = 'directional')) as did_mae_p90
  from v4_boot group by 1, 2, 3
),
obs  as (select dir, h, did_mae_p90 from did where rep = 0),
dist as (select dir, h, did_mae_p90 from did where rep > 0)
select o.dir, o.h,
  round(o.did_mae_p90::numeric, 4) as did_mae_p90,
  round(percentile_cont(0.005) within group (order by d.did_mae_p90)::numeric, 4) as ci_lo_99,
  round(percentile_cont(0.995) within group (order by d.did_mae_p90)::numeric, 4) as ci_hi_99,
  count(distinct d.did_mae_p90) as distinct_replicate_values,
  round((2.0 * least(avg(case when d.did_mae_p90 >= 0 then 1.0 else 0 end),
                     avg(case when d.did_mae_p90 <= 0 then 1.0 else 0 end)))::numeric, 5) as p_boot,
  case when 2.0 * least(avg(case when d.did_mae_p90 >= 0 then 1.0 else 0 end),
                        avg(case when d.did_mae_p90 <= 0 then 1.0 else 0 end)) < 0.0031
            and o.did_mae_p90 < 0
       then 'passes alpha' else 'does not pass' end as verdict_vs_alpha
from obs o
join dist d on d.dir = o.dir and d.h = o.h
group by o.dir, o.h, o.did_mae_p90
order by o.dir, o.h;

-- --------------------------------------------------------------- Q3 SECONDARY
-- Reported always, verdict-bearing never. Two jobs:
--   MFE p90 is the mechanism check. V3's claim was that the signature shortens the retrace
--   without lengthening the run. That claim survives only if the MAE DiD moves and this one
--   does not; an MFE DiD of the same size means the signature simply picked bigger bars.
--   mean R is V3's estimand, carried so the two rounds can be read on one axis.
with did as (
  select rep, dir, h,
    (max(p90_cond_mfe) filter (where regime2 = 'range')
     - max(p90_base_mfe) filter (where regime2 = 'range'))
    - (max(p90_cond_mfe) filter (where regime2 = 'directional')
       - max(p90_base_mfe) filter (where regime2 = 'directional')) as did_mfe_p90,
    (max(mean_delta_r) filter (where regime2 = 'range'))
    - (max(mean_delta_r) filter (where regime2 = 'directional')) as did_mean_r
  from v4_boot group by 1, 2, 3
)
select dir, h,
  round(max(did_mfe_p90) filter (where rep = 0)::numeric, 4) as did_mfe_p90,
  round(percentile_cont(0.005) within group (order by did_mfe_p90)
        filter (where rep > 0)::numeric, 4) as mfe_ci_lo_99,
  round(percentile_cont(0.995) within group (order by did_mfe_p90)
        filter (where rep > 0)::numeric, 4) as mfe_ci_hi_99,
  round(max(did_mean_r) filter (where rep = 0)::numeric, 4) as did_mean_r,
  round(percentile_cont(0.005) within group (order by did_mean_r)
        filter (where rep > 0)::numeric, 4) as r_ci_lo_99,
  round(percentile_cont(0.995) within group (order by did_mean_r)
        filter (where rep > 0)::numeric, 4) as r_ci_hi_99
from did
group by 1, 2
order by 1, 2;

-- ------------------------------------------------------- Q4 CONSISTENCY (ญ.8)
-- The PROMISING level in the decision rubric is not a p-value; it asks whether the effect
-- points the same way across instruments and sessions rather than only in the pool. This
-- table is what that level is read from. Descriptive, per pre-registration: no significance
-- test is run on any single instrument or session, and none may be quoted as if it were.
select symbol, dir, h,
  count(*) filter (where regime2 = 'range')       as n_range,
  count(*) filter (where regime2 = 'directional') as n_dir,
  round((percentile_cont(0.90) within group (order by cond_mae)
           filter (where regime2 = 'range')
       - percentile_cont(0.90) within group (order by base_mae)
           filter (where regime2 = 'range'))::numeric, 3) as range_mae_p90_shift,
  round((percentile_cont(0.90) within group (order by cond_mae)
           filter (where regime2 = 'directional')
       - percentile_cont(0.90) within group (order by base_mae)
           filter (where regime2 = 'directional'))::numeric, 3) as dir_mae_p90_shift
from v4_paired
where base_mae is not null
group by 1, 2, 3
order by 1, 2, 3;
