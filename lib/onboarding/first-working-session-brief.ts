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
  | "brief_provider_rate_limited"
  | "brief_input_snapshot_invalid"
  | "brief_citation_scope_invalid" | "brief_semantic_supported_finding_invalid"
  | "brief_semantic_interpretation_invalid" | "brief_semantic_working_opinion_invalid"
  | "brief_authority_gap_invalid" | "brief_formation_priority_invalid"
  | "brief_contradiction_invalid" | "brief_finalization_payload_invalid"
  | "brief_database_finalization_failed" | "brief_semantic_revision_exhausted"
  | "brief_semantic_revision_time_budget_exhausted";

export class FirstWorkingSessionPreparationStageError extends Error {
  constructor(
    public readonly stageCode: FirstWorkingSessionPreparationStageCode,
    public readonly section?: BriefSection,
    public readonly statementKind?: BriefStatementKind,
    public readonly validatorRule?: string,
    public readonly statementIndex?: number | null,
    public readonly revisionTelemetry?: BriefRevisionTelemetry,
  ) {
    super(stageCode);
    this.name = "FirstWorkingSessionPreparationStageError";
  }
}

type Scope = { ownerId: string; businessId: string; businessRepresentationId: string; onboardingSessionId: string };
export type BriefInputs = { evidence: EvidenceInput[]; observations: ObservationInput[]; hypotheses: CurrentPreparationHypothesis[] };
export type BriefProviderCallContext = { logicalGeneration: number; revisionNumber: 0 | 1 | 2 };
export type BriefGenerator = (
  prompt: string,
  schema: Record<string, unknown>,
  context?: BriefProviderCallContext,
) => Promise<unknown>;
export type BriefProviderCallDiagnostic = BriefProviderCallContext & {
  success: boolean;
  durationMs: number;
  httpStatus: number | null;
  errorType: string | null;
  errorCode: string | null;
  errorParam: string | null;
  requestId: string | null;
  safeMessage: string | null;
  retryAfter: string | null;
  sdkRetryCount: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  promptCharacterCount: number;
  schemaBytes: number;
  serializedRequestBytes: number;
  providerRequestSha256: string;
};

type CompactEvidenceInput = {
  id: string;
  sourceType: EvidenceInput["sourceType"];
  rawStatement: string;
  affectedDomains: string[];
  pageType?: string;
  evidenceKind?: string;
  logicalSourceKey?: string;
  authorityType?: EvidenceInput["authority_type"];
  authorityKey?: string;
};
type CompactObservationInput = {
  evidenceId: string;
  meaning: string;
  confidence: number;
  affectedDomains: string[];
};
type CompactHypothesisInput = {
  id: string;
  constitutionalDomain: CurrentPreparationHypothesis["constitutionalDomain"];
  epistemicState: CurrentPreparationHypothesis["epistemicState"];
  currentBelief: string | null;
  confidence: CurrentPreparationHypothesis["confidence"];
  representationRisk: CurrentPreparationHypothesis["representationRisk"];
  riskReason: string | null;
  verificationNeed: string | null;
  ownerDecision: CurrentPreparationHypothesis["ownerDecision"];
};
type CompactBriefInputs = {
  evidence: CompactEvidenceInput[];
  observations: CompactObservationInput[];
  hypotheses: CompactHypothesisInput[];
};
export type FirstWorkingSessionBriefProviderContract = {
  inputs: CompactBriefInputs;
  evidenceAliasToId: ReadonlyMap<string, string>;
  evidenceIdToAlias: ReadonlyMap<string, string>;
  hypothesisAliasToId: ReadonlyMap<string, string>;
  hypothesisIdToAlias: ReadonlyMap<string, string>;
};

const arraySectionNames = ["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"] as const;
const singletonSectionNames = ["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"] as const;

