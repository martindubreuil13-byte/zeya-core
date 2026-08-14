import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFirstWorkingSessionBriefArtifact,
  buildCompactFirstWorkingSessionBriefPrompt,
  buildCompactFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionBriefPrompt,
  buildFirstWorkingSessionBriefProviderRequest,
  buildFirstWorkingSessionBriefProviderContract,
  buildFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionFinalizationPayload,
  buildFirstWorkingSessionHypothesisTraceFingerprint,
  createObservedFirstWorkingSessionBriefGenerator,
  FIRST_WORKING_SESSION_BRIEF_MODEL,
  FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
  FIRST_WORKING_SESSION_PREPARATION_VERSION,
  FirstWorkingSessionPreparationStageError,
  loadFirstWorkingSessionBriefInputs,
  type BriefInputs,
  type BriefProviderCallDiagnostic,
} from "../../../../../lib/onboarding/first-working-session-brief";
import { createDirectHireServiceClient } from "../../../../../lib/onboarding/direct-hire-service-client";
import {
  buildP22LiveShapedDiagnosticInputs,
  P2_2_DIAGNOSTIC_IDS,
} from "../../../../../scripts/diagnostics/p2-2-openai-brief-dry-run";

export const maxDuration = 300;
export const runtime = "nodejs";

export const P2_2_LIVE_REPLAY_WORKING_SESSION_ID =
  "715f4971-4d3f-4f53-9b89-a9dd703349d8";

type WorkingSessionRow = {
  id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  direct_hire_onboarding_session_id: string;
  status: string;
  preparation_status: string;
  preparation_contract_version: string | null;
  preparation_website_persisted_at: string | null;
};

function authorized(request: NextRequest): boolean {
  const configured = process.env.DIRECT_HIRE_PREPARATION_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = createHash("sha256").update(configured).digest();
  const actual = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expected, actual);
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function requestMetrics(inputs: BriefInputs, reasoningRunId: string, compact: boolean) {
  const contract = buildFirstWorkingSessionBriefProviderContract(inputs);
  const providerInputs = compact ? contract.inputs : inputs;
  const prompt = compact
    ? buildCompactFirstWorkingSessionBriefPrompt(inputs, contract)
    : buildFirstWorkingSessionBriefPrompt(inputs);
  const schema = compact
    ? buildCompactFirstWorkingSessionBriefSchema(inputs, contract)
    : buildFirstWorkingSessionBriefSchema(inputs);
  const request = buildFirstWorkingSessionBriefProviderRequest(prompt, schema);
  const serializedRequest = JSON.stringify(request);
  const evidenceJson = JSON.stringify(providerInputs.evidence);
  const observationsJson = JSON.stringify(providerInputs.observations);
  const hypothesesJson = JSON.stringify(compact ? providerInputs.hypotheses : inputs.hypotheses.map((hypothesis) => ({
    id: hypothesis.id,
    constitutionalDomain: hypothesis.constitutionalDomain,
    epistemicState: hypothesis.epistemicState,
    currentBelief: hypothesis.currentBelief,
    confidence: hypothesis.confidence,
    representationRisk: hypothesis.representationRisk,
    riskReason: hypothesis.riskReason,
    verificationNeed: hypothesis.verificationNeed,
    ownerDecision: hypothesis.ownerDecision,
  })));
  const schemaJson = JSON.stringify(schema);
  const enumBytes = (ids: string[]) => ids.reduce((total, id) => {
    const encoded = JSON.stringify(id);
    const occurrences = schemaJson.split(encoded).length - 1;
    return total + occurrences * Buffer.byteLength(encoded, "utf8");
  }, 0);
  const evidenceCitationEnumBytes = enumBytes(providerInputs.evidence.map((item) => item.id));
  const hypothesisCitationEnumBytes = enumBytes(providerInputs.hypotheses.map((item) => item.id));
  const rawStatementCounts = new Map<string, number>();
  for (const item of inputs.evidence) {
    rawStatementCounts.set(item.rawStatement, (rawStatementCounts.get(item.rawStatement) ?? 0) + 1);
  }
  const duplicateRawStatementCharacters = [...rawStatementCounts]
    .reduce((total, [statement, count]) => total + Math.max(0, count - 1) * statement.length, 0);
  return {
    evidenceCount: inputs.evidence.length,
    observationCount: inputs.observations.length,
    hypothesisCount: inputs.hypotheses.length,
    promptCharacterCount: prompt.length,
    schemaBytes: serializedBytes(schema),
    serializedRequestBytes: Buffer.byteLength(serializedRequest, "utf8"),
    estimatedRequestTokensAtFourCharactersPerToken: Math.ceil(serializedRequest.length / 4),
    providerRequestSha256: createHash("sha256").update(serializedRequest).digest("hex"),
    contributors: {
      instructionCharacters: prompt.length - evidenceJson.length - observationsJson.length - hypothesesJson.length,
      evidencePayloadBytes: Buffer.byteLength(evidenceJson, "utf8"),
      observationsPayloadBytes: Buffer.byteLength(observationsJson, "utf8"),
      hypothesesPayloadBytes: Buffer.byteLength(hypothesesJson, "utf8"),
      evidenceCitationEnumBytes,
      hypothesisCitationEnumBytes,
      citationEnumBytes: evidenceCitationEnumBytes + hypothesisCitationEnumBytes,
      duplicateRawStatementCharacters,
      maxOutputTokensConfigured: null,
    },
    reasoningRunId,
    hypothesisTraceFingerprint: buildFirstWorkingSessionHypothesisTraceFingerprint(inputs.hypotheses),
  };
}

