# Phase 12-prep.6 ExecutionPlan Audit

## Scope

Compared only the existing `ExecutionPlan` models in:

- `lib/orchestration`
- `lib/execution-plans`

No refactor was performed.

## Findings

### `lib/orchestration`

- Purpose: deterministic work coordination and readiness planning.
- Model shape: business-level `ExecutionPlan` with `businessId`, `workItems`, `assignments`, `blockers`, `nextAction`, `readiness`, and `blockerCount`.
- Strength: good for operating-state decisions before execution is ready.
- Strength: captures blockers, founder review, workforce assignment, and readiness.
- Limitation: does not produce worker-runtime steps directly.
- Limitation: does not map cleanly to `WorkerBrief` generation without another adapter.
- Limitation: `buildExecutionPlan()` name collides with the execution-plan builder name.

### `lib/execution-plans`

- Purpose: operational plan between Mission or ExecutionRequest and WorkerBrief.
- Model shape: execution-level `ExecutionPlan` with `missionId`, optional `executionRequestId`, `companyContext`, `missionObjective`, `desiredOutcome`, `plannedSteps`, `assumptions`, `risks`, and `successCriteria`.
- Strength: already used by Operational Intelligence through `buildExecutionPlanFromOperationalAnalysis()`.
- Strength: already converts to `WorkerBrief[]`.
- Strength: matches Phase 12 bridge requirement: Mission -> Operational Intelligence -> ExecutionPlan -> WorkerBrief.
- Strength: cleanly separates execution steps from provider dispatch.
- Limitation: lacks `businessId`, assignment readiness, and blocker state.

## Recommendation

The canonical execution model for Phase 12 runtime execution should be `lib/execution-plans`.

Reason: the bridge layer needs the model that Operational Intelligence already emits and WorkerBrief generation already consumes. `lib/orchestration` should survive as the upstream readiness and work-coordination model, but it should not be the canonical runtime `ExecutionPlan` for Mission -> Operational Intelligence -> WorkerBrief flow.

Recommended naming direction for a later cleanup: keep `lib/execution-plans` as `ExecutionPlan`; rename the `lib/orchestration` concept in docs/types to something like `WorkOrchestrationPlan` or `OperatingPlan` to remove ambiguity.
