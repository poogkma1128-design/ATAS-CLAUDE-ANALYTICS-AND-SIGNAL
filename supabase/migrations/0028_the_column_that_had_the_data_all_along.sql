-- Speed of tape, built on the column that actually holds the trade count.
--
-- HANDOFF 8.5 said this rule needed one field carried into HistoryBar because
-- bars.trades was already there. bars.trades is there and it is zero -- on all
-- 2,428 stored bars, every instrument, since migration 0001. Dto.cs declares
-- the property and SignalBridgeIndicator.cs never assigns it.
--
-- bars.ticks is the one with the data. The indicator sums PriceVolumeInfo.Ticks
-- across the footprint, and volume divided by it comes out at 1.09-1.25 on the
-- three futures and 0.036 on BTCUSDT: the average size of one trade. A counter
-- of price changes could not produce that ratio. So `ticks` is the trade count,
-- `trades` is a dead column, and this rule needed no indicator change at all --
-- the opposite of what 8.5 claimed. That correction is the reason this
-- migration exists at all, and it is written up in 5.16.
--
-- ------------------------------------------------------------------ the rule
--
-- A burst of trades on its own is not a direction. The tape speeds up at every
-- number, every open, and every stop run in both directions at once. What makes
-- it readable is where the bar closed in its own range: urgency that ended at
-- the high is buyers who ran out of patience, and urgency that ended mid-range
-- is a fight nobody won -- which fires nothing, deliberately.
--
-- Direction comes from the range rather than from delta because delta already
-- carries two rules. A third pointed at the same quantity would mostly restate
-- what delta_divergence and delta_flip say.
--
-- ------------------------------------------------------- where the defaults are from
--
--   rateHistory 10    liquidity.minVolumeHistory, which asks the same question
--                     of the same shape of window
--   minRateRatio 2    NOT measured. A burst has to be worth the name, and twice
--                     the median is the round number to start from. Every
--                     instrument's standard deviation is at or above its mean,
--                     so there is real spread for this to cut
--   edgeShare 0.3     NOT measured. The close must sit in the outer third of
--                     the bar's range for the burst to have gone somewhere
--
-- Muted for the reason in 5.15: a rule that is off produces no evidence and can
-- never earn its way in, so it fires, gets scored, and says nothing. That now
-- makes FOUR muted rules. The argument still holds for each of them, but the
-- backlog of undecided rules is now the thing to watch -- nothing else should
-- be added here until some of these are decided (7.2 item J).
--
-- The shared plan params are copied from the live rows for the reason spelled
-- out in 0027: the migrations that set them are guarded and will not reach a
-- row inserted later, and settings_effect's live CTE reads them with
-- select distinct, so a missing rewardRatio would split it into two
-- arrangements and mislabel which settings are actually running.
insert into public.rules (
  key, name, description, enabled, telegram_enabled, horizon_bars, params
) values
  (
    'speed_of_tape',
    'Speed of Tape',
    'จำนวนเทรดต่อแท่งพุ่งเกินปกติหลายเท่า และแท่งนั้นไปปิดสุดปลายทางใดทางหนึ่ง — ความรีบที่ไปถึงไหนสักที่ ไม่ใช่แค่ตลาดคึก',
    true,
    false,
    10,
    '{
      "minRateRatio": 2, "edgeShare": 0.3, "rateHistory": 10,
      "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 3,
      "trailAfterR": 0.5, "trailOffsetR": 0.25,
      "minVolumeRatio": 1.2, "minVolumeHistory": 10,
      "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
    }'::jsonb
  )
on conflict (key) do nothing;

comment on column public.bars.trades is
  'Dead column. The indicator has never assigned it, so it is 0 on every row. The trade count is in bars.ticks -- see migration 0028 and HANDOFF 5.16.';

comment on column public.bars.ticks is
  'Trades in the bar: PriceVolumeInfo.Ticks summed across the footprint. volume/ticks is the average trade size, which is what speed_of_tape records as a first handle on block-trade questions.';
