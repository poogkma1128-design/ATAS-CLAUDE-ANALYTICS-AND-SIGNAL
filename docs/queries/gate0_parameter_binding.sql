-- Gate 0 — "does this threshold ever actually bind, and does it mean the same
-- thing on every instrument?"
--
-- Provenance: these are the exact queries behind the four figures quoted in the
-- 2026-09-02 review of HANDOFF section 5.18. They are recorded here so the
-- numbers can be re-derived rather than taken on trust -- an independent
-- reviewer who cannot re-run a figure has not verified it.
--
-- Read-only. Nothing here writes.

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
-- Source of: speed_of_tape long GC +0.181 on the 1000-bar run, i.e. the
-- forbidden-item-18 check the "close the long side" recommendation skipped.
-- Run it for any (rule, variant) pair before proposing a rule-wide action.
select e.name, r.variant, r.symbol, r.direction, r.trades,
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
select id, name, status, created_at,
       round(extract(epoch from (now() - created_at))/3600, 1) as hours_since,
       (select count(*) from public.experiment_results x where x.experiment_id = e.id) as rows
from public.experiments e
where status <> 'done'
order by created_at desc;
