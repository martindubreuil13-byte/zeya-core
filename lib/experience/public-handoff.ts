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
      "This conversation conflicts with the finalized Experience. Please restart.",
      "finalization", status, true, false,
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

export async function submitPublicExperienceHandoff(
  input: PublicExperienceHandoffInput,
  request: Request = fetch,
): Promise<{ snapshot: PublicExperienceHandoffSnapshot }> {
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
    phone: input.phone,
    name: input.name,
    business: input.business,
    customer: input.customer,
  });

  const finalized = await request("/api/experience/session/finalize-zeya", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: snapshot.experienceToken, transcript: snapshot.transcript }),
  });
  if (!finalized.ok) throw finalizationError(finalized.status);

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

  let result: { success?: boolean; error?: string } = {};
  try {
    result = await dispatched.json() as typeof result;
  } catch {
    throw new PublicExperienceHandoffError(
      "The call request returned an invalid response.",
      "dispatch", dispatched.status, false, true,
    );
  }
  if (!dispatched.ok || result.success !== true) {
    throw new PublicExperienceHandoffError(
      typeof result.error === "string" ? result.error : "The call request failed.",
      "dispatch", dispatched.status, false, dispatched.status >= 500,
    );
  }

  return { snapshot };
}
