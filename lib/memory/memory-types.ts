// Memory Types — Persistent record of business knowledge evolution
// Memory ≠ Profile: Profile is current truth, Memory is history of truth

// ─── Core Memory Event ──────────────────────────────────────────────────────

export interface MemoryEvent {
  // Identification
  id: string; // UUID
  businessId: string;

  // Classification
  type: string; // "BUSINESS_PROFILE_UPDATED", "PRICING_OBJECTION_FOUND", etc.
  category: MemoryCategory;

  // Source and context
  source: MemorySource; // "CONVERSATION", "CALL_RESULT", "MANUAL", etc.
  field: string | null; // Which profile field was affected (if any)

  // Values
  previousValue: any; // What it was before
  newValue: any; // What it is now

  // Quality metrics
  confidence: number; // 0-100, how confident in this fact
  strength: "weak" | "moderate" | "strong"; // How well-supported

  // Metadata
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  expiresAt?: string; // Optional: when this learning becomes stale

  // Optional context
  relatedEventIds?: string[]; // Links to related events
  notes?: string; // Human or system notes
}

// ─── Memory Categories ──────────────────────────────────────────────────────

export type MemoryCategory =
  | "BUSINESS_PROFILE"
  | "MISSION"
  | "ICP"
  | "LEADS"
  | "CALL_RESULTS"
  | "LEARNINGS"
  | "WORKFORCE"
  | "WORKFLOW"
  | "MESSAGING"
  | "COMPETITIVE"
  | "OTHER";

// ─── Memory Source ──────────────────────────────────────────────────────────

export type MemorySource =
  | "CONVERSATION" // From founder response
  | "CALL_RESULT" // From sales call
  | "MANUAL" // Founder entered directly
  | "INFERENCE" // Derived from other events
  | "SYSTEM" // Auto-generated
  | "IMPORT"; // From external system

// ─── Learning Event (Derived from raw memory) ───────────────────────────────

export interface LearningEvent {
  id: string;
  businessId: string;

  // What pattern was detected
  pattern: string; // "PRICING_OBJECTION", "ICP_CHANGED", etc.
  category: MemoryCategory;

  // The evidence
  evidence: string[]; // Which memory events support this
  confidence: number; // 0-100

  // The insight
  description: string; // Human-readable learning
  implication: string; // What this means for business

  // Metadata
  createdAt: string;
  validatedAt?: string; // When founder confirmed this

  // Related facts
  relatedEvents?: string[]; // Memory event IDs that support this
}

// ─── Business Knowledge (Derived from all memory) ────────────────────────────

export interface BusinessKnowledge {
  businessId: string;

  // Core facts (high confidence, validated)
  knownFacts: KnownFact[];

  // Working hypotheses (lower confidence)
  assumptions: Assumption[];

  // Evidence-backed learnings (from multiple sources)
  validatedLearnings: ValidatedLearning[];

  // Questions to resolve
  openQuestions: OpenQuestion[];

  // Metadata
  generatedAt: string;
  confidence: number; // Overall confidence in this knowledge base
  coverage: number; // What % of business is understood (0-100)
}

export interface KnownFact {
  id: string;
  statement: string; // "Target customers are restaurant owners"
  category: MemoryCategory;
  confidence: number; // 0-100
  sources: string[]; // Memory event IDs
  firstObserved: string; // ISO timestamp
  lastConfirmed: string; // ISO timestamp
  stable: boolean; // Has this fact remained consistent?
}

export interface Assumption {
  id: string;
  statement: string; // "Pricing may be a barrier"
  category: MemoryCategory;
  confidence: number; // 0-100 (typically lower)
  evidence: string[]; // What suggests this
  testable: boolean; // Can we validate this?
  priority: "low" | "medium" | "high"; // How important to validate?
}

export interface ValidatedLearning {
  id: string;
  learning: string; // "7 prospects mentioned pricing concerns"
  category: MemoryCategory;
  confidence: number; // 0-100 (typically high)
  evidence: string[]; // Memory event IDs supporting this
  frequency: number; // How often observed
  implication: string; // What this means
  actionable: boolean; // Can we act on this?
}

export interface OpenQuestion {
  id: string;
  question: string; // "What's the best acquisition channel?"
  category: MemoryCategory;
  priority: "low" | "medium" | "high";
  relatedFacts: string[]; // Known facts relevant to this question
  testMethods: string[]; // How to answer this
}

// ─── Memory Event Update Result ──────────────────────────────────────────────

export interface MemoryPersistenceResult {
  success: boolean;
  savedEventIds: string[];
  newLearnings: LearningEvent[];
  updatedKnowledge: BusinessKnowledge | null;
  errors: string[];
}

// ─── Query Types ────────────────────────────────────────────────────────────

export interface MemoryQuery {
  businessId: string;
  category?: MemoryCategory;
  source?: MemorySource;
  since?: string; // ISO timestamp
  until?: string; // ISO timestamp
  field?: string;
  limit?: number;
}

export interface MemoryQueryResult {
  events: MemoryEvent[];
  total: number;
  hasMore: boolean;
}
