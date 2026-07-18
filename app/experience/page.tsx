"use client";

import { useEffect, useState, useRef } from "react";
import { usePublicExperienceVoiceConversation } from "@/hooks/voice/usePublicExperienceVoiceConversation";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { PresenceCore } from "@/components/presence";
import { BeatController } from "@/lib/experience/beat-controller";
import { initializeSession } from "@/lib/experience/experience-state";
import { analyzeConversationInsights } from "@/lib/experience/conversation-analyzer";
import { PublicExperienceReflection,type PublicExperienceReflectionData } from "@/components/experience/PublicExperienceReflection";
import {
  acquirePublicExperienceAction,
  PublicExperienceHandoffError,
  releasePublicExperienceAction,
  submitPublicExperienceHandoff,
} from "@/lib/experience/public-handoff";
import type { DispatchRecord } from "@/lib/dispatch/types";
import type { VeyaDelegationStatus } from "@/lib/dispatch/veya-delegation-types";

type Phase = "initial" | "voice_active" | "handoff" | "collecting_phone" | "waiting_for_call";

const PHONE_HANDOFF =
  "Perfect. Keep this page open. One of my agents will call you shortly. I’ve already prepared a short brief from what we discussed. What’s the best number to reach you on?";

export default function ExperiencePage() {
  const voice = usePublicExperienceVoiceConversation();
  const {
    state: voiceState,
    transcript: voiceTranscript,
    isConfigured,
    startConversation,
    stopConversation,
    resetConversation,
    speakExact,
    experienceSession,
  } = voice;

  const [phase, setPhase] = useState<Phase>("initial");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [isSubmittingPhone, setIsSubmittingPhone] = useState(false);
  const [dispatchRecord, setDispatchRecord] = useState<DispatchRecord | null>(null);
  const [delegationStatus, setDelegationStatus] =
    useState<VeyaDelegationStatus>("preparing_brief");
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [voiceStartError, setVoiceStartError] = useState<string | null>(null);
  const [durableCallStatus,setDurableCallStatus]=useState<string|null>(null);
  const [reflection,setReflection]=useState<PublicExperienceReflectionData|null>(null);
  const [nameConfirmation, setNameConfirmation] = useState<{ asking: boolean; name?: string }>({
    asking: false,
  });
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BeatController | null>(null);
  const handoffHasStartedSpeakingRef = useRef(false);
  const startInFlightRef = useRef(false);
  const handoffInFlightRef = useRef(false);
  const handoffCompletedRef = useRef(false);

  const isVoiceActive = ["connecting", "listening", "thinking", "speaking"].includes(voiceState);
  const callRequested = delegationStatus === "call_requested"
    || delegationStatus === "correlation_pending"
    || delegationStatus === "dispatch_resolution_pending";

  // Auto-scroll transcript to latest message
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [voiceTranscript]);

  useEffect(()=>{
    const token=experienceSession?.token;
    if(phase!=="waiting_for_call"||!token||!callRequested)return;
    let stopped=false,inFlight=false,timer:number|undefined;
    const controller=new AbortController();
    const poll=async()=>{
      if(stopped||inFlight)return;
      inFlight=true;
      try{
        const statusResponse=await fetch("/api/experience/session/status",{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
        if(stopped)return;
        if(statusResponse.status===404){setDurableCallStatus("expired");stopped=true;return;}
        if(statusResponse.ok){
          const body=await statusResponse.json() as {status?:string};
          if(body.status)setDurableCallStatus(body.status);
          if(body.status==="reflection_ready"){
            const reflectionResponse=await fetch("/api/experience/session/reflection",{headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
            if(stopped)return;
            if(reflectionResponse.ok){const data=await reflectionResponse.json() as {reflection:PublicExperienceReflectionData};setReflection(data.reflection);stopped=true;}
            return;
          }
          if(body.status==="call_failed"||body.status==="expired"){stopped=true;return;}
        }
      }catch{/* transient network errors are retried */}
      finally{inFlight=false;if(!stopped)timer=window.setTimeout(poll,3000);}
    };
    void poll();
    return()=>{stopped=true;controller.abort();if(timer)window.clearTimeout(timer);};
  },[callRequested,experienceSession?.token,phase]);

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
    if (!acquirePublicExperienceAction(startInFlightRef)) return;
    setVoiceStartError(null);
    const startTimestamp = performance.now();
    console.log("[EXPERIENCE] Start button clicked", {
      timestamp: startTimestamp,
      millisecondsSincePageLoad: Math.round(startTimestamp),
    });
    if (!isConfigured) {
      releasePublicExperienceAction(startInFlightRef);
      return;
    }
    setPhase("voice_active");
    try {
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
    } catch {
      resetConversation();
      controllerRef.current = null;
      setVoiceStartError("The voice session could not start. Please try again.");
      setPhase("initial");
    } finally {
      releasePublicExperienceAction(startInFlightRef);
    }
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

  const submitExperienceHandoff = async (
    finalName: string | null,
    offer: string | null,
    buyer: string | null,
  ) => {
    if (handoffCompletedRef.current || !acquirePublicExperienceAction(handoffInFlightRef)) return;

    const token = experienceSession?.token ?? null;
    const normalizedPhone = phoneNumber.trim();
    const transcriptEntries = voiceTranscript.map((entry) => ({ ...entry }));
    let succeeded = false;

    setIsSubmittingPhone(true);
    setDelegationStatus("preparing_brief");
    setDelegationError(null);
    setPhase("waiting_for_call");

    const dispatchPayload = {
      id: `dispatch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      source: "experience_conversation",
      timestamp: new Date().toISOString(),
      visitor: { name: finalName || "Unknown", phone: normalizedPhone },
      business: { offer: offer || "Unknown", target_buyer: buyer || "Unknown" },
    };
    setDispatchRecord({
      dispatch_id: dispatchPayload.id,
      payload: dispatchPayload,
      brief: {
        visitor_name: finalName || "Unknown",
        business_summary: `${finalName || "The visitor"} sells ${offer || "an unspecified offer"} to ${buyer || "an unspecified customer"}.`,
        outreach_objective: "Demonstrate how Zeya helps businesses create more customer conversations.",
        call_context: { offer: offer || "Unknown", target_market: buyer || "Unknown" },
        instructions: "Be warm and natural. The visitor agreed to see a demo of how Zeya represents businesses to generate conversations. Show concretely how this helps them reach more of their ideal customers.",
      },
      status: "draft",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    try {
      if (!token) {
        throw new PublicExperienceHandoffError(
          "The Experience session is unavailable. Please restart.",
          "finalization", null, true, false,
        );
      }
      const handoff = await submitPublicExperienceHandoff({
        experienceToken: token,
        transcriptEntries,
        phone: normalizedPhone,
        name: finalName,
        business: offer,
        customer: buyer,
      });
      succeeded = true;
      handoffCompletedRef.current = true;
      setDelegationStatus(handoff.dispatchStatus === "call_dispatched" ? "call_requested" : handoff.dispatchStatus);
      setDispatchRecord((current) => current ? {
        ...current,
        status: "calling",
        updated_at: new Date().toISOString(),
      } : current);
    } catch (error) {
      const handoffError = error instanceof PublicExperienceHandoffError ? error : null;
      const message = handoffError?.message ?? "The call request failed. Please try again.";
      setDelegationStatus("failed");
      setDelegationError(message);
      setDispatchRecord((current) => current ? {
        ...current,
        status: "failed",
        updated_at: new Date().toISOString(),
      } : current);
      if (handoffError?.restartRequired) {
        resetConversation();
        controllerRef.current = null;
        setVoiceStartError(message);
        setPhase("initial");
      }
    } finally {
      if (!succeeded) releasePublicExperienceAction(handoffInFlightRef);
      setIsSubmittingPhone(false);
    }
  };

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (handoffInFlightRef.current || handoffCompletedRef.current || !phoneNumber.trim()) return;

    const normalizedPhone = phoneNumber.trim();
    if (!normalizedPhone.startsWith("+")) {
      alert("I may be missing part of that number. Could you check it for me?");
      return;
    }

    const userMessages = voiceTranscript.filter(
      (entry) => entry.role === "user" && entry.isFinal && entry.text.trim(),
    );
    const name = userMessages[0]?.text.trim() || null;
    const offer = userMessages[1]?.text.trim() || null;
    const buyer = userMessages[2]?.text.trim() || null;
    const analysis = analyzeConversationInsights(voiceTranscript, name || undefined);

    if (analysis.nameConfidence === "low" && analysis.extractedName) {
      setExtractedName(analysis.extractedName);
      setNameConfirmation({ asking: true, name: analysis.extractedName });
      return;
    }

    void submitExperienceHandoff(name, offer, buyer);
  };

  const handleCallRetry = () => {
    setIsSubmittingPhone(false);
    setPhase("collecting_phone");
  };

  const handleReconnect = () => {
    resetConversation();
    controllerRef.current = null;
    handoffInFlightRef.current = false;
    handoffCompletedRef.current = false;
    sessionStorage.removeItem("lastProcessedTranscriptId");
    setIsSubmittingPhone(false);
    setPhase("initial");
  };

  const handleNameConfirm = (confirmed: boolean) => {
    if (handoffInFlightRef.current || handoffCompletedRef.current) return;
    if (confirmed && extractedName) {
      setNameConfirmation({ asking: false });
      const userMessages = voiceTranscript.filter(
        (entry) => entry.role === "user" && entry.isFinal && entry.text.trim(),
      );
      void submitExperienceHandoff(
        extractedName,
        userMessages[1]?.text.trim() || null,
        userMessages[2]?.text.trim() || null,
      );
    } else {
      setNameConfirmation({ asking: false });
      setExtractedName(null);
      setPhase("collecting_phone");
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
            {voiceStartError && (
              <p className="text-xs font-light text-red-300/80" role="alert">
                {voiceStartError}
              </p>
            )}
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
                  disabled={isSubmittingPhone}
                  className="flex-1 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 px-4 py-3 text-sm font-light transition-colors rounded"
                  style={{ letterSpacing: "0.08em" }}
                >
                  That's Correct
                </button>
                <button
                  onClick={() => handleNameConfirm(false)}
                  disabled={isSubmittingPhone}
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
          {reflection ? (
            <PublicExperienceReflection reflection={reflection}/>
          ) : durableCallStatus === "call_failed" || durableCallStatus === "expired" ? (
            <div className="w-full max-w-md text-center space-y-4">
              <PresenceCore state="idle"/>
              <p className="font-serif text-lg text-zeya-ivory">{durableCallStatus === "expired" ? "This Experience has expired." : "The call could not be completed."}</p>
              <p className="text-sm text-zeya-taupe">No business Representation was changed.</p>
            </div>
          ) : callRequested ? (
            <div className="w-full max-w-md space-y-8">
              <div className="flex flex-col items-center text-center">
                <PresenceCore state="idle" />
                <div className="mt-6 space-y-4">
                  <p
                    className="font-serif text-lg text-zeya-ivory font-light"
                    style={{ letterSpacing: "0.06em" }}
                  >
                    {durableCallStatus === "call_in_progress" ? "You're on the call with my agent." : "The call is being connected."}
                  </p>
                  <p
                    className="text-sm font-light text-zeya-taupe"
                    style={{ letterSpacing: "0.02em", lineHeight: "1.8" }}
                  >
                    Keep this page open. Zeya will return only after the provider confirms the call is complete.
                  </p>
                </div>
              </div>

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
