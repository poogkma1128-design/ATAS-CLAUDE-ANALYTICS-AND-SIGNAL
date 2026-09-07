# Repository Working Rules

These instructions apply to every agent working anywhere in this repository.

## Mandatory Handoff Gate

Before editing any source code, configuration, migration, script, test, deployment file, or runtime setting:

1. Read `docs/HANDOFF.md` completely. Do not rely on memory, a previous chat, or an older checkout.
2. Start with the newest canonical status section at the top of the Handoff, then reconcile the requested task with the relevant historical and technical sections.
3. Check the active Git branch and working-tree status. For time-sensitive production claims, verify the live system read-only instead of copying an old version number or feed status from the Handoff.
4. If the request conflicts with a Handoff safety gate, evidence requirement, or owner-only decision, stop before changing runtime behavior. Explain the conflict, its L1/L2/L3 severity, and the likely consequence so the owner can decide.

No implementation edit may begin until this gate is complete. Reading only a chat summary is not a substitute for reading the repository Handoff.

## Mandatory Experiment and Review Gate

For any work that proposes, runs, interprets, or approves a signal-quality experiment, also read and follow
`docs/EXPERIMENT_REVIEW_PROTOCOL.md` before changing code, parameters, production state, or an empirical
conclusion.

1. Assign four lifecycle roles explicitly: Proposer, Executor/Recorder, Independent Reviewer, and Owner.
   A model preference in the Handoff is only routing guidance; it never waives role separation.
2. The Proposer may not decide its own hypothesis. The Executor/Recorder may not approve its own run or
   report. The Independent Reviewer must re-query raw artifacts, not review only the narrative.
3. Run Gate 0 before a parameter sweep. Record marginal and conditional bind/pass rates by instrument,
   direction, and session, together with units, distributions, null/degenerate rates, and sensitivity.
4. Every empirical claim must cite a reproducible evidence packet: exact experiment IDs, code/query commit,
   data window, planned/attempted/succeeded/failed/omitted/superseded variants, baseline metrics, and the
   independent review status. SQL/DB is the source of numerical evidence, not a human or AI reviewer.
5. Until per-opportunity artifacts and session-by-instrument block resampling exist, do not claim that a
   variant difference is statistically significant. A better aggregate is an observation, not proof.
6. Before obeying a misassigned or unsafe request, respond in the required L1-L4 format from the protocol.
   Production alerts, filters, rules, secrets, GUI installation, and anything that can reach real money retain
   the owner-only approvals defined there.

## Mandatory Completion Gate

Before declaring any change complete:

1. Update `docs/HANDOFF.md` with what changed, what was or was not deployed, verification evidence, remaining work, risks, owner actions, and rollback instructions when relevant.
2. Update any other affected setup, runbook, architecture, or user documentation. If no additional document is needed, record that fact and the reason in the Handoff.
3. Run checks proportional to the change and inspect the final Git diff/status.
4. Commit and push the documentation with the implementation. A Handoff update that exists only locally is not visible to another machine or agent; it becomes shared on the target branch only after the PR is merged.

## Scope and Honest Limitation

`AGENTS.md` is enforced only by agents and tools that load repository instructions. Chat sessions that have not opened this repository, agents working from an older revision, and AI products that ignore `AGENTS.md` are not covered. For those environments, the owner must still explicitly say: “Read `docs/HANDOFF.md` before making changes.”
