export const DIRECT_HIRE_ONBOARDING_PATH = "/onboarding";

export const DIRECT_HIRE_ONBOARDING_STATES = [
  "first_meeting",
  "preparation",
] as const;

export const DIRECT_HIRE_PREPARATION_STATUSES = [
  "not_started",
  "queued",
  "running",
  "ready",
  "partial",
  "failed",
] as const;

export type DirectHireOnboardingState =
  (typeof DIRECT_HIRE_ONBOARDING_STATES)[number];

export type DirectHirePreparationStatus =
  (typeof DIRECT_HIRE_PREPARATION_STATUSES)[number];

export type DirectHireOnboardingStatus = {
  state: DirectHireOnboardingState;
  preparationStatus: DirectHirePreparationStatus;
  preparation: DirectHirePreparationView;
};

export const DIRECT_HIRE_PROGRESS_STEPS = [
  "validating_destination",
  "homepage",
  "about",
  "products_services",
  "evidence",
  "observations",
] as const;

export type DirectHireProgressStep = (typeof DIRECT_HIRE_PROGRESS_STEPS)[number];
export type DirectHireProgressValue = "pending" | "running" | "complete" | "skipped" | "failed";
export type DirectHireProgress = Partial<Record<DirectHireProgressStep, DirectHireProgressValue>>;

export type DirectHireSafeFailureCode =
  | "unsupported_site"
  | "unsafe_destination"
  | "dns_failed"
  | "redirect_blocked"
  | "too_many_redirects"
  | "response_too_large"
  | "response_compressed"
  | "unsupported_content_type"
  | "request_timeout"
  | "request_failed"
  | "robots_disallowed"
  | "no_usable_evidence"
  | "persistence_failed";

export type DirectHirePreparationView = {
  authorized: boolean;
  progress: DirectHireProgress;
  successfulPageCount: number;
  failedPageCount: number;
  attemptCount: number;
  retryAvailable: boolean;
  failureCode: DirectHireSafeFailureCode | null;
  completedAt: string | null;
};

export type DirectHireProfileInput = {
  ownerName: string;
  businessName: string;
  website: string;
  phone: string;
  growthPriority: string;
};

export type DirectHireProfileField = keyof DirectHireProfileInput;

export type DirectHireProfileErrors = Partial<
  Record<DirectHireProfileField, string>
>;

export type DirectHireProfileValidation =
  | {
      success: true;
      data: DirectHireProfileInput;
    }
  | {
      success: false;
      errors: DirectHireProfileErrors;
    };
