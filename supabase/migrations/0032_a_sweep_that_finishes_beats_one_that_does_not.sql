-- Cut the nightly sweep's bar cap from 1000 to 200, so it finishes instead of
-- dying silently every night.
--
-- The job has been failing. `standing sweep 2026-09-02` sat at status = 'running'
-- with zero rows for seventeen hours before it was closed by hand; the worker is
-- killed before the function reaches its own error handler, so nothing marks the
-- row failed and /experiments reports a dead job as alive. See HANDOFF 3.11.
--
-- What actually binds is (arms x bars), where arms = variants + baseline. This
-- job runs 8 variants, so 9 arms. maxBars is applied PER FEED, and with four
-- feeds it currently loads 3,847 bars, not 1,000:
--
--     maxBars 1000  ->  3,847 bars  ->  9 arms  ->  34,600 arm-bars   died
--     maxBars  600  ->  2,400 bars  ->  9 arms  ->  21,600 arm-bars   untested
--     maxBars  200  ->    800 bars  ->  9 arms  ->   7,200 arm-bars   below the pass
--
-- The only confirmed pass at this bar volume was 3 variants + baseline over 600
-- bars per feed: 4 arms x 2,400 bars = 9,600 arm-bars. Scaling that to 9 arms
-- puts the break-even near maxBars 267. 200 sits a quarter below it, because the
-- failure mode is silent and costs a whole night, so a thin margin is not worth
-- the saving.
--
-- Say plainly what this costs: 200 bars of 5m is under 17 hours per instrument.
-- This job exists to ask the same questions every night and watch the answers
-- stack up as bars accumulate, and a window that short cannot show accumulation.
-- The sweep survives; its purpose does not. That is the trade, and it is worth
-- making only because a run that dies produces nothing at all.
--
-- This is a stopgap, not a fix. The fix is HANDOFF 7.2-O1: persist results per
-- variant so a killed worker stops erasing finished work, after which the cap
-- can go back up. Until then the ceiling keeps falling on its own -- 2,892 bars
-- killed a run on 1 Sep and the window is 3,847 now -- so revisit this number
-- rather than trusting it.
--
-- Nothing else changes: same schedule, same 8 variants, same questions. No rule
-- parameter, no signal, no Telegram. An experiment writes to experiment_results
-- and never to public.signals.
select cron.schedule(
  'nightly-standing-experiment',
  '0 21 * * *',
  $cron$
  select public.run_backtest(jsonb_build_object(
    'name', 'standing sweep ' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
    'note', 'Runs every night on whatever bars have accumulated. The same questions each time, so the answer is watched as evidence grows rather than decided once. Bar cap cut to 200 per feed by migration 0032 so the run finishes; see HANDOFF 3.11 and 7.2-O1.',
    'maxBars', 200,
    'variants', jsonb_build_array(
      jsonb_build_object('label', 'reward 2',     'params', jsonb_build_object('rewardRatio', 2)),
      jsonb_build_object('label', 'reward 4',     'params', jsonb_build_object('rewardRatio', 4)),
      jsonb_build_object('label', 'gate 1.0',     'params', jsonb_build_object('minVolumeRatio', 1.0)),
      jsonb_build_object('label', 'trail 0.75/0.25', 'params', jsonb_build_object('trailAfterR', 0.75)),
      jsonb_build_object('label', 'share 0.6',    'params', jsonb_build_object('minRiskRangeShare', 0.6)),
      jsonb_build_object('label', 'minDelta 100', 'ruleKey', 'delta_divergence', 'params', jsonb_build_object('minDeltaMagnitude', 100)),
      jsonb_build_object('label', 'rejection 0',  'ruleKey', 'absorption',       'params', jsonb_build_object('rejectionTicks', 0)),
      jsonb_build_object('label', 'consecutive 2','ruleKey', 'poc_shift',        'params', jsonb_build_object('consecutive', 2))
    )
  ));
  $cron$
);
