# Evidence packet — trail counterfactual (`no_trail` vs `baseline`)

Filled under `docs/EXPERIMENT_REVIEW_PROTOCOL.md` §3, as HANDOFF §5.23 Phase 0.

> **Filled BEFORE the experiment ran.** That is the point of the packet: §3 requires the
> variants, estimand and failure criteria to exist before results do, so the plan cannot be
> fitted to its answer afterwards. Fields that depend on results say so explicitly and must
> be filled in by the Executor/Recorder **without editing anything above them**.

---

```text
Hypothesis / estimand:
  Mechanism: with trailAfterR 0.5 and trailOffsetR 0.25 the trailing stop cannot produce a
  loss -- it lands at +0.25R at worst -- so it does not cause losing trades, it truncates
  winners. Measured on all 943 resolved trail exits: 0 had a stop that never moved, 0 exited
  below entry, 0 were losses, mean +0.887R. The open question is therefore not "does trailing
  lose money" but "how much does it leave behind, and on which trades".

  Estimand: the difference in mean R per OPPORTUNITY between two whole policies -- every
  opportunity the policy produces, including ones it excludes -- not a per-trade paired
  difference over the trades the two arms happen to share. Reported per rule x direction and
  per instrument, with the exclusion census beside it.
  Explicitly NOT win rate (forbidden item 12).

Proposer:
  Claude (this session). Under HANDOFF §5.21 rule 1 the proposer does not decide its own
  hypothesis, so this session must not issue the verdict on the result.

Executor/Recorder:
  GPT/Codex -- per §5.21 the migration, _shared/rescore.ts, the backtest edge function and the
  queries are its lane. Not yet assigned to a specific run.

Independent Reviewer:
  Unassigned. Must be neither the proposer nor the executor, and must re-derive rows from raw
  SQL rather than reading the write-up (protocol §1). Cheap here: with trailing off the walk
  degenerates to a static-bracket first-touch scan, so the reviewer can re-derive no_trail
  without implementing a walk at all -- planned as Q4 of docs/queries/trail_counterfactual.sql.

Owner approval required (L1-L4):
  L2 to run and record. Becomes L3 the moment the result is used to change trailAfterR /
  trailOffsetR, open or close Telegram, enable a filter, or size real money.
  Independently blocked: HANDOFF §7.2-K forbids adopting ANY trail value until the
  0.25/0.0625 vs 0.25/0.03125 identity is explained. So this can be measured now and cannot
  be acted on regardless of what it shows.

Pre-registered variants and failure criteria:
  Variants: exactly two.
    baseline  -- the stored plan, unmodified.
    no_trail  -- byte-identical except trailTriggerTicks = 0.
  Deliberately NOT a trail sweep: §5.4c already swept trail twice over 12 values and adopted
  nothing; adding trail_offset x k variants turns a mechanism question into a search that will
  find a winner by chance.

  no_trail is adopted ONLY if all four hold:
    1. total R improves;
    2. no instrument gets worse;
    3. the improvement is not carried by fewer than three distinct session_days;
    4. max drawdown R does not worsen (forbidden item 17b).
  Any single failure = not adopted. "Better on aggregate" alone is explicitly not enough.

Exact experiment_id(s):
  Not yet -- no run has been created. The Executor/Recorder fills the UUID(s) here from
  public.experiments before quoting any figure anywhere.

Code / evaluator / query commit:
  Packet written at b7917ac. Evaluator to be stamped per row as evaluator_version
  (scorePlan@<sha>) once _shared/rescore.ts exists; scorePlan itself must be reused UNMODIFIED
  so the 21 fixtures in _shared/testdata/scorer_cases.ts keep covering it.

Data window, timezone, bar cap, instruments, sessions:
  To be frozen at run time and stamped as data_version on every row, because public.bars is
  mutable (is_closed flips; 0001 has an updated_at trigger). Include only opportunities whose
  entire forward window is is_closed and whose bars predate run start.
  Timezone UTC throughout; session_day = (bar_opened_at at time zone 'UTC')::date, the same
  definition migrations 0012 / 0020 / 0023 / 0029 already use.
  Instruments: BTCUSDT, GC, MNQU6, NQU6 (5m). Horizon from signal_outcomes.horizon_bars, NOT
  signals.hold_bars -- the live scorer at 0031:120 slices on the outcome row.
  As of 2026-09-02 the resolved population is 2,039 outcomes, of which 943 exited on trail.

Gate 0 artifact:
  docs/queries/gate0_parameter_binding.sql Q5-Q8, recorded in HANDOFF §5.18b.
  Note the standing caveat: that Gate 0 was run by Claude as both proposer and executor and
  has NOT had an independent raw re-run (HANDOFF §7.2 row Q). It does not gate this
  experiment -- trailAfterR / trailOffsetR are plan parameters, not rule thresholds, and no
  rule threshold is being swept here.

Attempted variants:
  Not yet -- no run has been created.

Succeeded variants:
  Not yet.

Failed variants:
  Not yet.

Planned but not run variants:
  None planned beyond the two above. If a third is ever added it is post-hoc and must be
  labelled as such in this field before it is run.

Run but not reported variants:
  Not yet. This field exists because HANDOFF §5.18a found a 1000-bar lookbackBars run sitting
  in the database and absent from the write-up; it must be filled with "none" only after
  checking public.experiments, not by assumption.

Superseded or post-hoc variants (with reason):
  None.

Baseline and variant metrics: R/trade, total R, max drawdown R, fill rate, trades,
  rule × direction × instrument; calibration metrics when claiming probability:
  Not yet. When filled: R/trade AND total R AND max_drawdown_r AND trade counts together --
  never R/trade alone (forbidden item 13, 17b, 20). No calibration metrics: this experiment
  claims no probability.

Per-opportunity artifact version:
  public.opportunity_results, to be created by migration 0032 (HANDOFF §7.2-O2). Does not
  exist yet. Until it does, protocol §5 forbids claiming that any variant difference is
  statistically significant.

Uncertainty method and resampling unit:
  Block bootstrap resampling whole (session_day, symbol) blocks -- NOT a paired t-test over
  shared trades. Two reasons, both recorded before any number is seen:
    - trades cluster within a session, so treating them as independent understates the SE;
    - pairing only on trades present in BOTH arms conditions on the intersection, which is
      exactly the set of trades a threshold change does not move. The trades that appear in
      one arm only are the ones the change is about.
  B and the seed must be fixed in this field before the comparison is read. Currently unset
  because the implementation is deliberately deferred (writing the resampler before the plan
  is frozen is how the plan gets fitted to the answer).

What would falsify the conclusion:
  The mechanism claim ("trailing cannot lose at these settings") is falsified by a single
  resolved trail exit below entry. It is settings-dependent, not universal: it fails whenever
  trailOffsetR > trailAfterR. That must be an invariant test in rescore_test.ts, not a note.

  The adoption claim is falsified by any one of the four criteria above.

  The whole comparison is void if the baseline variant does not reproduce
  public.signal_outcomes exactly -- exit_reason, bars_used, and pnl_ticks within 0.01. On any
  mismatch the run is marked failed and no_trail must NOT be written. This is the same
  self-check as the share = 0 row in docs/queries/risk_floor_sweep.sql, made machine-enforced.

Independent re-run result and timestamp:
  Not yet.

Decision: provisional / rejected / owner-approved:
  Not yet. Nothing above constitutes a decision.

Runtime change, deploy, rollback:
  None so far. Phase 0 made exactly one production write, recorded below.
  When Phases 1-3 land: migration 0032 is additive (create table, add column if not exists) --
  do not drop to roll back; the backtest edge function deploy follows §7.4 three-layer
  verification; rollback is redeploying the previous version. No change to ingest, rules,
  Telegram, or the live scorer at any point.
```

