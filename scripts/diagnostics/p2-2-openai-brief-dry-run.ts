import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import {
  buildFirstWorkingSessionBriefArtifact,
  buildFirstWorkingSessionBriefPrompt,
  buildFirstWorkingSessionBriefProviderRequest,
  buildFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionFinalizationPayload,
  collectFirstWorkingSessionBriefValidation,
  createFirstWorkingSessionBriefOpenAIClient,
  FIRST_WORKING_SESSION_BRIEF_MODEL,
  FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
  type BriefInputs,
} from "../../lib/onboarding/first-working-session-brief";
import {
  generateReasoningRunFingerprint,
  normalizeEffectivePreparationEvidence,
  normalizeEffectivePreparationObservations,
  toEvidenceInput,
  toObservationInput,
} from "../../lib/onboarding/persist-hypotheses-orchestration";
import { PREPARATION_DOMAINS } from "../../lib/onboarding/preparation-intelligence";
import type {
  DatabaseEvidence,
  DatabaseObservation,
} from "../../lib/onboarding/persist-hypotheses-types";

export const P2_2_DIAGNOSTIC_IDS = {
  session: "10000000-0000-4000-8000-000000000001",
  representation: "10000000-0000-4000-8000-000000000002",
  workingSession: "10000000-0000-4000-8000-000000000003",
  lease: "10000000-0000-4000-8000-000000000004",
  v1Home: "10000000-0000-4000-8000-000000000010",
  v2Home: "10000000-0000-4000-8000-000000000011",
  qualify: "10000000-0000-4000-8000-000000000012",
  contact: "10000000-0000-4000-8000-000000000013",
  ownerOffer: "10000000-0000-4000-8000-000000000014",
  ownerTarget: "10000000-0000-4000-8000-000000000015",
  ownerGoal: "10000000-0000-4000-8000-000000000016",
  ownerProblem: "10000000-0000-4000-8000-000000000017",
  oldObservation: "10000000-0000-4000-8000-000000000020",
  homeObservation: "10000000-0000-4000-8000-000000000021",
  qualifyObservation: "10000000-0000-4000-8000-000000000022",
};
const IDS = P2_2_DIAGNOSTIC_IDS;