export function buildFirstWorkingSessionBriefSchema(inputs: BriefInputs | CompactBriefInputs) {
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

export function buildFirstWorkingSessionBriefProviderContract(
  inputs: BriefInputs,
): FirstWorkingSessionBriefProviderContract {
  const evidence = [...inputs.evidence].sort((left, right) => left.id.localeCompare(right.id));
  const hypotheses = [...inputs.hypotheses].sort((left, right) =>
    left.constitutionalDomain.localeCompare(right.constitutionalDomain));
  const evidenceAliasToId = new Map(evidence.map((item, index) => [`E${index + 1}`, item.id]));
  const hypothesisAliasToId = new Map(hypotheses.map((item, index) => [`H${index + 1}`, item.id]));
  const evidenceIdToAlias = new Map([...evidenceAliasToId].map(([alias, id]) => [id, alias]));
  const hypothesisIdToAlias = new Map([...hypothesisAliasToId].map(([alias, id]) => [id, alias]));
  const logicalSourceAliases = new Map([...new Set(evidence
    .map((item) => item.logical_source_key).filter((value): value is string => Boolean(value)))]
    .sort().map((value, index) => [value, `L${index + 1}`]));
  const authorityAliases = new Map([...new Set(evidence
    .map((item) => item.authority_key).filter((value): value is string => Boolean(value)))]
    .sort().map((value, index) => [value, `A${index + 1}`]));
  return {
    inputs: {
      evidence: evidence.map((item) => ({
        id: evidenceIdToAlias.get(item.id)!,
        sourceType: item.sourceType,
        rawStatement: item.rawStatement,
        affectedDomains: item.affected_domains,
        ...(item.source_page_type ? { pageType: item.source_page_type } : {}),
        ...(item.source_evidence_kind ? { evidenceKind: item.source_evidence_kind } : {}),
        ...(item.logical_source_key ? { logicalSourceKey: logicalSourceAliases.get(item.logical_source_key)! } : {}),
        ...(item.authority_type ? { authorityType: item.authority_type } : {}),
        ...(item.authority_key ? { authorityKey: authorityAliases.get(item.authority_key)! } : {}),
      })),
      observations: inputs.observations.map((item) => ({
        evidenceId: evidenceIdToAlias.get(item.evidenceId)!,
        meaning: item.interpreted_meaning,
        confidence: item.confidence_in_interpretation,
        affectedDomains: item.affected_domains,
      })),
      hypotheses: hypotheses.map((item) => ({
        id: hypothesisIdToAlias.get(item.id)!,
        constitutionalDomain: item.constitutionalDomain,
        epistemicState: item.epistemicState,
        currentBelief: item.currentBelief,
        confidence: item.confidence,
        representationRisk: item.representationRisk,
        riskReason: item.riskReason,
        verificationNeed: item.verificationNeed,
        ownerDecision: item.ownerDecision,
      })),
    },
    evidenceAliasToId, evidenceIdToAlias, hypothesisAliasToId, hypothesisIdToAlias,
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

export function buildCompactFirstWorkingSessionBriefPrompt(
  inputs: BriefInputs,
  contract: FirstWorkingSessionBriefProviderContract = buildFirstWorkingSessionBriefProviderContract(inputs),
): string {
  const fullPrompt = buildFirstWorkingSessionBriefPrompt(inputs);
  const governedPayloadOffset = fullPrompt.indexOf("GOVERNED EVIDENCE:\n");
  if (governedPayloadOffset < 0) {
    throw new FirstWorkingSessionPreparationStageError("brief_input_snapshot_invalid");
  }
  return `${fullPrompt.slice(0, governedPayloadOffset)}GOVERNED EVIDENCE:\n${JSON.stringify(contract.inputs.evidence)}
GOVERNED OBSERVATIONS:\n${JSON.stringify(contract.inputs.observations)}
CURRENT HYPOTHESES:\n${JSON.stringify(contract.inputs.hypotheses)}`;
}

export function buildCompactFirstWorkingSessionBriefSchema(
  inputs: BriefInputs,
  contract: FirstWorkingSessionBriefProviderContract = buildFirstWorkingSessionBriefProviderContract(inputs),
) {
  return buildFirstWorkingSessionBriefSchema(contract.inputs);
}

function mapProviderCitationIds(
  ids: unknown,
  aliases: ReadonlyMap<string, string>,
): string[] {
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !aliases.has(id))) {
    throw new FirstWorkingSessionPreparationStageError(
      "brief_citation_scope_invalid", undefined, undefined, "provider_citation_alias_must_resolve",
    );
  }
  return ids.map((id) => aliases.get(id)!);
}

export function expandFirstWorkingSessionBriefProviderAliases(
  value: unknown,
  contract: FirstWorkingSessionBriefProviderContract,
): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const expanded = structuredClone(value) as Record<string, unknown>;
  const expandStatement = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const statement = candidate as Record<string, unknown>;
    statement.evidenceIds = mapProviderCitationIds(statement.evidenceIds, contract.evidenceAliasToId);
    statement.hypothesisIds = mapProviderCitationIds(statement.hypothesisIds, contract.hypothesisAliasToId);
  };
  for (const section of singletonSectionNames) expandStatement(expanded[section]);
  for (const section of arraySectionNames) {
    const items = expanded[section];
    if (Array.isArray(items)) items.forEach(expandStatement);
  }
  return expanded;
}

function compactValidationDefects(
  defects: BriefSemanticDefect[],
  contract: FirstWorkingSessionBriefProviderContract,
): BriefSemanticDefect[] {
  return defects.map((defect) => ({
    ...defect,
    citedEvidenceIds: defect.citedEvidenceIds.map((id) => contract.evidenceIdToAlias.get(id) ?? "INVALID"),
    citedHypothesisIds: defect.citedHypothesisIds.map((id) => contract.hypothesisIdToAlias.get(id) ?? "INVALID"),
    ...(defect.candidateSupportingEvidenceIds ? {
      candidateSupportingEvidenceIds: defect.candidateSupportingEvidenceIds
        .map((id) => contract.evidenceIdToAlias.get(id) ?? "INVALID"),
    } : {}),
  }));
}

