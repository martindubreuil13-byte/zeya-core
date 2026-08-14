import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import OpenAI from "openai";
import {
  loadCurrentPreparationHypotheses,
  type CurrentPreparationHypothesis,
} from "./preparation-intelligence";
import {
  loadPreparationReasoningSnapshot,
  toEvidenceInput,
  toObservationInput,
} from "./persist-hypotheses-orchestration";
import type { EvidenceInput, ObservationInput } from "./hypothesis-reasoning-types";

export const FIRST_WORKING_SESSION_BRIEF_MODEL = "gpt-4o";
export const FIRST_WORKING_SESSION_OPENAI_SDK_VERSION = "6.39.0";

export const FIRST_WORKING_SESSION_PREPARATION_VERSION =
  "first-working-session-preparation-v3";

export type BriefStatementKind =
  | "supported_finding" | "interpretation" | "working_opinion"
  | "unknown" | "contradiction";
export type BriefStatement = {
  statement: string;
  kind: BriefStatementKind;
  evidenceIds: string[];
  hypothesisIds: string[];
};
export type FirstWorkingSessionBrief = {
  businessRead: BriefStatement;
  offerRead: BriefStatement;
  customerRead: BriefStatement;
  problemOutcomeRead: BriefStatement;
  positioningRead: BriefStatement;
  commercialSignals: BriefStatement[];
  contradictions: BriefStatement[];
  unknowns: BriefStatement[];
  workingOpinions: BriefStatement[];
  formationPriorities: BriefStatement[];
  openingInsights: BriefStatement[];
  questions: BriefStatement[];
  authorityGaps: BriefStatement[];
  governance: { canonical: false; containsChainOfThought: false };
};

export type FirstWorkingSessionPreparationStageCode =
  | "brief_provider_unavailable" | "brief_provider_request_failed" | "brief_schema_invalid"
  | "brief_input_snapshot_invalid"
  | "brief_citation_scope_invalid" | "brief_semantic_supported_finding_invalid"
  | "brief_semantic_interpretation_invalid" | "brief_semantic_working_opinion_invalid"
  | "brief_authority_gap_invalid" | "brief_formation_priority_invalid"
  | "brief_contradiction_invalid" | "brief_finalization_payload_invalid"
  | "brief_database_finalization_failed";

export class FirstWorkingSessionPreparationStageError extends Error {
  constructor(
    public readonly stageCode: FirstWorkingSessionPreparationStageCode,
    public readonly section?: BriefSection,
    public readonly statementKind?: BriefStatementKind,
  ) {
    super(stageCode);
    this.name = "FirstWorkingSessionPreparationStageError";
  }
}

