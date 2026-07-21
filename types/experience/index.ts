import type { OnboardingGoal } from "@/types/onboarding";

export type RepresentationFit = "high" | "medium" | "low";
export type ConversionAction = "show_plans" | "follow_up" | null;

export interface BusinessInsights {
  businessType?: string;
  offer?: string;
  targetCustomer?: string;
  goal?: OnboardingGoal;
  challenge?: string;
  opportunity?: string;
  buyingSignals?: string[];
  concerns?: string[];
  representationFit: RepresentationFit;
  representationReasoning: string;
  recommendedNextStep: string;
  confidence?: "high" | "medium" | "low";
}

export interface ConversationAnalysis {
  insights: BusinessInsights;
  confidence: "high" | "medium" | "low";
  extractedFrom: number; // number of transcript entries analyzed
  nameConfidence?: "high" | "medium" | "low";
  extractedName?: string;
}

export interface PostCallState {
  conversionAction: ConversionAction;
  followUpEmail?: string;
  followUpName?: string;
}

export interface PlansOffering {
  id: string;
  name: string;
  description: string;
  features: string[];
  priceInfo?: string;
  recommended?: boolean;
}

export interface FollowUpLead {
  id: string;
  visitorName: string;
  visitorEmail: string;
  visitorPhone: string;
  businessSummary?: string;
  goal?: OnboardingGoal;
  representationFit: RepresentationFit;
  capturedAt: string;
}

export type RepresentationBriefEvidenceSourceType =
  | "zeya_conversation"
  | "veya_call";

export interface RepresentationBriefEvidenceSource {
  sourceType: RepresentationBriefEvidenceSourceType;
  sourceId: string;
  speaker: "visitor" | "zeya" | "veya";
  excerpt: string;
  supports: Array<
    | "what_i_heard"
    | "what_stood_out"
    | "what_that_may_mean"
    | "where_i_would_begin"
  >;
}

export interface RepresentationBriefValidation {
  evidence: "pass" | "fail";
  interpretation: "pass" | "fail";
  governance: "pass" | "fail";
  violations: string[];
}

export interface RepresentationBrief {
  id?: string;
  whatIHeard: string;
  whatStoodOut: string;
  whatThatMayMean: string;
  whereIWouldBegin: string;
  alignmentQuestion: string;
  confidenceLevel: "high" | "medium" | "requires_clarification";
  totalWordCount: number;
  evidenceSources: RepresentationBriefEvidenceSource[];
  validation: RepresentationBriefValidation;
}

export type RepresentationBriefResponseType="confirm"|"refine"|"redirect"|"continue";
