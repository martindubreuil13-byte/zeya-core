import type { VoiceTranscriptEntry } from "@/types/voice";
import {
  normalizePublicExperienceTranscript,
  PublicExperienceTranscriptError,
  type PublicExperienceTranscriptTurn,
} from "./public-transcript";

type PublicExperienceHandoffInput = {
  experienceToken: string;
  transcriptEntries: readonly VoiceTranscriptEntry[];
  phone: string;
  name: string | null;
  business: string | null;
  customer: string | null;
};

export type PublicExperienceHandoffSnapshot = Omit<
  PublicExperienceHandoffInput,
  "transcriptEntries"
> & {
  transcript: readonly Readonly<PublicExperienceTranscriptTurn>[];
};

export class PublicExperienceHandoffError extends Error {
  constructor(
    message: string,
    public readonly stage: "transcript" | "finalization" | "dispatch",
    public readonly status: number | null,
    public readonly restartRequired: boolean,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PublicExperienceHandoffError";
  }
}

type Request = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type PublicExperienceHandoffStage =
  | "handoff_submit_started"
  | "finalize_started"
  | "finalize_succeeded"
  | "finalize_conflict"
  | "dispatch_started"
  | "dispatch_succeeded"
  | "dispatch_conflict"
  | "handoff_recovered";

type StageChanged = (stage: PublicExperienceHandoffStage) => void;

const E164 = /^\+[1-9]\d{7,14}$/;

export function normalizePublicExperiencePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!/^\+[\d\s().-]+$/.test(trimmed)) return null;
  const normalized = `+${trimmed.slice(1).replace(/[\s().-]/g, "")}`;
  return E164.test(normalized) ? normalized : null;
}

export type PublicExperienceActionGuard = { current: boolean };

export function acquirePublicExperienceAction(guard: PublicExperienceActionGuard): boolean {
  if (guard.current) return false;
  guard.current = true;
  return true;
}

export function releasePublicExperienceAction(guard: PublicExperienceActionGuard): void {
  guard.current = false;
}

function finalizationError(status: number): PublicExperienceHandoffError {
  if (status === 400) {
    return new PublicExperienceHandoffError(
      "The conversation transcript is invalid. Please restart the Experience.",
      "finalization", status, true, false,
    );
  }
  if (status === 404) {
    return new PublicExperienceHandoffError(
      "This Experience session has expired. Please restart the Experience.",
      "finalization", status, true, false,
    );
  }
  if (status === 409) {
    return new PublicExperienceHandoffError(
      "The finalized Experience does not match this conversation.",
      "finalization", status, false, false,
    );
  }
  if (status === 413) {
    return new PublicExperienceHandoffError(
      "This conversation is too long to submit. Please restart the Experience.",
      "finalization", status, true, false,
    );
  }
  return new PublicExperienceHandoffError(
    "The conversation could not be finalized. Please try again.",
    "finalization", status, false, status >= 500,
  );
}

type ServerState =
  | "zeya_active"
  | "zeya_finalized"
  | "call_requested"
  | "call_correlation_pending"
  | "dispatch_resolution_pending"
  | "call_dispatched"
  | "call_active"
  | "reflection_ready"
  | string;

async function readServerState(
  request: Request,
  token: string,
): Promise<ServerState | null> {
  const response = await request("/api/experience/session/status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  try {
    const body = await response.json() as { status?: unknown };
    return typeof body.status === "string" ? body.status : null;
  } catch {
    return null;
  }
}

function dispatchedState(state: ServerState | null): boolean {
  return state === "call_dispatched" || state === "call_active" || state === "reflection_ready";
}