async function requireSingle<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>, label: string): Promise<T> {
  const result = await query;
  if (result.error || !result.data) throw new Error(`${label}_lookup_failed`);
  return result.data as T;
}

async function loadLiveScope(client: SupabaseClient, workingSessionId: string) {
  const workingSession = await requireSingle<WorkingSessionRow>(client
    .from("direct_hire_working_sessions")
    .select("id, owner_id, business_id, business_representation_id, direct_hire_onboarding_session_id, status, preparation_status, preparation_contract_version, preparation_website_persisted_at")
    .eq("id", workingSessionId)
    .maybeSingle(), "working_session");
  const onboarding = await requireSingle<{
    id: string; owner_id: string; business_id: string; business_representation_id: string;
  }>(client.from("direct_hire_onboarding_sessions")
    .select("id, owner_id, business_id, business_representation_id")
    .eq("id", workingSession.direct_hire_onboarding_session_id)
    .eq("owner_id", workingSession.owner_id)
    .eq("business_id", workingSession.business_id)
    .eq("business_representation_id", workingSession.business_representation_id)
    .maybeSingle(), "onboarding");
  await requireSingle(client.from("businesses")
    .select("id, user_id")
    .eq("id", workingSession.business_id)
    .eq("user_id", workingSession.owner_id)
    .maybeSingle(), "business");
  const representation = await requireSingle<{ current_version_id: string | null }>(client
    .from("business_representations")
    .select("id, user_id, business_id, current_version_id")
    .eq("id", workingSession.business_representation_id)
    .eq("user_id", workingSession.owner_id)
    .eq("business_id", workingSession.business_id)
    .maybeSingle(), "representation");
  return {
    workingSession,
    scope: {
      ownerId: onboarding.owner_id,
      businessId: onboarding.business_id,
      businessRepresentationId: onboarding.business_representation_id,
      onboardingSessionId: onboarding.id,
    },
    lineage: {
      appointmentOnboardingBusinessRepresentationAligned: true,
      representationCurrentVersionPresent: representation.current_version_id !== null,
    },
  };
}

type ReplayResult = {
  success: boolean;
  stageCategory: string | null;
  validationPassed: boolean;
  citationLineagePassed: boolean;
  finalizationPayloadPreflightPassed: boolean;
  generationCount: number;
  revisionCount: number;
  providerCalls: BriefProviderCallDiagnostic[];
};

async function replay(
  label: "fixture" | "live",
  inputs: BriefInputs,
  reasoningRunId: string,
  workingSessionId: string,
): Promise<ReplayResult> {
  const providerCalls: BriefProviderCallDiagnostic[] = [];
  try {
    const artifact = await buildFirstWorkingSessionBriefArtifact(
      inputs,
      reasoningRunId,
      createObservedFirstWorkingSessionBriefGenerator((diagnostic) => providerCalls.push(diagnostic)),
      { deadlineMs: Date.now() + 240_000, maxRevisions: 2 },
    );
    buildFirstWorkingSessionFinalizationPayload(
      workingSessionId,
      P2_2_DIAGNOSTIC_IDS.lease,
      artifact,
    );
    return {
      success: true, stageCategory: null, validationPassed: true,
      citationLineagePassed: true, finalizationPayloadPreflightPassed: true,
      generationCount: artifact.telemetry.generationCount,
      revisionCount: artifact.telemetry.revisionCount,
      providerCalls,
    };
  } catch (error) {
    const stage = error instanceof FirstWorkingSessionPreparationStageError ? error : null;
    return {
      success: false,
      stageCategory: stage?.stageCode ?? `${label}_diagnostic_failed`,
      validationPassed: false,
      citationLineagePassed: false,
      finalizationPayloadPreflightPassed: false,
      generationCount: stage?.revisionTelemetry?.generationCount ?? providerCalls.length,
      revisionCount: stage?.revisionTelemetry?.revisionCount ?? Math.max(0, providerCalls.length - 1),
      providerCalls,
    };
  }
}

