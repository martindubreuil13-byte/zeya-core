// Conversation State Engine
// Converts founder responses into memory updates and workflow progression
// Input: conversation + current state → Output: facts + memory events + profile updates

import type { BusinessState } from "./types";
import type { ExecutiveGuidance } from "./derive-executive-guidance";
import type { ConversationObjective } from "./conversation-objective-types";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";

export interface ConversationResponseInput {
  businessState: BusinessState;
  executiveGuidance: ExecutiveGuidance;
  conversationObjective: ConversationObjective;
  founderResponse: string;
}

export interface ExtractedFacts {
  [key: string]: string | string[] | null;
}

export interface MemoryEvent {
  type: "BUSINESS_PROFILE_UPDATED" | "EXTRACTION_RECORDED";
  field: string;
  previousValue: any;
  newValue: any;
  timestamp: string;
  source: "CONVERSATION";
}

export interface ExtractionResult {
  extractedFacts: ExtractedFacts;
  memoryEvents: MemoryEvent[];
  profileUpdates: Partial<BusinessMemory>;
  workflowNeedsRefresh: boolean;
  confidence: number; // 0-100, how confident in extraction
}

// ─── Extraction Rules by Conversation Objective ─────────────────────────────

function extractFromBusinessContext(response: string): ExtractedFacts {
  // Question: "What does your business do?"
  const facts: ExtractedFacts = {};

  // Look for description patterns
  const descriptionMatch = response.match(
    /(?:we\s+(?:help|provide|offer|solve|enable|allow).*?(?:\.|$))/i
  );
  if (descriptionMatch) {
    facts.businessDescription = descriptionMatch[0].trim();
  }

  // If no explicit pattern, use the whole response as description
  if (!facts.businessDescription && response.length > 10) {
    facts.businessDescription = response.trim();
  }

  return facts;
}

function extractFromMissionDefinition(response: string): ExtractedFacts {
  // Question: "What outcome should this mission create?"
  const facts: ExtractedFacts = {};

  // Capture the mission statement
  if (response.length > 10) {
    facts.missionOutcome = response.trim();
  }

  return facts;
}

function extractFromICPDefinition(response: string): ExtractedFacts {
  // Question: "Who is the best-fit customer?"
  const facts: ExtractedFacts = {};

  // Extract target customer
  if (response.length > 5) {
    facts.targetCustomers = response.trim();
  }

  // Look for industry patterns
  const industryMatch = response.match(
    /(?:(?:in the|for|serve|target|focus on)\s+)?([a-z\s]+?)(?:\s+(?:industry|market|space|vertical|sector)|$)/i
  );
  if (industryMatch && !facts.targetCustomers) {
    facts.targetCustomers = industryMatch[1].trim();
  }

  return facts;
}

function extractFromLeadGeneration(response: string): ExtractedFacts {
  // Question: "Where will you source prospects?"
  const facts: ExtractedFacts = {};

  if (response.length > 10) {
    facts.leadSourceStrategy = response.trim();
  }

  return facts;
}

function extractFromLeadReview(response: string): ExtractedFacts {
  // Question: "Which prospects should we prioritize first?"
  const facts: ExtractedFacts = {};

  // Just record the selection
  if (response.length > 5) {
    facts.selectedProspectCriteria = response.trim();
  }

  return facts;
}

function extractFromCallPreparation(response: string): ExtractedFacts {
  // Question: "What should the caller know?"
  const facts: ExtractedFacts = {};

  if (response.length > 10) {
    facts.callerInstructions = response.trim();
  }

  return facts;
}

function extractFromResultReview(response: string): ExtractedFacts {
  // Question: "What pattern do you see in the responses?"
  const facts: ExtractedFacts = {};

  if (response.length > 10) {
    facts.callPatterns = response.trim();
  }

  // Look for common objections
  const objectionMatch = response.match(/(?:objection|said|asked|concern)[:\s]+(.*?)(?:\.|$)/i);
  if (objectionMatch) {
    facts.objections = [objectionMatch[1].trim()];
  }

  return facts;
}

function extractFromOptimization(response: string): ExtractedFacts {
  // Question: "What should we change?"
  const facts: ExtractedFacts = {};

  if (response.length > 10) {
    facts.optimizationSuggestion = response.trim();
  }

  return facts;
}

// ─── Main Extraction Router ──────────────────────────────────────────────────

