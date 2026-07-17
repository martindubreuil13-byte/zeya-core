import type { VoiceTranscriptEntry } from "@/types/voice";
import {
  PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURN_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURNS,
} from "./public-session-contract";

export type PublicExperienceTranscriptTurn = {
  role: "user" | "assistant";
  text: string;
};

export class PublicExperienceTranscriptError extends Error {
  constructor(
    public readonly code: "too_many_turns" | "turn_too_long" | "transcript_too_long",
  ) {
    super("The conversation transcript could not be submitted.");
    this.name = "PublicExperienceTranscriptError";
  }
}

export function normalizePublicExperienceTranscript(
  entries: readonly VoiceTranscriptEntry[],
): PublicExperienceTranscriptTurn[] {
  const seenFinalIds = new Set<string>();
  const transcript: PublicExperienceTranscriptTurn[] = [];
  let totalCharacters = 0;

  for (const entry of entries) {
    if (!entry.isFinal || (entry.role !== "user" && entry.role !== "agent")) continue;
    if (seenFinalIds.has(entry.id)) continue;

    const text = entry.text.trim();
    if (!text) continue;
    if (text.length > PUBLIC_EXPERIENCE_MAX_TURN_CHARS) {
      throw new PublicExperienceTranscriptError("turn_too_long");
    }

    if (transcript.length >= PUBLIC_EXPERIENCE_MAX_TURNS) {
      throw new PublicExperienceTranscriptError("too_many_turns");
    }

    totalCharacters += text.length;
    if (totalCharacters > PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS) {
      throw new PublicExperienceTranscriptError("transcript_too_long");
    }

    seenFinalIds.add(entry.id);
    transcript.push({
      role: entry.role === "agent" ? "assistant" : "user",
      text,
    });
  }

  return transcript;
}
