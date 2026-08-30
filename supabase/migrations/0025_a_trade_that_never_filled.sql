-- A signal that never filled is evidence, and it was being thrown away.
--
-- simulate() reports what never traded back, and backtest/index.ts discarded
-- it. That is only harmless while pullbackShare is 0. Turned on, it would have
-- been the worst kind of wrong: the signals that run away without retracing
-- skew toward the winners, so scoring only the fills makes a worse entry look
-- like a better one, and nothing in the numbers would have said so.
--
-- Recorded on the variant's total row alone. The per-instrument and per-rule
-- breakdowns cannot own a share of it: a signal that never filled produced no
-- outcome to attribute, and splitting the count across them would be inventing
-- a number rather than measuring one.
alter table public.experiment_results
  add column missed_fills integer;

comment on column public.experiment_results.missed_fills is
  'Signals whose entry never traded back within reach, so no trade happened. Only on a variant total row; null on breakdowns and on runs that predate the measurement. Nullable and without a default for the same reason as max_drawdown_r: not measured must not read as none.';

-- The readout states the fill rate rather than leaving it to be worked out.
--
-- Dropped and rebuilt rather than replaced: create or replace can only append
-- columns, and fill_rate belongs beside missed_fills in the middle of the list,
-- not stranded after timed_out where nobody reading the row would meet it next
-- to the number it qualifies. Nothing else selects from this view -- it is read
-- by hand -- so the drop costs a moment, not a dependency.
drop view if exists public.experiment_readout;

create view public.experiment_readout
with (security_invoker = true) as
  select e.name        as experiment,
         e.created_at,
         e.bars_from,
         e.bars_to,
         r.variant,
         r.symbol,
         r.rule_key,
         r.direction,
         r.trades,
         r.win_rate,
         r.total_r,
         round(r.total_r / nullif(r.trades, 0), 3) as r_per_trade,
         r.max_drawdown_r,
         r.worst_losing_streak,
         round(r.total_r / nullif(r.max_drawdown_r, 0), 2) as r_per_drawdown,
         r.missed_fills,
         -- Share of the signals found that were actually entered. Read beside
         -- r_per_trade always: an entry that only takes the easy trades will
         -- show a better R per trade while making less money, and this is the
         -- column that says so.
         round(
           r.trades::numeric / nullif(r.trades + r.missed_fills, 0), 4
         )                                                  as fill_rate,
         r.hit_target, r.hit_stop, r.hit_trail, r.timed_out,
         case
           when r.trades < 30 then 'too few trades'
           else 'readable'
         end as verdict,
         case
           when r.max_drawdown_r is null then 'not measured on this run'
           else null
         end as drawdown_note
    from public.experiments e
    join public.experiment_results r on r.experiment_id = e.id
   where e.status = 'done';

comment on view public.experiment_readout is
  'Experiment results with R per trade, drawdown, fill rate, and a verdict marking any breakdown under 30 trades as unreadable -- the same bar setup_stability and settings_effect hold live results to. fill_rate is null except on variant totals; drawdown_note names runs predating drawdown measurement, so an unmeasured route is never read as a smooth one.';
