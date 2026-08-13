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

type Scope = { ownerId: string; businessId: string; businessRepresentationId: string; onboardingSessionId: string };
type BriefInputs = { evidence: EvidenceInput[]; observations: ObservationInput[]; hypotheses: CurrentPreparationHypothesis[] };
type BriefGenerator = (prompt: string, schema: Record<string, unknown>) => Promise<unknown>;

const arraySectionNames = ["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"] as const;
const singletonSectionNames = ["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"] as const;

export function buildFirstWorkingSessionBriefSchema(inputs: BriefInputs) {
  const statementSchema = {
    type: "object", additionalProperties: false,
    properties: {
      statement: { type: "string", minLength: 1 },
      kind: { type: "string", enum: ["supported_finding", "interpretation", "working_opinion", "unknown", "contradiction"] },
      evidenceIds: { type: "array", items: { type: "string", enum: inputs.evidence.map((item) => item.id) } },
      hypothesisIds: { type: "array", items: { type: "string", enum: inputs.hypotheses.map((item) => item.id) } },
    },
    required: ["statement", "kind", "evidenceIds", "hypothesisIds"],
  };
  return {
    type: "object", additionalProperties: false,
    properties: {
      ...Object.fromEntries(singletonSectionNames.map((name) => [name, statementSchema])),
      ...Object.fromEntries(arraySectionNames.map((name) => [name, { type: "array", items: statementSchema }])),
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
Use hypothesisIds only for supplied current hypothesis IDs. A working opinion is useful noncanonical judgment, never approved truth.
Every formation priority, authority gap, and question must cite the Evidence and/or current hypothesis that makes it necessary.
When any medium/high-risk hypothesis is unresolved, return 3-7 ranked formationPriorities, highest value first.
When authorityBoundaries is unknown or high-risk, authorityGaps must identify practical authority categories to verify: pricing, promises/guarantees, negotiation, commitments, escalation, and what Zeya may say or agree to. Do not invent the answers.
Compare owner-authority Evidence with first_party_company Evidence. Surface useful verification questions when the owner's stated offer/target differs in breadth or emphasis from public positioning or proof; do not label tension as contradiction without conflicting facts.
Questions must reduce representation risk or improve outbound business-development readiness. Reject generic consultant questions and terminology absent from the cited material.
Business Read and working opinions must synthesize distinctive patterns across inputs rather than paraphrase a meta description.
Do not invent contradiction resolution, market size, customer segment, regulatory status, authority, pricing, guarantees, promises, superlatives, jargon, or facts. Concrete numbers and high-risk factual claims must appear in the cited governed basis.
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
  if (sourceEvidenceIds.some((id) => !effectiveEvidenceIds.has(id))) throw new Error("brief_evidence_out_of_scope");
  if (sourceHypothesisIds.some((id) => !currentHypothesisIds.has(id))) throw new Error("brief_hypothesis_out_of_scope");
  return { sourceEvidenceIds, sourceHypothesisIds };
}

const GOVERNED_FACT_MARKERS = [
  /\b(?:gdpr|hipaa|soc\s*2|iso\s*\d+|certified|licensed|regulated|regulatory|compliant|compliance)\b/gi,
  /\b(?:guarantee(?:d|s)?|warrant(?:y|ies)|promises?)\b/gi,
  /\b(?:best|largest|leading|only|number\s+one|award[- ]winning)\b/gi,
  /\b(?:enterprise|fortune\s*500|healthcare|government|public\s+sector|financial\s+services|e-?commerce|manufacturers?|nonprofits?)\b/gi,
] as const;

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9%$]+/g, " ").trim();
}

function concreteClaimMarkers(value: string): string[] {
  const markers: string[] = [...(value.match(/(?:[$€£]\s*)?\b\d[\d,.]*(?:\s*(?:%|percent|million|billion|thousand))?\b/gi) ?? [])];
  for (const pattern of GOVERNED_FACT_MARKERS) markers.push(...(value.match(pattern) ?? []));
  return [...new Set(markers.map(normalized).filter(Boolean))];
}

function rejectBriefStatement(section: BriefSection, item: BriefStatement, category: string): never {
  console.error("[first-working-session-brief] validation_failed", {
    section,
    kind: item.kind,
    category,
  });
  throw new Error(category);
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
  const basis = normalized([
    ...evidenceBasis,
    ...hypothesisBasis,
  ].join(" "));

  if (item.kind === "supported_finding" && item.evidenceIds.length === 0) {
    rejectBriefStatement(section, item, "brief_supported_finding_without_evidence");
  }
  if (["interpretation", "working_opinion"].includes(item.kind)
      && item.evidenceIds.length + item.hypothesisIds.length === 0) {
    rejectBriefStatement(section, item, "brief_synthesis_without_basis");
  }
  if (item.kind === "contradiction") {
    const citesContradictedHypothesis = item.hypothesisIds.some(
      (id) => hypothesesById.get(id)?.epistemicState === "contradicted",
    );
    const distinctEvidenceStatements = new Set(evidenceBasis.map(normalized).filter(Boolean));
    if (!citesContradictedHypothesis || distinctEvidenceStatements.size < 2) {
      rejectBriefStatement(section, item, "brief_contradiction_without_conflicting_basis");
    }
  }

  if (["supported_finding", "interpretation", "working_opinion", "contradiction"].includes(item.kind)) {
    const unsupportedMarker = concreteClaimMarkers(item.statement).find((marker) => !basis.includes(marker));
    if (unsupportedMarker) {
      rejectBriefStatement(section, item, "brief_unsupported_concrete_claim");
    }
  }
}

