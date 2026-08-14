import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type OpenAI from "openai";
import {
  buildFirstWorkingSessionBriefArtifact,
  buildFirstWorkingSessionBriefProviderRequest,
  buildFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionFinalizationPayload,
  createFirstWorkingSessionBriefOpenAIClient,
  FIRST_WORKING_SESSION_BRIEF_MODEL,
  FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
  FirstWorkingSessionPreparationStageError,
} from "../../../../../lib/onboarding/first-working-session-brief";
import {
  buildP22LiveShapedDiagnosticInputs,
  P2_2_DIAGNOSTIC_IDS,
  safeOpenAIProviderError,
} from "../../../../../scripts/diagnostics/p2-2-openai-brief-dry-run";

export const maxDuration = 300;
export const runtime = "nodejs";

type ProviderCallResult = {
  name: string;
  success: boolean;
  durationMs: number;
  httpStatus: number | null;
  requestId: string | null;
  errorName: string | null;
  errorType: unknown;
  errorCode: unknown;
  errorParam: unknown;
  safeMessage: string | null;
  responseReceived: boolean;
  structuredOutputParsed: boolean;
  validationPassed: boolean | null;
  validationFailure: {
    section: string | null;
    kind: string | null;
    category: string;
    validatorRule: string | null;
  } | null;
  generationCount?: number;
  revisionCount?: number;
};

function authorized(request: NextRequest): boolean {
  const configured = process.env.DIRECT_HIRE_PREPARATION_WORKER_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!configured || !supplied) return false;
  const expected = createHash("sha256").update(configured).digest();
  const actual = createHash("sha256").update(supplied).digest();
  return timingSafeEqual(expected, actual);
}

