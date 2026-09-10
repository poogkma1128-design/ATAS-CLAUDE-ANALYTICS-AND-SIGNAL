-- Owner-approved L3 live preview of the three-strategy set, 2026-09-07.
-- MNQ_REVERSAL_V1 is P-A only. GC_SWEEP_V1 is S-A Arm 2 only. Both are
-- explicitly unvalidated and use announcement_mode=manual while the same
-- evaluators run in backtest. See HANDOFF for scope, risk acceptance and roles.

do $$
declare
  current_gc_tick numeric;
  current_gc_value numeric;
begin
  select tick_size, tick_value
    into current_gc_tick, current_gc_value
    from public.instruments
   where symbol = 'GC'
   for update;

  if not found then
    raise exception 'GC instrument row is required before enabling GC_SWEEP_V1';
  end if;
  if current_gc_tick not in (0.40, 0.10) then
    raise exception 'refusing unexpected GC tick_size %', current_gc_tick;
  end if;
  if current_gc_value is not null and current_gc_value <> 10.00 then
    raise exception 'refusing unexpected GC tick_value %', current_gc_value;
  end if;

  -- CME GC: minimum price fluctuation $0.10/troy oz on a 100 oz contract,
  -- therefore $10 per tick. This corrects future plans/outcomes only; no
  -- historical signal or outcome is rewritten by this migration.
  update public.instruments
     set tick_size = 0.10,
         tick_value = 10.00
   where symbol = 'GC';
end
$$;

insert into public.rules (
  key, name, description, enabled, telegram_enabled,
  announcement_mode, horizon_bars, params
) values
(
  'mnq_reversal_v1',
  'MNQ Reversal V1 - P-A Live Preview',
  'UNVALIDATED: MNQU6 5m failed break of prior trading-day high/low, confirmed by Absorption or Delta Divergence.',
  true,
  true,
  'manual',
  10,
  '{
    "attemptWindowBars": 3,
    "attemptDistance": 0.25,
    "setupMaxAgeBars": 6,
    "volumeMultiple": 3,
    "edgeTicks": 2,
    "rejectionTicks": 2,
    "lookback": 5,
    "minDeltaMagnitude": 200,
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
),
(
  'gc_sweep_v1',
  'GC Sweep V1 - S-A Arm 2 Live Preview',
  'UNVALIDATED: GC 5m sweep and return through prior trading-day high/low, confirmed by Absorption or Stacked Imbalance.',
  true,
  true,
  'manual',
  10,
  '{
    "returnWindowBars": 3,
    "sweepDistance": 0.25,
    "setupMaxAgeBars": 6,
    "confirmationMode": "order_flow",
    "marketTickSize": 0.1,
    "volumeMultiple": 3,
    "edgeTicks": 2,
    "rejectionTicks": 2,
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
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  enabled = excluded.enabled,
  telegram_enabled = excluded.telegram_enabled,
  announcement_mode = excluded.announcement_mode,
  horizon_bars = excluded.horizon_bars,
  params = excluded.params;

comment on table public.strategy_setups is
  'Open and resolved multi-bar strategy setups. Written by ingest from the shared evaluators used by live and backtest.';

-- Immediate rollback, preserving observations:
-- update public.rules
--    set telegram_enabled = false, enabled = false
--  where key in ('mnq_reversal_v1', 'gc_sweep_v1');
-- DO NOT restore GC tick_size to 0.40: that was a chart row, not an exchange
-- tick. Scorers/views use instruments.tick_size and would silently rescale R.
-- Keep GC at 0.10 / $10 even when rolling back rule enablement or ingest.
