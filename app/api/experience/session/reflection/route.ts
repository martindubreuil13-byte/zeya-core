import { NextRequest, NextResponse } from "next/server";
import { createExperienceServiceClient, findExperienceSession, isExpired, isPlausibleExperienceToken } from "@/lib/experience/public-session-server";
import { derivePublicExperienceCallOutcome } from "@/lib/experience/public-call-outcome";
import {
  generateRepresentationBrief,
  inspectRepresentationBriefInput,
  REPRESENTATION_BRIEF_GENERATOR_VERSION,
  type RepresentationBriefInput,
  type RepresentationBriefResult,
} from "@/lib/experience/representation-brief-generator";
import type { RepresentationBrief, RepresentationBriefValidation } from "@/types/experience";
import { isExperienceDebugEnabled } from "@/lib/experience/experience-debug-guard";

type Turn = { role?: unknown; text?: unknown; id?: unknown };
type StoredBrief = { id: string; status: "valid" | "requires_clarification" | "failed"; structured_brief: RepresentationBrief | null; spoken_brief: string | null; confidence_level: string; evidence_references: unknown; validation_outcome: unknown; generator_version: string; provider: string; model: string; created_at: string };
type DebugTimings = Record<string, number>;

const DEBUG_ENABLED = isExperienceDebugEnabled({
  publicFlag: process.env.NEXT_PUBLIC_EXPERIENCE_DEBUG,
  vercelEnv: process.env.VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
});

function safeText(value: unknown, limit = 240) {
  return typeof value === "string" ? value.replace(/https?:\/\/\S+/gi, "[link]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[contact detail]").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[contact detail]").replace(/\s+/g, " ").trim().slice(0, limit) : "";
}

function publicBrief(record: StoredBrief) {
  if (record.status === "valid" && record.structured_brief) return { brief: { ...record.structured_brief, id: record.id }, spokenBrief: record.spoken_brief, briefState: "valid", briefMetadata: { generatorVersion: record.generator_version, provider: record.provider, model: record.model, createdAt: record.created_at } };
  if (record.status === "requires_clarification") return { briefState: "requires_clarification", clarification: { message: "I understand the outline, but I do not yet have enough evidence to offer a useful representation direction.", question: "What is the most important result your business creates for the people it serves?" } };
  return { briefState: "unavailable" };
}

function validationReason(gate: keyof Omit<RepresentationBriefValidation, "violations">, validation: RepresentationBriefValidation) {
  if (validation[gate] === "pass") return "All checks passed.";
  const relevant = validation.violations.filter((violation) => gate === "evidence"
    ? violation.startsWith("missing_evidence") || ["non_visitor_or_missing_evidence", "invented_number", "unsupported_market_claim", "psychological_claim", "unsupported_causal_claim", "insufficient_substantive_visitor_evidence"].includes(violation)
    : gate === "interpretation" ? violation === "interpretation_is_recap_or_generic" : violation === "governance_or_alignment_failed");
  return relevant.join(", ") || validation.violations.join(", ") || "Gate returned fail without a violation code.";
}