type Scope = { ownerId: string; businessId: string; businessRepresentationId: string; onboardingSessionId: string };
export type BriefInputs = { evidence: EvidenceInput[]; observations: ObservationInput[]; hypotheses: CurrentPreparationHypothesis[] };
type BriefGenerator = (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;

const arraySectionNames = ["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"] as const;
const singletonSectionNames = ["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"] as const;

export function buildFirstWorkingSessionBriefSchema(inputs: BriefInputs) {
  const evidenceIds = inputs.evidence.map((item) => item.id);
  const hypothesisIds = inputs.hypotheses.map((item) => item.id);
  const contradictedHypothesisIds = inputs.hypotheses
    .filter((item) => item.epistemicState === "contradicted").map((item) => item.id);
  const authorityHypothesisIds = inputs.hypotheses
    .filter((item) => item.constitutionalDomain === "authorityBoundaries").map((item) => item.id);
  const citationArray = (ids: string[], minItems = 0) => ({
    type: "array", items: { type: "string", enum: ids }, minItems,
  });
  const statementObject = (
    kinds: BriefStatementKind[], evidenceMinimum: number,
    allowedHypothesisIds = hypothesisIds, hypothesisMinimum = 0,
  ) => ({
    type: "object", additionalProperties: false,
    properties: {
      statement: { type: "string", minLength: 1, pattern: ".*\\S.*" },
      kind: { type: "string", enum: kinds },
      evidenceIds: citationArray(evidenceIds, evidenceMinimum),
      hypothesisIds: citationArray(allowedHypothesisIds, hypothesisMinimum),
    },
    required: ["statement", "kind", "evidenceIds", "hypothesisIds"],
  });
  const statementSchema = (kinds: BriefStatementKind[], citation: "evidence" | "either" | "contradiction" | "authority") => {
    if (citation === "evidence") return statementObject(kinds, 1);
    if (citation === "contradiction") return statementObject(kinds, 2, contradictedHypothesisIds, 1);
    if (citation === "authority") return statementObject(kinds, 0, authorityHypothesisIds, 1);
    return { anyOf: [statementObject(kinds, 1), statementObject(kinds, 0, hypothesisIds, 1)] };
  };
  const flexibleStatement = {
    anyOf: [
      statementSchema(["supported_finding"], "evidence"),
      statementSchema(["interpretation", "working_opinion", "unknown"], "either"),
    ],
  };
  const unresolvedRisk = inputs.hypotheses.some((item) =>
    ["medium", "high"].includes(item.representationRisk)
      && (item.epistemicState !== "supported" || item.ownerDecision !== "approved"));
  const authorityGapRequired = inputs.hypotheses.some((item) =>
    item.constitutionalDomain === "authorityBoundaries"
      && (item.epistemicState === "unknown" || item.representationRisk === "high"));
  const array = (items: Record<string, unknown>, minItems = 0, maxItems = 8) => ({
    type: "array", items, minItems, maxItems,
  });
  return {
    type: "object", additionalProperties: false,
    properties: {
      ...Object.fromEntries(singletonSectionNames.map((name) => [name, flexibleStatement])),
      commercialSignals: array(flexibleStatement),
      contradictions: array(statementSchema(["contradiction"], "contradiction")),
      unknowns: array(statementSchema(["unknown"], "either")),
      workingOpinions: array(statementSchema(["working_opinion"], "either")),
      formationPriorities: array(
        statementSchema(["interpretation", "working_opinion", "unknown"], "either"),
        unresolvedRisk ? 3 : 0, 7,
      ),
      openingInsights: array(flexibleStatement),
      questions: array(statementSchema(["interpretation", "unknown"], "either"), 0, 8),
      authorityGaps: array(
        statementSchema(["unknown"], "authority"), authorityGapRequired ? 1 : 0, 6,
      ),
      governance: {
        type: "object", additionalProperties: false,
        properties: { canonical: { type: "boolean", const: false }, containsChainOfThought: { type: "boolean", const: false } },
        required: ["canonical", "containsChainOfThought"],
      },
    },
    required: [...singletonSectionNames, ...arraySectionNames, "governance"],
  };
}

export function buildFirstWorkingSessionBriefPrompt(inputs: BriefInputs): string {
  return `Create an executive preparation brief for a first working session from the governed inputs below.
Synthesize independently across raw Evidence, Observations, and current hypotheses; do not merely paraphrase hypotheses.
Be specific enough that the facilitator sounds genuinely prepared. Avoid generic business language.
Every supported_finding must cite supplied Evidence. An interpretation or working_opinion must cite supplied Evidence and/or a current hypothesis. A contradiction must cite a contradicted current hypothesis and at least two genuinely conflicting Evidence items.
Describe an owner-supplied customer target as owner-stated unless public Evidence corroborates it. Working opinions must use explicitly provisional language such as "appears", "working interpretation", or "provisional view".
Use hypothesisIds only for supplied current hypothesis IDs. A working opinion is useful noncanonical judgment, never approved truth.
Every unknown, formation priority, and question must cite Evidence and/or a current hypothesis that makes it necessary. Use only interpretation, working_opinion, or unknown for formationPriorities; use only interpretation or unknown for questions.
Use kind=contradiction for every contradictions item, kind=unknown for every unknowns and authorityGaps item, and kind=working_opinion for every workingOpinions item. Do not place contradiction items outside contradictions.
When any medium/high-risk hypothesis is unresolved, return 3-7 ranked formationPriorities, highest value first.
When authorityBoundaries is unknown or high-risk, return at least one authorityGaps item and cite the supplied authorityBoundaries hypothesis ID on every item. Identify practical authority categories to verify: pricing, promises/guarantees, negotiation, commitments, escalation, and what Zeya may say or agree to. Do not invent the answers.
Compare owner-authority Evidence with first_party_company Evidence. Surface useful verification questions when the owner's stated offer/target differs in breadth or emphasis from public positioning or proof; do not label tension as contradiction without conflicting facts.
Questions must reduce representation risk or improve outbound business-development readiness. Reject generic consultant questions and terminology absent from the cited material.
Questions and verification priorities may ask whether an unsupported matter is true, but must not assert that it is true. Authority gaps may name pricing, negotiation, promises, commitments, and escalation specifically as unknown categories.
Business Read and working opinions must synthesize distinctive patterns across inputs rather than paraphrase a meta description.
Do not invent contradiction resolution, market size, geography, customer segment, regulatory status, authority, pricing, timelines, guarantees, promises, commitments, superlatives, quantitative performance, jargon, or facts. Concrete assertions must appear in the cited governed basis: supported findings use cited Evidence; interpretations and working opinions may also use cited current hypotheses.
Do not use guarded superlative words such as "leading", "best", "largest", or "number one" merely to mean prominent or central; use neutral wording unless the exact claim is present in the cited governed basis.
Return conclusions only: never chain-of-thought, hidden reasoning, or provider commentary.
GOVERNED EVIDENCE:\n${JSON.stringify(inputs.evidence)}
GOVERNED OBSERVATIONS:\n${JSON.stringify(inputs.observations)}
CURRENT HYPOTHESES:\n${JSON.stringify(inputs.hypotheses.map((hypothesis) => ({
  id: hypothesis.id,
  constitutionalDomain: hypothesis.constitutionalDomain,
  epistemicState: hypothesis.epistemicState,
  currentBelief: hypothesis.currentBelief,
  confidence: hypothesis.confidence,
  representationRisk: hypothesis.representationRisk,
  riskReason: hypothesis.riskReason,
  verificationNeed: hypothesis.verificationNeed,
  ownerDecision: hypothesis.ownerDecision,
})))}`;
}

function statements(brief: FirstWorkingSessionBrief): BriefStatement[] {
  return [
    ...singletonSectionNames.map((key) => brief[key]),
    ...arraySectionNames.flatMap((key) => brief[key]),
  ];
}

type BriefSection = typeof singletonSectionNames[number] | typeof arraySectionNames[number];

function statementEntries(brief: FirstWorkingSessionBrief): Array<{ section: BriefSection; item: BriefStatement }> {
  return [
    ...singletonSectionNames.map((section) => ({ section, item: brief[section] })),
    ...arraySectionNames.flatMap((section) => brief[section].map((item) => ({ section, item }))),
  ];
}

export type BriefEvidenceScopeDiagnostic = {
  effectiveEvidenceCount: number;
  citedEvidenceCount: number;
  outOfScopeCount: number;
  category: "none" | "hypothesis_id_as_evidence" | "predecessor_id_as_evidence" | "historical_hypothesis_basis" | "unknown_id";
};

export function analyzeBriefEvidenceScope(value: unknown, inputs: BriefInputs): BriefEvidenceScopeDiagnostic {
  const effectiveIds = new Set(inputs.evidence.map((item) => item.id));
  const hypothesisIds = new Set(inputs.hypotheses.map((item) => item.id));
  const predecessorIds = new Set(inputs.hypotheses.map((item) => item.previousHypothesisId).filter((id): id is string => Boolean(id)));
  const historicalBasisIds = new Set(inputs.hypotheses.flatMap((item) => item.sourceEvidenceIds).filter((id) => !effectiveIds.has(id)));
  const candidate = value as Partial<FirstWorkingSessionBrief> | null;
  const citedIds = new Set<string>();
  if (candidate && typeof candidate === "object") {
    for (const key of singletonSectionNames) {
      const item = candidate[key];
      if (item && Array.isArray(item.evidenceIds)) item.evidenceIds.forEach((id) => citedIds.add(id));
    }
    for (const key of arraySectionNames) {
      const items = candidate[key];
      if (Array.isArray(items)) items.forEach((item) => item?.evidenceIds?.forEach((id) => citedIds.add(id)));
    }
  }
  const outOfScope = [...citedIds].filter((id) => !effectiveIds.has(id));
  const category = outOfScope.length === 0 ? "none"
    : outOfScope.some((id) => hypothesisIds.has(id)) ? "hypothesis_id_as_evidence"
      : outOfScope.some((id) => predecessorIds.has(id)) ? "predecessor_id_as_evidence"
        : outOfScope.some((id) => historicalBasisIds.has(id)) ? "historical_hypothesis_basis"
          : "unknown_id";
  return { effectiveEvidenceCount: effectiveIds.size, citedEvidenceCount: citedIds.size, outOfScopeCount: outOfScope.length, category };
}

export function buildBriefCitationLineage(
  brief: FirstWorkingSessionBrief,
  effectiveEvidenceIds: Set<string>,
  currentHypothesisIds: Set<string>,
): { sourceEvidenceIds: string[]; sourceHypothesisIds: string[] } {
  const sourceEvidenceIds = [...new Set(statements(brief).flatMap((item) => item.evidenceIds))].sort();
  const sourceHypothesisIds = [...new Set(statements(brief).flatMap((item) => item.hypothesisIds))].sort();
  if (sourceEvidenceIds.some((id) => !effectiveEvidenceIds.has(id))
      || sourceHypothesisIds.some((id) => !currentHypothesisIds.has(id))) {
    throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
  }
  return { sourceEvidenceIds, sourceHypothesisIds };
}

type GuardedClaimClass = "number" | "pricing" | "market_size" | "regulatory"
  | "guarantee" | "customer_segment" | "geography" | "superlative"
  | "timeline" | "commitment";
type GuardedClaim = { claimClass: GuardedClaimClass; marker: string };

const GUARDED_FACT_PATTERNS: Array<[GuardedClaimClass, RegExp]> = [
  ["pricing", /(?:[$€£]\s*\d[\d,.]*|\b(?:price|pricing|costs?|fees?|priced at)\b)/gi],
  ["market_size", /\b(?:market size|addressable market|tam|sam|som|\d[\d,.]*\s*(?:million|billion|thousand))\b/gi],
  ["regulatory", /\b(?:gdpr|hipaa|soc\s*2|iso\s*\d+|certified|licensed|regulated|regulatory|compliant|compliance)\b/gi],
  ["guarantee", /\b(?:guarantee(?:d|s)?|warrant(?:y|ies)|assured results?)\b/gi],
  ["customer_segment", /\b(?:startups?|smes?|small and medium businesses|series\s+[a-e]|saas|enterprise|fortune\s*500|healthcare|government|public sector|financial services|e-?commerce|manufacturers?|nonprofits?|technology companies)\b/gi],
  ["geography", /\b(?:global(?:ly)?|worldwide|english[- ]speaking|western|developed (?:countries|country|markets?)|north american?|european?|asian|african)\b/gi],
  ["superlative", /\b(?:best|largest|leading|number\s+one|award[- ]winning)\b/gi],
  ["timeline", /\b(?:within\s+\w+\s+(?:days?|weeks?|months?|years?)|in\s+\w+\s+(?:days?|weeks?|months?|years?)|delivery timeline|deadline)\b/gi],
  ["commitment", /\b(?:will deliver|commits? to|committed to|authorized to|may promise|can promise|will provide)\b/gi],
];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%$]+/g, " ").trim();
}

