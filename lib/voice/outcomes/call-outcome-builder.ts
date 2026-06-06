// Rule-based CallOutcome builder — deterministic outcome classification

import type { CapturedElevenLabsConversation } from "../events/elevenlabs-conversation-store";
import type { OutcomeDetectionResult } from "./call-outcome-types";

// Keywords that indicate interest
const INTEREST_KEYWORDS = [
  "interested",
  "sounds good",
  "definitely",
  "let's",
  "would love",
  "great idea",
  "demo",
  "interested in",
  "tell me more",
  "want to know",
  "pricing",
];

// Keywords that indicate callback request
const CALLBACK_KEYWORDS = [
  "callback",
  "call me back",
  "call me later",
  "reach out",
  "call tomorrow",
  "next week",
  "schedule a call",
  "ring me back",
  "follow up",
  "get back to me",
];

// Keywords that indicate disinterest
const DISINTEREST_KEYWORDS = [
  "not interested",
  "no thanks",
  "not interested",
  "don't need",
  "not for us",
  "doesn't fit",
  "not a fit",
  "not right now",
  "busy",
  "no time",
  "not applicable",
];

// Keywords that indicate voicemail
const VOICEMAIL_KEYWORDS = [
  "voicemail",
  "leave a message",
  "beep",
  "message",
  "after the tone",
];

/**
 * Detect outcome from conversation summary and extracted data
 * Uses rules-based classification (no AI/LLM)
 */
export function detectOutcome(conversation: CapturedElevenLabsConversation): OutcomeDetectionResult {
  console.log("[outcome-builder] 🔵 Detecting outcome from conversation", {
    conversationId: conversation.conversationId,
    status: conversation.status,
    summaryLength: conversation.summary?.length || 0,
    transcriptSegments: conversation.transcript.length,
    callDuration: conversation.callDuration,
  });

  // Check call status
  if (conversation.status === "failed") {
    console.log("[outcome-builder] 🟡 Outcome: Call failed", { conversationId: conversation.conversationId });
    return {
      outcome: "unknown",
      confidence: 0.3,
      reason: "Call failed — unable to complete",
      recommendedAction: "retry_call",
    };
  }

  const summary = (conversation.summary || "").toLowerCase();
  const transcriptText = conversation.transcript
    .map((seg) => seg.message)
    .join(" ")
    .toLowerCase();

  // Check for voicemail first (short call, no interaction, voicemail keywords)
  if (isVoicemail(conversation, summary, transcriptText)) {
    console.log("[outcome-builder] 🟢 Outcome detected: voicemail", { conversationId: conversation.conversationId });
    return {
      outcome: "voicemail",
      confidence: 0.95,
      reason: "Voicemail detected",
      recommendedAction: "retry_call",
    };
  }

  // Check for wrong number (very short call, confusion keywords)
  if (isWrongNumber(conversation, summary, transcriptText)) {
    return {
      outcome: "wrong_number",
      confidence: 0.85,
      reason: "Wrong number or disconnected call",
      recommendedAction: "remove_list",
    };
  }

  // Check for callback request
  if (hasKeywords(summary, CALLBACK_KEYWORDS) || hasKeywords(transcriptText, CALLBACK_KEYWORDS)) {
    console.log("[outcome-builder] 🟢 Outcome detected: callback_requested", { conversationId: conversation.conversationId });
    return {
      outcome: "callback_requested",
      confidence: 0.9,
      reason: "Prospect requested callback",
      recommendedAction: "schedule_callback",
    };
  }

  // Check for disinterest BEFORE interest (to avoid matching "not interested" as "interested")
  if (hasKeywords(summary, DISINTEREST_KEYWORDS) || hasKeywords(transcriptText, DISINTEREST_KEYWORDS)) {
    console.log("[outcome-builder] 🟢 Outcome detected: not_interested", { conversationId: conversation.conversationId });
    return {
      outcome: "not_interested",
      confidence: 0.8,
      reason: "Prospect expressed disinterest",
      recommendedAction: "remove_list",
    };
  }

  // Check for interest
  if (hasKeywords(summary, INTEREST_KEYWORDS) || hasKeywords(transcriptText, INTEREST_KEYWORDS)) {
    console.log("[outcome-builder] 🟢 Outcome detected: interested", { conversationId: conversation.conversationId });
    return {
      outcome: "interested",
      confidence: 0.85,
      reason: "Prospect expressed interest",
      recommendedAction: "schedule_demo",
    };
  }

  // Check extracted data for outcome hints
  if (conversation.extractedData) {
    const extractedOutcome = inferOutcomeFromExtractedData(conversation.extractedData);
    if (extractedOutcome) {
      return extractedOutcome;
    }
  }

  // Default to unknown with follow-up action
  console.log("[outcome-builder] 🟡 Outcome detected: unknown (no keywords matched)", {
    conversationId: conversation.conversationId,
    summaryLength: summary.length,
    transcriptLength: transcriptText.length,
  });
  return {
    outcome: "unknown",
    confidence: 0.3,
    reason: "Unable to determine outcome from conversation",
    recommendedAction: "follow_up",
  };
}

