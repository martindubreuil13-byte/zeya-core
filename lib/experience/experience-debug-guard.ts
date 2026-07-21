export type ExperienceDebugEnvironment = {
  publicFlag?: string;
  vercelEnv?: string;
  nodeEnv?: string;
};

export function isExperienceDebugEnabled(environment: ExperienceDebugEnvironment) {
  if (environment.publicFlag !== "true") return false;
  if (environment.vercelEnv === "production") return false;
  if (environment.vercelEnv === "preview") return true;
  return !environment.vercelEnv && environment.nodeEnv === "development";
}
