-- Start the trail sooner and keep it closer.
--
-- The biggest single leak was trades stopped on the very first bar: 73 of
-- them, -72.99R between them, with an average adverse excursion of 3.84R.
-- Nothing can be done about a bar that runs four times the risk against the
-- entry. But the exits that worked were the trailed ones, and they worked
-- everywhere:
--
--     exit      trades   total R
--     stop        130    -129.99
--     target       50    +100.00
--     trail        72     +66.49   positive at every hold length, 2 bars to 8
--     timeout      21      +2.17
--
-- Not one hold length lost money on a trailed exit. That is what suggested
-- reaching the trail earlier would convert stops into smaller wins, which is
-- what the numbers then said.
--
-- Re-walking all 273 resolved signals bar by bar (the same machinery as
-- docs/queries/risk_floor_sweep.sql, which reproduces the scorer's own results
-- on the stored plans):
--
--     trailAfterR  trailOffsetR   total R   win rate   trail/stop
--     0.50         0.25           +54.98      56.0%     106/113
--     0.75         0.25           +49.37      52.4%      95/123
--     1.00         0.25           +45.63      48.7%      77/132
--     0.25         0.50           +41.40      50.5%     121/102
--     0.50         0.50           +40.79      55.7%     102/113
--     1.00         0.50           +34.84      48.7%      70/132   <- before
--     1.50         0.50           +16.79      42.9%      33/146
--
-- Both directions are monotone across the whole sweep: reaching the trail
-- sooner is better every time, and keeping it closer is better every time. It
-- is a slope, not a spike, which is what says it is an effect rather than a
-- fit to one arrangement of the data.
--
-- It also improves the win rate and the expectancy together, 48.7% to 56.0%,
-- which is unusual enough to be worth stating: those two normally trade off,
-- and a setting that lifts one by hurting the other is how tuning for win rate
-- goes wrong (see HANDOFF section 11).
--
-- This is the most trustworthy kind of change to make from a backtest. Trail
-- settings do not decide which signals fire, only how an already-found trade
-- is exited, so the simulation walks exactly the trades that really happened
-- rather than guessing at a different set.
--
-- Still two sessions of data. Guarded so that re-running this migration cannot
-- overwrite a later hand-tune from /rules: it only moves rules that are still
-- sitting on the previous values.
update public.rules
   set params = params || jsonb_build_object(
         'trailAfterR',  0.5,
         'trailOffsetR', 0.25
       )
 where (params->>'trailAfterR')::numeric  = 1
   and (params->>'trailOffsetR')::numeric = 0.5;