export async function runP22ActualLiveReplay(
  client: SupabaseClient,
  workingSessionId: string,
) {
  if (workingSessionId !== P2_2_LIVE_REPLAY_WORKING_SESSION_ID) {
    throw new Error("working_session_not_allowed");
  }
  const liveScope = await loadLiveScope(client, workingSessionId);
  const live = await loadFirstWorkingSessionBriefInputs(client, liveScope.scope);
  const fixture = buildP22LiveShapedDiagnosticInputs();
  const fixtureMetrics = requestMetrics(fixture.inputs, fixture.reasoningRunId, true);
  const liveBeforeMetrics = requestMetrics(live.inputs, live.reasoningRunId, false);
  const liveMetrics = requestMetrics(live.inputs, live.reasoningRunId, true);

  // Sequential calls prevent this diagnostic from creating provider concurrency.
  const fixtureOutcome = await replay(
    "fixture", fixture.inputs, fixture.reasoningRunId, P2_2_DIAGNOSTIC_IDS.workingSession,
  );
  const liveOutcome = await replay("live", live.inputs, live.reasoningRunId, workingSessionId);
  return {
    workingSession: {
      id: liveScope.workingSession.id,
      status: liveScope.workingSession.status,
      preparationStatus: liveScope.workingSession.preparation_status,
      preparationContractVersion: liveScope.workingSession.preparation_contract_version,
      expectedPreparationContractVersion: FIRST_WORKING_SESSION_PREPARATION_VERSION,
      websiteCheckpointPresent: liveScope.workingSession.preparation_website_persisted_at !== null,
    },
    lineage: liveScope.lineage,
    comparison: {
      fixture: { metrics: fixtureMetrics, outcome: fixtureOutcome },
      live: {
        beforeCompaction: { ...liveBeforeMetrics, observedProviderRequiredTokens: 33_347 },
        metrics: liveMetrics,
        outcome: liveOutcome,
      },
      deltas: {
        evidenceCount: liveMetrics.evidenceCount - fixtureMetrics.evidenceCount,
        observationCount: liveMetrics.observationCount - fixtureMetrics.observationCount,
        hypothesisCount: liveMetrics.hypothesisCount - fixtureMetrics.hypothesisCount,
        promptCharacterCount: liveMetrics.promptCharacterCount - fixtureMetrics.promptCharacterCount,
        serializedRequestBytes: liveMetrics.serializedRequestBytes - fixtureMetrics.serializedRequestBytes,
      },
    },
  };
}

export async function runP22ActualLiveCompactOnly(
  client: SupabaseClient,
  workingSessionId: string,
) {
  if (workingSessionId !== P2_2_LIVE_REPLAY_WORKING_SESSION_ID) {
    throw new Error("working_session_not_allowed");
  }
  const liveScope = await loadLiveScope(client, workingSessionId);
  const live = await loadFirstWorkingSessionBriefInputs(client, liveScope.scope);
  return {
    metrics: requestMetrics(live.inputs, live.reasoningRunId, true),
    outcome: await replay("live", live.inputs, live.reasoningRunId, workingSessionId),
  };
}

export async function runP22ActualLiveMetricsOnly(
  client: SupabaseClient,
  workingSessionId: string,
) {
  if (workingSessionId !== P2_2_LIVE_REPLAY_WORKING_SESSION_ID) {
    throw new Error("working_session_not_allowed");
  }
  const liveScope = await loadLiveScope(client, workingSessionId);
  const live = await loadFirstWorkingSessionBriefInputs(client, liveScope.scope);
  return {
    beforeCompaction: requestMetrics(live.inputs, live.reasoningRunId, false),
    afterCompaction: requestMetrics(live.inputs, live.reasoningRunId, true),
  };
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "invalid_request" }, { status: 400 });
  }
  const workingSessionId = (body as { workingSessionId?: unknown })?.workingSessionId;
  if (workingSessionId !== P2_2_LIVE_REPLAY_WORKING_SESSION_ID) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  try {
    const result = await runP22ActualLiveReplay(createDirectHireServiceClient(), workingSessionId);
    return NextResponse.json({
      success: result.comparison.fixture.outcome.success && result.comparison.live.outcome.success,
      deployment: {
        NODE_ENV: process.env.NODE_ENV ?? null,
        VERCEL_ENV: process.env.VERCEL_ENV ?? null,
        VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      },
      providerConfig: {
        model: FIRST_WORKING_SESSION_BRIEF_MODEL,
        sdkVersion: FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
      },
      ...result,
    });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode
        : error instanceof Error ? error.message : "live_replay_failed",
    }, { status: 500 });
  }
}