function normalizedConcept(value: string): string {
  return normalized(value)
    .replace(/\bstartups\b/g, "startup")
    .replace(/\bmarkets?\b|\bcountries\b|\bcountry\b/g, "market")
    .replace(/\bcompanies\b/g, "company");
}

function guardedClaims(value: string): GuardedClaim[] {
  const claims: GuardedClaim[] = [];
  const structuralNumber = /\b(?:priorities|questions|sections|version|contract|attempts?|working session)\b/i;
  for (const match of value.matchAll(/(?:[$€£]\s*)?\b(?:\d[\d,.]*|one|two|three|four|five|six|seven|eight|nine|ten)(?:\s*(?:%|percent|million|billion|thousand))?\b/gi)) {
    const context = value.slice(Math.max(0, (match.index ?? 0) - 24), (match.index ?? 0) + match[0].length + 24);
    if (!structuralNumber.test(context)) claims.push({ claimClass: "number", marker: normalizedConcept(match[0]) });
  }
  for (const [claimClass, pattern] of GUARDED_FACT_PATTERNS) {
    for (const match of value.matchAll(pattern)) {
      claims.push({ claimClass, marker: normalizedConcept(match[0]) });
    }
  }
  return [...new Map(claims.filter((item) => item.marker).map((item) => [`${item.claimClass}:${item.marker}`, item])).values()];
}

