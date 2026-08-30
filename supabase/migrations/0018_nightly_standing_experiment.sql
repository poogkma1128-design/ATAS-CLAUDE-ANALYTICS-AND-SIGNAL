-- The same questions, asked again every night.
--
-- A single run answers a question on the data that existed that day. The
-- questions worth asking are the ones whose answer should be watched as evidence
-- accumulates, so this asks them again every night on whatever bars have arrived
-- since, and the answers stack up on /experiments where the trend is visible.
--
-- 21:00 UTC is 04:00 in Bangkok: the futures charts are closed, so nothing is
-- competing with it, and no result can reach anyone -- an experiment writes to
-- experiment_results and never to public.signals.
--
-- Nothing here adopts anything. The owner decides, from the numbers.
select cron.schedule(
  'nightly-standing-experiment',
  '0 21 * * *',
  $cron$
  select public.run_backtest(jsonb_build_object(
    'name', 'standing sweep ' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
    'note', 'Runs every night on whatever bars have accumulated. The same questions each time, so the answer is watched as evidence grows rather than decided once.',
    'maxBars', 1000,
    'variants', jsonb_build_array(
      jsonb_build_object('label', 'reward 2.5', 'params', jsonb_build_object('rewardRatio', 2.5)),
      jsonb_build_object('label', 'reward 3',   'params', jsonb_build_object('rewardRatio', 3)),
      jsonb_build_object('label', 'reward 4',   'params', jsonb_build_object('rewardRatio', 4)),
      jsonb_build_object('label', 'gate 1.0',   'params', jsonb_build_object('minVolumeRatio', 1.0)),
      jsonb_build_object('label', 'gate 1.4',   'params', jsonb_build_object('minVolumeRatio', 1.4)),
      jsonb_build_object('label', 'trail 0.5/0.5', 'params', jsonb_build_object('trailOffsetR', 0.5)),
      jsonb_build_object('label', 'trail 0.75/0.25', 'params', jsonb_build_object('trailAfterR', 0.75))
    )
  ));
  $cron$
);
