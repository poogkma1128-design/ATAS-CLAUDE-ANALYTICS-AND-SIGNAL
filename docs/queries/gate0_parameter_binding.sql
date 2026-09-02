-- Gate 0 diagnostics — "does this threshold ever actually bind, and does it
-- mean the same thing on every instrument?"
--
-- Provenance: these are the queries the proposer used behind figures quoted in
-- the 2026-09-02 review of HANDOFF section 5.18. They are recorded so figures
-- can be re-derived rather than taken on trust. They are NOT, by themselves, a
-- complete Gate 0 packet and have not yet received an independent raw re-run.
--
-- Read-only. Nothing here writes.
--
-- Re-run record (fill in the PR/Handoff evidence packet; never edit historical
-- results into this SQL file):
--   reviewer =
--   query commit =
--   executed_at_utc =
--   database/project =
--   exact experiment_id(s) =
--   result artifact/link =
--
-- A complete Gate 0 must additionally freeze the data window and report both
-- marginal and conditional rates by instrument x direction x session, units,
-- quantiles/distribution, null/degenerate rates, and sensitivity. Q1 below is
-- a marginal bar-level diagnostic only; it cannot approve a sweep.

-- ---------------------------------------------------------------- Q1
-- Source of: BTCUSDT interior-thinnest share 0.0040 vs futures 0.18-0.21,
--            and lvn maxShare pass-rate 100% on BTCUSDT at 0.25 (99.9% at 0.15).
--
-- Replicates supabase/functions/_shared/rules/lvn.ts exactly:
--   avgVolume  = mean volume over ALL levels in the bar
--   interior   = levels within [low + margin, high - margin],
--                margin = range * (1 - interiorShare) / 2      (interiorShare 0.8)
--   gate       = min(interior volume) <= avgVolume * maxShare
-- The interior trim matters: without it the thinnest level of a bar is almost
-- always its own extreme, which is thin by construction, not a hole.
with per_bar as (
  select i.symbol,
         b.id,
         b.opened_at,
         (select avg(cl.volume) from public.cluster_levels cl where cl.bar_id = b.id) as avg_vol,
         (select min(cl.volume) from public.cluster_levels cl
           where cl.bar_id = b.id
             and cl.price >= b.low  + (b.high - b.low) * (1 - 0.8) / 2 - 1e-9
             and cl.price <= b.high - (b.high - b.low) * (1 - 0.8) / 2 + 1e-9
         ) as interior_min_vol,
         (select count(*) from public.cluster_levels cl where cl.bar_id = b.id) as levels
  from public.bars b
  join public.instruments i on i.id = b.instrument_id
  where b.is_closed = true and b.high > b.low
)
select symbol,
       count(*) as bars,
       min(opened_at) as window_start_utc,
       max(opened_at) as window_end_utc,
       round(avg(levels)) as avg_levels,
       round(avg(interior_min_vol / nullif(avg_vol,0))::numeric, 4) as avg_interior_thinnest_share,
       round((count(*) filter (where interior_min_vol <= avg_vol * 0.15))::numeric / count(*), 4) as pass_at_015,
       round((count(*) filter (where interior_min_vol <= avg_vol * 0.25))::numeric / count(*), 4) as pass_at_025,
       round((count(*) filter (where interior_min_vol <= avg_vol * 0.55))::numeric / count(*), 4) as pass_at_055
from per_bar
where interior_min_vol is not null and avg_vol > 0 and levels >= 8   -- lvn minLevels
group by symbol
order by avg_levels desc;
-- A pass-rate at or near 1.0 means the parameter is saturated: it is not
-- filtering anything on that instrument, so sweeping it there measures nothing.
-- avg_levels also answers whether minLevels (8 / 12) can ever bind at all.


