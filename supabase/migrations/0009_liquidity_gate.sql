-- Only judge bars that carried enough participation to be judged.
--
-- Every threshold in the rule engine was calibrated on bars with real volume
-- behind them. A thin bar clears them for the wrong reason: not because
-- something happened, but because there was too little trade for anything to
-- stand out against it.
--
-- Measured on the first session of recorded signals, grouping each signal by
-- its bar's volume against the median of the 50 bars before it:
--
--     < 0.4x    10 trades   +2.58R
--     0.4-0.7x  23 trades   -7.13R
--     0.7-1.2x  35 trades   -1.83R
--     1.2-2.0x  28 trades   +3.04R
--     >= 2.0x   60 trades   +8.84R
--
-- Cutting at 1.2x separates +11.88R over 88 trades from -6.38R over 68.
--
-- A ratio rather than a trading-hours window: the clock scored worse on the
-- same data (+8.46R), would need a different setting per instrument, moves
-- with daylight saving, and means nothing for an instrument that trades around
-- the clock, which BTCUSDT — already in this database — does.
--
-- One session of data, so this is a starting point to be re-measured, not a
-- settled number. It lives in rules.params like every other threshold and is
-- editable from /rules without a deploy.
update public.rules
   set params = params || jsonb_build_object(
         'minVolumeRatio',   1.2,
         'minVolumeHistory', 10
       )
 where not (params ? 'minVolumeRatio');