function evidence(id: string, overrides: Partial<DatabaseEvidence>): DatabaseEvidence {
  return {
    id,
    business_representation_id: IDS.representation,
    direct_hire_onboarding_session_id: IDS.session,
    source_type: "public_website",
    raw_statement: "Business architecture for founders.",
    affected_domains: ["whatYouSell"],
    created_at: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

// This is the same fixed, synthetic fixture used by
// tests/integration/p2-2-forensic-live-shaped.test.ts. It contains no live rows.
export function buildP22LiveShapedDiagnosticInputs(): { inputs: BriefInputs; reasoningRunId: string } {
  const rows: DatabaseEvidence[] = [
    evidence(IDS.v1Home, { canonical_source_url: "https://modernbusinessarchitect.com/", source_content_hash: "old", extraction_method_version: "direct-hire-web-v1", source_retrieved_at: "2026-08-01T00:00:00.000Z" }),
    evidence(IDS.v2Home, { canonical_source_url: "https://modernbusinessarchitect.com/", source_content_hash: "home-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "homepage", source_evidence_kind: "section_text", raw_statement: "You don’t need another idea. You need something that actually works. Turn your ideas into structured, scalable businesses with clarity, alignment, and execution. Arrival → Architecture → Assembly. Most people don’t lack ideas. They lack structure. Architecture: Reverse engineer the path." }),
    evidence(IDS.qualify, { canonical_source_url: "https://modernbusinessarchitect.com/qualify", source_content_hash: "qualify-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "products_services", source_evidence_kind: "section_list", raw_statement: "This isn’t for everyone. If you're serious about turning an idea into something structured, executable, and viable — this is where we start." }),
    evidence(IDS.contact, { canonical_source_url: "https://modernbusinessarchitect.com/contact", source_content_hash: "contact-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "contact", source_evidence_kind: "section_text", raw_statement: "Prospective clients can request a conversation through the contact page." }),
    evidence(IDS.ownerOffer, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "description", induction_material_label: "What the business sells", captured_by_actor: "owner", raw_statement: "Business coaching and architecture", created_at: "2026-08-10T00:00:00.000Z" }),
    evidence(IDS.ownerTarget, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "description", induction_material_label: "Target customer", captured_by_actor: "owner", raw_statement: "Startups globally in western developed country English speaking", created_at: "2026-08-10T00:00:01.000Z" }),
    evidence(IDS.ownerGoal, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "note", induction_material_label: "Growth priority", captured_by_actor: "owner", raw_statement: "find new potential clients", created_at: "2026-08-10T00:00:02.000Z" }),
    evidence(IDS.ownerProblem, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "note", induction_material_label: "Owner context", captured_by_actor: "owner", raw_statement: "people dont always understand business architecture", created_at: "2026-08-10T00:00:03.000Z" }),
  ];
  const allObservations: DatabaseObservation[] = [
    { id: IDS.oldObservation, business_representation_id: IDS.representation, evidence_id: IDS.v1Home, interpreted_meaning: "Historical homepage", confidence_in_interpretation: 50, affected_domains: ["whatYouSell"], created_at: "2026-08-01T00:00:00.000Z" },
    { id: IDS.homeObservation, business_representation_id: IDS.representation, evidence_id: IDS.v2Home, interpreted_meaning: "Architecture leads the public positioning", confidence_in_interpretation: 70, affected_domains: ["whatYouSell"], created_at: "2026-08-12T00:00:00.000Z" },
    { id: IDS.qualifyObservation, business_representation_id: IDS.representation, evidence_id: IDS.qualify, interpreted_meaning: "Qualification emphasizes readiness for structural decisions", confidence_in_interpretation: 65, affected_domains: ["whoItIsFor"], created_at: "2026-08-12T00:00:01.000Z" },
  ];
  const effective = normalizeEffectivePreparationEvidence(rows);
  const effectiveIds = new Set(effective.map((item) => item.id));
  const observations = normalizeEffectivePreparationObservations(allObservations, effectiveIds);
  const reasoningRunId = generateReasoningRunFingerprint(
    IDS.session,
    IDS.representation,
    [...effectiveIds].sort(),
    observations.map((item) => item.id).sort(),
  );
  const hypotheses = PREPARATION_DOMAINS.map((domain, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    constitutionalDomain: domain,
    epistemicState: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "unknown" as const : "partial" as const,
    currentBelief: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? null
      : domain === "whatYouSell" ? "Business coaching and architecture services"
        : domain === "whoItIsFor" ? "Startups globally in western developed country English speaking"
          : domain === "problemOrAspiration" ? "Clients need to turn ideas into structured, scalable businesses"
            : domain === "proposedDescription" ? "Helps startups turn ideas into structured, scalable businesses"
              : "The service provides clarity, alignment, and execution for business ideas",
    confidence: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "unknown" as const : "medium" as const,
    representationRisk: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "high" as const : "medium" as const,
    riskReason: domain === "authorityBoundaries" ? "Pricing promises negotiation commitments and escalation authority are unknown." : "Positioning requires owner verification.",
    verificationNeed: null,
    sourceEvidenceIds: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? [] : [IDS.v2Home, IDS.ownerOffer],
    hypothesisVersion: 5,
    previousHypothesisId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ownerDecision: null,
    requestTraceId: reasoningRunId,
    createdByActor: "zeya_reasoning_service",
  }));
  return {
    inputs: {
      evidence: toEvidenceInput(effective),
      observations: toObservationInput(observations),
      hypotheses,
    },
    reasoningRunId,
  };
}

type JsonSchema = Record<string, unknown>;
type CallResult = { ok: true; value: unknown } | { ok: false; error: unknown };

const documentedSupported = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const",
  "anyOf", "pattern", "format", "minItems", "maxItems", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "description", "$ref", "$defs",
]);
const documentedUnsupported = new Set([
  "allOf", "not", "dependentRequired", "dependentSchemas", "if", "then", "else",
  "uniqueItems", "oneOf", "propertyNames", "contains", "dependencies", "patternProperties",
]);
const explicitlyRequestedKeywords = [
  "minItems", "maxItems", "minLength", "maxLength", "pattern", "format", "enum", "const",
  "anyOf", "oneOf", "allOf", "$ref", "$defs", "additionalProperties", "propertyNames",
  "contains", "dependencies", "dependentRequired", "if", "then", "else",
];

function schemaKeywords(schema: unknown, out = new Set<string>()): Set<string> {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return out;
  const row = schema as Record<string, unknown>;
  for (const [key, value] of Object.entries(row)) {
    out.add(key);
    if (key === "properties" || key === "$defs") {
      for (const child of Object.values(value as Record<string, unknown>)) schemaKeywords(child, out);
    } else if (["items", "anyOf", "oneOf", "allOf", "not", "if", "then", "else"].includes(key)) {
      if (Array.isArray(value)) value.forEach((child) => schemaKeywords(child, out));
      else schemaKeywords(value, out);
    }
  }
  return out;
}

function schemaDepth(value: unknown, depth = 0): number {
  if (!value || typeof value !== "object") return depth;
  if (Array.isArray(value)) return value.reduce<number>((max, child) => Math.max(max, schemaDepth(child, depth)), depth);
  return Object.values(value as Record<string, unknown>)
    .reduce<number>((max, child) => Math.max(max, schemaDepth(child, depth + 1)), depth);
}

function enumValueCount(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.reduce((sum, child) => sum + enumValueCount(child), 0);
  return Object.entries(value as Record<string, unknown>).reduce(
    (sum, [key, child]) => sum + (key === "enum" && Array.isArray(child) ? child.length : enumValueCount(child)),
    0,
  );
}

function byteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function metrics(prompt: string, schema: JsonSchema, request: unknown, inputs: BriefInputs) {
  console.log({
    model: FIRST_WORKING_SESSION_BRIEF_MODEL,
    schemaBytes: byteLength(schema),
    promptCharacters: prompt.length,
    approximatePromptTokens: Math.ceil(prompt.length / 4),
    serializedRequestBytes: byteLength(request),
    effectiveEvidenceItems: inputs.evidence.length,
    hypotheses: inputs.hypotheses.length,
    totalSchemaEnumValues: enumValueCount(schema),
    maximumSchemaDepth: schemaDepth(schema),
    topLevelRequestKeys: Object.keys(request as Record<string, unknown>),
  });
}

export function safeOpenAIProviderError(error: unknown) {
  const row = error as Record<string, unknown> & {
    constructor?: { name?: string };
    headers?: { get?: (name: string) => string | null };
  };
  const nested = row.error && typeof row.error === "object" ? row.error as Record<string, unknown> : {};
  const status = typeof row.status === "number" ? row.status : null;
  return {
    constructor: row.constructor?.name ?? typeof error,
    httpStatus: status,
    openaiErrorType: row.type ?? nested.type ?? null,
    openaiErrorCode: row.code ?? nested.code ?? null,
    param: row.param ?? nested.param ?? null,
    providerMessage: row.message ?? nested.message ?? String(error),
    requestId: row.request_id ?? row.requestID ?? row.headers?.get?.("x-request-id") ?? null,
    model: FIRST_WORKING_SESSION_BRIEF_MODEL,
    requestPhase: status !== null ? "after HTTP response" : "before HTTP response or transport failure",
  };
}

export async function runP22ProviderDiagnosticCall(
  client: OpenAI, number: string, name: string, prompt: string, schema: JsonSchema,
): Promise<CallResult> {
  const request = buildFirstWorkingSessionBriefProviderRequest(prompt, schema);
  console.log(`\nCALL ${number} — ${name}`);
  try {
    const response = await client.responses.create(request);
    const value = JSON.parse(response.output_text);
    console.log({ result: "PASS", responseStatus: response.status, requestId: response._request_id ?? null });
    return { ok: true, value };
  } catch (error) {
    console.log({ result: "FAIL", ...safeOpenAIProviderError(error) });
    return { ok: false, error };
  }
}

function bisectionSchemas(full: JsonSchema, inputs: BriefInputs): Array<[string, JsonSchema]> {
  const evidenceEnum = inputs.evidence.map((item) => item.id);
  const hypothesisEnum = inputs.hypotheses.map((item) => item.id);
  const object = (properties: Record<string, unknown>) => ({
    type: "object", properties, required: Object.keys(properties), additionalProperties: false,
  });
  const statement = object({
    statement: { type: "string", minLength: 1, pattern: ".*\\S.*" },
    kind: { type: "string", enum: ["supported_finding"] },
    evidenceIds: { type: "array", items: { type: "string" } },
    hypothesisIds: { type: "array", items: { type: "string" } },
  });
  const withEvidence = structuredClone(statement) as JsonSchema;
  ((withEvidence.properties as Record<string, JsonSchema>).evidenceIds.items as JsonSchema).enum = evidenceEnum;
  const withHypotheses = structuredClone(withEvidence) as JsonSchema;
  ((withHypotheses.properties as Record<string, JsonSchema>).hypothesisIds.items as JsonSchema).enum = hypothesisEnum;
  const bounded = structuredClone(withHypotheses) as JsonSchema;
  (bounded.properties as Record<string, JsonSchema>).evidenceIds.minItems = 1;
  const props = full.properties as Record<string, JsonSchema>;
  return [
    ["top-level object", object({ ok: { type: "boolean" } })],
    ["governance", object({ governance: props.governance })],
    ["one statement object", object({ statement })],
    ["Evidence citation enum", object({ statement: withEvidence })],
    ["hypothesis citation enum", object({ statement: withHypotheses })],
    ["one array section", object({ section: { type: "array", items: withHypotheses } })],
    ["minItems/maxItems", object({ section: { type: "array", items: bounded, minItems: 1, maxItems: 8 } })],
    ["all singleton sections", object(Object.fromEntries(["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"].map((key) => [key, props[key]])))],
    ["all list sections", object(Object.fromEntries(["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"].map((key) => [key, props[key]])))],
    ["complete schema", full],
  ];
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
  const { inputs, reasoningRunId } = buildP22LiveShapedDiagnosticInputs();
  const schema = buildFirstWorkingSessionBriefSchema(inputs) as JsonSchema;
  const prompt = buildFirstWorkingSessionBriefPrompt(inputs);
  const client = createFirstWorkingSessionBriefOpenAIClient();
  const basicSchema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };

  const stabilityArgument = process.argv.find((argument) => argument.startsWith("--stability-runs="));
  if (stabilityArgument) {
    const runCount = Number.parseInt(stabilityArgument.split("=")[1] ?? "", 10);
    if (!Number.isInteger(runCount) || runCount < 1 || runCount > 50) {
      throw new Error("--stability-runs must be an integer from 1 to 50");
    }
    const results: Array<{
      run: number; result: "PASS" | "FAIL"; providerCalls: number; revisionCount: number;
      initialCategory: string | null; terminalCategory: string | null; validatorRule: string | null;
      durationMs: number;
    }> = [];
    for (let run = 1; run <= runCount; run += 1) {
      const startedAt = Date.now();
      let providerCalls = 0;
      let initialCategory: string | null = null;
      try {
        const artifact = await buildFirstWorkingSessionBriefArtifact(
          inputs,
          reasoningRunId,
          async (providerPrompt, providerSchema) => {
            providerCalls += 1;
            const response = await client.responses.create(
              buildFirstWorkingSessionBriefProviderRequest(providerPrompt, providerSchema),
            );
            const candidate = JSON.parse(response.output_text);
            if (providerCalls === 1) {
              initialCategory = collectFirstWorkingSessionBriefValidation(candidate, inputs).terminalCategory;
            }
            return candidate;
          },
          { maxRevisions: 2 },
        );
        buildFirstWorkingSessionFinalizationPayload(IDS.workingSession, IDS.lease, artifact);
        results.push({
          run, result: "PASS", providerCalls, revisionCount: artifact.telemetry.revisionCount,
          initialCategory, terminalCategory: null, validatorRule: null,
          durationMs: Date.now() - startedAt,
        });
      } catch (error) {
        const stageError = error as {
          stageCode?: string;
          validatorRule?: string;
        };
        const providerError = safeOpenAIProviderError(error);
        const terminalCategory = stageError.stageCode
          ?? [providerError.httpStatus, providerError.openaiErrorType, providerError.openaiErrorCode]
            .filter((value) => value !== null && value !== undefined).join(":")
          ?? "provider_failure";
        results.push({
          run, result: "FAIL", providerCalls, revisionCount: Math.max(0, providerCalls - 1),
          initialCategory, terminalCategory: terminalCategory || "provider_failure",
          validatorRule: stageError.validatorRule ?? null,
          durationMs: Date.now() - startedAt,
        });
      }
      console.log("STABILITY PROGRESS", { completed: run, total: runCount });
      if (run < runCount) await new Promise((resolve) => setTimeout(resolve, 10_000));
    }
    const durations = results.map((result) => result.durationMs).sort((a, b) => a - b);
    const passCount = results.filter((result) => result.result === "PASS").length;
    console.log("\nSTABILITY RESULTS", results);
    console.log("\nSTABILITY SUMMARY", {
      initialPassCount: results.filter((result) => result.result === "PASS" && result.providerCalls === 1).length,
      revision1RecoveryCount: results.filter((result) => result.result === "PASS" && result.providerCalls === 2).length,
      revision2RecoveryCount: results.filter((result) => result.result === "PASS" && result.providerCalls === 3).length,
      terminalFailures: runCount - passCount,
      finalPassCount: passCount,
      averageProviderCalls: results.reduce((sum, result) => sum + result.providerCalls, 0) / runCount,
      maxProviderCalls: Math.max(...results.map((result) => result.providerCalls)),
      durationMs: { min: durations[0], median: durations[Math.floor(durations.length / 2)], max: durations.at(-1) },
      failureCategories: Object.fromEntries([...new Set(results.filter((result) => result.result === "FAIL").map((result) => result.terminalCategory))]
        .map((category) => [category, results.filter((result) => result.terminalCategory === category).length])),
    });
    return;
  }

  console.log({ openaiSdkVersion: FIRST_WORKING_SESSION_OPENAI_SDK_VERSION, model: FIRST_WORKING_SESSION_BRIEF_MODEL });
  const used = [...schemaKeywords(schema)].sort();
  console.log("\nUSED KEYWORDS", used);
  console.log("SUPPORTED", used.filter((key) => documentedSupported.has(key)));
  console.log("UNSUPPORTED / QUESTIONABLE", used.filter((key) => !documentedSupported.has(key)));
  console.log("REQUESTED KEYWORD PRESENCE", Object.fromEntries(explicitlyRequestedKeywords.map((key) => [key, used.includes(key)])));
  console.log("DOCUMENTED UNSUPPORTED PRESENT", used.filter((key) => documentedUnsupported.has(key)));

  const call1 = await runP22ProviderDiagnosticCall(client, "1", "BASIC CONTROL", "Return {ok:true}", basicSchema);
  if (!call1.ok) return;

  const tinyPrompt = "Return a valid object matching the supplied first-working-session brief schema.";
  metrics(tinyPrompt, schema, buildFirstWorkingSessionBriefProviderRequest(tinyPrompt, schema), inputs);
  const call2 = await runP22ProviderDiagnosticCall(client, "2", "PRODUCTION SCHEMA CONTROL", tinyPrompt, schema);
  if (!call2.ok) {
    console.log("\nSCHEMA BISECTION");
    for (const [name, candidate] of bisectionSchemas(schema, inputs)) {
      const result = await runP22ProviderDiagnosticCall(client, `2.${name}`, name, "Return the smallest valid object for this schema.", candidate);
      if (!result.ok) {
        console.log("SMALLEST FAILING SCHEMA", { name, schema: candidate, error: safeOpenAIProviderError(result.error) });
        break;
      }
    }
    return;
  }

  const fullRequest = buildFirstWorkingSessionBriefProviderRequest(prompt, schema);
  metrics(prompt, schema, fullRequest, inputs);
  const call3 = await runP22ProviderDiagnosticCall(client, "3", "FULL PRODUCTION-SHAPED REQUEST", prompt, schema);
  if (!call3.ok) return;

  try {
    const artifact = await buildFirstWorkingSessionBriefArtifact(
      inputs,
      reasoningRunId,
      async () => call3.value,
    );
    const payload = buildFirstWorkingSessionFinalizationPayload(IDS.workingSession, IDS.lease, artifact);
    console.log("\nLOCAL VALIDATION", {
      runtimeAndSemanticValidation: "PASS",
      citationLineage: "PASS",
      finalizationPayloadPreflight: "PASS",
      sourceEvidenceIds: payload.p_source_evidence_ids.length,
      sourceHypothesisIds: payload.p_source_hypothesis_ids.length,
    });
  } catch (error) {
    const stageError = error as {
      section?: string;
      statementKind?: string;
      stageCode?: string;
      validatorRule?: string;
    };
    console.log("\nLOCAL VALIDATION", {
      result: "FAIL",
      section: stageError.section ?? null,
      kind: stageError.statementKind ?? null,
      category: stageError.stageCode ?? "brief_schema_invalid",
      validatorRule: stageError.validatorRule ?? null,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("DIAGNOSTIC FAILED", safeOpenAIProviderError(error));
    process.exitCode = 1;
  });
}