-- ---------------------------------------------------------------- Q2
-- Source of: naked_poc R standard deviation 1.65 (highest of any rule).
--
-- signal_outcomes stores pnl_ticks, not R, so R is reconstructed from the plan
-- the signal was scored against. Caveat, stated rather than buried: se_mean
-- below treats trades as independent. They are not -- trades cluster by session
-- and sweep variants share most of their trades -- so this column is NOT a
-- valid standard error for a variant-vs-variant difference. Use it only to size
-- the per-trade dispersion of a rule. See O2 in the handoff for the artifact a
-- real difference test needs.
with r as (
  select s.rule_key, s.direction,
         case when s.direction = 'long'
              then (o.exit_price - s.entry_price) / nullif(s.entry_price - s.stop_price, 0)
              else (s.entry_price - o.exit_price) / nullif(s.stop_price - s.entry_price, 0)
         end as r_mult
  from public.signal_outcomes o
  join public.signals s on s.id = o.signal_id
  where o.status = 'resolved' and o.exit_price is not null
)
select rule_key, direction, count(*) as trades,
       round(avg(r_mult)::numeric,3) as mean_r,
       round(stddev_samp(r_mult)::numeric,3) as sd_r,
       round((stddev_samp(r_mult)/sqrt(count(*)))::numeric,3) as se_mean_iid_only
from r
where r_mult is not null
group by rule_key, direction
having count(*) >= 20
order by trades desc;


-- ---------------------------------------------------------------- Q3
-- Discovery query for: speed_of_tape long GC +0.181 on the 1000-bar run, i.e. the
-- forbidden-item-18 check the "close the long side" recommendation skipped.
-- Run it for any (rule, variant) pair before proposing a rule-wide action.
-- IMPORTANT: name LIKE is useful for discovery but is not reproducible evidence.
-- Copy the returned UUIDs into the evidence packet and re-run with exact e.id
-- predicates before citing a number.
select e.id as experiment_id, e.name, e.created_at, r.variant, r.symbol, r.direction, r.trades,
       round((r.total_r / nullif(r.trades,0))::numeric, 3) as r_per_trade,
       round(r.max_drawdown_r::numeric,2) as max_dd_r
from public.experiment_results r
join public.experiments e on e.id = r.experiment_id
where r.rule_key = 'speed_of_tape' and r.symbol is not null
  and r.variant in ('baseline','rateHistory 20')
  and e.name like 'speed_of_tape%'
order by r.direction, r.symbol, e.created_at, r.variant;


-- ---------------------------------------------------------------- Q4
-- Runs that produced nothing, and runs still claiming to be alive.
-- A sweep write-up that does not account for these is reporting a filtered
-- view of its own evidence.
-- This can expose non-done rows only. It cannot discover a planned variant that
-- was never created or a successful run omitted from prose; those require the
-- pre-registered manifest and evidence packet in EXPERIMENT_REVIEW_PROTOCOL.md.
select id, name, status, created_at,
       round(extract(epoch from (now() - created_at))/3600, 1) as hours_since,
       (select count(*) from public.experiment_results x where x.experiment_id = e.id) as rows
from public.experiments e
where status <> 'done'
order by created_at desc;


-- =================================================================== Q5-Q8
-- Added 2026-09-02 (second pass): the full Gate 0 sweep over all 8 rules.
-- Executed against project sckdriuwfyittcybnbhz on 2026-09-02, window
-- 2026-08-28 00:00Z .. 2026-09-02 08:50Z, timeframe 5m, is_closed = true.
-- Proposer/Executor: Claude. INDEPENDENT RE-RUN: not yet done -- results are an
-- observation, not an approved conclusion. See EXPERIMENT_REVIEW_PROTOCOL.md s2.

-- ---------------------------------------------------------------- Q5
-- Units, null and degenerate rates, with the data window on the same row.
-- This is the bars.trades = 0 class of defect: a column that exists, reads as a
-- number, and carries nothing.
select i.symbol, count(*) as bars,
  min(b.opened_at) as window_start_utc, max(b.opened_at) as window_end_utc,
  round((count(*) filter (where b.ticks is null or b.ticks = 0))::numeric/count(*),4)   as ticks_null_or_zero,
  round((count(*) filter (where b.trades is null or b.trades = 0))::numeric/count(*),4) as trades_null_or_zero,
  round((count(*) filter (where b.delta is null))::numeric/count(*),4)                  as delta_null,
  round((count(*) filter (where b.cum_delta is null))::numeric/count(*),4)              as cum_delta_null,
  round((count(*) filter (where b.high <= b.low))::numeric/count(*),4)                  as zero_range,
  round(avg(b.volume)::numeric,1) as avg_volume, round(avg(b.ticks)::numeric,1) as avg_ticks