function claimSupported(claim: GuardedClaim, basis: string): boolean {
  const normalizedBasis = normalizedConcept(basis);
  const markerTokens = claim.marker.split(" ").filter(Boolean);
  return markerTokens.every((token) => normalizedBasis.split(" ").includes(token));
}

function isVerificationFraming(section: BriefSection, item: BriefStatement): boolean {
  if (item.kind === "unknown" || section === "questions" || section === "authorityGaps") return true;
  return section === "formationPriorities"
    && /\b(?:clarify|verify|determine|confirm|investigate|whether|review)\b/i.test(item.statement);
}

function rejectBriefStatement(
  section: BriefSection, item: BriefStatement, category: FirstWorkingSessionPreparationStageCode,
): never {
  console.error("[first-working-session-brief] validation_failed", {
    section,
    kind: item.kind,
    category,
  });
  throw new FirstWorkingSessionPreparationStageError(category, section, item.kind);
}

function semanticCategory(item: BriefStatement): FirstWorkingSessionPreparationStageCode {
  if (item.kind === "supported_finding") return "brief_semantic_supported_finding_invalid";
  if (item.kind === "working_opinion") return "brief_semantic_working_opinion_invalid";
  if (item.kind === "contradiction") return "brief_contradiction_invalid";
  return "brief_semantic_interpretation_invalid";
}

