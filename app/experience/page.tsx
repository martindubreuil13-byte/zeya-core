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

type Phase = "initial" | "voice_active" | "collecting_phone" | "confirming";

export default function ExperiencePage() {
  const router = useRouter();
  const { user } = useAuth();
  const voice = useOnboardingVoiceConversation();
  const {
    state: voiceState,
    transcript: voiceTranscript,
    isConfigured,
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

  const isVoiceActive = ["connecting", "listening", "thinking", "speaking"].includes(voiceState);

  // Auto-scroll transcript to latest message
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceTranscript]);

  // Detect final user transcript and advance beat
  useEffect(() => {
    if (phase !== "voice_active" || !controllerRef.current) return;

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
    console.log("[EXPERIENCE] Start button clicked");
    if (!isConfigured) return;
    setPhase("voice_active");

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
        stopConversation();
        setPhase("collecting_phone");
      },
      onSessionFail: (session, reason) => {
        console.error("[BEAT] onSessionFail()", reason);
        stopConversation();
        setPhase("initial");
      },
    });

    console.log("[EXPERIENCE] BeatController created");
    controllerRef.current = controller;

    console.log("[EXPERIENCE] Calling controller.startBeat()");
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

    // Transition to confirmation
    setTimeout(() => {
      setPhase("confirming");
    }, 1000);
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
              A brief conversation to see what's possible.
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

      {phase === "confirming" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="max-w-md space-y-8">
            <div className="text-center space-y-4">
              <p
                className="font-serif text-lg text-zeya-ivory font-light"
                style={{ letterSpacing: "0.08em" }}
              >
                Perfect.
              </p>
              <p
                className="text-sm text-zeya-taupe font-light"
                style={{ letterSpacing: "0.02em", lineHeight: "1.6" }}
              >
                Keep this page open. One of my agents will call you shortly.
              </p>
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
          </div>
        </div>
      )}
    </main>
  );
}