from public.bars b join public.instruments i on i.id=b.instrument_id
where b.is_closed = true group by i.symbol order by bars desc;

-- ---------------------------------------------------------------- Q6
-- The two gates in front of everything, marginal and conditional.
-- liquidity  = volume >= median(prev 50 bars, v>0, n>=10) * minVolumeRatio 1.2
-- tape ratio = ticks  / median(prev 10 bars, t>0, n>=10) >= minRateRatio 2
-- edgeShare  = close in the outer 30% of the bar's range
-- avg_volume_per_tick is the units check: it is the "average trade size" proxy
-- that speed_of_tape records for prop-list item 4.
with b as (
  select i.symbol, x.id, x.opened_at, x.volume, x.ticks, x.high, x.low, x.close,
         row_number() over (partition by i.symbol order by x.opened_at) as rn
  from public.bars x join public.instruments i on i.id = x.instrument_id
  where x.is_closed = true and x.timeframe = '5m'
), g as (
  select b.symbol, b.volume, b.ticks, b.high, b.low, b.close,
    (select percentile_cont(0.5) within group (order by p.volume)
       from b p where p.symbol=b.symbol and p.rn between b.rn-50 and b.rn-1 and p.volume>0) as med_vol50,
    (select count(*) from b p where p.symbol=b.symbol and p.rn between b.rn-50 and b.rn-1 and p.volume>0) as n_vol,
    (select percentile_cont(0.5) within group (order by p.ticks)
       from b p where p.symbol=b.symbol and p.rn between b.rn-10 and b.rn-1 and p.ticks>0) as med_ticks10,
    (select count(*) from b p where p.symbol=b.symbol and p.rn between b.rn-10 and b.rn-1 and p.ticks>0) as n_ticks
  from b
)
select symbol, count(*) as bars,
  round((count(*) filter (where n_vol < 10))::numeric/count(*),4) as liq_skipped_short_history,
  round((count(*) filter (where n_vol >= 10 and volume >= med_vol50*1.2))::numeric
        / nullif(count(*) filter (where n_vol >= 10),0),4)        as liq_pass_marginal,
  round((count(*) filter (where n_ticks >= 10 and ticks >= med_ticks10*2.0))::numeric
        / nullif(count(*) filter (where n_ticks >= 10),0),4)      as tape_ratio_pass_marginal,
  round((count(*) filter (where n_vol>=10 and volume>=med_vol50*1.2
                            and n_ticks>=10 and ticks>=med_ticks10*2.0))::numeric
        / nullif(count(*) filter (where n_vol>=10 and volume>=med_vol50*1.2),0),4) as tape_pass_conditional_on_liq,
  round((count(*) filter (where high>low and ((close-low)/(high-low) >= 0.7 or (close-low)/(high-low) <= 0.3)))::numeric
        / nullif(count(*) filter (where high>low),0),4)           as edgeshare_pass_marginal,
  round(avg(volume/nullif(ticks,0))::numeric,4) as avg_volume_per_tick
from g group by symbol order by bars desc;

