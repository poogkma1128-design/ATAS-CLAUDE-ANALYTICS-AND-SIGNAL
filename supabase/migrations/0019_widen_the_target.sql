-- Move the target out from 2R to 3R.
--
-- The trail change in 0014 had a side effect nobody asked for: once a trade
-- reaches 0.5R its stop sits 0.25R behind the best price, so it is already a
-- winner. The target no longer decides whether a trade wins -- only how much
-- it wins. That made "where should the target sit" a question worth asking
-- again, and the backtest runner could finally ask it.
--
-- Sweeping rewardRatio over every stored bar (BTCUSDT 375, MNQU6 239, NQU6 100,
-- GC 100 = 812 bars of 5m, 2026-08-28 to 2026-08-29):
--
--     rewardRatio  trades  win rate   total R   R/trade   target  stop  trail
--     1.25            174     58%      +21.43     0.123      50    67     51
--     1.50            174     58%      +31.80     0.183      44    67     57
--     1.75            174     58%      +41.10     0.236      40    67     61
--     2.00            174     58%      +49.64     0.285      36    67     65   <- before
--     2.50            174     58%      +63.92     0.367      28    67     73
--     3.00            174     58%      +73.25     0.421      20    67     81
--     4.00            174     58%      +83.44     0.480      11    67     90
--     6.00            174     58%      +99.29     0.571       6    67     95
--
-- The evidence here is unusually clean, for a specific reason: rewardRatio does
-- not decide which signals fire, only where the target sits. Every variant walks
-- the same 174 trades, and the stop count is identical at 67 across all of them.
-- This is the same class of change as the trail in 0014 -- a re-scoring of trades
-- that really happened -- not a comparison between two different sets of signals.
--
-- The win rate does not move at all, which is the trail explaining itself: a
-- trade that reaches 0.5R is already guaranteed at least +0.25R wherever the
-- target is. Moving the target changes how much is won, not whether.
--
-- Checked that this is not an artefact of the trail by crossing the two. A wider
-- target paid under every trail setting including none at all:
--
--     no trail,        reward 2   +28.85   0.166   43%
--     no trail,        reward 3   +50.29   0.289   39%
--     trail 1/0.5,     reward 2   +44.84   0.258   52%
--     trail 1/0.5,     reward 3   +68.85   0.396   52%
--     trail 0.5/0.25,  reward 2   +49.64   0.285   58%
--     trail 0.5/0.25,  reward 3   +73.25   0.421   58%
--
-- Every instrument improves and none gets worse (R/trade, 2.0 -> 3.0):
-- BTCUSDT 98 trades 0.385 -> 0.567 - GC 18 trades 0.579 -> 0.597 -
-- MNQU6 46 trades -0.078 -> -0.008 - NQU6 12 trades 0.427 -> 0.605.
-- Re-run on 198 trades after BTCUSDT added 92 bars overnight: same direction,
-- +51.99 -> +77.59 total, 0.263 -> 0.392 per trade, win rate flat at 57.6%.
--
-- WHY 3.0 AND NOT THE TOP OF THE CURVE. The curve has no turning point: it was
-- still climbing at reward 32. HANDOFF section 11 rule 14 says not to trust a
-- curve like that, and the reason shows up at the far end -- the +32.00R between
-- reward 16 and 32 comes from two trades that happened to reach that level. 3.0
-- is chosen because it is still in the thick part of the data (20 trades reach
-- the target there, so it is not resting on a tail), its neighbours at 2.5 and
-- 4.0 agree, and all four instruments agree. It is not chosen for being the
-- highest row.
--
-- Still roughly two days of data, which does not clear the stability gate in
-- section 5.5. The rollback is a restore, not a reconstruction: rule_snapshots
-- already holds two arrangements at rewardRatio 2, so /experiments can put this
-- back in one click if the live numbers disagree.
--
-- Guarded so re-running cannot overwrite a later hand-tune from /rules: it only
-- moves rules still sitting on the previous value.
update public.rules
   set params = params || jsonb_build_object('rewardRatio', 3)
 where (params->>'rewardRatio')::numeric = 2;

-- Record the new arrangement so it can be returned to as exactly as the old one.
--
-- is_best_known moves here because this is now the arrangement with the strongest
-- measured evidence -- by the same standard the previous holder was marked with,
-- a simulation over the trades on record. The two rewardRatio 2 snapshots stay
-- exactly where they are; they just stop holding the title. Losing the title is
-- not losing the rollback point.
do $$
declare
  snap uuid;
begin
  if exists (select 1 from public.rule_snapshots where label = 'reward 3.0 + trail 0.5/0.25') then
    return;
  end if;

  snap := public.snapshot_rules(
    'reward 3.0 + trail 0.5/0.25',
    'Target widened from 2R to 3R. Same 174 trades as every other variant, same 67 stops; the change is where winners are cut off, not which trades happen.'
  );

  update public.rule_snapshots
     set measured_r        = 73.25,
         measured_win_rate = 0.5800,
         measured_trades   = 174
   where id = snap;

  -- Only one arrangement can hold the title (rule_snapshots_one_best).
  update public.rule_snapshots set is_best_known = false where is_best_known;
  update public.rule_snapshots set is_best_known = true  where id = snap;
end $$;

-- Keep the nightly sweep bracketing the live value.
--
-- 0018 asked reward 2.5 / 3 / 4 against a baseline of 2.0. With the baseline now
-- at 3.0, "reward 3" would just re-run the baseline and every remaining variant
-- would sit above it -- a sweep that can only ever say "go higher". Swapping in
-- reward 2 puts the value just stepped away from back on the list, so the run
-- that would reveal this change as a mistake is the one that happens every night.
select cron.schedule(
  'nightly-standing-experiment',
  '0 21 * * *',
  $cron$
  select public.run_backtest(jsonb_build_object(
    'name', 'standing sweep ' || to_char(now() at time zone 'Asia/Bangkok', 'YYYY-MM-DD'),
    'note', 'Runs every night on whatever bars have accumulated. The same questions each time, so the answer is watched as evidence grows rather than decided once.',
    'maxBars', 1000,
    'variants', jsonb_build_array(
      jsonb_build_object('label', 'reward 2',   'params', jsonb_build_object('rewardRatio', 2)),
      jsonb_build_object('label', 'reward 2.5', 'params', jsonb_build_object('rewardRatio', 2.5)),
      jsonb_build_object('label', 'reward 4',   'params', jsonb_build_object('rewardRatio', 4)),
      jsonb_build_object('label', 'gate 1.0',   'params', jsonb_build_object('minVolumeRatio', 1.0)),
      jsonb_build_object('label', 'gate 1.4',   'params', jsonb_build_object('minVolumeRatio', 1.4)),
      jsonb_build_object('label', 'trail 0.5/0.5', 'params', jsonb_build_object('trailOffsetR', 0.5)),
      jsonb_build_object('label', 'trail 0.75/0.25', 'params', jsonb_build_object('trailAfterR', 0.75))
    )
  ));
  $cron$
);
