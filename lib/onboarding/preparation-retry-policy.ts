/**
 * Preparation Retry Policy
 *
 * Classifies failures as deterministic (terminal) or transient (retryable).
 * Failed preparations never auto-retry on page load. Retryable failures may only
 * be retried through an explicit owner action while attempts remain.
 */

const TERMINAL_FAILURE_CODES = new Set([
  'preparation_reasoning_snapshot_invalid',
  'preparation_reasoning_observation_scope_invalid',
  'brief_input_snapshot_invalid',
  'preparation_reasoning_persistence_failed',
  'preparation_reasoning_readback_failed',
]);

export function isRetryableFailure(failureCode: string | null | undefined): boolean {
  if (!failureCode) return true;
  return !TERMINAL_FAILURE_CODES.has(failureCode);
}

export function shouldAutoTriggerPreparation(
  preparationStatus: string,
  failureCode: string | null | undefined,
  attemptCount: number,
  maxAttempts: number = 10,
  preparationCurrent: boolean = true,
): boolean {
  if (attemptCount >= maxAttempts) return false;
  switch (preparationStatus) {
    case 'pending':
      return true;
    case 'running':
      return true;
    case 'failed':
      return false;
    case 'ready':
      return !preparationCurrent;
    case 'partial':
    default:
      return false;
  }
}

export type PreparationRequestGuard = {
  tryStart(sessionId: string, explicitRetry?: boolean): boolean;
  finish(sessionId: string): void;
};

export function createPreparationRequestGuard(): PreparationRequestGuard {
  const inFlight = new Set<string>();
  const automaticallyAttempted = new Set<string>();
  return {
    tryStart(sessionId, explicitRetry = false) {
      if (inFlight.has(sessionId) || (!explicitRetry && automaticallyAttempted.has(sessionId))) return false;
      inFlight.add(sessionId);
      if (!explicitRetry) automaticallyAttempted.add(sessionId);
      return true;
    },
    finish(sessionId) {
      inFlight.delete(sessionId);
    },
  };
}

export function shouldAllowExplicitPreparationRetry(
  preparationStatus: string,
  failureCode: string | null | undefined,
  attemptCount: number,
  maxAttempts: number = 10,
): boolean {
  return preparationStatus === 'failed'
    && attemptCount < maxAttempts
    && isRetryableFailure(failureCode);
}
