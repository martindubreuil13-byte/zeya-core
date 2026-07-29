// Representation Formation Session Types
// Mirrors Supabase schema for Formation Session orchestration

// ─────────────────────────────────────────────────────────────────────
// ENUM TYPES
// ─────────────────────────────────────────────────────────────────────

export type FormationSessionStatus =
  | 'initiated'
  | 'getting_familiar'
  | 'working_conversation_pending'
  | 'working_conversation_linked';

export type FormationInitiationSource =
  | 'public_experience_session'
  | 'representation_brief'
  | 'callback'
  | 'owner_request';

// ─────────────────────────────────────────────────────────────────────
// PERSISTENCE MODELS
// ─────────────────────────────────────────────────────────────────────

export interface FormationSessionRow {
  id: string;
  business_id: string;
  business_representation_id: string;
  owner_id: string;
  status: FormationSessionStatus;
  initiated_from: FormationInitiationSource | null;
  initiated_from_id: string | null;
  public_experience_session_id: string | null;
  representation_brief_id: string | null;
  first_working_conversation_id: string | null;
  formation_started_at: string;
  created_at: string;
  updated_at: string;
}

// ─────────────────────────────────────────────────────────────────────
// DOMAIN ENTITIES
// ─────────────────────────────────────────────────────────────────────

export interface FormationSession {
  id: string;
  businessId: string;
  businessRepresentationId: string;
  ownerId: string;
  status: FormationSessionStatus;
  initiatedFrom: FormationInitiationSource | null;
  initiatedFromId: string | null;
  publicExperienceSessionId: string | null;
  representationBriefId: string | null;
  firstWorkingConversationId: string | null;
  formationStartedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ─────────────────────────────────────────────────────────────────────
// API REQUEST/RESPONSE TYPES
// ─────────────────────────────────────────────────────────────────────

export interface InitiateFormationRequest {
  businessId: string;
  initiatedFrom?: FormationInitiationSource;
  initiatedFromId?: string;
}

export interface InitiateFormationResponse {
  sessionId: string;
  businessRepresentationId: string;
  status: FormationSessionStatus;
  initiatedAt: string;
}

export interface FormationSessionStatusResponse {
  sessionId: string;
  businessRepresentationId: string;
  status: FormationSessionStatus;
  initiatedAt: string;
  linkedContextSummary?: {
    fromPublicExperience?: boolean;
    fromRepresentationBrief?: boolean;
    workingConversationLinked?: boolean;
  };
  nextAction?: string;
}

export interface LinkConversationRequest {
  conversationId: string;
  conversationType?: string;
}

export interface LinkConversationResponse {
  sessionId: string;
  status: FormationSessionStatus;
  linkedAt: string;
}


// ─────────────────────────────────────────────────────────────────────
// MUTATION COMMANDS
// ─────────────────────────────────────────────────────────────────────

export interface InitiateFormationSessionCommand {
  businessId: string;
  businessRepresentationId: string;
  ownerId: string;
  initiatedFrom?: FormationInitiationSource;
  initiatedFromId?: string;
}

export interface AdvanceFormationStatusCommand {
  sessionId: string;
  businessRepresentationId: string;
  expectedCurrentStatus: FormationSessionStatus;
  newStatus: FormationSessionStatus;
  transitionDetails?: Record<string, unknown>;
}

export interface LinkFormationConversationCommand {
  sessionId: string;
  businessRepresentationId: string;
  conversationId: string;
  conversationType?: string;
}

// ─────────────────────────────────────────────────────────────────────
// FORMATION SUMMARY TYPES
// ─────────────────────────────────────────────────────────────────────

export interface FormationSummarySection {
  title: string;
  content: string;
}

export interface FormationSummaryMetadata {
  formationSessionId: string;
  reviewType: 'formation_initial_review';
  sourceFingerprint: string;
  generatorVersion: string;
  reviewedAt: string; // ISO-8601 timestamp
  reviewedByOwnerId: string;
}

export interface FormationSummary {
  proposalId: string;
  sourceFingerprint: string;
  generatorVersion: string;
  isCurrent: boolean;
  sections: FormationSummarySection[];
}

export interface FormationSummaryRequest {
  proposalId?: string;
  sourceFingerprint?: string;
}

export interface FormationApprovalRequest {
  proposalId: string;
  sourceFingerprint: string;
}

export interface FormationApprovalResponse {
  success: boolean;
  versionId?: string;
  message: string;
}