function validateKindAwareTraceability(
  section: BriefSection,
  item: BriefStatement,
  evidenceById: Map<string, EvidenceInput>,
  hypothesesById: Map<string, CurrentPreparationHypothesis>,
) {
  const evidenceBasis = item.evidenceIds.map((id) => evidenceById.get(id)?.rawStatement ?? "");
  const hypothesisBasis = item.hypothesisIds.flatMap((id) => {
    const hypothesis = hypothesesById.get(id);
    return [hypothesis?.currentBelief ?? "", hypothesis?.riskReason ?? "", hypothesis?.verificationNeed ?? "", hypothesis?.constitutionalDomain ?? ""];
  });
  const semanticBasis = item.kind === "supported_finding" || item.kind === "contradiction"
    ? evidenceBasis.join(" ")
    : [...evidenceBasis, ...hypothesisBasis].join(" ");

  if (item.kind === "supported_finding" && item.evidenceIds.length === 0) {
    rejectBriefStatement(section, item, "brief_semantic_supported_finding_invalid");
  }
  if (["interpretation", "working_opinion"].includes(item.kind)
      && item.evidenceIds.length + item.hypothesisIds.length === 0) {
    rejectBriefStatement(section, item, semanticCategory(item));
  }
  if (item.kind === "unknown" && item.evidenceIds.length + item.hypothesisIds.length === 0) {
    rejectBriefStatement(
      section, item,
      section === "authorityGaps" ? "brief_authority_gap_invalid"
        : section === "formationPriorities" ? "brief_formation_priority_invalid"
          : "brief_citation_scope_invalid",
    );
  }
  if (item.kind === "contradiction") {
    const citesContradictedHypothesis = item.hypothesisIds.some(
      (id) => hypothesesById.get(id)?.epistemicState === "contradicted",
    );
    const distinctEvidenceStatements = new Set(evidenceBasis.map(normalized).filter(Boolean));
    if (!citesContradictedHypothesis || distinctEvidenceStatements.size < 2) {
      rejectBriefStatement(section, item, "brief_contradiction_invalid");
    }
  }

  if (!isVerificationFraming(section, item)
      && ["supported_finding", "interpretation", "working_opinion", "contradiction"].includes(item.kind)) {
    const unsupportedClaim = guardedClaims(item.statement)
      .find((claim) => !claimSupported(claim, semanticBasis));
    if (unsupportedClaim) {
      rejectBriefStatement(section, item, semanticCategory(item));
    }
  }
}