export function validateFirstWorkingSessionBrief(
  value: unknown, inputs: BriefInputs,
): FirstWorkingSessionBrief {
  if (!value || typeof value !== "object") throw new Error("brief_invalid_shape");
  const scopeDiagnostic = analyzeBriefEvidenceScope(value, inputs);
  if (scopeDiagnostic.outOfScopeCount > 0) {
    console.error("[first-working-session-brief] brief_evidence_out_of_scope", scopeDiagnostic);
    throw new Error("brief_evidence_out_of_scope");
  }
  const brief = value as FirstWorkingSessionBrief;
  if (!brief.governance || brief.governance.canonical !== false || brief.governance.containsChainOfThought !== false) {
    throw new Error("brief_invalid_governance");
  }
  for (const key of singletonSectionNames) if (!brief[key] || typeof brief[key].statement !== "string") throw new Error(`brief_missing_${key}`);
  for (const key of arraySectionNames) if (!Array.isArray(brief[key])) throw new Error(`brief_missing_${key}`);
  const evidenceById = new Map(inputs.evidence.map((item) => [item.id, item]));
  const hypothesesById = new Map(inputs.hypotheses.map((item) => [item.id, item]));
  for (const { section, item } of statementEntries(brief)) {
    if (!item.statement?.trim() || !Array.isArray(item.evidenceIds) || !Array.isArray(item.hypothesisIds)) throw new Error("brief_invalid_statement");
    if (!["supported_finding", "interpretation", "working_opinion", "unknown", "contradiction"].includes(item.kind)) throw new Error("brief_invalid_kind");
    if (item.evidenceIds.some((id) => !evidenceById.has(id))) throw new Error("brief_evidence_out_of_scope");
    if (item.hypothesisIds.some((id) => !hypothesesById.has(id))) throw new Error("brief_hypothesis_out_of_scope");
    validateKindAwareTraceability(section, item, evidenceById, hypothesesById);
  }
  if (brief.workingOpinions.some((item) => item.kind !== "working_opinion")) throw new Error("brief_opinion_mislabeled");
  if (brief.contradictions.some((item) => item.kind !== "contradiction")) throw new Error("brief_contradiction_mislabeled");
  if (brief.unknowns.some((item) => item.kind !== "unknown")) throw new Error("brief_unknown_mislabeled");
  const unresolvedRisk = inputs.hypotheses.some((item) =>
    ["medium", "high"].includes(item.representationRisk)
      && (item.epistemicState !== "supported" || item.ownerDecision !== "approved"),
  );
  if (unresolvedRisk && (brief.formationPriorities.length < 3 || brief.formationPriorities.length > 7)) {
    throw new Error("brief_formation_priorities_required");
  }
  if (brief.formationPriorities.some((item) => item.evidenceIds.length + item.hypothesisIds.length === 0)) {
    throw new Error("brief_priority_untraceable");
  }
  if (brief.questions.some((item) => item.evidenceIds.length + item.hypothesisIds.length === 0)) {
    throw new Error("brief_question_untraceable");
  }
  const authority = inputs.hypotheses.find((item) => item.constitutionalDomain === "authorityBoundaries");
  if (authority && (authority.epistemicState === "unknown" || authority.representationRisk === "high")) {
    if (brief.authorityGaps.length === 0) throw new Error("brief_authority_gaps_required");
    if (brief.authorityGaps.some((item) => !item.hypothesisIds.includes(authority.id))) {
      throw new Error("brief_authority_gap_untraceable");
    }
  }
  return brief;
}

async function defaultGenerator(prompt: string, schema: Record<string, unknown>): Promise<unknown> {
  try {
    const response = await new OpenAI().responses.create({
      model: "gpt-4o",
      instructions: prompt,
      input: [{ role: "user", content: "Produce the governed first-working-session brief." }],
      text: { format: { type: "json_schema", name: "first_working_session_brief", schema, strict: true } },
    });
    try {
      return JSON.parse(response.output_text);
    } catch {
      throw new Error("brief_provider_invalid_response");
    }
  } catch (error) {
    if (error instanceof Error && error.message === "brief_provider_invalid_response") throw error;
    throw new Error("brief_provider_failed");
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
  if (hypotheses.length !== 7) throw new Error("brief_current_hypotheses_missing");
  const evidence = toEvidenceInput(snapshot.evidence);
  const observations = toObservationInput(snapshot.observations);
  const brief = await synthesizeFirstWorkingSessionBrief({ evidence, observations, hypotheses });
  const { sourceEvidenceIds, sourceHypothesisIds } = buildBriefCitationLineage(
    brief,
    new Set(evidence.map((item) => item.id)),
    new Set(hypotheses.map((item) => item.id)),
  );
  const hypothesisTraceFingerprint = createHash("sha256").update(hypotheses
    .map((item) => `${item.id}:${item.hypothesisVersion}:${item.requestTraceId ?? ""}`)
    .sort().join("|"))
    .digest("hex");
  const sourceSnapshotFingerprint = createHash("sha256").update([
    FIRST_WORKING_SESSION_PREPARATION_VERSION, snapshot.reasoningRunId,
    hypothesisTraceFingerprint, ...sourceEvidenceIds, ...sourceHypothesisIds,
  ].join("|")).digest("hex");
  return { brief, sourceEvidenceIds, sourceHypothesisIds, sourceSnapshotFingerprint, hypothesisTraceFingerprint };
}

export function isFirstWorkingSessionBriefCurrent(
  stored: { sourceSnapshotFingerprint: string; preparationContractVersion: string }, expectedSnapshotFingerprint: string,
): boolean {
  return stored.preparationContractVersion === FIRST_WORKING_SESSION_PREPARATION_VERSION
    && stored.sourceSnapshotFingerprint === expectedSnapshotFingerprint;
}
