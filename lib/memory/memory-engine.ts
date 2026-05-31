// Memory Engine — Derive insights and learnings from raw memory events
// Converts raw MemoryEvents into actionable LearningEvents and BusinessKnowledge

import type { MemoryEvent, LearningEvent, BusinessKnowledge, KnownFact, Assumption, ValidatedLearning, OpenQuestion, MemoryCategory } from "./memory-types";

// ─── Learning Pattern Extraction ─────────────────────────────────────────────

interface LearningPattern {
  pattern: string;
  category: MemoryCategory;
  trigger: (events: MemoryEvent[]) => boolean;
  extract: (events: MemoryEvent[]) => Partial<LearningEvent>;
  confidence: number;
}

const LEARNING_PATTERNS: LearningPattern[] = [
  {
    pattern: "PRICING_OBJECTION_DETECTED",
    category: "CALL_RESULTS",
    trigger: (events) => {
      const pricingEvents = events.filter(
        (e) =>
          e.type.includes("OBJECTION") &&
          e.field === "objections" &&
          (String(e.newValue).toLowerCase().includes("price") ||
            String(e.newValue).toLowerCase().includes("cost") ||
            String(e.newValue).toLowerCase().includes("expensive"))
      );
      return pricingEvents.length >= 2;
    },
    extract: (events) => ({
      pattern: "PRICING_OBJECTION_DETECTED",
      description: "Multiple prospects mentioned pricing as a concern",
      implication: "Pricing may be a barrier to acquisition",
      confidence: Math.min(100, events.length * 20),
      relatedEvents: events.map((e) => e.id),
    }),
    confidence: 75,
  },

  {
    pattern: "ICP_CLARIFICATION",
    category: "ICP",
    trigger: (events) => {
      const icpChanges = events.filter(
        (e) =>
          e.field === "target_customers" &&
          e.previousValue &&
          e.newValue &&
          String(e.previousValue) !== String(e.newValue)
      );
      return icpChanges.length >= 1;
    },
    extract: (events) => ({
      pattern: "ICP_CLARIFICATION",
      description: "ICP definition evolved based on market feedback",
      implication: "Business is refining who the best customer is",
      confidence: 90,
      relatedEvents: events.map((e) => e.id),
    }),
    confidence: 85,
  },

  {
    pattern: "ACQUISITION_CHANNEL_IDENTIFIED",
    category: "LEADS",
    trigger: (events) => {
      const channelEvents = events.filter(
        (e) =>
          e.field === "acquisition_channels" ||
          (e.type.includes("LEAD") && e.newValue && !e.previousValue)
      );
      return channelEvents.length >= 1;
    },
    extract: (events) => ({
      pattern: "ACQUISITION_CHANNEL_IDENTIFIED",
      description: "A successful lead acquisition channel has been identified",
      implication: "Should focus outreach on this channel",
      confidence: 80,
      relatedEvents: events.map((e) => e.id),
    }),
    confidence: 70,
  },

  {
    pattern: "COMMON_OBJECTION_PATTERN",
    category: "CALL_RESULTS",
    trigger: (events) => {
      const objectionEvents = events.filter(
        (e) =>
          e.type.includes("OBJECTION") &&
          e.category === "CALL_RESULTS"
      );
      const grouped = groupBy(objectionEvents, (e) => String(e.newValue));
      return Object.values(grouped).some((group) => group.length >= 3);
    },
    extract: (events) => ({
      pattern: "COMMON_OBJECTION_PATTERN",
      description: "The same objection appears in multiple calls",
      implication: "Need to develop counter-argument or adjust positioning",
      confidence: 85,
      relatedEvents: events.map((e) => e.id),
    }),
    confidence: 80,
  },
];

function groupBy<T>(array: T[], key: (item: T) => any): Record<string, T[]> {
  return array.reduce((result, item) => {
    const k = key(item);
    if (!result[k]) result[k] = [];
    result[k].push(item);
    return result;
  }, {} as Record<string, T[]>);
}

// ─── Learning Extraction ────────────────────────────────────────────────────