export type BriefStatementValidationCandidate = { section: BriefSection; item: BriefStatement };
export type BriefStatementValidationResult = {
  accepted: boolean; category: FirstWorkingSessionPreparationStageCode | null;
  section: BriefSection; kind: BriefStatementKind;
};

export function validateFirstWorkingSessionBriefCandidates(
  inputs: BriefInputs,
  candidates: BriefStatementValidationCandidate[],
): BriefStatementValidationResult[] {
  const evidenceById = new Map(inputs.evidence.map((item) => [item.id, item]));
  const hypothesesById = new Map(inputs.hypotheses.map((item) => [item.id, item]));
  return candidates.map(({ section, item }) => {
    try {
      if (item.evidenceIds.some((id) => !evidenceById.has(id))
          || item.hypothesisIds.some((id) => !hypothesesById.has(id))) {
        return { accepted: false, category: "brief_citation_scope_invalid", section, kind: item.kind };
      }
      validateKindAwareTraceability(section, item, evidenceById, hypothesesById);
      return { accepted: true, category: null, section, kind: item.kind };
    } catch (error) {
      const category = error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode : "brief_schema_invalid";
      return { accepted: false, category, section, kind: item.kind };
    }
  });
}

export function validateFirstWorkingSessionBrief(
  value: unknown, inputs: BriefInputs,
): FirstWorkingSessionBrief {
  if (!value || typeof value !== "object") throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  const scopeDiagnostic = analyzeBriefEvidenceScope(value, inputs);
  if (scopeDiagnostic.outOfScopeCount > 0) {
    console.error("[first-working-session-brief] brief_evidence_out_of_scope", scopeDiagnostic);
    throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
  }
  const brief = value as FirstWorkingSessionBrief;
  const expectedTopLevelKeys = new Set([...singletonSectionNames, ...arraySectionNames, "governance"]);
  if (Object.keys(brief).some((key) => !expectedTopLevelKeys.has(key as keyof FirstWorkingSessionBrief))) {
    throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  }
  if (!brief.governance || brief.governance.canonical !== false || brief.governance.containsChainOfThought !== false) {
    throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  }
  for (const key of singletonSectionNames) if (!brief[key] || typeof brief[key].statement !== "string") throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  for (const key of arraySectionNames) if (!Array.isArray(brief[key])) throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  if (Object.keys(brief.governance).some((key) => !["canonical", "containsChainOfThought"].includes(key))) throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  if (arraySectionNames.some((key) => brief[key].length > (key === "formationPriorities" ? 7 : key === "authorityGaps" ? 6 : 8))) throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  const evidenceById = new Map(inputs.evidence.map((item) => [item.id, item]));
  const hypothesesById = new Map(inputs.hypotheses.map((item) => [item.id, item]));
  for (const { section, item } of statementEntries(brief)) {
    if (!item || typeof item !== "object"
        || Object.keys(item).some((key) => !["statement", "kind", "evidenceIds", "hypothesisIds"].includes(key))) {
      throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
    }
    if (!item.statement?.trim() || !Array.isArray(item.evidenceIds) || !Array.isArray(item.hypothesisIds)
        || item.evidenceIds.some((id) => typeof id !== "string")
        || item.hypothesisIds.some((id) => typeof id !== "string")) {
      throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
    }
    if (!["supported_finding", "interpretation", "working_opinion", "unknown", "contradiction"].includes(item.kind)) throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length
        || new Set(item.hypothesisIds).size !== item.hypothesisIds.length
        || item.evidenceIds.some((id) => !evidenceById.has(id))
        || item.hypothesisIds.some((id) => !hypothesesById.has(id))) {
      throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
    }
    validateKindAwareTraceability(section, item, evidenceById, hypothesesById);
    if (item.kind === "contradiction" && section !== "contradictions") {
      throw new FirstWorkingSessionPreparationStageError("brief_contradiction_invalid");
    }
  }
  if (brief.workingOpinions.some((item) => item.kind !== "working_opinion")) throw new FirstWorkingSessionPreparationStageError("brief_semantic_working_opinion_invalid");
  if (brief.contradictions.some((item) => item.kind !== "contradiction")) throw new FirstWorkingSessionPreparationStageError("brief_contradiction_invalid");
  if (brief.unknowns.some((item) => item.kind !== "unknown")) throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
  if (brief.unknowns.some((item) => item.evidenceIds.length + item.hypothesisIds.length === 0)) throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
  if (brief.formationPriorities.some((item) => !["interpretation", "working_opinion", "unknown"].includes(item.kind))) throw new FirstWorkingSessionPreparationStageError("brief_formation_priority_invalid");
  if (brief.questions.some((item) => !["interpretation", "unknown"].includes(item.kind))) throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
  if (brief.authorityGaps.some((item) => item.kind !== "unknown")) throw new FirstWorkingSessionPreparationStageError("brief_authority_gap_invalid");
  const unresolvedRisk = inputs.hypotheses.some((item) =>
    ["medium", "high"].includes(item.representationRisk)
      && (item.epistemicState !== "supported" || item.ownerDecision !== "approved"),
  );
  if (unresolvedRisk && (brief.formationPriorities.length < 3 || brief.formationPriorities.length > 7)) {
    throw new FirstWorkingSessionPreparationStageError("brief_formation_priority_invalid");
  }
  if (brief.formationPriorities.some((item) => item.evidenceIds.length + item.hypothesisIds.length === 0)) {
    throw new FirstWorkingSessionPreparationStageError("brief_formation_priority_invalid");
  }
  if (brief.questions.some((item) => item.evidenceIds.length + item.hypothesisIds.length === 0)) {
    throw new FirstWorkingSessionPreparationStageError("brief_citation_scope_invalid");
  }
  const authority = inputs.hypotheses.find((item) => item.constitutionalDomain === "authorityBoundaries");
  if (authority && (authority.epistemicState === "unknown" || authority.representationRisk === "high")) {
    if (brief.authorityGaps.length === 0) throw new FirstWorkingSessionPreparationStageError("brief_authority_gap_invalid");
    if (brief.authorityGaps.some((item) => !item.hypothesisIds.includes(authority.id))) {
      throw new FirstWorkingSessionPreparationStageError("brief_authority_gap_invalid");
    }
  }
  return brief;
}

