"use client";

import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { useOnboardingVoiceConversation } from "@/hooks/voice/useOnboardingVoiceConversation";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { PresenceCore } from "@/components/presence";
import { createDispatchInSupabase } from "@/lib/dispatch/supabase-persistence";
import { persistFollowUpLead } from "@/lib/leads/follow-up-lead-persistence";
import { BeatController } from "@/lib/experience/beat-controller";
import { initializeSession } from "@/lib/experience/experience-state";
import { analyzeConversationInsights } from "@/lib/experience/conversation-analyzer";
import { PostCallReveal } from "@/components/experience/PostCallReveal";
import type { DispatchRecord } from "@/lib/dispatch/types";
import type { BusinessInsights } from "@/types/experience";
import type {
  VeyaBriefingPayload,
  VeyaDelegationResponse,
  VeyaDelegationStatus,
} from "@/lib/dispatch/veya-delegation-types";

type Phase = "initial" | "voice_active" | "handoff" | "collecting_phone" | "waiting_for_call";

const PHONE_HANDOFF =
  "Perfect. Keep this page open. One of my agents will call you shortly. I’ve already prepared a short brief from what we discussed. What’s the best number to reach you on?";

export default function ExperiencePage() {
  const { user, session } = useAuth();
  const voice = useOnboardingVoiceConversation();
  const {
    state: voiceState,
    transcript: voiceTranscript,
    isConfigured,
    startConversation,
    stopConversation,
    speakExact,
  } = voice;

  const [phase, setPhase] = useState<Phase>("initial");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmittingPhone, setIsSubmittingPhone] = useState(false);
  const [dispatchRecord, setDispatchRecord] = useState<DispatchRecord | null>(null);
  const [delegationStatus, setDelegationStatus] =
    useState<VeyaDelegationStatus>("preparing_brief");
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [businessInsights, setBusinessInsights] = useState<BusinessInsights | null>(null);
  const [callCompleted, setCallCompleted] = useState(false);
  const [isShowingReveal, setIsShowingReveal] = useState(false);
  const [nameConfirmation, setNameConfirmation] = useState<{ asking: boolean; name?: string }>({
    asking: false,
  });
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BeatController | null>(null);
  const handoffHasStartedSpeakingRef = useRef(false);

  const isVoiceActive = ["connecting", "listening", "thinking", "speaking"].includes(voiceState);
  const callRequested = delegationStatus === "call_requested";
  const showPostCallReveal = callRequested && isShowingReveal;

  // Auto-scroll transcript to latest message
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceTranscript]);

  // Keep the voice session alive until the handoff has actually been spoken,
  // then stop microphone capture before revealing phone collection.
  useEffect(() => {
    if (phase !== "handoff") return;

    if (voiceState === "speaking") {
      handoffHasStartedSpeakingRef.current = true;
    }

    if (handoffHasStartedSpeakingRef.current && voiceState === "listening") {
      console.info(
        "[EXPERIENCE] handoff playback complete; calling stopConversation before phone capture",
      );
      void stopConversation();
      setPhase("collecting_phone");
      return;
    }

    const fallback = window.setTimeout(() => {
      void stopConversation();
      setPhase("collecting_phone");
    }, 20_000);

    return () => window.clearTimeout(fallback);
  }, [phase, stopConversation, voiceState]);

  // Detect final user transcript and advance beat
  useEffect(() => {
    if (phase !== "voice_active" || !controllerRef.current) return;

    // Don't process transcripts until Beat 1 has been initiated
    // (ambient noise during connection setup can hijack state machine before Beat 1 plays)
    if (!controllerRef.current.beatStartedAt) return;

    // Find the last final user message
    const lastUserMessage = voiceTranscript
      .filter((entry) => entry.role === "user" && entry.isFinal && entry.text?.trim())
      .pop();

    if (!lastUserMessage) return;

    // Check if we've already processed this transcript
    const lastProcessedId = sessionStorage.getItem("lastProcessedTranscriptId");
    if (lastProcessedId === lastUserMessage.id) return;

    // Mark this transcript as processed
    sessionStorage.setItem("lastProcessedTranscriptId", lastUserMessage.id);

    // Advance beat immediately (no extraction, no validation)
    controllerRef.current.advanceBeat(null);
  }, [voiceTranscript, phase]);

  const handleStartExperience = async () => {
    const startTimestamp = performance.now();
    console.log("[EXPERIENCE] Start button clicked", {
      timestamp: startTimestamp,
      millisecondsSincePageLoad: Math.round(startTimestamp),
    });
    if (!isConfigured) return;
    setPhase("voice_active");

    console.log("[EXPERIENCE] Establishing Realtime connection");
    const connectStartTimestamp = performance.now();
    await startConversation();
    const connectEndTimestamp = performance.now();
    console.log("[EXPERIENCE] Realtime connected", {
      connectStartTimestamp: Math.round(connectStartTimestamp),
      connectEndTimestamp: Math.round(connectEndTimestamp),
      connectionDuration: Math.round(connectEndTimestamp - connectStartTimestamp),
    });
    console.log("[CONNECTION] Before BeatController, checking voice connection state", {
      timestamp: Math.round(performance.now()),
    });

    console.log("[EXPERIENCE] Initializing session");
    const session = initializeSession();

    console.log("[EXPERIENCE] Creating BeatController");
    const controller = new BeatController(session, {
      onBeatStart: async (beat, script) => {
        console.log("[BEAT] onBeatStart() called", { beat, scriptLength: script.length });
        console.log("[BEAT] onBeatStart() calling speakExact()");
        await speakExact?.(script);
        console.log("[BEAT] onBeatStart() speakExact() returned");
      },
      onBeatComplete: () => {
        console.log("[BEAT] onBeatComplete() called");
        // Phase 1B: No action on beat completion
      },
      onSessionComplete: () => {
        console.log("[BEAT] onSessionComplete() called");
        handoffHasStartedSpeakingRef.current = false;
        setPhase("handoff");
        speakExact?.(PHONE_HANDOFF);
      },
      onSessionFail: (session, reason) => {
        console.error("[BEAT] onSessionFail()", reason);
        stopConversation();
        setPhase("initial");
      },
    });

    console.log("[EXPERIENCE] BeatController created");
    controllerRef.current = controller;

    const beatStartTimestamp = performance.now();
    console.log("[EXPERIENCE] Calling controller.startBeat()", {
      timestamp: beatStartTimestamp,
      millisecondsSincePageLoad: Math.round(beatStartTimestamp),
      timeSinceConnectionReady: "see [VOICE] timestamp for comparison",
    });
    await controller.startBeat();
    console.log("[EXPERIENCE] controller.startBeat() returned");
  };

  const handleEndConversation = () => {
    // Auto-transition to phone collection when conversation ends
    setTimeout(() => {
      stopConversation();
      setPhase("collecting_phone");
    }, 500);
  };

  // Auto-trigger phone collection when user says yes to experiment
  useEffect(() => {
    if (voiceState === "disconnected" && phase === "voice_active" && voiceTranscript.length > 0) {
      // Conversation has ended naturally, move to phone capture
      setTimeout(() => {
        setPhase("collecting_phone");
      }, 800);
    }
  }, [voiceState, phase, voiceTranscript.length]);

  const handlePhoneSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!phoneNumber.trim()) return;
    setIsSubmittingPhone(true);

    // Extract only reliable visitor data. Missing context stays null in the Veya brief.
    const userMessages = voiceTranscript.filter((entry) => entry.role === "user");
    const name = userMessages[0]?.text?.trim() || null;
    const offer = userMessages[1]?.text?.trim() || null;
    const buyer = userMessages[2]?.text?.trim() || null;

    // Normalize and validate phone number
    const normalizedPhone = phoneNumber.trim();
    if (!normalizedPhone.startsWith("+")) {
      setIsSubmittingPhone(false);
      alert("I may be missing part of that number. Could you check it for me?");
      return;
    }

    // Analyze conversation for insights (including name extraction)
    const analysis = analyzeConversationInsights(voiceTranscript, name || undefined);
    setBusinessInsights({
      ...analysis.insights,
      confidence: analysis.confidence,
    });

    // Check name confidence
    if (analysis.nameConfidence === "low" && analysis.extractedName) {
      // Ask for confirmation if name extraction confidence is low
      console.log("[Experience] Low confidence name extraction, asking for confirmation", {
        extractedName: analysis.extractedName,
        confidence: analysis.nameConfidence,
      });
      setExtractedName(analysis.extractedName);
      setNameConfirmation({ asking: true, name: analysis.extractedName });
      setIsSubmittingPhone(false);
      return;
    }

    // If we have an extracted name from low-confidence, use that confirmed name
    const finalName = extractedName || name;

    setDelegationStatus("preparing_brief");
    setDelegationError(null);
    setPhase("waiting_for_call");

    // Build dispatch payload
    const dispatchPayload = {
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source: "experience_conversation",
      timestamp: new Date().toISOString(),
      visitor: {
        name: finalName || "Unknown",
        phone: normalizedPhone,
      },
      business: {
        offer: offer || "Unknown",
        target_buyer: buyer || "Unknown",
      },
    };

    // Generate agent brief (outcome-focused, not internally focused)
    const agentBrief = {
      visitor_name: finalName || "Unknown",
      business_summary: `${finalName || "The visitor"} sells ${offer || "an unspecified offer"} to ${buyer || "an unspecified customer"}.`,
      outreach_objective: "Demonstrate how Zeya helps businesses create more customer conversations.",
      call_context: {
        offer: offer || "Unknown",
        target_market: buyer || "Unknown",
      },
      instructions: "Be warm and natural. The visitor agreed to see a demo of how Zeya represents businesses to generate conversations. Show concretely how this helps them reach more of their ideal customers.",
    };

    setDispatchRecord({
      dispatch_id: dispatchPayload.id,
      payload: dispatchPayload,
      brief: agentBrief,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const briefing: VeyaBriefingPayload = {
      name,
      business: offer,
      customer: buyer,
      phone: normalizedPhone,
      source: "zeya_experience",
      createdAt: new Date().toISOString(),
    };

    console.log("[Experience] Veya briefing created", {
      hasName: Boolean(briefing.name),
      hasBusiness: Boolean(briefing.business),
      hasCustomer: Boolean(briefing.customer),
    });

    try {
      const isAuthenticated = Boolean(user && session?.access_token);
      if (user && session?.access_token) {
        await createDispatchInSupabase(
          user.id,
          dispatchPayload.id,
          dispatchPayload.visitor.name,
          normalizedPhone,
          dispatchPayload.business.offer,
          dispatchPayload.business.target_buyer,
          agentBrief,
        );
      }

      setDelegationStatus("dispatching_call");
      console.log("[Experience] Veya dispatch requested", {
        dispatchId: isAuthenticated ? dispatchPayload.id : "server-generated",
        authenticationMode: isAuthenticated ? "authenticated" : "anonymous",
      });

      const response = await fetch("/api/experience/delegate-call", {
        method: "POST",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          briefing,
          ...(isAuthenticated ? { dispatchId: dispatchPayload.id } : {}),
        }),
      });
      const responseBody = await response.text();
      console.log("[Experience] Veya delegation response received", {
        dispatchId: isAuthenticated ? dispatchPayload.id : "server-generated",
        status: response.status,
        ok: response.ok,
      });

      let result: VeyaDelegationResponse;
      try {
        result = JSON.parse(responseBody) as VeyaDelegationResponse;
      } catch (error) {
        const parseMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Delegation API returned a non-JSON response (${response.status}): ${responseBody || "<empty body>"}. Parse failure: ${parseMessage}`,
        );
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || "The call request failed.");
      }

      setDelegationStatus("call_requested");
      setDispatchRecord((current) =>
        current
          ? {
              ...current,
              dispatch_id: result.dispatchId || current.dispatch_id,
              status: "calling",
              updated_at: new Date().toISOString(),
            }
          : current,
      );
      console.log("[Experience] Veya call requested", {
        provider: result.provider,
        providerCallId: result.providerCallId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDelegationStatus("failed");
      setDelegationError(message);
      setDispatchRecord((current) =>
        current
          ? { ...current, status: "failed", updated_at: new Date().toISOString() }
          : current,
      );
      console.error("[Experience] Veya delegation failed", {
        message,
        name: error instanceof Error ? error.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
      });
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  const handleCallRetry = () => {
    setIsSubmittingPhone(false);
    setPhase("collecting_phone");
  };

  const handleReconnect = () => {
    controllerRef.current = null;
    sessionStorage.removeItem("lastProcessedTranscriptId");
    setIsSubmittingPhone(false);
    setPhase("initial");
  };

  const handleNameConfirm = (confirmed: boolean) => {
    console.log("[Experience] Name confirmation", { confirmed, name: extractedName });

    if (confirmed && extractedName) {
      // Name was confirmed, continue with phone submission
      setNameConfirmation({ asking: false });
      // Re-trigger the submission with confirmed name
      // We'll need to call handlePhoneSubmit logic here
      void handlePhoneSubmitContinued();
    } else {
      // Name was not confirmed, ask user to spell it out
      setNameConfirmation({ asking: false });
      setExtractedName(null);
      // Go back to phone collection
      setPhase("collecting_phone");
    }
  };

  const handlePhoneSubmitContinued = async () => {
    // This is a continuation of handlePhoneSubmit after name confirmation
    if (!extractedName) return;

    setDelegationStatus("preparing_brief");
    setDelegationError(null);
    setPhase("waiting_for_call");
    setIsSubmittingPhone(true);

    const userMessages = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text?.trim());
    const offer = userMessages[1]?.text?.trim() || null;
    const buyer = userMessages[2]?.text?.trim() || null;
    const normalizedPhone = phoneNumber.trim();

    // Build dispatch payload
    const dispatchPayload = {
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source: "experience_conversation",
      timestamp: new Date().toISOString(),
      visitor: {
        name: extractedName,
        phone: normalizedPhone,
      },
      business: {
        offer: offer || "Unknown",
        target_buyer: buyer || "Unknown",
      },
    };

    const agentBrief = {
      visitor_name: extractedName,
      business_summary: `${extractedName} sells ${offer || "an unspecified offer"} to ${buyer || "an unspecified customer"}.`,
      outreach_objective: "Demonstrate how Zeya helps businesses create more customer conversations.",
      call_context: {
        offer: offer || "Unknown",
        target_market: buyer || "Unknown",
      },
      instructions: "Be warm and natural. The visitor agreed to see a demo of how Zeya represents businesses to generate conversations. Show concretely how this helps them reach more of their ideal customers.",
    };

    setDispatchRecord({
      dispatch_id: dispatchPayload.id,
      payload: dispatchPayload,
      brief: agentBrief,
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const briefing: VeyaBriefingPayload = {
      name: extractedName,
      business: offer,
      customer: buyer,
      phone: normalizedPhone,
      source: "zeya_experience",
      createdAt: new Date().toISOString(),
    };

    try {
      const isAuthenticated = Boolean(user && session?.access_token);
      if (user && session?.access_token) {
        await createDispatchInSupabase(
          user.id,
          dispatchPayload.id,
          extractedName,
          normalizedPhone,
          dispatchPayload.business.offer,
          dispatchPayload.business.target_buyer,
          agentBrief,
        );
      }

      setDelegationStatus("dispatching_call");

      const response = await fetch("/api/experience/delegate-call", {
        method: "POST",
        headers: {
          ...(session?.access_token
            ? { Authorization: `Bearer ${session.access_token}` }
            : {}),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          briefing,
          ...(isAuthenticated ? { dispatchId: dispatchPayload.id } : {}),
        }),
      });

      const responseBody = await response.text();
      let result: VeyaDelegationResponse;
      try {
        result = JSON.parse(responseBody) as VeyaDelegationResponse;
      } catch (error) {
        throw new Error(`Failed to parse delegation response: ${responseBody}`);
      }

      if (!response.ok || !result.success) {
        throw new Error(result.error || "The call request failed.");
      }

      setDelegationStatus("call_requested");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDelegationStatus("failed");
      setDelegationError(message);
    } finally {
      setIsSubmittingPhone(false);
    }
  };

  const handleCallComplete = () => {
    console.log("[Experience] User confirmed call is complete, preparing reveal...");
    setCallCompleted(true);

    // Wait 2 seconds before showing reveal (pause for breath)
    setTimeout(() => {
      console.log("[Experience] Showing reveal experience");
      setIsShowingReveal(true);
    }, 2000);
  };

  const handleFollowUpCapture = async (data: { name: string; email: string }) => {
    try {
      console.log("[Experience] Capturing follow-up lead", {
        name: data.name,
        email: data.email,
      });

      await persistFollowUpLead(user?.id, {
        name: data.name,
        email: data.email,
        phone: phoneNumber || undefined,
        businessSummary: businessInsights
          ? `${businessInsights.businessType || "Unknown"}: ${businessInsights.offer || "Unknown"}`
          : undefined,
        goal: businessInsights?.goal,
        representationFit: businessInsights?.representationFit || "low",
      });

      console.log("[Experience] Follow-up lead captured successfully", {
        name: data.name,
        email: data.email,
      });
    } catch (error) {
      console.error("[Experience] Failed to capture follow-up lead", error);
      throw error;
    }
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void flex flex-col">
      {phase === "initial" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <PresenceCore />
          <div className="mt-12 space-y-6 text-center">
            <p
              className="font-serif text-lg sm:text-xl text-zeya-ivory font-light"
              style={{ letterSpacing: "0.08em", lineHeight: "1.6" }}
            >
              Meet Zeya.
            </p>
            <p
              className="text-sm text-zeya-taupe font-light max-w-md mx-auto"
              style={{ letterSpacing: "0.02em", lineHeight: "1.7" }}
            >
              A brief conversation to see what&apos;s possible.
            </p>
            <VoiceButton
              onStart={handleStartExperience}
              onStop={handleEndConversation}
              disabled={!isConfigured}
              state={voiceState}
            />
          </div>
        </div>
      )}

      {phase === "voice_active" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <PresenceCore />
          <div className="mt-12 space-y-8 text-center max-w-2xl">
            <div className="space-y-4">
              <div
                className={`inline-block px-4 py-2 rounded-full border transition-all ${
                  isVoiceActive
                    ? "border-zeya-champagne bg-zeya-champagne/5"
                    : "border-zeya-taupe"
                }`}
              >
                <p
                  className={`text-xs font-light ${
                    isVoiceActive ? "text-zeya-champagne" : "text-zeya-taupe"
                  }`}
                  style={{ letterSpacing: "0.1em" }}
                >
                  {voiceState === "listening" && "Listening…"}
                  {voiceState === "thinking" && "Processing…"}
                  {voiceState === "speaking" && "Speaking…"}
                  {voiceState === "connecting" && "Connecting…"}
                  {!isVoiceActive && "Conversation ready"}
                </p>
              </div>

              {/* Transcript display */}
              {voiceTranscript.length > 0 && (
                <div className="mt-8 max-w-md mx-auto h-48 overflow-y-auto space-y-4 text-left pr-2">
                  {voiceTranscript.map((entry) => (
                    <div key={entry.id} className="space-y-1">
                      <p className="text-xs text-zeya-taupe opacity-60" style={{ letterSpacing: "0.1em" }}>
                        {entry.role === "agent" ? "ZEYA" : "YOU"}
                      </p>
                      <p
                        className={`text-sm font-light ${
                          entry.role === "agent"
                            ? "text-zeya-ivory opacity-85"
                            : "text-zeya-champagne opacity-90"
                        }`}
                        style={{
                          lineHeight: "1.7",
                          letterSpacing: "0.01em",
                        }}
                      >
                        {entry.text}
                      </p>
                    </div>
                  ))}
                  <div ref={transcriptEndRef} />
                </div>
              )}
            </div>

          </div>
        </div>
      )}

      {phase === "handoff" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <PresenceCore />
          <div className="mt-12 space-y-4 text-center max-w-md">
            <p
              className="font-serif text-lg text-zeya-ivory font-light"
              style={{ letterSpacing: "0.08em" }}
            >
              Preparing your handoff…
            </p>
            <p
              className="text-sm text-zeya-taupe font-light"
              style={{ letterSpacing: "0.02em", lineHeight: "1.6" }}
            >
              Zeya is preparing the next step.
            </p>
          </div>
        </div>
      )}

      {phase === "collecting_phone" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          {nameConfirmation.asking ? (
            <div className="max-w-md space-y-6 text-center">
              <div className="space-y-4">
                <p
                  className="font-serif text-lg text-zeya-ivory font-light"
                  style={{ letterSpacing: "0.08em" }}
                >
                  I want to make sure I have your name right.
                </p>
                <p
                  className="text-sm text-zeya-taupe font-light"
                  style={{ letterSpacing: "0.02em", lineHeight: "1.6" }}
                >
                  I heard your name as:
                </p>
                <p
                  className="font-serif text-2xl text-zeya-champagne font-light"
                  style={{ letterSpacing: "0.06em" }}
                >
                  {nameConfirmation.name}
                </p>
              </div>

              <div className="flex gap-3 flex-col sm:flex-row">
                <button
                  onClick={() => handleNameConfirm(true)}
                  className="flex-1 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 px-4 py-3 text-sm font-light transition-colors rounded"
                  style={{ letterSpacing: "0.08em" }}
                >
                  That's Correct
                </button>
                <button
                  onClick={() => handleNameConfirm(false)}
                  className="flex-1 border border-zeya-taupe/30 text-zeya-ivory hover:border-zeya-champagne hover:text-zeya-champagne px-4 py-3 text-sm font-light transition-colors rounded"
                  style={{ letterSpacing: "0.08em" }}
                >
                  Spell It Out
                </button>
              </div>
            </div>
          ) : (
            <div className="max-w-md space-y-8 text-center">
              <div className="space-y-4">
                <p
                  className="font-serif text-lg text-zeya-ivory font-light"
                  style={{ letterSpacing: "0.08em" }}
                >
                  Where should my team reach you?
                </p>
              <p
                className="text-sm text-zeya-taupe font-light"
                style={{ letterSpacing: "0.02em", lineHeight: "1.6" }}
              >
                Include your country code.
              </p>
            </div>

            <form onSubmit={handlePhoneSubmit} className="space-y-6">
              <input
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="+1 (555) 000-0000"
                disabled={isSubmittingPhone}
                className="w-full bg-transparent border-b border-zeya-hush/30 text-zeya-ivory placeholder-zeya-hush/40 focus:outline-none focus:border-zeya-champagne transition-colors duration-300 py-3 text-base"
                style={{
                  letterSpacing: "0.01em",
                }}
              />
              <button
                type="submit"
                disabled={isSubmittingPhone || !phoneNumber.trim()}
                className="w-full py-3 border border-zeya-taupe hover:border-zeya-champagne text-zeya-ivory hover:text-zeya-champagne transition-all duration-300 disabled:opacity-50 text-sm font-light"
                style={{
                  letterSpacing: "0.08em",
                }}
              >
                {isSubmittingPhone ? "Confirming…" : "Confirm"}
              </button>
            </form>
            </div>
          )}
        </div>
      )}

      {phase === "waiting_for_call" && (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          {showPostCallReveal && businessInsights ? (
            <PostCallReveal
              insights={businessInsights}
              onFollowUpCapture={handleFollowUpCapture}
            />
          ) : callRequested && !callCompleted ? (
            <div className="w-full max-w-md space-y-8">
              <div className="flex flex-col items-center text-center">
                <PresenceCore state="idle" />
                <div className="mt-6 space-y-4">
                  <p
                    className="font-serif text-lg text-zeya-ivory font-light"
                    style={{ letterSpacing: "0.06em" }}
                  >
                    You're on the call with my agent.
                  </p>
                  <p
                    className="text-sm font-light text-zeya-taupe"
                    style={{ letterSpacing: "0.02em", lineHeight: "1.8" }}
                  >
                    Take your time. When you're finished talking, click below to continue.
                  </p>
                </div>
              </div>

              <button
                onClick={handleCallComplete}
                className="w-full border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 px-6 py-4 text-sm font-light transition-colors rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                My Call Is Complete
              </button>
            </div>
          ) : (
            <div className="w-full max-w-md space-y-7">
              <div className="flex flex-col items-center text-center">
                <PresenceCore state="idle" />
                <div className="mt-6 space-y-3">
                  <p
                    className="font-serif text-lg text-zeya-ivory font-light"
                    style={{ letterSpacing: "0.06em", lineHeight: "1.6" }}
                  >
                    Perfect. I’ve prepared a short brief for my agent based on our conversation.
                  </p>
                  <p className="text-sm font-light text-zeya-taupe">Keep this page open.</p>
                  <p className="text-sm font-light text-zeya-taupe">
                    I’ll stay here while the call is being connected.
                  </p>
                </div>
              </div>

              <div className="space-y-3 rounded border border-zeya-taupe/20 px-4 py-4">
                <div className="flex items-center gap-3 text-sm font-light">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-zeya-champagne/50 text-[0.65rem] text-zeya-champagne">
                    {delegationStatus === "preparing_brief" ? "•" : "✓"}
                  </span>
                  <span className={delegationStatus === "preparing_brief" ? "text-zeya-champagne" : "text-zeya-ivory/75"}>
                    Preparing brief
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm font-light">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-zeya-taupe/30 text-[0.65rem] text-zeya-champagne">
                    {delegationStatus === "dispatching_call"
                      ? "•"
                      : delegationStatus === "failed"
                        ? "✓"
                        : ""}
                  </span>
                  <span className={delegationStatus === "dispatching_call" ? "text-zeya-champagne" : "text-zeya-ivory/75"}>
                    Ready to call
                  </span>
                </div>
                <div className="flex items-center gap-3 text-sm font-light">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      delegationStatus === "failed"
                        ? "bg-red-400/80"
                        : "bg-zeya-taupe/25"
                    }`}
                  />
                  <span className={delegationStatus === "failed" ? "text-red-300/80" : "text-zeya-taupe/60"}>
                    {delegationStatus === "failed" ? "Call request failed" : "Waiting for connection"}
                  </span>
                </div>
                {delegationError && (
                  <p className="pl-8 text-xs font-light leading-relaxed text-red-300/70">
                    {delegationError}
                  </p>
                )}
              </div>

              <div className="text-center space-y-3">
                <p
                  className="font-serif text-lg text-zeya-ivory font-light"
                  style={{ letterSpacing: "0.08em" }}
                >
                  Waiting for your call…
                </p>
                <p
                  className="text-xs text-zeya-taupe/70 font-light"
                  style={{ letterSpacing: "0.02em", lineHeight: "1.6" }}
                >
                  If the call does not arrive, you can try again or reconnect with Zeya here.
                </p>
                <div className="inline-flex items-center gap-2 rounded-full border border-zeya-taupe/20 px-3 py-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-zeya-taupe/50" />
                  <span className="text-[0.65rem] uppercase tracking-[0.12em] text-zeya-taupe/70">
                    Microphone paused
                  </span>
                </div>
              </div>

              {dispatchRecord && (
                <div className="space-y-4 p-4 border border-zeya-taupe/20 rounded">
                  <div className="space-y-2">
                    <p
                      className="text-xs text-zeya-taupe opacity-60"
                      style={{ letterSpacing: "0.1em" }}
                    >
                      DISPATCH MONITOR
                    </p>
                    <div className="space-y-3 text-sm font-light">
                      <div className="flex justify-between">
                        <span className="text-zeya-taupe">ID</span>
                        <span className="text-zeya-ivory opacity-70 font-mono text-xs">
                          {dispatchRecord.dispatch_id.slice(0, 12)}...
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zeya-taupe">Visitor</span>
                        <span className="text-zeya-ivory opacity-70">{dispatchRecord.payload.visitor.name}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zeya-taupe">Phone</span>
                        <span className="text-zeya-ivory opacity-70">{dispatchRecord.payload.visitor.phone}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-zeya-taupe">Status</span>
                        <span
                          className="font-light"
                          style={{
                            color:
                              dispatchRecord.status === "queued"
                                ? "rgb(215, 193, 155)"
                                : "rgb(204, 182, 142)",
                          }}
                        >
                          {dispatchRecord.status.toUpperCase()}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-zeya-taupe/10 text-xs text-zeya-taupe opacity-40">
                    <p>Ready for outbound execution</p>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleCallRetry}
                  className="w-full border border-zeya-taupe/40 px-4 py-3 text-sm font-light text-zeya-ivory transition-colors hover:border-zeya-champagne hover:text-zeya-champagne"
                >
                  I did not get the call
                </button>
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="w-full border border-zeya-taupe/20 px-4 py-3 text-sm font-light text-zeya-taupe transition-colors hover:border-zeya-champagne hover:text-zeya-champagne"
                >
                  Reconnect with Zeya
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
