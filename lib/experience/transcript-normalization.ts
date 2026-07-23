export type NormalizedTranscript = { raw: string; normalized: string; changed: boolean; ambiguous: boolean };

const FILLER = /\b(?:um+|uh+|erm+)\b[,\s]*/gi;

export function normalizeTranscriptText(rawValue: string): NormalizedTranscript {
  const raw = rawValue.trim();
  if (!raw) return { raw, normalized: raw, changed: false, ambiguous: false };

  let normalized = raw
    .replace(/\s+/g, " ")
    .replace(FILLER, "")
    .replace(/\b(\w+)(?:,\s*|\s+)\1\b/gi, "$1")
    .replace(/\s+([,.?!])/g, "$1")
    .trim();

  normalized = normalized
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence ? sentence[0].toUpperCase() + sentence.slice(1) : sentence)
    .join(" ");
  if (normalized && !/[.!?]$/.test(normalized)) normalized += ".";

  const ambiguous = /\b(?:probably|maybe|something|that thing|I guess|not sure)\b/i.test(normalized)
    || normalized.split(/\s+/).length < 4;
  return { raw, normalized, changed: raw !== normalized, ambiguous };
}

export function normalizeTranscriptTurns<T extends { text?: unknown }>(
  turns: readonly T[],
): Array<T & { rawText: string; normalizedText: string; normalizationAmbiguous: boolean }> {
  return turns.map((turn) => {
    const result = normalizeTranscriptText(typeof turn.text === "string" ? turn.text : "");
    return { ...turn, rawText: result.raw, normalizedText: result.normalized, normalizationAmbiguous: result.ambiguous };
  });
}
