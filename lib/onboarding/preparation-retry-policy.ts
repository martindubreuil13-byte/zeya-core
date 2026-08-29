/**
 * Preparation Retry Policy
 *
 * Classifies failures as deterministic (terminal) or transient (retryable).
 * Deterministic failures must not auto-retry on page load to avoid consuming attempts.
 * Transient failures (lease expired, network) may auto-retry while attempts < max.
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
  maxAttempts: number = 3,
): boolean {
  switch (preparationStatus) {
    case 'pending':
      return true;
    case 'running':
      return true;
    case 'failed':
      return attemptCount < maxAttempts && isRetryableFailure(failureCode);
    case 'ready':
    case 'partial':
    default:
      return false;
  }
}