export function buildFirstWorkingSessionBriefRevisionPrompt(
  inputs: BriefInputs,
  candidate: unknown,
  defects: BriefSemanticDefect[],
  revisionNumber: 1 | 2,
): string {
  return `Repair this brief only to satisfy the supplied validation defects.
Preserve valid content where possible.
Remove unsupported premises when governed support does not exist.
Add citations only when the supplied governed Evidence directly supports that premise.
Do not introduce new factual premises, Evidence, hypotheses, authority, commitments, pricing, performance claims, customer segments, geography, compliance claims, guarantees, or conclusions.
Return the complete corrected brief. Do not return a patch, explanation, or reasoning.
REVISION NUMBER:\n${revisionNumber}
CURRENT CANDIDATE:\n${JSON.stringify(candidate)}
VALIDATION DEFECTS:\n${JSON.stringify(defects)}
FROZEN GOVERNED EVIDENCE:\n${JSON.stringify(inputs.evidence)}
FROZEN GOVERNED OBSERVATIONS:\n${JSON.stringify(inputs.observations)}
FROZEN CURRENT HYPOTHESES:\n${JSON.stringify(inputs.hypotheses)}`;
}

export function buildCompactFirstWorkingSessionBriefRevisionPrompt(
  inputs: BriefInputs,
  candidate: unknown,
  defects: BriefSemanticDefect[],
  revisionNumber: 1 | 2,
  contract: FirstWorkingSessionBriefProviderContract = buildFirstWorkingSessionBriefProviderContract(inputs),
): string {
  return `Repair this brief only to satisfy the supplied validation defects.
Preserve valid content where possible.
Remove unsupported premises when governed support does not exist.
Add citations only when the supplied governed Evidence directly supports that premise.
Do not introduce new factual premises, Evidence, hypotheses, authority, commitments, pricing, performance claims, customer segments, geography, compliance claims, guarantees, or conclusions.
Return the complete corrected brief. Do not return a patch, explanation, or reasoning.
REVISION NUMBER:\n${revisionNumber}
CURRENT CANDIDATE:\n${JSON.stringify(candidate)}
VALIDATION DEFECTS:\n${JSON.stringify(compactValidationDefects(defects, contract))}
FROZEN GOVERNED EVIDENCE:\n${JSON.stringify(contract.inputs.evidence)}
FROZEN GOVERNED OBSERVATIONS:\n${JSON.stringify(contract.inputs.observations)}
FROZEN CURRENT HYPOTHESES:\n${JSON.stringify(contract.inputs.hypotheses)}`;
}

function statements(brief: FirstWorkingSessionBrief): BriefStatement[] {
  return [
    ...singletonSectionNames.map((key) => brief[key]),
    ...arraySectionNames.flatMap((key) => brief[key]),
  ];
}

export type BriefSection = typeof singletonSectionNames[number] | typeof arraySectionNames[number];

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
    .replace(/\bglobally\b/g, "global")
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

export type BriefSemanticDefect = {
  section: BriefSection;
  statementIndex: number | null;
  kind: BriefStatementKind;
  category: FirstWorkingSessionPreparationStageCode;
  validatorRule: string;
  guardedClaimClass?: GuardedClaimClass;
  detectedMarker?: string;
  citedEvidenceIds: string[];
  citedHypothesisIds: string[];
  candidateSupportingEvidenceIds?: string[];
};

function semanticDefect(
  section: BriefSection,
  statementIndex: number | null,
  item: BriefStatement,
  category: FirstWorkingSessionPreparationStageCode,
  validatorRule: string,
  claim?: GuardedClaim,
  inputs?: BriefInputs,
): BriefSemanticDefect {
  const candidateSupportingEvidenceIds = claim && inputs
    ? inputs.evidence.filter((evidence) => claimSupported(claim, evidence.rawStatement)).map((evidence) => evidence.id)
    : undefined;
  return {
    section, statementIndex, kind: item.kind, category, validatorRule,
    ...(claim ? { guardedClaimClass: claim.claimClass, detectedMarker: claim.marker } : {}),
    citedEvidenceIds: [...item.evidenceIds],
    citedHypothesisIds: [...item.hypothesisIds],
    ...(candidateSupportingEvidenceIds?.length ? { candidateSupportingEvidenceIds } : {}),
  };
}

function isVerificationFraming(section: BriefSection, item: BriefStatement): boolean {
  if (item.kind === "unknown" || section === "questions" || section === "authorityGaps") return true;
  return section === "formationPriorities"
    && /\b(?:clarify|verify|determine|confirm|investigate|whether|review)\b/i.test(item.statement);
}

function semanticCategory(item: BriefStatement): FirstWorkingSessionPreparationStageCode {
  if (item.kind === "supported_finding") return "brief_semantic_supported_finding_invalid";
  if (item.kind === "working_opinion") return "brief_semantic_working_opinion_invalid";
  if (item.kind === "contradiction") return "brief_contradiction_invalid";
  return "brief_semantic_interpretation_invalid";
}