export function deriveLearningEvents(events: MemoryEvent[]): LearningEvent[] {
  const learnings: LearningEvent[] = [];

  for (const pattern of LEARNING_PATTERNS) {
    if (pattern.trigger(events)) {
      const extraction = pattern.extract(events);
      const learning: LearningEvent = {
        id: `learning_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        businessId: events[0]?.businessId || "unknown",
        pattern: pattern.pattern,
        category: pattern.category,
        evidence: extraction.relatedEvents || [],
        confidence: extraction.confidence || pattern.confidence,
        description: extraction.description || "",
        implication: extraction.implication || "",
        createdAt: new Date().toISOString(),
      };
      learnings.push(learning);
    }
  }

  return learnings;
}

// ─── Business Knowledge Builder ──────────────────────────────────────────────

export function buildBusinessKnowledge(events: MemoryEvent[]): BusinessKnowledge {
  const knownFacts = extractKnownFacts(events);
  const assumptions = extractAssumptions(events);
  const validatedLearnings = extractValidatedLearnings(events);
  const openQuestions = deriveOpenQuestions(knownFacts, assumptions);

  const totalConfidence = calculateOverallConfidence(
    knownFacts,
    assumptions,
    validatedLearnings
  );

  return {
    businessId: events[0]?.businessId || "unknown",
    knownFacts,
    assumptions,
    validatedLearnings,
    openQuestions,
    generatedAt: new Date().toISOString(),
    confidence: totalConfidence,
    coverage: calculateCoverage(knownFacts, assumptions),
  };
}

function extractKnownFacts(events: MemoryEvent[]): KnownFact[] {
  const facts: Map<string, KnownFact> = new Map();

  // High confidence events become facts
  const highConfidenceEvents = events.filter((e) => e.confidence >= 80);

  for (const event of highConfidenceEvents) {
    const key = `${event.field}:${event.newValue}`;
    if (!facts.has(key)) {
      facts.set(key, {
        id: `fact_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        statement: `${event.field}: ${event.newValue}`,
        category: event.category,
        confidence: event.confidence,
        sources: [event.id],
        firstObserved: event.createdAt,
        lastConfirmed: event.createdAt,
        stable: true,
      });
    } else {
      const fact = facts.get(key)!;
      fact.sources.push(event.id);
      fact.lastConfirmed = event.createdAt;
      fact.confidence = Math.min(100, fact.confidence + 5);
    }
  }

  return Array.from(facts.values());
}

function extractAssumptions(events: MemoryEvent[]): Assumption[] {
  const assumptions: Assumption[] = [];

  // Events with lower confidence or "might" language become assumptions
  const lowConfidenceEvents = events.filter(
    (e) => e.confidence >= 50 && e.confidence < 80
  );

  for (const event of lowConfidenceEvents) {
    assumptions.push({
      id: `assumption_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      statement: `${event.field}: ${event.newValue}`,
      category: event.category,
      confidence: event.confidence,
      evidence: [event.id],
      testable: true,
      priority: event.confidence >= 70 ? "high" : "medium",
    });
  }

  return assumptions;
}

function extractValidatedLearnings(events: MemoryEvent[]): ValidatedLearning[] {
  const learnings: LearningEvent[] = deriveLearningEvents(events);

  return learnings.map((learning) => ({
    id: learning.id,
    learning: learning.description,
    category: learning.category,
    confidence: learning.confidence,
    evidence: learning.evidence,
    frequency: learning.evidence.length,
    implication: learning.implication,
    actionable: learning.confidence >= 75,
  }));
}

function deriveOpenQuestions(
  facts: KnownFact[],
  assumptions: Assumption[]
): OpenQuestion[] {
  const questions: OpenQuestion[] = [];

  // Assumptions become open questions to validate
  for (const assumption of assumptions) {
    questions.push({
      id: `question_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      question: `Is the assumption true: ${assumption.statement}?`,
      category: assumption.category,
      priority: assumption.priority,
      relatedFacts: facts.map((f) => f.id),
      testMethods: [
        "Ask founder",
        "Review market data",
        "Analyze call results",
      ],
    });
  }

  // Known gaps become open questions
  const coveredCategories = new Set(facts.map((f) => f.category));
  const allCategories: MemoryCategory[] = [
    "BUSINESS_PROFILE",
    "ICP",
    "LEADS",
    "CALL_RESULTS",
  ];

  for (const category of allCategories) {
    if (!coveredCategories.has(category)) {
      questions.push({
        id: `question_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        question: `What do we know about ${category.toLowerCase().replace(/_/g, " ")}?`,
        category,
        priority: "high",
        relatedFacts: [],
        testMethods: ["Ask founder", "Conduct research"],
      });
    }
  }

  return questions;
}

function calculateOverallConfidence(
  facts: KnownFact[],
  assumptions: Assumption[],
  learnings: ValidatedLearning[]
): number {
  if (facts.length === 0) return 20;

  const factConfidence = facts.reduce((sum, f) => sum + f.confidence, 0) / facts.length;
  const learningBonus = learnings.length * 10;
  const assumptionPenalty = assumptions.length * 5;

  return Math.min(100, Math.max(20, factConfidence + learningBonus - assumptionPenalty));
}

function calculateCoverage(facts: KnownFact[], assumptions: Assumption[]): number {
  const allCategories = new Set<MemoryCategory>();
  facts.forEach((f) => allCategories.add(f.category));
  assumptions.forEach((a) => allCategories.add(a.category));

  const targetCategories = 6; // Number of categories we want coverage for
  return Math.min(100, (allCategories.size / targetCategories) * 100);
}

// ─── Memory Summary ──────────────────────────────────────────────────────────

export function buildMemorySummary(knowledge: BusinessKnowledge): {
  topFacts: KnownFact[];
  topLearnings: ValidatedLearning[];
  openQuestions: OpenQuestion[];
} {
  return {
    topFacts: knowledge.knownFacts.slice(0, 5),
    topLearnings: knowledge.validatedLearnings.slice(0, 3),
    openQuestions: knowledge.openQuestions
      .filter((q) => q.priority === "high")
      .slice(0, 3),
  };
}
