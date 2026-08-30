-- Raise delta_divergence's minimum delta from 100 to 200, and leave every other
-- rule threshold exactly where it was.
--
-- None of the four rules' own thresholds had ever been measured. Six runs swept
-- all of them. This is the only change any of them earned.
--
-- Why the bar is higher here than it was for the target and the trail: those
-- re-scored the same trades, so every variant walked an identical set. A rule
-- threshold decides WHICH signals fire, so trade counts move between variants
-- and total R stops being readable -- a variant can post more R purely by
-- trading more. Everything below is read on R per trade, with total R shown
-- only for scale.
--
-- ---------------------------------------------------------------- adopted
--
-- minDeltaMagnitude, over 1000 bars (baseline = 100):
--
--     minDelta   trades   R/trade   total R
--      50          220     0.368     +81.05
--     100 (was)    212     0.375     +79.47
--     150          211     0.381     +80.47
--     175          211     0.381     +80.47
--     200          210     0.388     +81.46   <- adopted
--     225          210     0.388     +81.46
--     250          210     0.388     +81.46
--     300          207     0.379     +78.55
--
-- This is the only sweep in the campaign that produced a curve with a top: it
-- climbs to a flat 200-250 and falls again at 300. A plateau is stronger
-- evidence than a peak, because the neighbours do not merely agree in direction
-- -- they agree exactly.
--
-- Per instrument, nothing gets worse:
--
--     BTCUSDT   0.460 -> 0.471
--     GC        0.597 -> 0.691
--     MNQU6    -0.008 -> -0.008   (unchanged; no affected signals)
--     NQU6      0.547 ->  0.547   (unchanged; no affected signals)
--
-- 200 rather than 225 or 250: all three score identically, so the least
-- restrictive of them is taken. A filter should not discard more than the
-- evidence asks it to. Same reasoning that picked 0.30 in migration 0010.
--
-- The gain is small -- +0.013 R per trade across the book -- and it is meant to
-- be. delta_divergence is the smallest rule here. What earned the change was
-- the shape of the evidence, not its size.
update public.rules
   set params = params || jsonb_build_object('minDeltaMagnitude', 200)
 where key = 'delta_divergence'
   and (params->>'minDeltaMagnitude')::numeric = 100;

-- ------------------------------------------------------- measured, not moved
--
-- Recorded here because "we checked, and it was already right" is worth exactly
-- as much as a change, and costs a re-measure to rediscover.
--
-- ALREADY AT THEIR BEST -- neighbours worse on both sides:
--     absorption.volumeMultiple  3   (2 -> 0.344, 3 -> 0.375, 4 -> 0.327, 5 -> 0.327)
--     absorption.edgeTicks       2   (1 -> 0.331, 2 -> 0.375, 3 -> 0.345)
--     plan.bufferTicks           2   (0 -> 0.278, 1 -> 0.376, 2 -> 0.375, 3 -> 0.363, 4 -> 0.397)
--     stacked_imbalance.ratio    3   (2 -> 0.386, 2.5 -> 0.400, 3 -> 0.375, 4 -> 0.377, 5 -> 0.404)
--
-- ratio and bufferTicks are listed as "already right" on the strength of rule 9
-- rather than of their own row: both have a higher score somewhere else on the
-- sweep, but with lower scores on either side of it. A single high row whose
-- neighbours disagree is a fit to this data, not a finding.
--
-- INERT -- these did not change a single trade anywhere in their tested range,
-- so they are not tuning knobs at all at present settings:
--     poc_shift.minTicks     4 through 12   (identical to baseline, all of them)
--     poc_shift.hvnShare     0.15 to 0.35   (identical to baseline)
--     delta_divergence.lookback  8 and 10   (identical to baseline)
--
-- minTicks being inert confirms what HANDOFF section 5.3 suspected from the
-- other direction: the POC moves a median of 45 ticks between adjacent bars, so
-- any threshold in single digits is below the noise and filters nothing.
--
-- ------------------------------------------------- promising, NOT adopted
--
-- absorption.rejectionTicks 0: 242 trades at 0.473 R/trade against 212 at
-- 0.375, the largest improvement measured anywhere in the campaign. Not taken,
-- for two reasons that rule 14 names directly. The curve never turns -- 4, 3, 2,
-- 1, 0.5, 0 improves at every step and 0 is the floor -- which is the signature
-- of a constraint being removed rather than tuned; rejectionTicks 0 means
-- "price need not be rejected at all", which is not a smaller absorption
-- threshold but a different rule. And the entire effect is BTCUSDT: the other
-- three instruments score identically to baseline.
--
-- poc_shift.consecutive 2: 301 trades at 0.404, and unlike the above its curve
-- does turn (1 -> 0.360, 2 -> 0.404, 3 -> 0.375, 4 -> 0.356). It fails on the
-- instruments instead: GC 0.597 -> 0.474 and NQU6 0.547 -> 0.429 both get worse
-- while BTCUSDT and MNQU6 improve. Total R says +42R; two of four instruments
-- say otherwise. This is the closest miss in the campaign and the first thing
-- to revisit once the futures charts have run more sessions.
--
-- stacked_imbalance stack 5 (0.407) and minVolume 40 (0.404) both improve
-- monotonically while cutting trade count, with no turn anywhere. That is the
-- shape of a filter tightening onto a smaller and smaller sample, not of a
-- threshold finding its level.
--
-- minRiskRangeShare 0.6 (0.408 overall) settles pending item 7.2 D: keep 0.30.
-- Section 5.4 flagged 0.55-0.65 as scoring higher and needing a re-measure once
-- there was more data. There is more data now, and it says the same thing it
-- said then -- the gain is not shared. GC falls 0.597 -> 0.494 while MNQU6
-- rises. In 5.4 it was BTCUSDT that paid; a lift that keeps changing which
-- instrument funds it is not an effect.
--
-- All four of these go into the nightly sweep below, so they are re-asked every
-- night instead of being remembered.

do $$
declare
  snap uuid;
begin
  if exists (select 1 from public.rule_snapshots where label = 'minDelta 200') then
    return;
  end if;

  snap := public.snapshot_rules(
    'minDelta 200',
    'The one rule threshold that cleared every bar out of six sweeps: a curve with a flat top at 200-250, and no instrument worse.'
  );

  update public.rule_snapshots
     set measured_r        = 81.46,
         measured_win_rate = 0.5760,
         measured_trades   = 210
   where id = snap;

  update public.rule_snapshots set is_best_known = false where is_best_known;
  update public.rule_snapshots set is_best_known = true  where id = snap;
end $$;

-- Re-point the nightly sweep at the questions that are still open.
--
-- Its old list was answered: the target was adopted at 3.0, the gate settled at
-- 1.2, and the trail comparison is in settings_effect now. Eight slots is the
-- cap, so they go to the four findings above that were too good to adopt and too
-- interesting to drop, plus the ones that would catch a live value being wrong:
-- reward 2 and minDelta 100 are the values just stepped away from, so the run
-- that would reveal either adoption as a mistake happens every night on its own.
select cron.schedule(
  'nightly-standing-experiment',
  '0 21 * * *',
  $cron$
  select public.run_backtest(jsonb_build_object(
    'name', 'standing sweep ' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
    'note', 'Runs every night on whatever bars have accumulated. The same questions each time, so the answer is watched as evidence grows rather than decided once.',
    'maxBars', 1000,
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