-- ---------------------------------------------------------------- Q7
-- Delta-magnitude gates and the two level-volume gates.
with b as (
  select i.symbol, x.id, x.opened_at, x.delta, x.high, x.low,
         row_number() over (partition by i.symbol order by x.opened_at) as rn
  from public.bars x join public.instruments i on i.id=x.instrument_id
  where x.is_closed=true and x.timeframe='5m'
), d as (
  select b.*,
    (select max(p.high) from b p where p.symbol=b.symbol and p.rn between b.rn-5 and b.rn-1) as prior_hi5,
    (select min(p.low)  from b p where p.symbol=b.symbol and p.rn between b.rn-5 and b.rn-1) as prior_lo5,
    (select count(*)    from b p where p.symbol=b.symbol and p.rn between b.rn-3 and b.rn-1 and p.delta > 0) as up3,
    (select count(*)    from b p where p.symbol=b.symbol and p.rn between b.rn-3 and b.rn-1 and p.delta < 0) as dn3
  from b
), lv as (
  select x.id,
    (select avg(cl.volume) from public.cluster_levels cl where cl.bar_id=x.id) as avg_vol,
    (select max(cl.volume) from public.cluster_levels cl where cl.bar_id=x.id) as max_vol,
    (select count(*) from public.cluster_levels cl where cl.bar_id=x.id and cl.volume >= 10) as levels_ge10,
    (select count(*) from public.cluster_levels cl where cl.bar_id=x.id) as n_levels
  from public.bars x where x.is_closed=true and x.timeframe='5m'
)
select d.symbol, count(*) as bars,
  round((count(*) filter (where abs(d.delta) >= 200))::numeric/count(*),4) as delta_mag200_marginal,
  round((count(*) filter (where abs(d.delta) >= 100))::numeric/count(*),4) as delta_mag100_marginal,
  round((count(*) filter (where (d.high>d.prior_hi5 and d.delta<=-200) or (d.low<d.prior_lo5 and d.delta>=200)))::numeric
        /count(*),4)                                                       as divergence_full_conditional,
  round((count(*) filter (where (d.up3=3 and d.delta<=-200) or (d.dn3=3 and d.delta>=200)))::numeric/count(*),4) as flip_full_conditional,
  round((count(*) filter (where lv.max_vol >= lv.avg_vol*3))::numeric/count(*),4) as absorption_x3_marginal,
  round((count(*) filter (where lv.levels_ge10 >= 4))::numeric/count(*),4)        as stacked_minvol10_marginal,
  round(avg(lv.max_vol/nullif(lv.avg_vol,0))::numeric,2) as avg_max_over_mean_level,
  round(avg(lv.levels_ge10)::numeric,1) as avg_levels_ge_minvol10, round(avg(lv.n_levels)::numeric,0) as avg_levels
from d join lv on lv.id=d.id group by d.symbol order by bars desc;

-- ---------------------------------------------------------------- Q8
-- poc_shift. minTicks is counted in ATAS tick_size units, which HANDOFF 3.1
-- already records as footprint-row spacing rather than the market's tick.
with p as (
  select i.symbol, i.tick_size, x.id,
         (select cl.price from public.cluster_levels cl where cl.bar_id=x.id
           order by cl.volume desc, cl.price limit 1) as poc,
         row_number() over (partition by i.symbol order by x.opened_at) as rn
  from public.bars x join public.instruments i on i.id=x.instrument_id
  where x.is_closed=true and x.timeframe='5m'
), s as (
  select p.*, lag(poc,1) over (partition by symbol order by rn) as p1,
              lag(poc,2) over (partition by symbol order by rn) as p2,
              lag(poc,3) over (partition by symbol order by rn) as p3
  from p
), m as (
  select symbol, tick_size, sign(poc-p1) as d1, sign(p1-p2) as d2, sign(p2-p3) as d3,
         abs(poc-p3)/nullif(tick_size,0) as total_shift_ticks
  from s where p3 is not null
)
select symbol, count(*) as bars, tick_size,
  round((count(*) filter (where d1<>0 and d1=d2 and d2=d3))::numeric/count(*),4) as consec3_same_dir_marginal,
  round((count(*) filter (where total_shift_ticks >= 8))::numeric/count(*),4)     as shift_ge8ticks_marginal,
  round((count(*) filter (where d1<>0 and d1=d2 and d2=d3 and total_shift_ticks>=8))::numeric
        / nullif(count(*) filter (where d1<>0 and d1=d2 and d2=d3),0),4)          as shift8_given_consec3,
  round((percentile_cont(0.5) within group (order by total_shift_ticks))::numeric,1) as median_3bar_shift_ticks
from m group by symbol, tick_size order by bars desc;
