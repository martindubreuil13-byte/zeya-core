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
  "first-working-session-preparation-v2";

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

const statementSchema = {
  type: "object", additionalProperties: false,
  properties: {
    statement: { type: "string", minLength: 1 },
    kind: { type: "string", enum: ["supported_finding", "interpretation", "working_opinion", "unknown", "contradiction"] },
    evidenceIds: { type: "array", items: { type: "string" } },
    hypothesisIds: { type: "array", items: { type: "string" } },
  },
  required: ["statement", "kind", "evidenceIds", "hypothesisIds"],
};
const arraySectionNames = ["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"] as const;
const singletonSectionNames = ["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"] as const;
const briefSchema = {
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

export function buildFirstWorkingSessionBriefPrompt(inputs: BriefInputs): string {
  return `Create an executive preparation brief for a first working session from the governed inputs below.
Synthesize independently across raw Evidence, Observations, and current hypotheses; do not merely paraphrase hypotheses.
Be specific enough that the facilitator sounds genuinely prepared. Avoid generic business language.
Every supported_finding, interpretation, working_opinion, or contradiction must cite one or more supplied Evidence IDs.
Use hypothesisIds only for supplied current hypothesis IDs. A working opinion is useful noncanonical judgment, never approved truth.
Every formation priority, authority gap, and question must cite the Evidence and/or current hypothesis that makes it necessary.
When any medium/high-risk hypothesis is unresolved, return 3-7 ranked formationPriorities, highest value first.
When authorityBoundaries is unknown or high-risk, authorityGaps must identify practical authority categories to verify: pricing, promises/guarantees, negotiation, commitments, escalation, and what Zeya may say or agree to. Do not invent the answers.
Compare owner-authority Evidence with first_party_company Evidence. Surface useful verification questions when the owner's stated offer/target differs in breadth or emphasis from public positioning or proof; do not label tension as contradiction without conflicting facts.
Questions must reduce representation risk or improve outbound business-development readiness. Reject generic consultant questions and terminology absent from the cited material.
Business Read and working opinions must synthesize distinctive patterns across inputs rather than paraphrase a meta description.
Do not invent contradiction resolution, authority, pricing, guarantees, promises, jargon, or facts.
Return conclusions only: never chain-of-thought, hidden reasoning, or provider commentary.
GOVERNED EVIDENCE:\n${JSON.stringify(inputs.evidence)}
GOVERNED OBSERVATIONS:\n${JSON.stringify(inputs.observations)}
CURRENT HYPOTHESES:\n${JSON.stringify(inputs.hypotheses)}`;
}

function statements(brief: FirstWorkingSessionBrief): BriefStatement[] {
  return [
    ...singletonSectionNames.map((key) => brief[key]),
    ...arraySectionNames.flatMap((key) => brief[key]),
  ];
}

const STOP_WORDS = new Set("a an and are as at be been by do does for from how i if in into is it may more must my of on or our should than that the their this to we what when where which who why with you your".split(" "));

function contentTokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z]{4,}/g)?.filter((token) => !STOP_WORDS.has(token)) ?? []);
}

function validateTraceableLanguage(
  item: BriefStatement,
  evidenceById: Map<string, EvidenceInput>,
  hypothesesById: Map<string, CurrentPreparationHypothesis>,
) {
  const basis = [
    ...item.evidenceIds.map((id) => evidenceById.get(id)?.rawStatement ?? ""),
    ...item.hypothesisIds.flatMap((id) => {
      const hypothesis = hypothesesById.get(id);
      return [hypothesis?.currentBelief ?? "", hypothesis?.riskReason ?? "", hypothesis?.constitutionalDomain ?? ""];
    }),
  ].join(" ");
  const statementTokens = contentTokens(item.statement);
  const basisTokens = contentTokens(basis);
  const overlap = [...statementTokens].filter((token) => basisTokens.has(token)).length;
  if (statementTokens.size >= 4 && overlap < 2) throw new Error(`brief_untraceable_language:${item.statement.slice(0, 80)}`);
}

export function validateFirstWorkingSessionBrief(
  value: unknown, inputs: BriefInputs,
): FirstWorkingSessionBrief {
  if (!value || typeof value !== "object") throw new Error("brief_invalid_shape");
  const brief = value as FirstWorkingSessionBrief;
  if (!brief.governance || brief.governance.canonical !== false || brief.governance.containsChainOfThought !== false) {
    throw new Error("brief_invalid_governance");
  }
  for (const key of singletonSectionNames) if (!brief[key] || typeof brief[key].statement !== "string") throw new Error(`brief_missing_${key}`);
  for (const key of arraySectionNames) if (!Array.isArray(brief[key])) throw new Error(`brief_missing_${key}`);
  const evidenceById = new Map(inputs.evidence.map((item) => [item.id, item]));
  const hypothesesById = new Map(inputs.hypotheses.map((item) => [item.id, item]));
  for (const item of statements(brief)) {
    if (!item.statement?.trim() || !Array.isArray(item.evidenceIds) || !Array.isArray(item.hypothesisIds)) throw new Error("brief_invalid_statement");
    if (!["supported_finding", "interpretation", "working_opinion", "unknown", "contradiction"].includes(item.kind)) throw new Error("brief_invalid_kind");
    if (!["unknown"].includes(item.kind) && item.evidenceIds.length === 0) throw new Error("brief_unsupported_statement");
    if (item.evidenceIds.some((id) => !evidenceById.has(id))) throw new Error("brief_evidence_out_of_scope");
    if (item.hypothesisIds.some((id) => !hypothesesById.has(id))) throw new Error("brief_hypothesis_out_of_scope");
    if (item.evidenceIds.length + item.hypothesisIds.length > 0) {
      validateTraceableLanguage(item, evidenceById, hypothesesById);
    }
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
  const value = await generator(buildFirstWorkingSessionBriefPrompt(inputs), briefSchema);
  return validateFirstWorkingSessionBrief(value, inputs);
}

export async function buildFirstWorkingSessionBrief(client: SupabaseClient, scope: Scope) {
  const snapshot = await loadPreparationReasoningSnapshot(client, scope.onboardingSessionId, scope.ownerId);
  const hypotheses = await loadCurrentPreparationHypotheses(client, scope);
  if (hypotheses.length !== 7) throw new Error("brief_current_hypotheses_missing");
  const evidence = toEvidenceInput(snapshot.evidence);
  const observations = toObservationInput(snapshot.observations);
  const brief = await synthesizeFirstWorkingSessionBrief({ evidence, observations, hypotheses });
  const sourceEvidenceIds = [...new Set(statements(brief).flatMap((item) => item.evidenceIds))].sort();
  const sourceHypothesisIds = [...new Set(statements(brief).flatMap((item) => item.hypothesisIds))].sort();
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