/**
 * Check if call is voicemail
 * Heuristics: very short call OR voicemail keywords OR no agent messages
 */
function isVoicemail(conversation: CapturedElevenLabsConversation, summary: string, transcript: string): boolean {
  // Very short call (< 10 seconds) is likely voicemail
  if (conversation.callDuration && conversation.callDuration < 10) {
    return true;
  }

  // Voicemail keywords
  if (hasKeywords(summary, VOICEMAIL_KEYWORDS) || hasKeywords(transcript, VOICEMAIL_KEYWORDS)) {
    return true;
  }

  // No agent messages in transcript (left voicemail)
  const agentMessages = conversation.transcript.filter((seg) => seg.role === "agent");
  if (agentMessages.length === 0) {
    return true;
  }

  return false;
}

/**
 * Check if call is wrong number
 * Heuristics: summary contains "wrong" OR (short call AND confusion keywords)
 */
function isWrongNumber(conversation: CapturedElevenLabsConversation, summary: string, transcript: string): boolean {
  // Explicit "wrong number" indicator
  if (summary.includes("wrong")) {
    return true;
  }

  const hasConfusionKeywords =
    transcript.includes("wrong") ||
    transcript.includes("who is this") ||
    transcript.includes("hold on");

  if (conversation.callDuration && conversation.callDuration < 30 && hasConfusionKeywords) {
    return true;
  }

  return false;
}

/**
 * Try to infer outcome from extracted data
 * Looks for sentiment, intent, or outcome fields
 */
function inferOutcomeFromExtractedData(
  extractedData: Record<string, unknown>
): OutcomeDetectionResult | null {
  const sentiment = extractedData.sentiment as string | undefined;
  const intent = extractedData.intent as string | undefined;
  const outcome = extractedData.outcome as string | undefined;

  // Check sentiment
  if (sentiment) {
    const sentimentLower = sentiment.toLowerCase();
    if (sentimentLower.includes("positive") || sentimentLower.includes("interested")) {
      return {
        outcome: "interested",
        confidence: 0.75,
        reason: "Extracted positive sentiment",
        recommendedAction: "schedule_demo",
      };
    }
    if (sentimentLower.includes("negative") || sentimentLower.includes("disinterested")) {
      return {
        outcome: "not_interested",
        confidence: 0.75,
        reason: "Extracted negative sentiment",
        recommendedAction: "remove_list",
      };
    }
  }

  // Check intent
  if (intent) {
    const intentLower = (intent as string).toLowerCase();
    if (intentLower.includes("callback")) {
      return {
        outcome: "callback_requested",
        confidence: 0.8,
        reason: "Extracted callback intent",
        recommendedAction: "schedule_callback",
      };
    }
  }

  // Check explicit outcome
  if (outcome) {
    const outcomeLower = (outcome as string).toLowerCase();
    if (["interested", "callback_requested", "not_interested", "wrong_number", "voicemail"].includes(
      outcomeLower
    )) {
      return {
        outcome: outcomeLower as any,
        confidence: 0.9,
        reason: "Extracted outcome value",
        recommendedAction: "follow_up",
      };
    }
  }

  return null;
}

/**
 * Check if text contains any keywords from the list
 */
function hasKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword.toLowerCase()));
}
