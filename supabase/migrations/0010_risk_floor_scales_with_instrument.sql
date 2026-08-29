-- A minimum risk that means the same thing on every instrument.
--
-- `minRiskTicks` counts footprint rows, and a row is not a fixed amount of
-- market: one MNQU6 row is 0.75, one BTCUSDT row is 0.30. The same floor of 4
-- rows is therefore 20% of a typical MNQU6 bar and 5% of a typical BTCUSDT one,
-- which produced signals like `entry 77576.40 · stop 77575.20 · target
-- 77578.80` — a trade risking 0.0015% of price, decided by the spread rather
-- than by the setup being wrong. The setting is per rule; the problem is per
-- instrument, so no single number could have been right for both.
--
-- Stating the floor as a share of the median range of the preceding 20 bars
-- removes that mismatch: it scales with the instrument and with how much the
-- instrument happens to be moving, so one value fits every chart.
--
-- Grouping every resolved signal by the risk its plan took against that same
-- median range says the tight end is where the losses are:
--
--                    MNQU6                    BTCUSDT
--     < 0.30x    12 trades  17% win  -6.00R   17 trades  29% win  -2.00R
--     0.30-0.60x 30 trades  37% win  -3.08R   15 trades  53% win  +4.75R
--     0.60-1.00x 28 trades  46% win  -0.02R   20 trades  45% win  -0.67R
--     >= 1.00x   58 trades  55% win +10.86R   36 trades  61% win +13.15R
--
-- Unlike the volume gate, this drops nothing: the setup was found, only the
-- room it was given was wrong, so those trades are widened rather than muted.
--
-- Re-walking all 216 resolved signals bar by bar under a floored plan (the walk
-- reproduces the stored outcome for 213 of them, so it is scoring the same
-- trades the scorer did):
--
--     share   lifted   total R   MNQU6    BTCUSDT
--     0.00     0       +13.17    +1.77    +11.41   (before this migration)
--     0.20    18       +19.24    +4.82    +14.41
--     0.25    24       +19.22    +4.88    +14.34
--     0.30    29       +19.27    +4.81    +14.46
--     0.40    47       +16.56    +3.68    +12.88
--     0.60    74       +24.28   +13.57    +10.71
--
-- 0.30 is taken because its neighbours agree with it — three adjacent settings
-- within 0.05R is an effect, one setting standing alone is a fit — and because
-- it improves both instruments while touching 29 of 216 trades. It stays a
-- floor for the degenerate cases rather than becoming the sizing rule.
--
-- The 0.55-0.65 region scores higher, but almost entirely on MNQU6, and gets
-- there by resizing a third of all trades on a single session of it. Worth
-- re-measuring once there is more data; not worth adopting from this much.
--
-- Two sessions of data, so like every other threshold here this is a starting
-- point to be re-measured, and is editable from /rules without a deploy.
update public.rules
   set params = params || jsonb_build_object(
         'minRiskRangeShare', 0.3,
         'minRiskRangeBars',  20
       )
 where not (params ? 'minRiskRangeShare');
