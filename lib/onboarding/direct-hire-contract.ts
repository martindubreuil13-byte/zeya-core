export const DIRECT_HIRE_ONBOARDING_PATH = "/onboarding";

export const DIRECT_HIRE_ONBOARDING_STATES = [
  "first_meeting",
  "preparation",
] as const;

export const DIRECT_HIRE_PREPARATION_STATUSES = ["not_started", "queued"] as const;

export type DirectHireOnboardingState =
  (typeof DIRECT_HIRE_ONBOARDING_STATES)[number];

export type DirectHirePreparationStatus =
  (typeof DIRECT_HIRE_PREPARATION_STATUSES)[number];

export type DirectHireOnboardingStatus = {
  state: DirectHireOnboardingState;
  preparationStatus: DirectHirePreparationStatus;
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
