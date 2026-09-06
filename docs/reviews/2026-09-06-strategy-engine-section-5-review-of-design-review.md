# Independent review of the §5 design review

Subject: `docs/reviews/2026-09-06-strategy-engine-section-5-design-review.md`, delivered in PR #90
(head `b595a7f`, merged as `6564d98`), together with HANDOFF §0W and the §5 amendments to
`docs/STRATEGY_ENGINE_PLAN.md`.
Reviewer: Claude session `0163k6pVFTJVEUmbCsHUn3z3` — the author of the plan being challenged, and
therefore **not** an independent judge of whether the plan is right. What this review can do is check
the design review against its own contract (§13), verify its factual claims, and test its mechanism
against the data it would have to run on. Where the review's decisions overrule the plan, they stand.

## Verdict

**ENDORSE WITH CHANGES.**

The central decision — **REJECT numeric scoring as written, boolean-first** — is correct, is argued
from evidence rather than taste, and I accept it against my own plan. Doubt 1 in particular gets the
hard question right: it does not claim a multifeature score can never work, it says the six hand-set
weights have no earned advantage and must show incremental value on untouched data. That is the
answer the contract asked for.

Three things must change before the Phase 2A contract is frozen. One of them is the review's own
central mechanism failing on the data that exists, which a single query settles and the review left
as a conditional.

## Blocking findings

### P1 — the power gate's answer is already knowable, and it is "not yet"

Doubt 7 requires "the minimum number of independent blocks and opportunities produced by that power
calculation", with session × instrument as the resampling unit, and doubt 2 says that if the history
cannot support a development / walk-forward / OOS split "the score remains unbuilt/underpowered".
Both are stated as conditionals. They are not conditional — the census is one read-only query, now
saved as `docs/queries/strategy_block_census.sql`:

| symbol | days with any bar | days holding ≥144 of 288 | **usable US-regular blocks** (≥70 of 78 bars) |
|---|---:|---:|---:|
| GC | 102 | 6 | **6** |
| MNQU6 | 102 | 6 | **6** |
| NQU6 | 6 | 4 | **4** |
| BTCUSDT | 9 | 8 | **4** |

The 102-day spans are not history. Before 2026-08-28, MNQU6 holds **96 bars across 96 days** and GC
holds 157 across 96 — one bar per day, the daily-bar artefact of §0L, not five-minute data. Real
5-minute coverage is **six trading days per instrument**, 2026-08-28 to 09-04.

So the three registered contrasts would be drawn from four to six independent blocks each, *before*
the review's own three-way split reserves any of them. No SESOI a trader would care about reaches
power 0.80 at a planning threshold of 0.05/3 on four blocks; the gate fails today with certainty, for
every strategy, on every instrument.

This matters because a gate whose answer is unknown reads as "proceed and find out", and a gate whose
answer is known reads as "collect data first". The second is the true state.

**Required:** record the block census in the plan and state the gate as a target number of usable
blocks to reach, not a condition to evaluate later. Then the next action is unambiguous — keep the
chart open (§3.7b) until the count is met — rather than writing Phase 2A and discovering the gate is
shut.

### P1 — the frozen percentile contract has no adjacency rule, and inherits §0V.1 P1 #2

Doubt 5 fixes the percentile population as "a fixed-length trailing window of bars that closed before
the decision bar" and freezes window length, minimum samples, tie handling and warm-up. It does not
require those bars to be contiguous. That is the same defect I raised against the Phase 1 volatility
contract in `docs/reviews/2026-09-06-strategy-engine-phase-1-independent-review.md` (P1 #2, merged as
HANDOFF §0V.1), and the §5 contract reproduces it one layer up, where it will govern *every* adaptive
threshold rather than one regime label.

Measured on on-grid closed bars since 2026-08-28 (Section B of the same query file):

| symbol | 20-bar windows that span a hole (>100 min) | bars whose immediate predecessor is not adjacent |
|---|---:|---:|
| NQU6 | **12.3%** | 0.6% |
| GC | **11.3%** | 3.8% |
| MNQU6 | 7.3% | 1.0% |
| BTCUSDT | 6.7% | 1.4% |

