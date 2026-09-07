-- Three rules that add no new data, and none of them says a word yet.
--
-- The prop-trading shortlist was ordered by how much of the existing engine
-- each item could reuse. These are the three that reuse all of it:
--
--   delta_flip  reads the same per-bar delta Delta Divergence reads, and the
--               same stored poc_price POC Shift reads. Nothing new is read.
--   lvn         walks the same footprint POC Shift walks, looking for the
--               thinnest level instead of the heaviest.
--   naked_poc   reads bars.poc_price, which has been written on every bar
--               since migration 0001, and asks which of those prices no later
--               bar has traded back through.
--
-- No ingest change, no indicator change, no new column. That is the whole
-- reason these three came first.
--
-- ------------------------------------------------- why telegram is off
--
-- Forbidden item 4 says not to add rules before the existing ones have proved
-- themselves, and it is right: four rules across two directions still cannot be
-- judged on the data on record. But a rule that is switched off produces no
-- evidence, so it can never earn its way in either -- "prove yourself first"
-- and "you may not fire" cannot both be satisfied.
--
-- What the rest of this system does in that position is measure without acting.
-- price_action.ts has recorded structure, sweeps and zones onto every signal
-- for weeks and filters nothing. So these three are enabled and muted: they
-- fire, the rows land in public.signals, evaluate_pending_outcomes() scores
-- them exactly like the other four, /stats compares them -- and no phone
-- buzzes. telegram_enabled flips to true from /rules, per rule, when the
-- outcomes say so, with no deploy.
--
-- The cost of being wrong about this is one column in the statistics tables
-- rather than an alert anyone acted on, which is the right side to be wrong on.
--
-- ------------------------------------------------------ where the defaults are from
--
-- These are starting points, not measured values, and they are all editable
-- from /rules. Where a default could be borrowed from something already
-- measured, it was:
--
--   delta_flip.minDeltaMagnitude 200   the value migration 0021 adopted for
--                                      delta_divergence, on the same quantity
--   delta_flip.runBars 3               poc_shift.consecutive 3, on the same
--                                      question: how many bars agreeing makes
--                                      a sequence rather than noise
--   delta_flip.minRunDelta 0           no unmeasured threshold. Any bar that
--                                      pressed the same way counts
--   delta_flip.levelShare 0.25         a quarter of the signal bar's own range.
--                                      A share and not a tick count, per
--                                      forbidden item 8: one footprint row is
--                                      3 real ticks on MNQ and something else
--                                      everywhere else, so a tick tolerance
--                                      means a different thing per chart
--   lvn.maxShare 0.25                  the hole must trade under a quarter of
--                                      the bar's average level. Mirrors
--                                      poc_shift.hvnShare 0.25 from the other
--                                      end of the same profile
--   lvn.interiorShare 0.8              the outer 10% of the range at each end
--                                      is dropped before looking. Every bar's
--                                      thinnest level is its own extreme
--                                      otherwise, which is not a hole
--   lvn.minLevels 8                    a profile with fewer rows than this has
--                                      no shape to have a hole in
--   naked_poc.lookbackBars 40          the rules are handed 50 bars of history
--                                      (HISTORY_BARS in ingest.ts and
--                                      backtest.ts, which must agree). 40 back
--                                      leaves 10 bars of chances to be retested
--   naked_poc.minAgeBars 5             a POC from the bar just behind has not
--                                      been left alone, it is still being
--                                      traded
--
-- The shared plan and gate params are the current values from migrations 0008
-- through 0021, copied because those migrations are guarded against re-running
-- and will not reach a row inserted afterwards. If any of them is retuned
-- later, these rows have to move with the others.
insert into public.rules (
  key, name, description, enabled, telegram_enabled, horizon_bars, params
) values
  (
    'delta_flip',
    'Delta Flip',
    'Delta สลับข้างหลังโดนกดมาหลายแท่ง และสลับตรงราคาที่เคยมี volume หนัก (POC เดิม) — ฝั่งที่ไล่อยู่ชนของแล้วหยุด',
    true,
    false,
    10,
    '{
      "runBars": 3, "minDeltaMagnitude": 200, "minRunDelta": 0,
      "levelShare": 0.25, "levelLookback": 20,
      "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 3,
      "trailAfterR": 0.5, "trailOffsetR": 0.25,
      "minVolumeRatio": 1.2, "minVolumeHistory": 10,
      "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
    }'::jsonb
  ),
  (
    'lvn',
    'Low Volume Node',
    'ช่องว่างใน volume profile ของแท่ง — ตลาดทิ้งราคาที่เคยยอมรับ ข้ามช่องที่ไม่มีใครเทรด แล้วไปปิดอีกฝั่ง',
    true,
    false,
    10,
    '{
      "maxShare": 0.25, "interiorShare": 0.8, "minLevels": 8,
      "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 3,
      "trailAfterR": 0.5, "trailOffsetR": 0.25,
      "minVolumeRatio": 1.2, "minVolumeHistory": 10,
      "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
    }'::jsonb
  ),
  (
    'naked_poc',
    'Naked POC',
    'ราคากลับมาแตะ POC เก่าที่ยังไม่เคยถูกทดสอบเลยนับตั้งแต่มันเกิด — ครั้งแรกที่ระดับนั้นโดนวัด',
    true,
    false,
    10,
    '{
      "lookbackBars": 40, "minAgeBars": 5,
      "bufferTicks": 2, "minRiskTicks": 4, "rewardRatio": 3,
      "trailAfterR": 0.5, "trailOffsetR": 0.25,
      "minVolumeRatio": 1.2, "minVolumeHistory": 10,
      "minRiskRangeShare": 0.3, "minRiskRangeBars": 20
    }'::jsonb
  )
on conflict (key) do nothing;

comment on table public.rules is
  'Signal rules. enabled decides whether a rule fires at all; telegram_enabled decides whether a fired signal is announced. A rule that is enabled and not announced is being measured -- see migration 0027.';
