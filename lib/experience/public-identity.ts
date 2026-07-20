import type { VoiceTranscriptEntry } from "@/types/voice";
import { analyzeConversationInsights } from "./conversation-analyzer";

export type PublicExperienceIdentity = {
  name: string | null;
  offer: string | null;
  buyer: string | null;
  needsNameConfirmation: boolean;
};

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
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > 100) return null;
  return normalized.split(" ").map((part) =>
    part ? part.charAt(0).toLocaleUpperCase() + part.slice(1) : part
  ).join(" ");
}