---

## Phase 0 execution log

**1. Stuck experiment row closed** — `96de5127-e16f-40e1-b547-8a56775097eb`
(`standing sweep 2026-09-02`), stuck at `status = 'running'` with 0 result rows since
2026-09-01 21:00 UTC, 17 hours.

HANDOFF §3.11 prescribes checking `net._http_response` for a 546 before closing such a row.
**That check could not be completed:** `net._http_response` retained only ~6 hours at the time
of checking (72 rows, oldest 2026-09-02 08:10 UTC) and the response for a 17-hour-old request
had already been purged. **This is a limitation of the §3.11 procedure that was not documented:
the diagnostic it prescribes has a retention window shorter than the situation it diagnoses.**

Closed as `failed` on circumstantial evidence, stated as such in the row's `error`:

| run | variants | bars in window | rows written | outcome |
|---|---|---|---|---|
| `96de5127` (this one) | 8 | **3,795** | 0 | presumed WORKER_RESOURCE_LIMIT |
| `82ecfd14` | 8 | 2,892 | 0 | **confirmed** WORKER_RESOURCE_LIMIT |
| `67a0a0a7` | 2 | 3,018 | 0 | **confirmed** WORKER_RESOURCE_LIMIT |

8 variants over 3,795 bars is past everything that has ever succeeded, and past a run that
died at only 2 variants over 3,018 bars. Verified after: `status = 'running'` count is 0.

**The cause is not fixed.** `0018_nightly_standing_experiment.sql` still fires a fixed
multi-variant sweep at 21:00 UTC daily and will fail the same way, silently, until §7.2-O1
(persist per variant) lands. Bars grow every day, so the ceiling keeps falling — 2,892 bars
killed a run on 1 Sep, and the window is 3,795 now.

**2. This packet written.** No other production write, no code change, no deploy.
