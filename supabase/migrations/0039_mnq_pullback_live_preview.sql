-- Owner-directed L3 live preview, 2026-09-07.
--
-- The owner explicitly accepted live risk and requested that the new signal run
-- while its backtest evidence accumulates in parallel. This row is therefore a
-- recorded manual announcement override, not a claim that the strategy has a
-- validated edge. The evaluator is hard-scoped to MNQU6 5m and labels every
-- payload `executionScope=touch_bar_only` and `unvalidated`.
--
-- Immediate rollback (keeps all observations and outcomes):
--   update public.rules
--      set telegram_enabled = false
--    where key = 'mnq_pullback_v1';

insert into public.rules (
  key,
  name,
  description,
  enabled,
  telegram_enabled,
  announcement_mode,
  horizon_bars,
  params
) values (
  'mnq_pullback_v1',
  'MNQ Pullback V1 - Live Preview',
  'UNVALIDATED: MNQU6 5m pullback to prior CME trading-day high/low, confirmed on the same closed bar by Delta Flip or Stacked Imbalance.',
  true,
  true,
  'manual',
  10,
  '{
    "zoneProximity": 0.5,
    "invalidationDistance": 0.75,
    "setupMaxAgeBars": 6,
    "runBars": 3,
    "minDeltaMagnitude": 200,
    "minRunDelta": 0,
    "levelShare": 0.25,
    "levelLookback": 20,
    "ratio": 3,
    "minVolume": 10,
    "stack": 3,
    "bufferTicks": 2,
    "minRiskTicks": 4,
    "rewardRatio": 3,
    "trailAfterR": 0.5,
    "trailOffsetR": 0.25,
    "minVolumeRatio": 0,
    "minVolumeHistory": 10,
    "minRiskRangeShare": 0.3,
    "minRiskRangeBars": 20
  }'::jsonb
)
on conflict (key) do nothing;

comment on column public.rules.announcement_mode is
  'Telegram announcement policy. manual is an explicit owner override. mnq_pullback_v1 entered manual mode on 2026-09-07 for an owner-accepted unvalidated live preview while backtesting runs; see HANDOFF §0AD.';
