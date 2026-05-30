export type CallOutcome =
  | "answered"
  | "voicemail"
  | "no_answer"
  | "wrong_number"
  | "not_interested"
  | "follow_up"
  | "qualified"
  | "closed";

export type InterestLevel = "low" | "medium" | "high" | "unknown";

export type LearningType =
  | "objection_pattern"
  | "message_resonance"
  | "follow_up_pattern"
  | "outcome_pattern";

export interface CallResult {
  id: string;
  business_id: string;
  assignment_id: string | null;
  lead_id: string | null;
  outcome: CallOutcome;
  interest_level: InterestLevel | null;
  objection: string | null;
  follow_up_required: boolean;
  follow_up_date: string | null;
  summary: string | null;
  created_at: string;
}

export interface CreateCallResultInput {
  businessId: string;
  assignmentId?: string | null;
  leadId?: string | null;
  outcome: CallOutcome;
  interestLevel?: InterestLevel | null;
  objection?: string | null;
  followUpRequired?: boolean;
  followUpDate?: string | null;
  summary?: string | null;
}

export interface LearningEvent {
  id: string;
  business_id: string;
  mission_key: string | null;
  learning_type: LearningType;
  title: string;
  description: string | null;
  confidence: number;
  source_count: number;
  created_at: string;
}

export interface CreateLearningEventInput {
  businessId: string;
  missionKey?: string | null;
  learningType: LearningType;
  title: string;
  description?: string | null;
  confidence: number;
  sourceCount: number;
}

export type DerivedLearningEvent = Omit<LearningEvent, "id" | "created_at">;
