export type OnboardingGoal = "leads" | "revenue" | "operations" | "retention" | "other";

export type OnboardingMemory = {
  businessName?: string;
  businessType?: string;
  offer?: string;
  audience?: string;
  icp?: string[];
  painPoints?: string[];
  goal?: OnboardingGoal;
  objections?: string[];
  qualificationSignals?: string[];
  tonePreference?: string;
  outboundGoals?: string[];
  openQuestions?: string[];
};
