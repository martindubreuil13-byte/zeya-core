// ExecutionPlan module — Mission planning and dispatch orchestration

export { buildExecutionPlan } from "./execution-plan-builder";
export type { ExecutionPlanInput, ExecutionTarget } from "./execution-plan-builder";

export { createWorkerBriefsFromExecutionPlan } from "./execution-plan-to-worker-briefs";

export { dispatchExecutionPlan } from "./execution-plan-dispatcher";
export type { DispatchedExecutionPlan } from "./execution-plan-dispatcher";

export { buildExecutionPlanSummary } from "./execution-plan-summary";
export type { ExecutionPlanSummary } from "./execution-plan-summary";

export type {
  ExecutionPlanStatus,
  ExecutionPlanPriority,
  ExecutionPlanMode,
  ExecutionPlanStepStatus,
  ExecutionPlanStep,
  ExecutionPlan,
  ExecutionPlanWithDispatch,
} from "./execution-plan-types";