export function buildFirstWorkingSessionBriefProviderRequest(
  prompt: string,
  schema: Record<string, unknown>,
) {
  return {
    model: FIRST_WORKING_SESSION_BRIEF_MODEL,
    instructions: prompt,
    input: [{ role: "user" as const, content: "Produce the governed first-working-session brief." }],
    text: {
      format: {
        type: "json_schema" as const,
        name: "first_working_session_brief",
        schema,
        strict: true,
      },
    },
  };
}

export function createFirstWorkingSessionBriefOpenAIClient(): OpenAI {
  return new OpenAI();
}

async function defaultGenerator(prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  if (!process.env.OPENAI_API_KEY) {
    throw new FirstWorkingSessionPreparationStageError("brief_provider_unavailable");
  }
  try {
    const response = await createFirstWorkingSessionBriefOpenAIClient().responses.create(
      buildFirstWorkingSessionBriefProviderRequest(prompt, schema),
    );
    try {
      return JSON.parse(response.output_text);
    } catch {
      throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
    }
  } catch (error) {
    if (error instanceof FirstWorkingSessionPreparationStageError) throw error;
    throw new FirstWorkingSessionPreparationStageError("brief_provider_request_failed");
  }
}

export async function synthesizeFirstWorkingSessionBrief(
  inputs: BriefInputs, generator: BriefGenerator = defaultGenerator,
): Promise<FirstWorkingSessionBrief> {
  const value = await generator(buildFirstWorkingSessionBriefPrompt(inputs), buildFirstWorkingSessionBriefSchema(inputs));
  return validateFirstWorkingSessionBrief(value, inputs);
}

