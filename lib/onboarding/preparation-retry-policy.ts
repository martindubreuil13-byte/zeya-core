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
): boolean {
  switch (preparationStatus) {
    case 'pending':
      return true;
    case 'running':
      return true;
    case 'failed':
      return false;
    case 'ready':
    case 'partial':
    default:
      return false;
  }
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
