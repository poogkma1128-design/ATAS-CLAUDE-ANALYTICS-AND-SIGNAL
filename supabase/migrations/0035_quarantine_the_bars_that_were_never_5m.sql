-- Quarantine the bars that were never 5m bars, and the signals computed on them.
--
-- ┌──────────────────────────────────────────────────────────────────────────────────────┐
-- │ NOT APPLIED TO PRODUCTION. Owner approved the fix on 2026-09-04; EXPERIMENT_REVIEW_   │
-- │ PROTOCOL.md §5 still requires an Independent Reviewer to re-run the census below      │
-- │ before this is applied, because it moves rows that live statistics are computed from. │
-- │ Migrations 0033 and 0034 are also unapplied by owner decision; this one is separate   │
-- │ from both and does not depend on either.                                             │
-- └──────────────────────────────────────────────────────────────────────────────────────┘
--
-- WHAT HAPPENED
--
-- The indicator's timeframe is a free-text setting defaulting to "5m", not read from the
-- chart's period (SignalBridgeIndicator.cs), and ingest only checked it was a non-empty
-- string. On 2026-09-03, while checking how far back ATAS could load M5 history for the
-- V3.1 proposal, the owner had the bridge attached to daily and H4 charts. It posted their
-- bars as "5m", and ingest does not distinguish a backfill from live data: it ran full rule
-- evaluation over them.
--
-- The V3.1 note in docs/experiments/2026-09-03-candle-signature-v3.md called this exact
-- outcome forbidden - "ปนเปื้อนทุกสถิติที่มีอยู่แล้ว ... ห้ามทำแบบนี้เด็ดขาด" - while
-- proposing a backfill pipeline. It had already happened by the time that was written.
--
-- IT HAPPENED MORE THAN ONCE, IN TWO SHAPES
--
-- The daily-chart incident is the visible one. Looking for it turned up a second, quieter
-- shape inside the live window: bars labelled '5m' that sit off the five-minute grid,
-- because the bridge was also left on 1-minute and tick charts with the label unchanged.
--
--   COARSER, pre-feed: 255 bars (GC 158, MNQU6 97). GC median range 61.95 against 4.80 in
--   the feed era, median volume 77,803 against 454. MNQU6 512.25 against 15.75, and
--   2,007,590 against 2,802. No five minutes trades a day's volume.
--
--   FINER, in-window: 1,283 bars off the grid across four sessions - MNQU6 2026-08-28 (80),
--   BTCUSDT 2026-08-29 (173), BTCUSDT/GC/MNQU6 2026-08-31 (300/111/210), MNQU6 2026-09-03
--   (409). Some are minute-aligned but not 5m-aligned, which is a 1m chart. Some carry
--   sub-second timestamps like 13:30:43.147, which is a tick chart.
--
-- WHAT IS AFFECTED (censused 2026-09-04, see docs/queries/timeframe_contamination_census.sql)
--
--   1,538    rows in public.bars that are not 5-minute bars (255 pre-feed + 1,283 in-window),
--            21.7% of the 7,098 rows labelled '5m'
--   543      rows in public.signals computed on them - 15.0% of all 3,614. Of these, 177 sit
--            on the pre-feed daily bars and fired in one window on 2026-09-03 12:35-15:00
--            UTC; the other 366 sit on the in-window 1m and tick bars
--   264      rows in public.signal_outcomes pointing at those bars as exit_bar_id
--   158,647  rows in public.cluster_levels
--
-- 15% is the number to sit with. public.signals is the population that §5.18 Gate 0, the
-- H1/H2/H3 cohorts and confidence_v2 are all computed over, and one row in seven of it was
-- produced by rules reading a bar that was never a 5-minute bar.
--
-- For the H4 candle-signature work specifically, the in-window rows matter through a
-- different route than the signal count above. Strict adjacency already kept them out of
-- every V3/V4 candidate set; what they did instead was sit inside the rolling 50-bar window that sets med_range, med_vol, hi50 and lo50 for
-- the genuine bars around them. Measured: removing them moves V4 cell counts by at most 4,
-- and moves four long candidates from one regime to the other. Regime is the variable V4's
-- entire hypothesis is stated over, so that is a correctness fix, not a tidy-up.
--
-- WHY THIS RE-LABELS INSTEAD OF DELETING
--
-- signals.bar_id and cluster_levels.bar_id are ON DELETE CASCADE. Deleting the 1,538 bars
-- would therefore also destroy 543 signals and 158,647 levels, and null the exit_bar_id of
-- 264 outcomes, with no record of what was removed. That is irreversible, and it destroys
-- the evidence of the incident along with the incident.
--
-- Re-labelling achieves the whole point of the fix - the rows leave the '5m' partition, so
-- every 5m query stops seeing them - while destroying nothing and staying reversible by one
-- statement. The rows keep their contents, their ids, and their relationships.
--
-- WHY THE LABEL IS 'quarantine:not-5m' AND NOT '1d', '4h' OR '1m'
--
-- Because we do not know, and the rows do not agree with each other. GC's pre-feed gaps are
-- 71 at four hours and 66 at one day, so the chart's period was changed mid-session; the
-- in-window rows mix minute bars with tick bars. There is no single true period to write.
-- '1d' would replace a wrong fact with a confident wrong fact, which is harder to catch than
-- an obviously quarantined one. The label states only what is established: not 5m.

