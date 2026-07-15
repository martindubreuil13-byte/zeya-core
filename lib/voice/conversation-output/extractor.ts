import OpenAI from "openai";
import { candidateTypes, validateCandidates, type ConversationCandidate, type ConversationTranscriptTurn } from "./types";

export type ConversationExtractionInput = {
  transcript: ConversationTranscriptTurn[];
  channel: "zeya_realtime" | "veya_outbound";
  agentType: string;
  canonicalVersionId: string;
  authorizedElementKeys: string[];
  transcriptTrustLevel: "provider_attested" | "authenticated_client_relay" | "status_only";
};

export type ConversationExtractionModel = (input: ConversationExtractionInput) => Promise<unknown>;

const systemPrompt = `Extract non-canonical conversation intelligence for human review.
Return a JSON array only. Supported candidateType values: ${candidateTypes.join(", ")}.
Each item must contain candidateType, content with a concise summary, speakerRole, statementKind,
sourceReference with turnIndexes, relevantElementKeys, confidence from 0 to 1, and rationale.
Distinguish customer statements from agent statements. Never classify an agent statement as candidate_evidence.
A customer objection is evidence of perception, not proof that its content is true.
Possible contradictions remain pending review and must only reference authorized element keys.
Do not invent facts or include transcript text beyond the concise structured summary.`;

export function createOpenAIConversationExtractionModel(): ConversationExtractionModel {
  return async (input) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("Conversation extraction is unavailable");
    const openai = new OpenAI({ apiKey });
    const response = await openai.chat.completions.create({
      model: process.env.VOICE_EXTRACTION_MODEL || "gpt-4.1-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: `${systemPrompt}\nReturn an object with one property named candidates.` },
        { role: "user", content: JSON.stringify({
          channel: input.channel,
          agentType: input.agentType,
          canonicalVersionId: input.canonicalVersionId,
          authorizedElementKeys: input.authorizedElementKeys,
          turns: input.transcript.map((turn, index) => ({ index, role: turn.role, text: turn.text })),
        }) },
      ],
    });
    const content = response.choices[0]?.message.content;
    if (!content) throw new Error("Conversation extraction returned no result");
    const parsed = JSON.parse(content) as { candidates?: unknown };
    return parsed.candidates;
  };
}

export async function extractConversationCandidates(
  input: ConversationExtractionInput,
  model: ConversationExtractionModel = createOpenAIConversationExtractionModel(),
): Promise<ConversationCandidate[]> {
  if (input.transcript.length === 0) throw new Error("Conversation transcript is empty");
  const candidates = validateCandidates(await model(input));
  for (const candidate of candidates) {
    if (candidate.speakerRole === "zeya" || candidate.speakerRole === "veya") {
      if (candidate.candidateType === "candidate_evidence") {
        throw new Error("Agent statements cannot become candidate Evidence");
      }
    }
    if (input.transcriptTrustLevel !== "provider_attested" && candidate.candidateType === "candidate_evidence") {
      throw new Error("Unattested transcript cannot create candidate Evidence");
    }
    if (candidate.relevantElementKeys.some((key) => !input.authorizedElementKeys.includes(key))) {
      throw new Error("Candidate references an unauthorized Representation element");
    }
    if (candidate.sourceReference.turnIndexes.some((index) => index < 0 || index >= input.transcript.length)) {
      throw new Error("Candidate source reference is invalid");
    }
  }
  return candidates;
}
