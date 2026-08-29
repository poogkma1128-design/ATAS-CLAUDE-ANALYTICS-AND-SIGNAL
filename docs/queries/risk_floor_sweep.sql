-- Re-measures `minRiskRangeShare` against whatever data the database now holds.
--
-- This is the query that chose 0.30 (see HANDOFF §5.4). It does not read the
-- setting: it rebuilds each signal's plan at every candidate share and walks the
-- bars that followed, exactly as public.evaluate_pending_outcomes() does — stop
-- checked before target, a bar containing both scored as the stop, the trail
-- advanced only after the bar has been checked.
--
-- The `share = 0` row is the baseline: it replays the stored plans, so it also
-- validates the walk. If its total R does not match `setup_stats`, the walk has
-- drifted from the scorer and the other rows cannot be trusted either.
--
-- Read it for two things, in this order:
--   1. do the settings next to the winner agree with it?  (an effect)
--   2. does the winner improve every instrument, not just one?  (not a fit)
-- A single high row with lower neighbours is a fit to one session. Adopt a new
-- value by editing rules.params at /rules; no deploy is involved.
with recursive
bars_n as (
  select b.id, b.instrument_id, b.timeframe, b.opened_at, b.high, b.low, b.close,
         row_number() over (partition by b.instrument_id, b.timeframe order by b.opened_at) as rn
    from public.bars b where b.is_closed
),
raw as (
  select s.id as signal_id, i.symbol, i.tick_size::numeric as tick, (s.direction='long') as is_long,
         coalesce(s.entry_price, s.price)::numeric as entry,
         s.stop_price::numeric as stop_price, s.target_price::numeric as target_price,
         s.risk_ticks::numeric as risk_ticks,
         coalesce(s.trail_trigger_ticks,0)::numeric as trail_trig,
         coalesce(s.trail_offset_ticks,0)::numeric as trail_off,
         o.horizon_bars, sb.rn as start_rn, sb.instrument_id, sb.timeframe,
         -- The same window the running code uses: minRiskRangeBars, ending on
         -- the bar before the signal, never including the signal bar itself.
         (select percentile_cont(0.5) within group (order by (p.high-p.low))
            from (select high, low from bars_n pb
                   where pb.instrument_id = sb.instrument_id and pb.timeframe = sb.timeframe
                     and pb.rn between sb.rn-20 and sb.rn-1) p)::numeric as med_range
    from public.signals s
    join public.signal_outcomes o on o.signal_id = s.id and o.status='resolved'
    join public.instruments i on i.id = s.instrument_id
    join bars_n sb on sb.id = s.bar_id
   where s.risk_ticks is not null
),
plan as (
  -- share 0 replays the stored plan untouched; every other row re-derives the
  -- plan from a floored risk, rounded to the tick grid the way buildPlan does.
  select signal_id, symbol, tick, is_long, entry, horizon_bars, start_rn, instrument_id, timeframe,
         0::numeric as share, risk_ticks, stop_price as stop0, target_price as target,
         trail_trig, trail_off, false as lifted
    from raw
  union all
  select r.signal_id, r.symbol, r.tick, r.is_long, r.entry, r.horizon_bars, r.start_rn,
         r.instrument_id, r.timeframe, v.share, f.rt,
         round((r.entry - (case when r.is_long then 1 else -1 end) * f.rt * r.tick)/r.tick)*r.tick,
         round((r.entry + (case when r.is_long then 1 else -1 end) * f.rt * 2 * r.tick)/r.tick)*r.tick,
         f.rt, f.rt * 0.5, f.rt > r.risk_ticks
    from raw r
    -- rewardRatio 2, trailAfterR 1, trailOffsetR 0.5 above: if rules.params
    -- ever moves off those, change them here too or the walk stops matching.
    cross join (values (0.15::numeric),(0.20),(0.25),(0.30),(0.35),(0.40),
                       (0.45),(0.50),(0.55),(0.60),(0.65),(0.70),(0.80),(1.00)) v(share)
    cross join lateral (select greatest(r.risk_ticks, coalesce(r.med_range,0) * v.share / r.tick) as rt) f
),
walk as (
  select p.signal_id, p.share, 0 as n, p.stop0 as stop_level, false as trail_on, p.entry as best,
         null::numeric as exit_px, null::text as exit_why, null::numeric as last_close
    from plan p
  union all
  select w.signal_id, w.share, w.n+1,
         case when p.trail_trig > 0
               and (w.trail_on or (case when p.is_long
                                        then (case when p.is_long then greatest(w.best,bb.high) else least(w.best,bb.low) end) - p.entry
                                        else p.entry - (case when p.is_long then greatest(w.best,bb.high) else least(w.best,bb.low) end) end) >= p.trail_trig*p.tick)
              then (case when p.is_long
                         then greatest(w.stop_level, greatest(w.best,bb.high) - p.trail_off*p.tick)
                         else least(w.stop_level, least(w.best,bb.low) + p.trail_off*p.tick) end)
              else w.stop_level end,
         w.trail_on or (p.trail_trig > 0 and (case when p.is_long
                              then (case when p.is_long then greatest(w.best,bb.high) else least(w.best,bb.low) end) - p.entry
                              else p.entry - (case when p.is_long then greatest(w.best,bb.high) else least(w.best,bb.low) end) end) >= p.trail_trig*p.tick),
         case when p.is_long then greatest(w.best,bb.high) else least(w.best,bb.low) end,
         case when (p.is_long and bb.low <= w.stop_level) or (not p.is_long and bb.high >= w.stop_level) then w.stop_level
              when (p.is_long and bb.high >= p.target) or (not p.is_long and bb.low <= p.target) then p.target end,
         case when (p.is_long and bb.low <= w.stop_level) or (not p.is_long and bb.high >= w.stop_level) then (case when w.trail_on then 'trail' else 'stop' end)
              when (p.is_long and bb.high >= p.target) or (not p.is_long and bb.low <= p.target) then 'target' end,
         bb.close
    from walk w
    join plan p on p.signal_id = w.signal_id and p.share = w.share
    join bars_n bb on bb.instrument_id = p.instrument_id and bb.timeframe = p.timeframe
                  and bb.rn = p.start_rn + w.n + 1
   where w.exit_px is null and w.n < p.horizon_bars
),
fin as (select distinct on (signal_id, share) * from walk order by signal_id, share, n desc),
scored as (
  select p.signal_id, p.share, p.symbol, p.risk_ticks, p.lifted,
         -- No exit found within the horizon means the plan timed out, which is
         -- closed at the last close, the same as the scorer does.
         (case when p.is_long then coalesce(f.exit_px, f.last_close) - p.entry
               else p.entry - coalesce(f.exit_px, f.last_close) end) / p.tick as sim_pnl
    from fin f join plan p on p.signal_id = f.signal_id and p.share = f.share
)
select share,
       count(*) filter (where lifted) as lifted_trades,
       round(sum(sim_pnl/nullif(risk_ticks,0)),2) as total_r,
       round(avg(case when sim_pnl>0 then 1 else 0 end),3) as win_rate,
       jsonb_object_agg(symbol, r_by_symbol) as r_per_symbol
  from (
    select share, symbol, risk_ticks, sim_pnl, lifted,
           round(sum(sim_pnl/nullif(risk_ticks,0)) over (partition by share, symbol),2) as r_by_symbol
      from scored
  ) x
 group by share order by share;
