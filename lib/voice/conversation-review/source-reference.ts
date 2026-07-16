import type { ConversationSpeakerRole } from "@/lib/voice/conversation-output/types";

export type TranscriptTurn = { role: "customer" | "agent"; text: string };

export function validateEvidenceTurnIndexes(
  sourceReference: unknown,
  transcript: unknown,
  speakerRole: ConversationSpeakerRole,
): number[] {
  if (!sourceReference || typeof sourceReference !== "object" || Array.isArray(sourceReference)) throw new Error("valid source references are required for Evidence");
  const indexes = (sourceReference as { turnIndexes?: unknown }).turnIndexes;
  if (!Array.isArray(indexes) || indexes.length === 0 || !Array.isArray(transcript)) throw new Error("valid source references are required for Evidence");
  const seen = new Set<number>();
  return indexes.map((value) => {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 2_147_483_647) throw new Error("Evidence source turn index is invalid");
    if (value >= transcript.length) throw new Error("Evidence source turn index is out of range");
    if (seen.has(value)) throw new Error("Evidence source turn indexes must be unique");
    seen.add(value);
    const turn = transcript[value] as Partial<TranscriptTurn> | null;
    if (!turn || typeof turn !== "object" || !["customer", "agent"].includes(String(turn.role)) || typeof turn.text !== "string" || !turn.text.trim()) throw new Error("Evidence source transcript turn is invalid");
    if (["customer", "founder", "staff"].includes(speakerRole) && turn.role !== "customer") throw new Error("Evidence source speaker does not match transcript turn");
    return value;
  });
}