function collectKindAwareDefects(
  section: BriefSection,
  statementIndex: number | null,
  item: BriefStatement,
  evidenceById: Map<string, EvidenceInput>,
  hypothesesById: Map<string, CurrentPreparationHypothesis>,
  inputs: BriefInputs,
): BriefSemanticDefect[] {
  const defects: BriefSemanticDefect[] = [];
  const evidenceBasis = item.evidenceIds.map((id) => evidenceById.get(id)?.rawStatement ?? "");
  const hypothesisBasis = item.hypothesisIds.flatMap((id) => {
    const hypothesis = hypothesesById.get(id);
    return [hypothesis?.currentBelief ?? "", hypothesis?.riskReason ?? "", hypothesis?.verificationNeed ?? "", hypothesis?.constitutionalDomain ?? ""];
  });
  const semanticBasis = item.kind === "supported_finding" || item.kind === "contradiction"
    ? evidenceBasis.join(" ")
    : [...evidenceBasis, ...hypothesisBasis].join(" ");

  if (item.kind === "supported_finding" && item.evidenceIds.length === 0) {
    defects.push(semanticDefect(section, statementIndex, item, "brief_semantic_supported_finding_invalid", "supported_finding_evidence_required"));
  }
  if (["interpretation", "working_opinion"].includes(item.kind)
      && item.evidenceIds.length + item.hypothesisIds.length === 0) {
    defects.push(semanticDefect(section, statementIndex, item, semanticCategory(item), "interpretation_or_working_opinion_basis_required"));
  }
  if (item.kind === "unknown" && item.evidenceIds.length + item.hypothesisIds.length === 0) {
    defects.push(semanticDefect(
      section, statementIndex, item,
      section === "authorityGaps" ? "brief_authority_gap_invalid"
        : section === "formationPriorities" ? "brief_formation_priority_invalid"
          : "brief_citation_scope_invalid",
      "unknown_basis_required",
    ));
  }
  if (item.kind === "contradiction") {
    const citesContradictedHypothesis = item.hypothesisIds.some(
      (id) => hypothesesById.get(id)?.epistemicState === "contradicted",
    );
    const distinctEvidenceStatements = new Set(evidenceBasis.map(normalized).filter(Boolean));
    if (!citesContradictedHypothesis || distinctEvidenceStatements.size < 2) {
      defects.push(semanticDefect(section, statementIndex, item, "brief_contradiction_invalid", "contradiction_requires_conflicting_evidence_and_contradicted_hypothesis"));
    }
  }

  if (!isVerificationFraming(section, item)
      && ["supported_finding", "interpretation", "working_opinion", "contradiction"].includes(item.kind)) {
    const unsupportedClaims = guardedClaims(item.statement)
      .filter((claim) => !claimSupported(claim, semanticBasis));
    for (const unsupportedClaim of unsupportedClaims) {
      defects.push(semanticDefect(
        section, statementIndex, item, semanticCategory(item),
        `guarded_concrete_claim_supported_by_cited_basis:${unsupportedClaim.claimClass}`,
        unsupportedClaim, inputs,
      ));
    }
  }
  return defects;
}

function validateKindAwareTraceability(
  section: BriefSection,
  item: BriefStatement,
  evidenceById: Map<string, EvidenceInput>,
  hypothesesById: Map<string, CurrentPreparationHypothesis>,
  inputs: BriefInputs,
  statementIndex: number | null = null,
) {
  const defect = collectKindAwareDefects(section, statementIndex, item, evidenceById, hypothesesById, inputs)[0];
  if (!defect) return;
  console.error("[first-working-session-brief] validation_failed", {
    section: defect.section, kind: defect.kind, category: defect.category, validatorRule: defect.validatorRule,
  });
  throw new FirstWorkingSessionPreparationStageError(
    defect.category, defect.section, defect.kind, defect.validatorRule, defect.statementIndex,
  );
}