export async function buildFirstWorkingSessionBrief(client: SupabaseClient, scope: Scope) {
  const snapshot = await loadPreparationReasoningSnapshot(client, scope.onboardingSessionId, scope.ownerId);
  const hypotheses = await loadCurrentPreparationHypotheses(client, scope);
  if (hypotheses.length !== 7
      || hypotheses.some((hypothesis) => hypothesis.requestTraceId !== snapshot.reasoningRunId)) {
    throw new FirstWorkingSessionPreparationStageError("brief_input_snapshot_invalid");
  }
  const evidence = toEvidenceInput(snapshot.evidence);
  const observations = toObservationInput(snapshot.observations);
  return buildFirstWorkingSessionBriefArtifact(
    { evidence, observations, hypotheses }, snapshot.reasoningRunId,
  );
}

export async function buildFirstWorkingSessionBriefArtifact(
  inputs: BriefInputs,
  reasoningRunId: string,
  generator?: BriefGenerator,
) {
  const brief = await synthesizeFirstWorkingSessionBrief(inputs, generator);
  const { sourceEvidenceIds, sourceHypothesisIds } = buildBriefCitationLineage(
    brief,
    new Set(inputs.evidence.map((item) => item.id)),
    new Set(inputs.hypotheses.map((item) => item.id)),
  );
  const hypothesisTraceFingerprint = createHash("sha256").update(inputs.hypotheses
    .map((item) => `${item.id}:${item.hypothesisVersion}:${item.requestTraceId ?? ""}`)
    .sort().join("|"))
    .digest("hex");
  const sourceSnapshotFingerprint = createHash("sha256").update([
    FIRST_WORKING_SESSION_PREPARATION_VERSION, reasoningRunId,
    hypothesisTraceFingerprint, ...sourceEvidenceIds, ...sourceHypothesisIds,
  ].join("|")).digest("hex");
  return { brief, sourceEvidenceIds, sourceHypothesisIds, sourceSnapshotFingerprint, hypothesisTraceFingerprint };
}

type FirstWorkingSessionBriefArtifact = Awaited<ReturnType<typeof buildFirstWorkingSessionBriefArtifact>>;

export function buildFirstWorkingSessionFinalizationPayload(
  workingSessionId: string,
  leaseId: string,
  artifact: FirstWorkingSessionBriefArtifact,
) {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const fingerprint = /^[0-9a-f]{64}$/;
  if (!uuid.test(workingSessionId) || !uuid.test(leaseId)
      || !fingerprint.test(artifact.sourceSnapshotFingerprint)
      || !fingerprint.test(artifact.hypothesisTraceFingerprint)
      || artifact.sourceEvidenceIds.some((id) => !uuid.test(id))
      || artifact.sourceHypothesisIds.some((id) => !uuid.test(id))
      || !artifact.brief || typeof artifact.brief !== "object") {
    throw new FirstWorkingSessionPreparationStageError("brief_finalization_payload_invalid");
  }
  return {
    p_working_session_id: workingSessionId,
    p_lease_id: leaseId,
    p_snapshot_fingerprint: artifact.sourceSnapshotFingerprint,
    p_hypothesis_trace_fingerprint: artifact.hypothesisTraceFingerprint,
    p_contract_version: FIRST_WORKING_SESSION_PREPARATION_VERSION,
    p_brief: artifact.brief,
    p_source_evidence_ids: artifact.sourceEvidenceIds,
    p_source_hypothesis_ids: artifact.sourceHypothesisIds,
  };
}

export function isFirstWorkingSessionBriefCurrent(
  stored: { sourceSnapshotFingerprint: string; preparationContractVersion: string }, expectedSnapshotFingerprint: string,
): boolean {
  return stored.preparationContractVersion === FIRST_WORKING_SESSION_PREPARATION_VERSION
    && stored.sourceSnapshotFingerprint === expectedSnapshotFingerprint;
}
