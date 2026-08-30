-- A drawdown nobody measured must not read as a drawdown of zero.
--
-- 0023 added these as `not null default 0`, which is wrong for the window
-- between now and the runner being redeployed: a backtest from the old bundle
-- sends no drawdown, the default fills in 0, and the readout says the variant
-- never gave anything back. That is the same failure just fixed on the signal
-- feed, where a column the page forgot to select rendered as a stop of zero --
-- absent and zero are different facts and must look different.
--
-- Existing rows are set to null for the same reason: they were scored by a
-- runner that did not compute this, so 0 is not their measurement, it is the
-- absence of one.
alter table public.experiment_results
  alter column max_drawdown_r      drop not null,
  alter column max_drawdown_r      drop default,
  alter column worst_losing_streak drop not null,
  alter column worst_losing_streak drop default;

update public.experiment_results
   set max_drawdown_r = null, worst_losing_streak = null
 where max_drawdown_r = 0 and worst_losing_streak = 0;

comment on column public.experiment_results.max_drawdown_r is
  'Deepest fall from a running peak, in R, over the trades in this breakdown taken in the order they opened. Null means the run predates the runner that measures it -- not that the equity never fell.';

-- The readout says so in words rather than leaving a blank to be interpreted.
create or replace view public.experiment_readout
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
  'Experiment results with R per trade, drawdown, and a verdict marking any breakdown under 30 trades as unreadable -- the same bar setup_stability and settings_effect hold live results to. drawdown_note names runs that predate drawdown measurement, so an unmeasured route is never read as a smooth one.';