Between one in fifteen and one in eight threshold computations would be taken over a window that
silently contains a terminal-off gap or an unmarked session break. A percentile is a statement about
a distribution; a window that jumps a night is a statement about two.

**Required:** the frozen percentile contract must add maximum permitted spacing between consecutive
samples, must distinguish a scheduled session break from a feed gap rather than treating both as
"the previous bar", and must return `insufficient_history` rather than a threshold when the rule is
violated — the same standard `research/hybrid_ml/dataset.py:214` already applies as
`missing_or_invalid_past_13`.

### P1 — the power contract names no test statistic, so its minimum cannot be calculated

Doubt 7 freezes the estimand, the SESOI, alpha, target power and the block unit, then requires "the
minimum number of independent blocks and opportunities produced by that power calculation". A power
calculation needs an estimator and an inference procedure; neither is named. "Holm-adjusted p-values"
says how to correct three numbers, not how any one of them is produced. As written, two honest
implementers will compute different minimums from the same frozen row, which is exactly the ambiguity
the freeze exists to remove.

**Required:** name them in the same immutable row — the estimator (mean after-cost incremental R per
boolean-eligible opportunity), the inference procedure (moving-block bootstrap over session ×
instrument blocks, with the block length and resample count fixed), and how power is obtained
(simulation under the SESOI using per-block variance from development data only). Without those the
gate is a sentence, not a gate.

## Non-blocking findings

- **P2 — "database constraints" claims more than a database can enforce.** Plan §5 now says 0038 must
  carry "database constraints: boolean rows require score/classification null; shadow scores cannot
  determine live acceptance". The first is a real `CHECK`. The second is a property of a code path;
  no constraint can observe that a scorer's output was ignored. Enforceable neighbours exist — a
  signal may not reference a `strategy_version` whose `decision_mode` is `score_shadow` — and should
  be named as such. Split the sentence into constraints and code invariants, and give the invariants
  tests, or the plan promises a guarantee the schema will not deliver.
- **P2 — `UNDERPOWERED` is defined at two different levels.** §5 bullet 4 requires NO_TRADE / WATCH /
  GOOD / STRONG / A+ to be a contiguous, non-overlapping partition of the score range. The closure
  adds "a score band on inadequate data is `UNDERPOWERED`", but inadequate data is a property of an
  experiment, not a score interval, and Phase 2A has no classification at all. State plainly that
  `UNDERPOWERED` / `ENGINEERING_ONLY` are verdicts on an `experiment_results` row and never values of
  `signals.classification` or of a candidate row.
- **P2 — multiplicity is controlled within one family, not across versions over time.** Holm over the
  three registered contrasts is right. But doubt 2 permits successive versions, and each new version
  starts a fresh family at alpha 0.05; run enough versions and something passes. The review's own
  rule that a verdict "requires a later untouched interval" is the real protection and should be
  stated as the controlling one, with the attempt count and the interval each attempt consumed
  recorded in the experiment registry. An "attempt budget" with no number and no keeper is not a
  control.
- **P2 — required change #3 is superseded and should be marked so.** It asks the owner to "approve
  exchange-time session definitions". §0V.1 P1 #3, merged into the same base, is precisely that
  exchange-time definitions are wrong for non-US windows and each window needs its own zone. The
  plan's status header already carries the corrected version, so nothing downstream is misled today;
  the dated review file should not be rewritten, but HANDOFF should say which wording controls.

## Checked and confirmed — not assumed

- **The §5.19 citation is exact.** HANDOFF lines 3340-3342: `poc_shift` corr 0.013 (n=376),
  `stacked_imbalance` 0.051 (n=243), `absorption` 0.027 (n=197). The review's "0.013, 0.051, 0.027
  for the three largest rule cohorts" is the number, not a paraphrase of it.
- **Holm is the right correction and the claim about it is true.** Holm-Bonferroni controls the
  family-wise error rate under arbitrary dependence between the tests, which matters here precisely
  because the three strategies share bars and features. Planning power against `0.05 / 3` is the
  conservative bound — Holm's most stringent threshold is alpha/m for the smallest p-value — so the
  planning number is correct rather than merely cautious-sounding.