begin;

-- The affected bars, resolved once into a temporary table so that the bar update and the
-- signal update below cannot select different sets if a write lands between them.
create temporary table quarantined_bar_ids as
  select id from public.bars
  where timeframe = '5m'
    and (
      -- Coarser: the live 5m feed began 2026-08-28, so every '5m' row before it came from
      -- some other chart. An era boundary rather than a shape test, because these bars are
      -- individually plausible - only their date gives them away.
      opened_at < timestamptz '2026-08-28 00:00:00+00'
      -- Finer: a genuine 5m bar opens on a multiple of 300 seconds. Nothing on a 5m chart
      -- opens at 13:30:43.147 or at 19:19:00.
      or date_part('epoch', opened_at)::bigint % 300 <> 0
    );

-- Fail closed if the census does not match what was reviewed. A count that has moved means
-- the contamination is not what this migration was written against, and re-labelling a
-- different set of rows than the reviewer examined is exactly the failure mode 0033 and
-- 0034 were blocked for.
do $$
declare
  bar_count int;
  signal_count int;
begin
  select count(*) into bar_count from quarantined_bar_ids;
  select count(*) into signal_count
    from public.signals s join quarantined_bar_ids q on q.id = s.bar_id;

  if bar_count <> 1538 or signal_count <> 543 then
    raise exception
      'census mismatch: found % bars and % signals, expected 1538 and 543. '
      'Re-run docs/queries/timeframe_contamination_census.sql and have the change '
      'reviewed against the new numbers before applying.', bar_count, signal_count;
  end if;
end $$;

-- Bars first. The unique key is (instrument_id, timeframe, opened_at), so changing the
-- timeframe cannot collide with a genuine 5m bar at the same timestamp: none of these
-- timestamps has one, and if one ever did the constraint would refuse rather than overwrite.
update public.bars
set timeframe = 'quarantine:not-5m'
where id in (select id from quarantined_bar_ids);

-- Then the signals computed on them. Leaving these as '5m' while their bars are quarantined
-- would be worse than doing nothing: the signal population is what §5.18 Gate 0, the H1/H2/H3
-- cohorts and confidence_v2 are all computed over, and they read signals.timeframe.
update public.signals
set timeframe = 'quarantine:not-5m'
where bar_id in (select id from quarantined_bar_ids);

commit;

-- ROLLBACK
--
-- Nothing was deleted, so the reverse is one pair of statements:
--
--   begin;
--   update public.signals set timeframe = '5m' where timeframe = 'quarantine:not-5m';
--   update public.bars    set timeframe = '5m' where timeframe = 'quarantine:not-5m';
--   commit;
--
-- cluster_levels and signal_outcomes are untouched by both directions: they reach their bar
-- through bar_id, which never changes.
--
-- AFTER APPLYING
--
-- Re-run docs/queries/timeframe_contamination_census.sql: every count must be zero and Q5
-- must report 'ok' for every instrument. Then re-run h4_candle_signature_v4_gate0.sql. Its
-- counts must NOT move, because the V4 queries already exclude both shapes by window and by
-- grid alignment - this migration and those filters are two expressions of one rule. If the
-- counts do move, the filters and this migration disagree about what a 5m bar is, and that
-- has to be resolved before V4 runs rather than after.
