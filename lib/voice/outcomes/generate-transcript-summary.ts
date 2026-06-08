// Generate summary from transcript when ElevenLabs doesn't provide one
// Model: gpt-4o-mini (~$0.0002 per call)

import OpenAI from "openai";
import type { ElevenLabsTranscriptSegment } from "../events/elevenlabs-event-types";

/**
 * Generate a summary from conversation transcript
 * Used as fallback when ElevenLabs webhook summary is missing
 */
export async function generateSummaryFromTranscript(
  transcript: ElevenLabsTranscriptSegment[]
): Promise<string | null> {
  if (!transcript || transcript.length === 0) {
    return null;
  }

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[summary-gen] OPENAI_API_KEY not set — cannot generate fallback summary");
    return null;
  }

  try {
    // Format transcript for analysis
    const conversationText = transcript
      .map((segment) => `${segment.role === "user" ? "User" : "Agent"}: ${segment.message}`)
      .join("\n");

    if (conversationText.trim().length === 0) {
      return null;
    }

    const openai = new OpenAI();

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `You are a conversation analyst. Your task is to generate a concise, factual summary of a business conversation.

Extract and include:
1. Main topic discussed
2. Key concerns or objections raised
3. Commitments or next steps agreed
4. Important facts or data mentioned

Write a 2-3 sentence summary. Be specific and factual. Do not add interpretation or opinion.
Focus on what was said, not how it was said.`,
        },
        {
          role: "user",
          content: `Summarize this conversation:\n\n${conversationText}`,
        },
      ],
      temperature: 0.3,
      max_tokens: 150,
    });

    const summary = response.choices[0]?.message?.content?.trim();
    if (summary && summary.length > 0) {
      return summary;
    }

    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[summary-gen] Failed to generate summary from transcript:", message);
    return null;
  }
}