function extractFacts(
  objectiveType: string,
  response: string
): ExtractedFacts {
  switch (objectiveType) {
    case "COLLECT_BUSINESS_CONTEXT":
      return extractFromBusinessContext(response);
    case "DEFINE_MISSION":
      return extractFromMissionDefinition(response);
    case "DEFINE_ICP":
      return extractFromICPDefinition(response);
    case "REQUEST_LEADS":
      return extractFromLeadGeneration(response);
    case "REVIEW_LEADS":
      return extractFromLeadReview(response);
    case "PREPARE_CALLER_BRIEF":
      return extractFromCallPreparation(response);
    case "REQUEST_CALL_RESULTS":
      return extractFromCallPreparation(response);
    case "REVIEW_RESULTS":
      return extractFromResultReview(response);
    case "OPTIMIZE_WORKFLOW":
      return extractFromOptimization(response);
    default:
      return {};
  }
}

// ─── Profile Update Mapping ──────────────────────────────────────────────────

const EXTRACTION_TO_PROFILE: Record<string, keyof BusinessMemory> = {
  businessDescription: "positioning",
  missionOutcome: "first_mission",
  targetCustomers: "target_customers",
  leadSourceStrategy: "acquisition_channels",
  selectedProspectCriteria: "known_facts",
  callerInstructions: "caller_brief",
  callPatterns: "validated_learnings",
  objections: "objections",
  optimizationSuggestion: "validated_learnings",
};

function buildProfileUpdates(
  facts: ExtractedFacts,
  previousProfile: Partial<BusinessMemory>
): Partial<BusinessMemory> {
  const updates: Partial<BusinessMemory> = {};

  for (const [factKey, factValue] of Object.entries(facts)) {
    const profileField = EXTRACTION_TO_PROFILE[factKey];

    if (profileField && factValue) {
      // Append to existing values (newline-separated for these fields)
      if (profileField === "objections" || profileField === "known_facts" || profileField === "validated_learnings") {
        const existingValue = (previousProfile[profileField] as string) || "";
        if (Array.isArray(factValue)) {
          const newLines = factValue.join("\n");
          updates[profileField] = existingValue ? `${existingValue}\n${newLines}` : newLines;
        } else {
          updates[profileField] = existingValue ? `${existingValue}\n${factValue}` : (factValue as string);
        }
      } else {
        // Handle string fields (overwrite)
        updates[profileField] = factValue as string;
      }
    }
  }

  return updates;
}

// ─── Memory Event Creation ───────────────────────────────────────────────────

function createMemoryEvents(
  facts: ExtractedFacts,
  previousProfile: Partial<BusinessMemory>
): MemoryEvent[] {
  const events: MemoryEvent[] = [];

  for (const [factKey, factValue] of Object.entries(facts)) {
    const profileField = EXTRACTION_TO_PROFILE[factKey];

    if (profileField && factValue) {
      const previousValue = previousProfile[profileField] || null;

      events.push({
        type: "BUSINESS_PROFILE_UPDATED",
        field: profileField,
        previousValue,
        newValue: factValue,
        timestamp: new Date().toISOString(),
        source: "CONVERSATION",
      });
    }
  }

  return events;
}

// ─── Confidence Scoring ──────────────────────────────────────────────────────

function calculateConfidence(facts: ExtractedFacts, response: string): number {
  let confidence = 50; // baseline

  // More facts extracted = higher confidence
  const factCount = Object.keys(facts).length;
  confidence += factCount * 10;

  // Longer response = more confidence
  if (response.length > 100) confidence += 15;
  if (response.length > 200) confidence += 10;

  // Direct answer patterns = higher confidence
  if (response.match(/^(?:we|i|the)\s+/i)) confidence += 10;

  return Math.min(100, confidence);
}

// ─── Main Engine ────────────────────────────────────────────────────────────

export function processConversationResponse(
  input: ConversationResponseInput,
  previousProfile: Partial<BusinessMemory>
): ExtractionResult {
  const { founderResponse, conversationObjective } = input;

  // Extract facts based on current question
  const extractedFacts = extractFacts(conversationObjective.objectiveType, founderResponse);

  // Build profile updates
  const profileUpdates = buildProfileUpdates(extractedFacts, previousProfile);

  // Create memory events
  const memoryEvents = createMemoryEvents(extractedFacts, previousProfile);

  // Determine if workflow needs refresh
  const workflowNeedsRefresh = Object.keys(profileUpdates).length > 0;

  // Calculate extraction confidence
  const confidence = calculateConfidence(extractedFacts, founderResponse);

  return {
    extractedFacts,
    memoryEvents,
    profileUpdates,
    workflowNeedsRefresh,
    confidence,
  };
}

// (Types are exported above)