export async function submitPublicExperienceHandoff(
  input: PublicExperienceHandoffInput,
  request: Request = fetch,
  onStage?: StageChanged,
): Promise<{ snapshot: PublicExperienceHandoffSnapshot; dispatchStatus: "call_dispatched" | "correlation_pending" | "dispatch_resolution_pending" }> {
  const normalizedPhone = normalizePublicExperiencePhone(input.phone);
  if (!normalizedPhone) {
    throw new PublicExperienceHandoffError(
      "Enter a valid international phone number, including + and country code.",
      "dispatch", null, false, false,
    );
  }
  let transcript: PublicExperienceTranscriptTurn[];
  try {
    transcript = normalizePublicExperienceTranscript(input.transcriptEntries);
  } catch (error) {
    if (error instanceof PublicExperienceTranscriptError) {
      throw new PublicExperienceHandoffError(
        "The conversation transcript cannot be submitted. Please restart the Experience.",
        "transcript", null, true, false,
      );
    }
    throw error;
  }

  if (transcript.length === 0) {
    throw new PublicExperienceHandoffError(
      "The conversation transcript is empty. Please restart the Experience.",
      "transcript", null, true, false,
    );
  }

  const snapshot: PublicExperienceHandoffSnapshot = Object.freeze({
    experienceToken: input.experienceToken,
    transcript: Object.freeze(transcript.map((turn) => Object.freeze({ ...turn }))),
    phone: normalizedPhone,
    name: input.name,
    business: input.business,
    customer: input.customer,
  });

  onStage?.("handoff_submit_started");
  onStage?.("finalize_started");
  const finalized = await request("/api/experience/session/finalize-zeya", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: snapshot.experienceToken, transcript: snapshot.transcript, phoneCaptured: true }),
  });
  if (!finalized.ok) {
    if (finalized.status !== 409) throw finalizationError(finalized.status);
    onStage?.("finalize_conflict");
    const state = await readServerState(request, snapshot.experienceToken);
    if (dispatchedState(state)) {
      onStage?.("handoff_recovered");
      return { snapshot, dispatchStatus: "call_dispatched" };
    }
    if (state !== "zeya_finalized" && state !== "call_requested" && state !== "call_correlation_pending" && state !== "dispatch_resolution_pending") {
      throw finalizationError(finalized.status);
    }
    onStage?.("handoff_recovered");
  } else {
    onStage?.("finalize_succeeded");
  }

  onStage?.("dispatch_started");
  const dispatched = await request("/api/experience/delegate-call", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      experienceToken: snapshot.experienceToken,
      phone: snapshot.phone,
      name: snapshot.name,
      business: snapshot.business,
      customer: snapshot.customer,
    }),
  });

  let result: { success?: boolean; status?: string; error?: string } = {};
  try {
    result = await dispatched.json() as typeof result;
  } catch {
    throw new PublicExperienceHandoffError(
      "The call request returned an invalid response.",
      "dispatch", dispatched.status, false, true,
    );
  }
  if (dispatched.status === 202 && result.status === "correlation_pending") {
    onStage?.("dispatch_succeeded");
    return { snapshot, dispatchStatus: "correlation_pending" };
  }
  if (dispatched.status === 202 && result.status === "dispatch_resolution_pending") {
    onStage?.("dispatch_succeeded");
    return { snapshot, dispatchStatus: "dispatch_resolution_pending" };
  }
  if (dispatched.status === 409) {
    onStage?.("dispatch_conflict");
    const state = await readServerState(request, snapshot.experienceToken);
    if (dispatchedState(state)) {
      onStage?.("handoff_recovered");
      return { snapshot, dispatchStatus: "call_dispatched" };
    }
    if (state === "call_requested" || state === "call_correlation_pending" || state === "dispatch_resolution_pending") {
      onStage?.("handoff_recovered");
      return { snapshot, dispatchStatus: state === "call_correlation_pending" ? "correlation_pending" : "dispatch_resolution_pending" };
    }
  }
  if (!dispatched.ok || result.success !== true || result.status !== "call_dispatched") {
    throw new PublicExperienceHandoffError(
      typeof result.error === "string" ? result.error : "The call request failed.",
      "dispatch", dispatched.status, false, dispatched.status >= 500,
    );
  }

  onStage?.("dispatch_succeeded");
  return { snapshot, dispatchStatus: "call_dispatched" };
}
