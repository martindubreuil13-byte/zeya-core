"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { useOnboardingVoiceConversation } from "@/hooks/voice/useOnboardingVoiceConversation";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { PresenceCore } from "@/components/presence";
import { extractAssistantActions } from "@/lib/dispatch/actions";
import { createDispatchInSupabase } from "@/lib/dispatch/supabase-persistence";
import {
  generateWorkerBrief,
  linkDispatchToWorkerBrief,
} from "@/lib/dispatch/worker-brief-generator";
import { buildExecutionPackage } from "@/lib/dispatch/execution-package";
import { BeatController } from "@/lib/experience/beat-controller";
import { initializeSession } from "@/lib/experience/experience-state";
import type { VoiceState } from "@/types/voice";
import type { DispatchRecord, AgentBrief } from "@/lib/dispatch/types";

type Phase = "initial" | "voice_active" | "handoff" | "collecting_phone" | "waiting_for_call";

const PHONE_HANDOFF =
  "Perfect. Keep this page open. One of my agents will call you shortly. I’ve already prepared a short brief from what we discussed. What’s the best number to reach you on?";

export default function ExperiencePage() {
  const router = useRouter();
  const { user } = useAuth();
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
  const [visitorName, setVisitorName] = useState("");
  const [businessOffer, setBusinessOffer] = useState("");
  const [targetBuyer, setTargetBuyer] = useState("");
  const [dispatchRecord, setDispatchRecord] = useState<DispatchRecord | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BeatController | null>(null);
  const handoffHasStartedSpeakingRef = useRef(false);

  const isVoiceActive = ["connecting", "listening", "thinking", "speaking"].includes(voiceState);

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

    // Extract visitor data from transcript
    const userMessages = voiceTranscript.filter((entry) => entry.role === "user");
    const name = userMessages[0]?.text || "Unknown";
    const offer = userMessages[1]?.text || "Unknown";
    const buyer = userMessages[2]?.text || "Unknown";

    // Normalize and validate phone number
    const normalizedPhone = phoneNumber.trim();
    if (!normalizedPhone.startsWith("+")) {
      setIsSubmittingPhone(false);
      alert("I may be missing part of that number. Could you check it for me?");
      return;
    }

    // Build dispatch payload
    const dispatchPayload = {
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source: "experience_conversation",
      timestamp: new Date().toISOString(),
      visitor: {
        name: name,
        phone: normalizedPhone,
      },
      business: {
        offer: offer,
        target_buyer: buyer,
      },
    };

    // Generate agent brief (outcome-focused, not internally focused)
    const agentBrief = {
      visitor_name: name,
      business_summary: `${name} sells ${offer} to ${buyer}.`,
      outreach_objective: "Demonstrate how Zeya helps businesses create more customer conversations.",
      call_context: {
        offer: offer,
        target_market: buyer,
      },
      instructions: "Be warm and natural. The visitor agreed to see a demo of how Zeya represents businesses to generate conversations. Show concretely how this helps them reach more of their ideal customers.",
    };

    // Persist dispatch record to Supabase
    if (user) {
      // Create dispatch record
      const record = await createDispatchInSupabase(
        user.id,
        dispatchPayload.id,
        name,
        normalizedPhone,
        offer,
        buyer,
        agentBrief
      );

      if (record) {
        // Generate worker brief
        const briefResult = await generateWorkerBrief({
          businessId: user.id,
          visitorName: name,
          businessOffer: offer,
          targetBuyer: buyer,
          agentBrief: agentBrief,
          dispatchId: dispatchPayload.id,
        });

        // Link dispatch to worker brief
        if (briefResult?.id) {
          await linkDispatchToWorkerBrief(dispatchPayload.id, briefResult.id);
        }

        // Build execution package (ready for Telnyx)
        const executionPackage = buildExecutionPackage({
          dispatch_id: dispatchPayload.id,
          visitor_name: name,
          phone_number: normalizedPhone,
          business_offer: offer,
          target_buyer: buyer,
          worker_brief_id: briefResult?.id || "",
          agent_brief: agentBrief,
          created_at: new Date().toISOString(),
        });

        setDispatchRecord({
          dispatch_id: dispatchPayload.id,
          payload: dispatchPayload,
          brief: agentBrief,
          status: "draft",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        // Log execution package for debugging
        console.log("[Experience] Execution package ready", executionPackage);
      }
    }

    // Keep the experience alive while the visitor waits for the call.
    setPhase("waiting_for_call");
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
        </div>
      )}

      {phase === "waiting_for_call" && (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
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
                  ✓
                </span>
                <span className="text-zeya-ivory/75">Preparing brief</span>
              </div>
              <div className="flex items-center gap-3 text-sm font-light">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-zeya-champagne/50 text-[0.65rem] text-zeya-champagne">
                  ✓
                </span>
                <span className="text-zeya-ivory/75">Ready to call</span>
              </div>
              <div className="flex items-center gap-3 text-sm font-light">
                <span className="h-2 w-2 rounded-full bg-zeya-champagne/80" />
                <span className="text-zeya-champagne">Waiting for connection</span>
              </div>
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
        </div>
      )}
    </main>
  );
}