function briefDiagnostics(input: RepresentationBriefInput, result: RepresentationBriefResult) {
  const inspection = inspectRepresentationBriefInput(input);
  const validation = result.status === "valid" ? result.brief.validation : result.validation;
  const diagnostics = {
    conversationLength: inspection.conversationLength,
    visitorUtterances: inspection.visitorUtterances,
    zeyaUtterances: inspection.zeyaUtterances,
    veyaUtterances: inspection.veyaUtterances,
    evidenceItemsExtracted: inspection.evidenceItems.length,
    substantiveEvidenceItems: inspection.substantiveEvidenceItems,
    substantiveWordCount: inspection.substantiveWordCount,
    contrastsFound: inspection.contrastsFound,
    repeatedThemes: inspection.repeatedThemes,
    generatorConfidence: result.status === "valid" ? result.brief.confidenceLevel : result.confidenceLevel,
    validationResult: validation,
  };
  console.info("[Experience Debug][Representation Brief]", diagnostics);
  for (const gate of ["evidence", "interpretation", "governance"] as const) {
    console.info(`[Experience Debug][Validation] ${gate.toUpperCase()} Gate ${validation[gate].toUpperCase()}`, { reason: validationReason(gate, validation) });
  }
  if (result.status !== "valid") {
    console.info("[Experience Debug][Clarification selection]", {
      insufficientVisitorEvidence: result.status === "requires_clarification",
      validationFailed: result.status === "failed" && result.internalReason !== "speech_length_invalid",
      generatorReturnedNull: false,
      persistenceFailed: false,
      fallbackPath: result.status === "failed" && result.internalReason === "speech_length_invalid",
      reason: result.status === "failed" ? result.internalReason : result.validation.violations.join(","),
      observedEvidenceItems: inspection.substantiveEvidenceItems,
      minimumEvidenceItems: 2,
      observedEvidenceWords: inspection.substantiveWordCount,
      minimumEvidenceWords: 16,
    });
  }
  return { ...diagnostics, evidenceItems: inspection.evidenceItems };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization"), token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!isPlausibleExperienceToken(token)) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
  const debug = DEBUG_ENABLED && req.headers.get("x-experience-debug") === "1";
  const started = performance.now();
  const timings: DebugTimings = {};
  let checkpoint = started;
  const mark = (stage: string) => { const now = performance.now(); timings[stage] = Math.round(now - checkpoint); checkpoint = now; };
  if (debug) console.info("[Experience Debug] reflection_started");
  try {
    const db = createExperienceServiceClient(), session = await findExperienceSession(db, token);
    if (!session || isExpired(session)) return NextResponse.json({ error: "Experience session not found." }, { status: 404 });
    if (session.state!=="reflection_ready" || !session.veya_conversation_output_id) return NextResponse.json({ error: "The reflection is not ready yet." }, { status: 409 });
    const veyaOutput = await db.from("voice_conversation_outputs").select("transcript,provider_attested,transcript_status").eq("id", session.veya_conversation_output_id).eq("voice_context_id", session.veya_voice_context_id).single();
    mark("loadVeyaConversationMs");
    if (veyaOutput.error || !veyaOutput.data?.provider_attested || veyaOutput.data.transcript_status !== "finalized") return NextResponse.json({ error: "The reflection is not ready yet." }, { status: 409 });
    const veyaTurns = Array.isArray(veyaOutput.data.transcript) ? veyaOutput.data.transcript as Turn[] : [];
    const outcome = derivePublicExperienceCallOutcome(veyaTurns, (value) => safeText(value));
    let stored=(await db.from("public_experience_representation_briefs").select("id,status,structured_brief,spoken_brief,confidence_level,evidence_references,validation_outcome,generator_version,provider,model,created_at").eq("public_experience_session_id", session.id).maybeSingle()).data as StoredBrief | null;
    let debugStatus = stored?.status ?? "not_generated";
    let debugValidation = stored?.validation_outcome ?? null;
    let debugBriefDiagnostics: ReturnType<typeof briefDiagnostics> | undefined;
    if (!stored) {
      let zeyaTurns: Turn[] = [];
      if (session.zeya_conversation_output_id) {
        const output = await db.from("voice_conversation_outputs").select("transcript").eq("id", session.zeya_conversation_output_id).eq("voice_context_id", session.zeya_voice_context_id).single();
        if (!output.error && Array.isArray(output.data?.transcript)) zeyaTurns = output.data.transcript as Turn[];
      }
      mark("loadZeyaConversationMs");
      const map = (turns: Turn[]) => turns.map((turn, index) => ({ role: String(turn.role ?? ""), text: String(turn.text ?? ""), id: typeof turn.id === "string" ? turn.id : `turn_${index}` }));
      const briefInput: RepresentationBriefInput = { visitorName: null, businessOffer: null, targetCustomer: null, zeyaTranscript: map(zeyaTurns), veyaTranscript: map(veyaTurns) };
      const extractionStarted = performance.now();
      const inspection = inspectRepresentationBriefInput(briefInput);
      timings.evidenceExtractionMs = Math.round(performance.now() - extractionStarted);
      const generationStarted = performance.now();
      const generated=generateRepresentationBrief(briefInput, (timing) => { timings.validationMs = timing.validationMs; });
      timings.briefGenerationMs = Math.round(performance.now() - generationStarted);
      if (debug) debugBriefDiagnostics = briefDiagnostics(briefInput, generated);
      const valid = generated.status === "valid";
      const status = generated.status === "valid" ? "valid" : generated.status;
      const confidence = valid ? generated.brief.confidenceLevel : "requires_clarification";
      const validation = valid ? generated.brief.validation : generated.validation;
      debugStatus = status;
      debugValidation = validation;
      const persistenceStarted = performance.now();
      const persisted = await db.rpc("zeya_persist_public_experience_representation_brief", {
        p_session_id: session.id, p_status: status, p_structured_brief: valid ? generated.brief : null, p_spoken_brief: valid ? generated.spokenBrief : null,
        p_confidence_level: confidence, p_evidence_references: valid ? generated.brief.evidenceSources : [], p_validation_outcome: validation,
        p_generator_version: REPRESENTATION_BRIEF_GENERATOR_VERSION, p_provider: "deterministic", p_model: "text_evidence_rules_v1",
        p_internal_failure_reason: generated.status === "failed" ? generated.internalReason : generated.status === "requires_clarification" ? generated.validation.violations.join(",") : null,
      });
      timings.persistenceMs = Math.round(performance.now() - persistenceStarted);
      if (persisted.error) {
        if (debug) console.info("[Experience Debug][Clarification selection]", { insufficientVisitorEvidence: false, validationFailed: false, generatorReturnedNull: false, persistenceFailed: true, fallbackPath: false, reason: "brief_persistence_failed" });
        throw new Error("brief persistence failed");
      }
      stored = (await db.from("public_experience_representation_briefs").select("id,status,structured_brief,spoken_brief,confidence_level,evidence_references,validation_outcome,generator_version,provider,model,created_at").eq("id", persisted.data).single()).data as StoredBrief;
    }
    const observations = veyaTurns.filter((turn) => turn.role === "customer").map((turn) => safeText(turn.text)).filter(Boolean).slice(0, 2);
    timings.reflectionTotalMs = Math.round(performance.now() - started);
    if (debug) {
      console.info("---------------------------- Experience Timing ----------------------------");
      console.table(timings);
      console.info("--------------------------------------------------------------------------");
    }
    return NextResponse.json({ status: "reflection_ready", outcome, reflection: { summary: "Zeya preserved the business context that was carried into Veya’s real call.", observations, reviewNotice: "Anything learned here would be reviewed before becoming part of the business Representation. Nothing is approved automatically." }, ...publicBrief(stored), ...(debug ? { experienceDebug: { timings, briefStatus: debugStatus, validation: debugValidation, briefDiagnostics: debugBriefDiagnostics } } : {}) });
  } catch {
    return NextResponse.json({ error: "The reflection is unavailable." }, { status: 503 });
  }
}