export type BriefStatementValidationCandidate = { section: BriefSection; item: BriefStatement };
export type BriefStatementValidationResult = {
  accepted: boolean; category: FirstWorkingSessionPreparationStageCode | null;
  section: BriefSection; kind: BriefStatementKind; validatorRule: string | null;
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
        return { accepted: false, category: "brief_citation_scope_invalid", section, kind: item.kind, validatorRule: "citation_ids_must_be_in_effective_scope" };
      }
      validateKindAwareTraceability(section, item, evidenceById, hypothesesById, inputs);
      return { accepted: true, category: null, section, kind: item.kind, validatorRule: null };
    } catch (error) {
      const category = error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode : "brief_schema_invalid";
      return {
        accepted: false,
        category,
        section,
        kind: item.kind,
        validatorRule: error instanceof FirstWorkingSessionPreparationStageError
          ? error.validatorRule ?? null
          : null,
      };
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
    validateKindAwareTraceability(section, item, evidenceById, hypothesesById, inputs);
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

export type BriefValidationReport = {
  valid: boolean;
  repairable: boolean;
  defects: BriefSemanticDefect[];
  terminalCategory: FirstWorkingSessionPreparationStageCode | null;
};

export function isRepairableBriefDefect(defect: BriefSemanticDefect): boolean {
  if (defect.validatorRule === "citation_ids_must_be_in_effective_scope") return false;
  return [
    "brief_semantic_supported_finding_invalid",
    "brief_semantic_interpretation_invalid",
    "brief_semantic_working_opinion_invalid",
    "brief_authority_gap_invalid",
    "brief_formation_priority_invalid",
    "brief_contradiction_invalid",
    "brief_citation_scope_invalid",
  ].includes(defect.category);
}

function globalDefect(
  section: BriefSection,
  category: FirstWorkingSessionPreparationStageCode,
  validatorRule: string,
  kind: BriefStatementKind,
  item?: BriefStatement,
): BriefSemanticDefect {
  return {
    section, statementIndex: null, kind, category, validatorRule,
    citedEvidenceIds: item ? [...item.evidenceIds] : [],
    citedHypothesisIds: item ? [...item.hypothesisIds] : [],
  };
}

export function collectFirstWorkingSessionBriefValidation(
  value: unknown,
  inputs: BriefInputs,
): BriefValidationReport {
  try {
    validateFirstWorkingSessionBrief(value, inputs);
    return { valid: true, repairable: false, defects: [], terminalCategory: null };
  } catch (error) {
    if (!(error instanceof FirstWorkingSessionPreparationStageError)) {
      return { valid: false, repairable: false, defects: [], terminalCategory: "brief_schema_invalid" };
    }
    if (["brief_schema_invalid", "brief_input_snapshot_invalid"].includes(error.stageCode)) {
      return { valid: false, repairable: false, defects: [], terminalCategory: error.stageCode };
    }
    const scope = analyzeBriefEvidenceScope(value, inputs);
    if (scope.outOfScopeCount > 0) {
      return { valid: false, repairable: false, defects: [], terminalCategory: "brief_citation_scope_invalid" };
    }
  }

  const brief = value as FirstWorkingSessionBrief;
  const evidenceById = new Map(inputs.evidence.map((item) => [item.id, item]));
  const hypothesesById = new Map(inputs.hypotheses.map((item) => [item.id, item]));
  const defects: BriefSemanticDefect[] = [];
  for (const section of singletonSectionNames) {
    const item = brief[section];
    if (item.evidenceIds.some((id) => !evidenceById.has(id)) || item.hypothesisIds.some((id) => !hypothesesById.has(id))) {
      return { valid: false, repairable: false, defects: [], terminalCategory: "brief_citation_scope_invalid" };
    }
    if (new Set(item.evidenceIds).size !== item.evidenceIds.length || new Set(item.hypothesisIds).size !== item.hypothesisIds.length) {
      defects.push(semanticDefect(section, null, item, "brief_citation_scope_invalid", "citation_ids_must_be_unique"));
    }
    defects.push(...collectKindAwareDefects(section, null, brief[section], evidenceById, hypothesesById, inputs));
  }
  for (const section of arraySectionNames) {
    brief[section].forEach((item, statementIndex) => {
      if (item.evidenceIds.some((id) => !evidenceById.has(id)) || item.hypothesisIds.some((id) => !hypothesesById.has(id))) {
        defects.push(semanticDefect(section, statementIndex, item, "brief_citation_scope_invalid", "citation_ids_must_be_in_effective_scope"));
      } else if (new Set(item.evidenceIds).size !== item.evidenceIds.length || new Set(item.hypothesisIds).size !== item.hypothesisIds.length) {
        defects.push(semanticDefect(section, statementIndex, item, "brief_citation_scope_invalid", "citation_ids_must_be_unique"));
      }
      defects.push(...collectKindAwareDefects(section, statementIndex, item, evidenceById, hypothesesById, inputs));
      if (item.kind === "contradiction" && section !== "contradictions") {
        defects.push(semanticDefect(section, statementIndex, item, "brief_contradiction_invalid", "contradiction_kind_only_allowed_in_contradictions"));
      }
    });
  }
  brief.workingOpinions.forEach((item, index) => {
    if (item.kind !== "working_opinion") defects.push(semanticDefect("workingOpinions", index, item, "brief_semantic_working_opinion_invalid", "working_opinions_kind_required"));
  });
  brief.contradictions.forEach((item, index) => {
    if (item.kind !== "contradiction") defects.push(semanticDefect("contradictions", index, item, "brief_contradiction_invalid", "contradictions_kind_required"));
  });
  brief.formationPriorities.forEach((item, index) => {
    if (!["interpretation", "working_opinion", "unknown"].includes(item.kind)) {
      defects.push(semanticDefect("formationPriorities", index, item, "brief_formation_priority_invalid", "formation_priority_kind_invalid"));
    }
  });
  brief.questions.forEach((item, index) => {
    if (!["interpretation", "unknown"].includes(item.kind)) defects.push(semanticDefect("questions", index, item, "brief_citation_scope_invalid", "question_kind_invalid"));
  });
  brief.authorityGaps.forEach((item, index) => {
    if (item.kind !== "unknown") defects.push(semanticDefect("authorityGaps", index, item, "brief_authority_gap_invalid", "authority_gap_kind_required"));
  });
  const unresolvedRisk = inputs.hypotheses.some((item) =>
    ["medium", "high"].includes(item.representationRisk)
      && (item.epistemicState !== "supported" || item.ownerDecision !== "approved"));
  if (unresolvedRisk && (brief.formationPriorities.length < 3 || brief.formationPriorities.length > 7)) {
    defects.push(globalDefect("formationPriorities", "brief_formation_priority_invalid", "formation_priority_count_required", "unknown"));
  }
  const authority = inputs.hypotheses.find((item) => item.constitutionalDomain === "authorityBoundaries");
  if (authority && (authority.epistemicState === "unknown" || authority.representationRisk === "high")) {
    if (brief.authorityGaps.length === 0) {
      defects.push(globalDefect("authorityGaps", "brief_authority_gap_invalid", "authority_gap_required", "unknown"));
    } else {
      brief.authorityGaps.forEach((item, index) => {
        if (!item.hypothesisIds.includes(authority.id)) {
          defects.push(semanticDefect("authorityGaps", index, item, "brief_authority_gap_invalid", "authority_hypothesis_citation_required"));
        }
      });
    }
  }
  const unique = [...new Map(defects.map((defect) => [
    `${defect.section}:${defect.statementIndex}:${defect.validatorRule}:${defect.detectedMarker ?? ""}`,
    defect,
  ])).values()];
  if (unique.length === 0) {
    return { valid: false, repairable: false, defects: [], terminalCategory: "brief_schema_invalid" };
  }
  return {
    valid: false,
    repairable: unique.every(isRepairableBriefDefect),
    defects: unique,
    terminalCategory: unique[0].category,
  };
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
  return new OpenAI({ timeout: 70_000, maxRetries: 2 });
}

function safeProviderString(value: unknown, maximumLength = 1000): string | null {
  if (value === undefined || value === null) return null;
  return String(value)
    .replace(/(?:sk|sess)-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, maximumLength);
}

function providerErrorDiagnostic(error: unknown) {
  const row = error as Record<string, unknown> & {
    headers?: { get?: (name: string) => string | null };
  };
  const nested = row.error && typeof row.error === "object"
    ? row.error as Record<string, unknown>
    : {};
  const retryHeader = row.headers?.get?.("x-stainless-retry-count")
    ?? row.headers?.get?.("x-openai-retry-count")
    ?? null;
  const parsedRetries = retryHeader === null ? null : Number.parseInt(retryHeader, 10);
  return {
    httpStatus: typeof row.status === "number" ? row.status : null,
    errorType: safeProviderString(row.type ?? nested.type, 200),
    errorCode: safeProviderString(row.code ?? nested.code, 200),
    errorParam: safeProviderString(row.param ?? nested.param, 200),
    requestId: safeProviderString(
      row.request_id ?? row.requestID ?? row.headers?.get?.("x-request-id"), 200,
    ),
    safeMessage: safeProviderString(row.message ?? nested.message ?? "provider request failed"),
    retryAfter: safeProviderString(row.headers?.get?.("retry-after"), 200),
    sdkRetryCount: parsedRetries !== null && Number.isFinite(parsedRetries) ? parsedRetries : null,
  };
}

export function classifyFirstWorkingSessionProviderFailure(diagnostic: {
  httpStatus: number | null;
  errorType: string | null;
  errorCode: string | null;
}): "brief_provider_rate_limited" | "brief_provider_request_failed" {
  return diagnostic.httpStatus === 429
    && diagnostic.errorType === "tokens"
    && diagnostic.errorCode === "rate_limit_exceeded"
    ? "brief_provider_rate_limited"
    : "brief_provider_request_failed";
}

async function runProductionProviderRequest(
  prompt: string,
  schema: Record<string, unknown>,
  context: BriefProviderCallContext = { logicalGeneration: 1, revisionNumber: 0 },
  observe?: (diagnostic: BriefProviderCallDiagnostic) => void,
): Promise<unknown> {
  if (!process.env.OPENAI_API_KEY) {
    throw new FirstWorkingSessionPreparationStageError("brief_provider_unavailable");
  }
  const startedAt = Date.now();
  const providerRequest = buildFirstWorkingSessionBriefProviderRequest(prompt, schema);
  const serializedRequest = JSON.stringify(providerRequest);
  const requestMetrics = {
    promptCharacterCount: prompt.length,
    schemaBytes: Buffer.byteLength(JSON.stringify(schema), "utf8"),
    serializedRequestBytes: Buffer.byteLength(serializedRequest, "utf8"),
    providerRequestSha256: createHash("sha256").update(serializedRequest).digest("hex"),
  };
  try {
    const response = await createFirstWorkingSessionBriefOpenAIClient().responses.create(
      providerRequest,
    );
    observe?.({
      ...context, success: true, durationMs: Date.now() - startedAt, httpStatus: 200,
      errorType: null, errorCode: null, errorParam: null,
      requestId: response._request_id ?? null, safeMessage: null, retryAfter: null,
      sdkRetryCount: null,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      totalTokens: response.usage?.total_tokens ?? null,
      ...requestMetrics,
    });
    try {
      return JSON.parse(response.output_text);
    } catch {
      throw new FirstWorkingSessionPreparationStageError("brief_schema_invalid");
    }
  } catch (error) {
    if (error instanceof FirstWorkingSessionPreparationStageError) throw error;
    const diagnostic = providerErrorDiagnostic(error);
    observe?.({
      ...context, success: false, durationMs: Date.now() - startedAt,
      ...diagnostic, inputTokens: null, outputTokens: null, totalTokens: null,
      ...requestMetrics,
    });
    throw new FirstWorkingSessionPreparationStageError(
      classifyFirstWorkingSessionProviderFailure(diagnostic),
    );
  }
}

const compactCitationGenerators = new WeakSet<BriefGenerator>();

async function defaultGenerator(
  prompt: string,
  schema: Record<string, unknown>,
  context?: BriefProviderCallContext,
): Promise<unknown> {
  return runProductionProviderRequest(prompt, schema, context);
}
compactCitationGenerators.add(defaultGenerator);

export function createCompactFirstWorkingSessionBriefGenerator(
  generator: BriefGenerator,
): BriefGenerator {
  compactCitationGenerators.add(generator);
  return generator;
}

export function createObservedFirstWorkingSessionBriefGenerator(
  observe: (diagnostic: BriefProviderCallDiagnostic) => void,
): BriefGenerator {
  return createCompactFirstWorkingSessionBriefGenerator(
    (prompt, schema, context) => runProductionProviderRequest(prompt, schema, context, observe),
  );
}

export async function synthesizeFirstWorkingSessionBrief(
  inputs: BriefInputs,
  generator: BriefGenerator = defaultGenerator,
): Promise<FirstWorkingSessionBrief> {
  if (!compactCitationGenerators.has(generator)) {
    const legacyValue = await generator(
      buildFirstWorkingSessionBriefPrompt(inputs), buildFirstWorkingSessionBriefSchema(inputs),
    );
    return validateFirstWorkingSessionBrief(legacyValue, inputs);
  }
  const contract = buildFirstWorkingSessionBriefProviderContract(inputs);
  const value = await generator(
    buildCompactFirstWorkingSessionBriefPrompt(inputs, contract),
    buildCompactFirstWorkingSessionBriefSchema(inputs, contract),
  );
  return validateFirstWorkingSessionBrief(
    expandFirstWorkingSessionBriefProviderAliases(value, contract), inputs,
  );
}

export type BriefRevisionTelemetry = {
  generationCount: number;
  revisionCount: number;
  initialValidationCategory: FirstWorkingSessionPreparationStageCode | null;
  terminalValidationCategory: FirstWorkingSessionPreparationStageCode | null;
  revisionExhausted: boolean;
  finalValidationPassed: boolean;
  providerDurationsMs: number[];
};

const MINIMUM_REVISION_REMAINING_MS = 80_000;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach(deepFreeze);
  }
  return value;
}

