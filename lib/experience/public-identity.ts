import type { VoiceTranscriptEntry } from "@/types/voice";
import { analyzeConversationInsights } from "./conversation-analyzer";

export type PublicExperienceIdentity = {
  name: string | null;
  offer: string | null;
  buyer: string | null;
  needsNameConfirmation: boolean;
};

export type PublicExperienceNameDecision = {
  name: string | null;
  needsConfirmation: boolean;
};

export function analyzePublicExperienceNameResponse(text: string): PublicExperienceNameDecision {
  const transcript: VoiceTranscriptEntry[] = [{
    id: "identity-response",
    role: "user",
    text: text.trim(),
    isFinal: true,
    createdAt: 0,
  }];
  const analysis = analyzeConversationInsights(transcript, text);
  return {
    name: analysis.extractedName || normalizeCorrectedPublicExperienceName(text),
    needsConfirmation: analysis.nameConfidence !== "high",
  };
}

export function resolvePublicExperienceNameReply(
  reply: string,
  proposedName: string,
): { resolvedName: string | null; rejected: boolean } {
  const spoken = reply.trim();
  if (/^(yes|yeah|yep|correct|that'?s right)$/i.test(spoken)) {
    return { resolvedName: proposedName, rejected: false };
  }
  if (/^(no|nope|incorrect)$/i.test(spoken)) {
    return { resolvedName: null, rejected: true };
  }
  const correction = spoken.replace(/^(?:no[, ]+)?(?:my name is|it'?s|this is)\s+/i, "");
  return { resolvedName: normalizeCorrectedPublicExperienceName(correction), rejected: false };
}

export function capturePublicExperienceIdentity(
  transcript: readonly VoiceTranscriptEntry[],
): PublicExperienceIdentity {
  const messages = transcript.filter(
    (entry) => entry.role === "user" && entry.isFinal && entry.text.trim(),
  );
  const rawName = messages[0]?.text.trim() || null;
  const analysis = analyzeConversationInsights([...transcript], rawName || undefined);
  const name = analysis.extractedName || rawName;
  return {
    name,
    offer: messages[1]?.text.trim() || null,
    buyer: messages[2]?.text.trim() || null,
    needsNameConfirmation: Boolean(name && analysis.nameConfidence !== "high"),
  };
}

export function normalizeCorrectedPublicExperienceName(value: string): string | null {
  const trimmed = value.trim().replace(/\s+/g, " ");
  const letterParts = trimmed.split(/[.\-\s]+/).filter(Boolean);
  const wasSpelled = letterParts.length >= 2 && letterParts.every((part) => /^[A-Za-z]$/.test(part));
  const normalized = wasSpelled
    ? letterParts.join("").toLocaleLowerCase()
    : trimmed;
  if (!normalized || normalized.length > 100) return null;
  return normalized.split(" ").map((part) =>
    part ? part.charAt(0).toLocaleUpperCase() + part.slice(1) : part
  ).join(" ");
}

export function publicExperienceSpokenName(value: string | null): string | null {
  return value ? normalizeCorrectedPublicExperienceName(value) : null;
}