function safeMessage(value: unknown): string {
  return String(value ?? "provider request failed")
    .replace(/(?:sk|sess)-[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 1000);
}

async function runProviderCall(
  client: OpenAI,
  name: string,
  prompt: string,
  schema: Record<string, unknown>,
  validate?: (value: unknown) => Promise<void> | void,
): Promise<ProviderCallResult> {
  const startedAt = Date.now();
  try {
    const response = await client.responses.create(
      buildFirstWorkingSessionBriefProviderRequest(prompt, schema),
    );
    let value: unknown;
    let parsed = false;
    let validationPassed: boolean | null = validate ? false : null;
    let postResponseError: unknown;
    try {
      value = JSON.parse(response.output_text);
      parsed = true;
      if (validate) {
        await validate(value);
        validationPassed = true;
      }
    } catch (error) {
      postResponseError = error;
    }
    const postResponseFailure = postResponseError instanceof Error ? postResponseError : null;
    const semanticFailure = postResponseError instanceof FirstWorkingSessionPreparationStageError
      && postResponseError.stageCode.startsWith("brief_semantic_")
      ? {
          section: postResponseError.section ?? null,
          kind: postResponseError.statementKind ?? null,
          category: postResponseError.stageCode,
          validatorRule: postResponseError.validatorRule ?? null,
        }
      : null;
    return {
      name,
      success: response.status === "completed" && parsed && validationPassed !== false,
      durationMs: Date.now() - startedAt,
      httpStatus: 200,
      requestId: response._request_id ?? null,
      errorName: postResponseFailure?.constructor.name ?? null,
      errorType: null,
      errorCode: null,
      errorParam: null,
      safeMessage: postResponseFailure ? safeMessage(postResponseFailure.message) : null,
      responseReceived: true,
      structuredOutputParsed: parsed,
      validationPassed,
      validationFailure: semanticFailure,
    };
  } catch (error) {
    const diagnostic = safeOpenAIProviderError(error);
    return {
      name,
      success: false,
      durationMs: Date.now() - startedAt,
      httpStatus: diagnostic.httpStatus,
      requestId: typeof diagnostic.requestId === "string" ? diagnostic.requestId : null,
      errorName: diagnostic.constructor,
      errorType: diagnostic.openaiErrorType,
      errorCode: diagnostic.openaiErrorCode,
      errorParam: diagnostic.param,
      safeMessage: safeMessage(diagnostic.providerMessage),
      responseReceived: diagnostic.httpStatus !== null,
      structuredOutputParsed: false,
      validationPassed: false,
      validationFailure: null,
    };
  }
}

export async function runP22DeployedProviderDiagnostic(
  client: OpenAI = createFirstWorkingSessionBriefOpenAIClient(),
) {
  const { inputs, reasoningRunId } = buildP22LiveShapedDiagnosticInputs();
  const productionSchema = buildFirstWorkingSessionBriefSchema(inputs);
  const basicSchema = {
    type: "object",
    properties: { ok: { type: "boolean" } },
    required: ["ok"],
    additionalProperties: false,
  };

  const call1 = await runProviderCall(client, "BASIC CONTROL", "Return {ok:true}", basicSchema);
  const call2 = await runProviderCall(
    client,
    "PRODUCTION SCHEMA CONTROL",
    "Return a valid object matching the supplied first-working-session brief schema.",
    productionSchema,
  );
  const startedAt = Date.now();
  let generationCount = 0;
  let revisionCount = 0;
  let call3: ProviderCallResult;
  try {
    const artifact = await buildFirstWorkingSessionBriefArtifact(
      inputs,
      reasoningRunId,
      async (prompt, schema) => {
        generationCount += 1;
        const response = await client.responses.create(
          buildFirstWorkingSessionBriefProviderRequest(prompt, schema),
        );
        return JSON.parse(response.output_text);
      },
      { maxRevisions: 2 },
    );
    revisionCount = artifact.telemetry.revisionCount;
    buildFirstWorkingSessionFinalizationPayload(
      P2_2_DIAGNOSTIC_IDS.workingSession,
      P2_2_DIAGNOSTIC_IDS.lease,
      artifact,
    );
    call3 = {
      name: "FULL FIXTURE REQUEST", success: true, durationMs: Date.now() - startedAt,
      httpStatus: 200, requestId: null, errorName: null, errorType: null, errorCode: null,
      errorParam: null, safeMessage: null, responseReceived: true,
      structuredOutputParsed: true, validationPassed: true, validationFailure: null,
      generationCount, revisionCount,
    };
  } catch (error) {
    const stageError = error instanceof FirstWorkingSessionPreparationStageError ? error : null;
    const diagnostic = safeOpenAIProviderError(error);
    call3 = {
      name: "FULL FIXTURE REQUEST", success: false, durationMs: Date.now() - startedAt,
      httpStatus: diagnostic.httpStatus ?? (generationCount > 0 ? 200 : null), requestId: null,
      errorName: error instanceof Error ? error.constructor.name : typeof error,
      errorType: diagnostic.openaiErrorType, errorCode: diagnostic.openaiErrorCode,
      errorParam: diagnostic.param, safeMessage: stageError ? stageError.stageCode : safeMessage(diagnostic.providerMessage),
      responseReceived: generationCount > 0, structuredOutputParsed: generationCount > 0,
      validationPassed: false,
      validationFailure: stageError?.stageCode.startsWith("brief_semantic_") ? {
        section: stageError.section ?? null, kind: stageError.statementKind ?? null,
        category: stageError.stageCode, validatorRule: stageError.validatorRule ?? null,
      } : null,
      generationCount, revisionCount: Math.max(0, generationCount - 1),
    };
  }
  return [call1, call2, call3];
}

export async function POST(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ success: false, error: "not_found" }, { status: 404 });
  }
  const calls = await runP22DeployedProviderDiagnostic();
  return NextResponse.json({
    success: calls.every((call) => call.success),
    deployment: {
      NODE_ENV: process.env.NODE_ENV ?? null,
      VERCEL_ENV: process.env.VERCEL_ENV ?? null,
      VERCEL_GIT_COMMIT_SHA: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    },
    providerConfig: {
      openaiApiKeyPresent: Boolean(process.env.OPENAI_API_KEY),
      openaiProjectPresent: Boolean(process.env.OPENAI_PROJECT),
      openaiOrganizationPresent: Boolean(process.env.OPENAI_ORG_ID || process.env.OPENAI_ORGANIZATION),
      model: FIRST_WORKING_SESSION_BRIEF_MODEL,
      sdkVersion: FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
    },
    calls,
  });
}