export async function synthesizeFirstWorkingSessionBriefWithRevisions(
  sourceInputs: BriefInputs,
  generator: BriefGenerator = defaultGenerator,
  options: { deadlineMs?: number; maxRevisions?: 0 | 1 | 2 } = {},
): Promise<{ brief: FirstWorkingSessionBrief; telemetry: BriefRevisionTelemetry }> {
  const inputs = deepFreeze(structuredClone(sourceInputs));
  const usesCompactCitations = compactCitationGenerators.has(generator);
  const providerContract = usesCompactCitations
    ? buildFirstWorkingSessionBriefProviderContract(inputs)
    : null;
  const schema = providerContract
    ? buildCompactFirstWorkingSessionBriefSchema(inputs, providerContract)
    : buildFirstWorkingSessionBriefSchema(inputs);
  const telemetry: BriefRevisionTelemetry = {
    generationCount: 0, revisionCount: 0, initialValidationCategory: null,
    terminalValidationCategory: null, revisionExhausted: false,
    finalValidationPassed: false, providerDurationsMs: [],
  };
  const invoke = async (prompt: string, revisionNumber: 0 | 1 | 2) => {
    const startedAt = Date.now();
    const availableMs = options.deadlineMs === undefined
      ? undefined
      : options.deadlineMs - Date.now() - 30_000;
    if (availableMs !== undefined && availableMs <= 0) {
      throw new FirstWorkingSessionPreparationStageError("brief_semantic_revision_time_budget_exhausted");
    }
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      telemetry.generationCount += 1;
      const request = generator(prompt, schema, {
        logicalGeneration: telemetry.generationCount,
        revisionNumber,
      });
      if (availableMs === undefined) return await request;
      return await Promise.race([
        request,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(
            new FirstWorkingSessionPreparationStageError("brief_semantic_revision_time_budget_exhausted"),
          ), availableMs);
        }),
      ]);
    } finally {
      if (timeout) clearTimeout(timeout);
      telemetry.providerDurationsMs.push(Date.now() - startedAt);
    }
  };
  const fail = (
    category: FirstWorkingSessionPreparationStageCode,
    defect?: BriefSemanticDefect,
  ): never => {
    telemetry.terminalValidationCategory = category;
    throw new FirstWorkingSessionPreparationStageError(
      category, defect?.section, defect?.kind, defect?.validatorRule,
      defect?.statementIndex, { ...telemetry, providerDurationsMs: [...telemetry.providerDurationsMs] },
    );
  };
  let providerCandidate: unknown;
  let candidate: unknown;
  try {
    providerCandidate = await invoke(
      providerContract
        ? buildCompactFirstWorkingSessionBriefPrompt(inputs, providerContract)
        : buildFirstWorkingSessionBriefPrompt(inputs),
      0,
    );
    candidate = providerContract
      ? expandFirstWorkingSessionBriefProviderAliases(providerCandidate, providerContract)
      : providerCandidate;
  } catch (error) {
    if (error instanceof FirstWorkingSessionPreparationStageError) fail(error.stageCode);
    throw error;
  }
  let report = collectFirstWorkingSessionBriefValidation(candidate, inputs);
  telemetry.initialValidationCategory = report.terminalCategory;
  if (report.valid) {
    telemetry.finalValidationPassed = true;
    return { brief: validateFirstWorkingSessionBrief(candidate, inputs), telemetry };
  }
  if (!report.repairable) {
    fail(report.terminalCategory ?? "brief_schema_invalid", report.defects[0]);
  }
  if (options.maxRevisions === 0) {
    fail(report.terminalCategory ?? "brief_schema_invalid", report.defects[0]);
  }
  const revisionNumbers = ([1, 2] as const).slice(0, options.maxRevisions ?? 2);
  for (const revisionNumber of revisionNumbers) {
    if (options.deadlineMs !== undefined
        && options.deadlineMs - Date.now() < MINIMUM_REVISION_REMAINING_MS) {
      fail("brief_semantic_revision_time_budget_exhausted");
    }
    telemetry.revisionCount = revisionNumber;
    try {
      providerCandidate = await invoke(
        providerContract
          ? buildCompactFirstWorkingSessionBriefRevisionPrompt(
              inputs, providerCandidate, report.defects, revisionNumber, providerContract,
            )
          : buildFirstWorkingSessionBriefRevisionPrompt(
              inputs, providerCandidate, report.defects, revisionNumber,
            ),
        revisionNumber,
      );
      candidate = providerContract
        ? expandFirstWorkingSessionBriefProviderAliases(providerCandidate, providerContract)
        : providerCandidate;
    } catch (error) {
      if (error instanceof FirstWorkingSessionPreparationStageError) fail(error.stageCode);
      throw error;
    }
    report = collectFirstWorkingSessionBriefValidation(candidate, inputs);
    telemetry.terminalValidationCategory = report.terminalCategory;
    if (report.valid) {
      telemetry.finalValidationPassed = true;
      return { brief: validateFirstWorkingSessionBrief(candidate, inputs), telemetry };
    }
    if (!report.repairable) {
      fail(report.terminalCategory ?? "brief_schema_invalid", report.defects[0]);
    }
  }
  telemetry.revisionExhausted = true;
  return fail("brief_semantic_revision_exhausted", report.defects[0]);
}