- **Doubt 1 does not overclaim.** It says explicitly that a multifeature score *could* contain more
  information, and rejects only the assumption that hand-set weights do. That is the distinction the
  question was asking for.
- **Doubt 8 is explicit enough to stop a nullable score drifting into a live filter.** The stage table
  carries a "may affect live signals?" column with an exit condition per stage, and 2C requires
  written owner approval. Subject to the P2 above about what the database can actually enforce, a
  score cannot become a gate by omission.
- **The merge preserved the Phase 1 review in full.** `docs/reviews/2026-09-06-strategy-engine-phase-1-independent-review.md`
  is **byte-identical** between `acc3a64` and `6564d98`; the only deletion line in the HANDOFF diff
  across that range is the diff header itself, so §0V and all three P1 blockers survive verbatim.
- **The change is documentation only.** `git diff --name-only 36f71d4 6564d98` returns three paths,
  all under `docs/`; no executable file, migration or function changed, so the author's decision not
  to re-run the suite is correct and the 163-passing result from the Phase 1 review still stands.
  `git diff --check` passes.

## Against the §13 contract

| Contract requirement | Result |
|---|---|
| All eight doubts addressed | **Met** — each has a decision, not a restatement |
| Concrete design answer for leakage, parameter count, correlated components | **Met** |
| Verdict in ENDORSE / ENDORSE WITH CHANGES / REJECT form | **Met** — REJECT AS WRITTEN |
| Explicit answer to doubt 8, on stated evidence | **Met** — boolean-first |
| Output in `docs/reviews/`, verdict into HANDOFF | **Met** |
| "Do not approve your own later implementation" | **Met** — required change #6 |
| Severity for every finding, from P0/P1/P2 | **Partly** — severities given, but no P2 finding exists at all, and doubts 5-7 do not quote the plan claim they contradict |
| "Then find what the list misses" | **Not met in this artifact.** Every finding maps to one of the eight doubts I supplied. The earlier revision did add something nobody listed — "missing is not zero evidence", now §5 bullet 3 — and it deserves to be recorded here as the review's own find rather than left in a superseded commit |
| "Name the query or artifact that would settle it" where a claim is empirical | **Partly** — §5.19 is cited precisely; the `tick_size` claim in doubt 4 names neither §0Q/§0R nor `docs/queries/btcusdt_identity_series.sql`; and the block count that decides doubt 7 was never measured though one query settles it |
| "States plainly what it could not check" | **Not met** — there is a production statement but no not-verified section |

The two unmet items are the same omission seen from two sides: the review reasons about the design
correctly but does not go to the data, so it cannot find what the doubt list missed and cannot say
what it could not check. The three P1s above are what going to the data produced.

## What I could not check

- I did not re-derive the SESOI, because there is none — it is an owner input and remains unset.
- I did not test the proposed 0038 constraints, because no migration exists yet; the P2 about
  enforceability is read off the plan's wording, not off DDL.
- I did not evaluate whether the three strategies are *good* strategies. Nothing in the repository
  can answer that yet, which is the point of the P1 above.
- The block census uses a 17:00 America/Chicago rollover and an 08:30-15:00 US-regular window because
  those are the plan's defaults; the owner has not approved session times, so the counts move if the
  definitions do. The order of magnitude does not.
- I am the author of the plan under review. My endorsement of the review's verdict is worth less than
  an independent one would be, and the owner should read it as the plan's author conceding the point,
  not as a second opinion.

## Runtime, deploy and rollback

Nothing was changed but this file, the census query and the handoff entry. No migration was applied,
no Edge Function deployed, no rule parameter changed, no data written, no signal created, no Telegram
message sent, no ATAS DLL built or installed. Every statement run against the live project was a
read-only `SELECT`; the queries are saved in `docs/queries/strategy_block_census.sql` so the numbers
can be reproduced or refuted. Rollback is a revert of this documentation commit, with no database
state to undo.
