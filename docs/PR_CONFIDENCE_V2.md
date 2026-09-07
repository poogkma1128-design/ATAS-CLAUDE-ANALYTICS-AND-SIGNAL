# PR: Confidence v2 shadow tracking + AI responsibility policy

## Purpose

This PR adds Confidence v2 in **shadow mode** and documents the operating policy for using GPT/Codex
and Claude without mistaking an AI explanation for market evidence.

## What changes

- Captures immutable signal-time snapshots under `signals.payload.confidenceV2`.
- Adds read-only `public.confidence_v2_progress` for cohort progress and resolved outcomes.
- Keeps `score: null`, does not change Telegram, rule parameters, or filtering.
- Adds dashboard visibility for v2 shadow state.
- Adds §5.21 of `docs/HANDOFF.md`: responsibility split, evidence gates, and L1–L4 objection policy.

## Required operating rule

SQL/deterministic code is the source of truth for R, win rate, drawdown, fill rate, sample size and
calibration. GPT/Codex owns implementation and deployment verification; Claude owns independent
hypothesis and bias review. Neither AI may enable a production filter, Telegram behavior, or trading
action from narrative or backtest alone.

## Risk and approval

- **L1**: source/query missing — attach source before reporting.
- **L2**: unverified hypothesis or tuned-backtest claim — stay in draft/experiment.
- **L3**: enable filter/Telegram, tune while viewing results, or deploy unverified — block pending
  forward evidence, peer review, and rollback plan.
- **L4**: live trading, safety/telemetry bypass, destructive history/secret action — stop and require
  explicit owner approval with documented impact and rollback.

## Merge checklist

- [ ] Verify the migration and deployed `ingest v15` status recorded in §5.20.
- [ ] Confirm v2 remains `mode: shadow` and `score: null`.
- [ ] Do not use `legacyScore` or any v2 field as a confidence percentage or Telegram filter.
- [ ] Read §5.20 and §5.21 before any confidence, rule, or AI-directed change.
- [ ] For L3/L4 work, record scope, owner approval, proof gates and rollback in the PR/Handoff.

## Non-goals

- No promise that Confidence v2 predicts profitable trades.
- No automatic live-trading action.
- No retroactive backfill presented as signal-time evidence.