export async function buildFirstWorkingSessionBrief(
  client: SupabaseClient,
  scope: Scope,
  options: { deadlineMs?: number } = {},
) {
  const { inputs, reasoningRunId } = await loadFirstWorkingSessionBriefInputs(client, scope);
  return buildFirstWorkingSessionBriefArtifact(inputs, reasoningRunId, undefined, options);
}

export async function loadFirstWorkingSessionBriefInputs(
  client: SupabaseClient,
  scope: Scope,
): Promise<{ inputs: BriefInputs; reasoningRunId: string }> {
  const snapshot = await loadPreparationReasoningSnapshot(client, scope.onboardingSessionId, scope.ownerId);
  const hypotheses = await loadCurrentPreparationHypotheses(client, scope);
  if (hypotheses.length !== 7
      || hypotheses.some((hypothesis) => hypothesis.requestTraceId !== snapshot.reasoningRunId)) {
    throw new FirstWorkingSessionPreparationStageError("brief_input_snapshot_invalid");
  }
  const evidence = toEvidenceInput(snapshot.evidence);
  const observations = toObservationInput(snapshot.observations);
  return { inputs: { evidence, observations, hypotheses }, reasoningRunId: snapshot.reasoningRunId };
}

export function buildFirstWorkingSessionHypothesisTraceFingerprint(
  hypotheses: CurrentPreparationHypothesis[],
): string {
  return createHash("sha256").update(hypotheses
    .map((item) => `${item.id}:${item.hypothesisVersion}:${item.requestTraceId ?? ""}`)
    .sort().join("|"))
    .digest("hex");
}

