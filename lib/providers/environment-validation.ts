/**
 * Shared environment validation for ElevenLabs environment routing.
 * FAIL CLOSED: Missing or invalid environments cause explicit errors.
 * Never silently defaults to production.
 */

export type ValidatedEnvironment = "staging" | "production";

const ALLOWED_ENVIRONMENTS: readonly ValidatedEnvironment[] = ["staging", "production"];

/**
 * Validate ELEVENLABS_ENVIRONMENT variable.
 * Throws if missing or invalid.
 */
export function validateEnvironment(env: string | undefined): ValidatedEnvironment {
  if (!env) {
    throw new Error(
      "ELEVENLABS_ENVIRONMENT not configured. " +
      "Set to 'staging' or 'production' in deployment environment variables."
    );
  }

  if (!ALLOWED_ENVIRONMENTS.includes(env as ValidatedEnvironment)) {
    throw new Error(
      `ELEVENLABS_ENVIRONMENT='${env}' is invalid. ` +
      `Allowed values: ${ALLOWED_ENVIRONMENTS.join(", ")}`
    );
  }

  return env as ValidatedEnvironment;
}

/**
 * Get validated environment from process.env.
 * Throws if missing or invalid.
 */
export function getValidatedEnvironment(): ValidatedEnvironment {
  return validateEnvironment(process.env.ELEVENLABS_ENVIRONMENT);
}