export async function buildFirstWorkingSessionBriefArtifact(
  inputs: BriefInputs,
  reasoningRunId: string,
  generator?: BriefGenerator,
  options: { deadlineMs?: number; maxRevisions?: 0 | 1 | 2 } = {},
) {
  const frozenInputs = deepFreeze(structuredClone(inputs));
  const hypothesisTraceFingerprint = buildFirstWorkingSessionHypothesisTraceFingerprint(
    frozenInputs.hypotheses,
  );
  const revisionOptions = {
    ...options,
    maxRevisions: options.maxRevisions ?? (generator ? 0 : 2),
  } as { deadlineMs?: number; maxRevisions: 0 | 1 | 2 };
  const { brief, telemetry } = await synthesizeFirstWorkingSessionBriefWithRevisions(frozenInputs, generator, revisionOptions);
  const { sourceEvidenceIds, sourceHypothesisIds } = buildBriefCitationLineage(
    brief,
    new Set(frozenInputs.evidence.map((item) => item.id)),
    new Set(frozenInputs.hypotheses.map((item) => item.id)),
  );
  const sourceSnapshotFingerprint = createHash("sha256").update([
    FIRST_WORKING_SESSION_PREPARATION_VERSION, reasoningRunId,
    hypothesisTraceFingerprint, ...sourceEvidenceIds, ...sourceHypothesisIds,
  ].join("|")).digest("hex");
  return { brief, sourceEvidenceIds, sourceHypothesisIds, sourceSnapshotFingerprint, hypothesisTraceFingerprint, telemetry };
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
