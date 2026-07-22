"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { usePublicExperienceVoiceConversation } from "@/hooks/voice/usePublicExperienceVoiceConversation";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { PresenceCore } from "@/components/presence";
import { BeatController } from "@/lib/experience/beat-controller";
import { ExperienceBeat } from "@/lib/experience/experience-beats";
import { initializeSession } from "@/lib/experience/experience-state";
import { analyzeConversationInsights } from "@/lib/experience/conversation-analyzer";
import { analyzePublicExperienceNameResponse, normalizeCorrectedPublicExperienceName, resolvePublicExperienceNameReply } from "@/lib/experience/public-identity";
import {
  acquirePublicExperienceAction,
  normalizePublicExperiencePhone,
  PublicExperienceHandoffError,
  releasePublicExperienceAction,
  submitPublicExperienceHandoff,
} from "@/lib/experience/public-handoff";
import type { DispatchRecord } from "@/lib/dispatch/types";
import type { VeyaDelegationStatus } from "@/lib/dispatch/veya-delegation-types";
import type { PublicExperienceCallOutcome } from "@/lib/experience/public-call-outcome";
import type { RepresentationBrief, RepresentationBriefResponseType } from "@/types/experience";
import { EXPERIENCE_DEBUG_ENABLED, experienceDebugLog, experienceDebugTable } from "@/lib/experience/experience-debug";

type Phase = "initial" | "voice_active" | "handoff" | "collecting_phone" | "submitting_handoff" | "finalizing" | "dispatching_call" | "waiting_for_call" | "brief_review" | "calibration" | "hiring_decision" | "identity_confirmation" | "living_representation" | "completed" | "handoff_error";

const PHONE_HANDOFF =
  "I’d like to try something with you. In a moment, my colleague Veya will call you. I’ve already told her everything we discussed, so she won’t be starting from scratch. She’ll ask a few questions that help us understand how we could represent your business. Please keep this page open—I’ll be waiting for you when you’re back. What’s the best number to reach you on?";

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
  const [callOutcome,setCallOutcome]=useState<PublicExperienceCallOutcome|null>(null);
  const [representationBrief,setRepresentationBrief]=useState<RepresentationBrief|null>(null);
  const [spokenBrief,setSpokenBrief]=useState<string|null>(null);
  const [briefClarification,setBriefClarification]=useState<{message:string;question:string}|null>(null);
  const [briefResponse,setBriefResponse]=useState<string|null>(null);
  const [briefResponseText,setBriefResponseText]=useState("");
  const [briefResponseError,setBriefResponseError]=useState<string|null>(null);
  const [briefResponsePending,setBriefResponsePending]=useState(false);
  const [businessName,setBusinessName]=useState("");
  const [businessEmail,setBusinessEmail]=useState("");
  const [calibrationText,setCalibrationText]=useState("");
  const [calibrationPending,setCalibrationPending]=useState(false);
  const [nameConfirmation, setNameConfirmation] = useState<{ asking: boolean; name?: string }>({
    asking: false,
  });
  const [extractedName, setExtractedName] = useState<string | null>(null);
  const [correctedName, setCorrectedName] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<BeatController | null>(null);
  const handoffHasStartedSpeakingRef = useRef(false);
  const startInFlightRef = useRef(false);
  const handoffInFlightRef = useRef(false);
  const handoffCompletedRef = useRef(false);
  const briefResponseKeysRef=useRef<Record<string,string>>({});
  const identityRef = useRef<{ name: string | null; offer: string | null; buyer: string | null } | null>(null);
  const identityResolvedRef = useRef(false);
  const reflectionDebugRef=useRef<{startedAt:number;responseAt?:number;serverTimings?:Record<string,number>;briefStatus?:string;validation?:unknown}|null>(null);

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
        const statusResponse=await fetch("/api/experience/session/reconcile",{method:"POST",headers:{Authorization:`Bearer ${token}`},signal:controller.signal});
        if(stopped)return;
        if(statusResponse.status===404){setDurableCallStatus("expired");stopped=true;return;}
        if(statusResponse.ok){
          const body=await statusResponse.json() as {status?:string};
          if(body.status)setDurableCallStatus(body.status);
          if(body.status==="reflection_ready"){
            setDurableCallStatus("reviewing_what_was_learned");
            console.info("[browser]", { reflection_ready: true });
            if(EXPERIENCE_DEBUG_ENABLED){reflectionDebugRef.current={startedAt:performance.now()};experienceDebugLog("reflection_started");}
            const reflectionResponse=await fetch("/api/experience/session/reflection",{headers:{Authorization:`Bearer ${token}`,...(EXPERIENCE_DEBUG_ENABLED?{"x-experience-debug":"1"}:{})},signal:controller.signal});
            if(stopped)return;
            if(reflectionResponse.ok){
              const completed=await reflectionResponse.json() as {outcome?:PublicExperienceCallOutcome;brief?:RepresentationBrief;spokenBrief?:string;clarification?:{message:string;question:string};experienceDebug?:{timings?:Record<string,number>;briefStatus?:string;validation?:unknown;briefDiagnostics?:{evidenceItems?:string[];[key:string]:unknown}}};
              if(EXPERIENCE_DEBUG_ENABLED&&reflectionDebugRef.current){reflectionDebugRef.current.responseAt=performance.now();reflectionDebugRef.current.serverTimings=completed.experienceDebug?.timings;reflectionDebugRef.current.briefStatus=completed.experienceDebug?.briefStatus;reflectionDebugRef.current.validation=completed.experienceDebug?.validation;experienceDebugLog("reflection_response_returned",{elapsedMs:Math.round(performance.now()-reflectionDebugRef.current.startedAt),briefStatus:completed.experienceDebug?.briefStatus,validation:completed.experienceDebug?.validation});const diagnostics=completed.experienceDebug?.briefDiagnostics;if(diagnostics){const{evidenceItems=[],...safeDiagnostics}=diagnostics;console.info("[Experience Debug][Representation Brief]",safeDiagnostics);console.info("[Experience Debug][Visitor Evidence]");console.table(evidenceItems.map((visitorStatement,index)=>({evidence:index+1,visitorStatement})));}}
              if(completed.outcome){setCallOutcome(completed.outcome);setRepresentationBrief(completed.brief??null);setSpokenBrief(completed.spokenBrief??null);setBriefClarification(completed.clarification??null);stopped=true;setPhase("brief_review");console.info("[browser]", { transition: "brief_review" });}
            }else if(reflectionResponse.status!==409){
              setDurableCallStatus("recoverable_reflection_failure");
              stopped=true;
            }
            return;
          }
          if(body.status==="call_failed"||body.status==="expired"){stopped=true;return;}
        }
      }catch{/* transient network errors are retried */}
      finally{inFlight=false;if(!stopped)timer=window.setTimeout(poll,1500);}
    };
    void poll();
    return()=>{stopped=true;controller.abort();if(timer)window.clearTimeout(timer);};
  },[callRequested,experienceSession?.token,phase]);

  useEffect(()=>{
    if(!EXPERIENCE_DEBUG_ENABLED||phase!=="completed"||!reflectionDebugRef.current)return;
    const debug=reflectionDebugRef.current,renderedAt=performance.now();
    experienceDebugLog("ui_rendered",{elapsedMs:Math.round(renderedAt-debug.startedAt),briefStatus:debug.briefStatus,validation:debug.validation});
    experienceDebugTable({
      ...(debug.serverTimings??{}),
      "Response returned":debug.responseAt?Math.round(debug.responseAt-debug.startedAt):"n/a",
      "UI render":debug.responseAt?Math.round(renderedAt-debug.responseAt):"n/a",
      "Reflection TOTAL":Math.round(renderedAt-debug.startedAt),
    });
  },[phase]);


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
          console.info("[public-experience]", { event: "experience_reset", stage: "voice_session_failed" });
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
      setPhase((current) => current === "voice_active" ? "collecting_phone" : current);
    }, 500);
  };

  // Auto-trigger phone collection when user says yes to experiment
  useEffect(() => {
    if (voiceState === "disconnected" && phase === "voice_active" && voiceTranscript.length > 0) {
      // Conversation has ended naturally, move to phone capture
      setTimeout(() => {
        setPhase((current) => current === "voice_active" ? "collecting_phone" : current);
      }, 800);
    }
  }, [voiceState, phase, voiceTranscript.length]);

  const submitExperienceHandoff = async (
    finalName: string | null,
    offer: string | null,
    buyer: string | null,
  ) => {
    const normalizedPhone = normalizePublicExperiencePhone(phoneNumber);
    if (!normalizedPhone) return;
    if (handoffCompletedRef.current || !acquirePublicExperienceAction(handoffInFlightRef)) return;

    const token = experienceSession?.token ?? null;
    const transcriptEntries = voiceTranscript.map((entry) => ({ ...entry }));
    let succeeded = false;

    setIsSubmittingPhone(true);
    setDelegationError(null);
    setDelegationStatus("preparing_brief");
    setPhase("submitting_handoff");

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
        conversationSummary: [offer && `The visitor is building or selling ${offer}.`, buyer && `The likely customer is ${buyer}.`].filter(Boolean).join(" ") || null,
        relevantDetail: (() => {
          const insights = analyzeConversationInsights(transcriptEntries).insights;
          return insights.challenge ?? insights.opportunity ?? (insights.goal ? `their goal of improving ${insights.goal}` : null);
        })(),
      }, fetch, (stage) => {
        console.info("[public-experience]", { event: stage, stage });
        if (stage === "finalize_started") setPhase("finalizing");
        if (stage === "dispatch_started") {
          setDelegationStatus("dispatching_call");
          setPhase("dispatching_call");
        }
      });
      succeeded = true;
      handoffCompletedRef.current = true;
      setDelegationStatus(handoff.dispatchStatus === "call_dispatched" ? "call_requested" : handoff.dispatchStatus);
      setPhase("waiting_for_call");
      setDispatchRecord((current) => current ? {
        ...current,
        status: "calling",
        updated_at: new Date().toISOString(),
      } : current);
    } catch (error) {
      const handoffError = error instanceof PublicExperienceHandoffError ? error : null;
      const message = handoffError?.message ?? "The call request failed. Please try again.";
      console.info("[public-experience]", { event: "handoff_failed", stage: handoffError?.stage ?? "unknown" });
      setDelegationStatus("failed");
      setDelegationError(message);
      setDispatchRecord((current) => current ? {
        ...current,
        status: "failed",
        updated_at: new Date().toISOString(),
      } : current);
      setPhase("handoff_error");
    } finally {
      if (!succeeded) releasePublicExperienceAction(handoffInFlightRef);
      setIsSubmittingPhone(false);
    }
  };

  const handlePhoneSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (handoffInFlightRef.current || handoffCompletedRef.current || !phoneNumber.trim()) return;

    const normalizedPhone = normalizePublicExperiencePhone(phoneNumber);
    if (!normalizedPhone) {
      alert("I may be missing part of that number. Could you check it for me?");
      return;
    }

    if (!identityResolvedRef.current || !identityRef.current?.name) {
      setDelegationError("Identity confirmation is incomplete. Reconnect with Zeya to continue.");
      return;
    }

    void submitExperienceHandoff(identityRef.current.name, identityRef.current.offer, identityRef.current.buyer);
  };

  const handleCallRetry = () => {
    if (handoffInFlightRef.current || handoffCompletedRef.current) return;
    setIsSubmittingPhone(false);
    setPhase("collecting_phone");
  };

  const handleReconnect = () => {
    console.info("[public-experience]", { event: "experience_reset", stage: "visitor_reconnect" });
    resetConversation();
    controllerRef.current = null;
    handoffInFlightRef.current = false;
    handoffCompletedRef.current = false;
    identityResolvedRef.current = false;
    identityRef.current = null;
    sessionStorage.removeItem("lastProcessedTranscriptId");
    setIsSubmittingPhone(false);
    setPhase("initial");
  };

  const resolveNameAndResume = (authoritativeName: string | null) => {
    if (authoritativeName) {
      identityResolvedRef.current = true;
      setNameConfirmation({ asking: false });
      setExtractedName(authoritativeName);
      identityRef.current = { ...(identityRef.current ?? { offer: null, buyer: null }), name: authoritativeName };
      void controllerRef.current?.advanceBeat(authoritativeName);
    } else {
      setDelegationError("Enter the name you would like me to use.");
    }
  };

  const handleNameConfirm = (confirmed: boolean) => {
    if (!nameConfirmation.asking || identityResolvedRef.current) return;
    resolveNameAndResume(confirmed ? extractedName : normalizeCorrectedPublicExperienceName(correctedName));
  };

  const startNameCorrectionVoice = () => {
    type Recognition = {
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      start: () => void;
      onresult: ((event: { results: ArrayLike<{ 0?: { transcript?: string } }> }) => void) | null;
      onerror: (() => void) | null;
    };
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => Recognition;
      webkitSpeechRecognition?: new () => Recognition;
    };
    const RecognitionConstructor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
    if (!RecognitionConstructor) {
      setDelegationError("Voice correction is not available in this browser. Type the correction instead.");
      return;
    }
    const recognition = new RecognitionConstructor();
    recognition.lang = navigator.language || "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const spoken = event.results[0]?.[0]?.transcript?.trim();
      if (!spoken) return;
      const reply = resolvePublicExperienceNameReply(spoken, extractedName ?? "");
      if (reply.resolvedName) resolveNameAndResume(reply.resolvedName);
      else if (!reply.rejected) setCorrectedName(spoken);
    };
    recognition.onerror = () => setDelegationError("I could not hear that correction. Type it below instead.");
    recognition.start();
  };

  const recordBriefResponse = async (responseType: RepresentationBriefResponseType, responseText = "") => {
    const token=experienceSession?.token,briefId=representationBrief?.id;if(!token||!briefId)return false;
    const key=briefResponseKeysRef.current[`${responseType}:${responseText}`]??crypto.randomUUID();
    briefResponseKeysRef.current[`${responseType}:${responseText}`]=key;setBriefResponsePending(true);setBriefResponseError(null);
    try{const response=await fetch("/api/experience/session/reflection/response",{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({briefId,requestKey:key,responseType,responseText})});if(!response.ok)throw new Error("response_not_recorded");setBriefResponse(responseType);return true;}catch{setBriefResponseError("I couldn’t save that adjustment yet. Your conversation is still preserved.");return false;}finally{setBriefResponsePending(false);}
  };

  // Process each final visitor turn exactly once. The greeting beat pauses here
  // when identity needs confirmation; only resolution advances to PRODUCT.
  useEffect(() => {
    if (phase !== "voice_active" || !controllerRef.current?.beatStartedAt) return;
    const latest = voiceTranscript.filter((entry) => entry.role === "user" && entry.isFinal && entry.text.trim()).at(-1);
    if (!latest || sessionStorage.getItem("lastProcessedTranscriptId") === latest.id) return;
    sessionStorage.setItem("lastProcessedTranscriptId", latest.id);
    const timer = window.setTimeout(() => {
      const controller = controllerRef.current;
      if (!controller) return;
      if (nameConfirmation.asking) {
        if (identityResolvedRef.current || !extractedName) return;
        const reply = resolvePublicExperienceNameReply(latest.text, extractedName);
        if (reply.resolvedName) resolveNameAndResume(reply.resolvedName);
        else if (reply.rejected) setCorrectedName("");
        else setCorrectedName(latest.text);
        return;
      }
      if (controller.currentBeat === ExperienceBeat.GREETING) {
        if (identityResolvedRef.current) return;
        const decision = analyzePublicExperienceNameResponse(latest.text);
        if (!decision.name) return;
        identityRef.current = { name: decision.name, offer: null, buyer: null };
        if (decision.needsConfirmation) {
          setExtractedName(decision.name);
          setCorrectedName("");
          setDelegationError(null);
          setNameConfirmation({ asking: true, name: decision.name });
          void speakExact?.(`I heard “${decision.name}.” Is that right?`);
          return;
        }
        resolveNameAndResume(decision.name);
        return;
      }
      if (controller.currentBeat === ExperienceBeat.PRODUCT) {
        identityRef.current = { ...(identityRef.current ?? { name: null, buyer: null }), offer: latest.text.trim() };
      } else if (controller.currentBeat === ExperienceBeat.CUSTOMER) {
        identityRef.current = { ...(identityRef.current ?? { name: null, offer: null }), buyer: latest.text.trim() };
      }
      void controller.advanceBeat(latest.text.trim());
    }, 0);
    return () => window.clearTimeout(timer);
  // Transcript arrival is the trigger; callbacks intentionally read the current refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameConfirmation.asking, phase, voiceTranscript]);

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
              {nameConfirmation.asking && (
                <div className="mx-auto mt-6 max-w-md space-y-4 rounded border border-zeya-taupe/20 p-5">
                  <p className="font-serif text-lg text-zeya-ivory">
                    I heard “{nameConfirmation.name}.” Is that right?
                  </p>
                  <p className="text-sm text-zeya-taupe">Confirm by voice, or type the correction.</p>
                  <button type="button" onClick={startNameCorrectionVoice} className="w-full border border-zeya-taupe/30 px-4 py-2 text-sm text-zeya-ivory">
                    Answer by voice
                  </button>
                  <input
                    type="text"
                    value={correctedName}
                    onChange={(event) => setCorrectedName(event.target.value)}
                    placeholder="Correct name"
                    autoComplete="name"
                    className="w-full bg-transparent border-b border-zeya-hush/30 py-3 text-zeya-ivory placeholder-zeya-hush/40 focus:border-zeya-champagne focus:outline-none"
                  />
                  {delegationError && <p className="text-xs text-red-300/80" role="alert">{delegationError}</p>}
                  <div className="flex gap-3">
                    <button type="button" onClick={() => handleNameConfirm(true)} className="flex-1 border border-zeya-champagne/60 px-4 py-3 text-sm text-zeya-champagne">
                      That&apos;s Correct
                    </button>
                    <button type="button" onClick={() => handleNameConfirm(false)} disabled={!correctedName.trim()} className="flex-1 border border-zeya-taupe/30 px-4 py-3 text-sm text-zeya-ivory disabled:opacity-50">
                      Use Corrected Name
                    </button>
                  </div>
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

      {(phase === "submitting_handoff" || phase === "finalizing" || phase === "dispatching_call") && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <PresenceCore state="idle" />
          <div className="mt-8 max-w-md space-y-3 text-center" role="status" aria-live="polite">
            <p className="font-serif text-lg text-zeya-ivory">
              {phase === "dispatching_call" ? "Connecting your call…" : "Confirming your handoff…"}
            </p>
            <p className="text-sm text-zeya-taupe">Keep this page open.</p>
          </div>
        </div>
      )}

      {phase === "handoff_error" && (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <PresenceCore state="idle" />
          <div className="mt-8 max-w-md space-y-5 text-center">
            <p className="font-serif text-lg text-zeya-ivory">The handoff could not be completed.</p>
            <p className="text-sm text-red-300/80" role="alert">{delegationError}</p>
            <button type="button" onClick={handleCallRetry} className="border border-zeya-taupe/40 px-5 py-3 text-sm text-zeya-ivory">
              Try the handoff again
            </button>
          </div>
        </div>
      )}

      {phase === "waiting_for_call" && (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          {durableCallStatus === "reviewing_what_was_learned" ? (
            <div className="w-full max-w-md space-y-4 text-center" role="status" aria-live="polite">
              <PresenceCore state="idle" />
              <p className="font-serif text-xl text-zeya-ivory">Welcome back.</p>
              <p className="text-sm text-zeya-taupe">Veya has returned the conversation to me.</p>
              <p className="text-sm text-zeya-taupe animate-pulse">I’m organizing what we learned…</p>
            </div>
          ) : durableCallStatus === "recoverable_reflection_failure" ? (
            <div className="w-full max-w-md space-y-5 text-center">
              <PresenceCore state="idle" />
              <p className="font-serif text-lg text-zeya-ivory">I couldn’t finish preparing the initial Representation.</p>
              <p className="text-sm text-zeya-taupe">Your completed browser conversation is still preserved. You can retry without repeating it.</p>
              <button type="button" onClick={()=>{setPhase("dispatching_call");window.setTimeout(()=>setPhase("waiting_for_call"),0);}} className="border border-zeya-taupe/40 px-5 py-3 text-sm text-zeya-ivory">Try preparing it again</button>
            </div>
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
                  {delegationStatus === "failed" ? (
                    <>
                      <p className="font-serif text-lg text-red-400/80 font-light" style={{ letterSpacing: "0.06em" }}>
                        The call request could not be placed.
                      </p>
                      <p className="text-sm font-light text-zeya-taupe">
                        {delegationError || "Please try again or reconnect with me."}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-serif text-lg text-zeya-ivory font-light" style={{ letterSpacing: "0.06em", lineHeight: "1.6" }}>
                        Veya is calling you now.
                      </p>
                      <p className="text-sm font-light text-zeya-taupe">
                        Keep this page open.
                      </p>
                    </>
                  )}
                </div>
              </div>

              {delegationStatus !== "failed" && (
                <div className="space-y-3 rounded border border-zeya-taupe/20 px-4 py-4">
                  <p className="text-xs font-light text-zeya-taupe/70 mb-2">
                    What’s happening:
                  </p>
                  <div className="flex items-start gap-3 text-sm font-light">
                    <span className="flex h-5 w-5 min-w-5 items-center justify-center rounded-full border border-zeya-champagne/50 text-[0.65rem] text-zeya-champagne">
                      •
                    </span>
                    <span className="text-zeya-champagne pt-0.5">
                      {["preparing_brief", "call_requested", "correlation_pending", "dispatch_resolution_pending"].includes(delegationStatus) ? "Veya is being briefed on our conversation." : "Your call is being connected."}
                    </span>
                  </div>
                  <div className="flex items-start gap-3 text-sm font-light">
                    <span className="flex h-5 w-5 min-w-5 items-center justify-center rounded-full border border-zeya-taupe/30">
                      {durableCallStatus === "call_in_progress" ? (
                        <span className="text-[0.65rem] text-zeya-champagne">•</span>
                      ) : (
                        <span className="h-1.5 w-1.5 rounded-full bg-zeya-taupe/25" />
                      )}
                    </span>
                    <span className={durableCallStatus === "call_in_progress" ? "text-zeya-ivory pt-0.5" : "text-zeya-taupe/60 pt-0.5"}>
                      {durableCallStatus === "call_in_progress" ? "You’re on the call." : "Waiting for your call."}
                    </span>
                  </div>
                </div>
              )}

              {delegationStatus !== "failed" && (
                <div className="text-center space-y-3">
                  <div className="inline-flex items-center gap-2 rounded-full border border-zeya-taupe/20 px-3 py-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-zeya-taupe/50" />
                    <span className="text-[0.65rem] uppercase tracking-[0.12em] text-zeya-taupe/70">
                      Microphone paused
                    </span>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={handleCallRetry}
                  className="w-full border border-zeya-taupe/40 px-4 py-3 text-sm font-light text-zeya-ivory transition-colors hover:border-zeya-champagne hover:text-zeya-champagne"
                >
                  {delegationStatus === "failed" ? "Try again" : "I did not get the call"}
                </button>
                <button
                  type="button"
                  onClick={handleReconnect}
                  className="w-full border border-zeya-taupe/20 px-4 py-3 text-sm font-light text-zeya-taupe transition-colors hover:border-zeya-champagne hover:text-zeya-champagne"
                >
                  Reconnect with me
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {phase === "brief_review" && representationBrief ? (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          <div className="w-full max-w-lg space-y-8" role="status" aria-live="polite">
            <div className="space-y-6">
              <div className="space-y-2">
                <p className="font-serif text-lg text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                  This is how I currently understand your business.
                </p>
              </div>

              <div className="space-y-4 rounded border border-zeya-taupe/20 px-5 py-4 text-left">
                <div className="space-y-2">
                  <p className="text-sm text-zeya-ivory leading-relaxed">
                    {representationBrief.whatIHeard}
                  </p>
                </div>

                <div className="h-px bg-zeya-taupe/10" />

                <div className="space-y-2">
                  <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">What stood out</p>
                  <p className="text-sm text-zeya-ivory leading-relaxed">
                    {representationBrief.whatStoodOut}
                  </p>
                </div>

                <div className="h-px bg-zeya-taupe/10" />

                <div className="space-y-2">
                  <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">What that may mean</p>
                  <p className="text-sm text-zeya-ivory leading-relaxed">
                    {representationBrief.whatThatMayMean}
                  </p>
                </div>

                <div className="h-px bg-zeya-taupe/10" />

                <div className="space-y-2">
                  <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">Where I would begin</p>
                  <p className="text-sm text-zeya-ivory leading-relaxed">
                    {representationBrief.whereIWouldBegin}
                  </p>
                </div>
              </div>

              <div className="space-y-4 pt-2">
                <p className="text-sm text-zeya-ivory text-center italic">
                  {representationBrief.alignmentQuestion}
                </p>

                <div className="space-y-2">
                  <button
                    onClick={() => {void recordBriefResponse("confirm");setPhase("hiring_decision");}}
                    className="w-full border border-zeya-champagne/60 px-4 py-3 text-sm text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors"
                  >
                    Yes, that&apos;s right.
                  </button>
                  <button
                    onClick={() => setPhase("calibration")}
                    className="w-full border border-zeya-taupe/30 px-4 py-3 text-sm text-zeya-ivory hover:border-zeya-champagne hover:text-zeya-champagne transition-colors"
                  >
                    Close, but let me adjust something.
                  </button>
                  <button
                    onClick={() => setPhase("brief_review")}
                    className="w-full border border-zeya-taupe/20 px-4 py-3 text-sm text-zeya-taupe hover:border-zeya-champagne hover:text-zeya-champagne transition-colors"
                  >
                    Let me think about this.
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : phase === "calibration" && representationBrief ? (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          <div className="w-full max-w-lg space-y-6">
            <div className="space-y-3">
              <p className="font-serif text-lg text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                What would you adjust?
              </p>
              <p className="text-sm text-zeya-taupe">Tell me what I missed or what matters more than I understood.</p>
            </div>

            <form onSubmit={(e) => {e.preventDefault();void (async()=>{if(await recordBriefResponse("refine",calibrationText.trim()))setPhase("hiring_decision");})();}} className="space-y-4">
              <textarea
                value={calibrationText}
                onChange={(e) => setCalibrationText(e.target.value)}
                maxLength={800}
                autoFocus
                placeholder="What should I know?"
                className="w-full min-h-32 border border-zeya-taupe/30 bg-transparent p-4 text-sm text-zeya-ivory placeholder-zeya-hush/40 focus:border-zeya-champagne focus:outline-none"
              />
              <button
                type="submit"
                disabled={calibrationPending || !calibrationText.trim()}
                className="w-full border border-zeya-champagne/60 px-4 py-3 text-sm text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors disabled:opacity-50"
              >
                I understand. Continue.
              </button>
              {briefResponseError&&<p className="text-xs text-red-300/80" role="alert">{briefResponseError}</p>}
            </form>
          </div>
        </div>
      ) : phase === "hiring_decision" ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <div className="w-full max-w-lg space-y-8">
            <div className="space-y-3">
              <p className="font-serif text-2xl text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                What this could become
              </p>
              <p className="text-sm text-zeya-taupe leading-relaxed">Based on this first brief, Zeya could help open and maintain informed conversations with suitable prospects, while keeping your expertise central. Would you like to explore what hiring Zeya would look like?</p>
            </div>

            <div className="space-y-3">
              <button
                onClick={() => setPhase("identity_confirmation")}
                className="w-full border border-zeya-champagne/60 px-6 py-4 text-sm text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors font-light"
                style={{letterSpacing:"0.06em"}}
              >
                Explore what hiring Zeya looks like
              </button>
              <button
                onClick={() => setPhase("initial")}
                className="w-full border border-zeya-taupe/20 px-6 py-4 text-sm text-zeya-taupe hover:border-zeya-champagne hover:text-zeya-champagne transition-colors font-light"
                style={{letterSpacing:"0.06em"}}
              >
                Not right now. I need to think about this.
              </button>
            </div>
          </div>
        </div>
      ) : phase === "identity_confirmation" ? (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          <div className="w-full max-w-lg space-y-6">
            <div className="space-y-2">
              <p className="font-serif text-lg text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                Who am I representing?
              </p>
              <p className="text-sm text-zeya-taupe">Just the basics for the record.</p>
            </div>

            <form onSubmit={(e) => {e.preventDefault(); if(extractedName && businessName && businessEmail) setPhase("living_representation");}} className="space-y-4">
              <div className="space-y-2">
                <label className="block text-xs text-zeya-taupe/70 uppercase tracking-wider">Your name</label>
                <input
                  type="text"
                  value={extractedName || ""}
                  disabled
                  className="w-full border-b border-zeya-taupe/30 bg-transparent py-2 text-sm text-zeya-ivory/60 opacity-60"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-zeya-taupe/70 uppercase tracking-wider">Business name</label>
                <input
                  type="text"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="Your business"
                  autoComplete="organization"
                  className="w-full border-b border-zeya-taupe/30 bg-transparent py-2 text-sm text-zeya-ivory placeholder-zeya-hush/40 focus:border-zeya-champagne focus:outline-none"
                />
              </div>

              <div className="space-y-2">
                <label className="block text-xs text-zeya-taupe/70 uppercase tracking-wider">Email</label>
                <input
                  type="email"
                  value={businessEmail}
                  onChange={(e) => setBusinessEmail(e.target.value)}
                  placeholder="you@business.com"
                  autoComplete="email"
                  className="w-full border-b border-zeya-taupe/30 bg-transparent py-2 text-sm text-zeya-ivory placeholder-zeya-hush/40 focus:border-zeya-champagne focus:outline-none"
                />
              </div>

              <p className="text-xs text-zeya-taupe/50 pt-2">This won’t be public. It’s just for our records.</p>

              <button
                type="submit"
                disabled={!businessName.trim() || !businessEmail.trim()}
                className="w-full border border-zeya-champagne/60 px-4 py-3 text-sm text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors disabled:opacity-50 mt-4"
              >
                Confirm and continue
              </button>
            </form>
          </div>
        </div>
      ) : phase === "living_representation" && representationBrief ? (
        <div className="flex-1 flex flex-col overflow-y-auto px-6 py-8">
          <div className="w-full max-w-lg mx-auto space-y-8">
            <div className="space-y-3">
              <p className="font-serif text-lg text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                My understanding of {businessName}
              </p>
              <p className="text-xs text-zeya-taupe/70">This is the foundation. We’ll refine it together.</p>
            </div>

            <div className="space-y-4 rounded border border-zeya-taupe/20 px-5 py-4">
              <div className="space-y-2">
                <p className="text-sm text-zeya-ivory leading-relaxed">
                  {representationBrief.whatIHeard}
                </p>
              </div>

              <div className="h-px bg-zeya-taupe/10" />

              <div className="space-y-2">
                <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">What stood out</p>
                <p className="text-sm text-zeya-ivory leading-relaxed">
                  {representationBrief.whatStoodOut}
                </p>
              </div>

              <div className="h-px bg-zeya-taupe/10" />

              <div className="space-y-2">
                <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">Where I would begin</p>
                <p className="text-sm text-zeya-ivory leading-relaxed">
                  {representationBrief.whereIWouldBegin}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-sm text-zeya-ivory">Still refining my understanding</p>
              </div>
            </div>

            <div className="border-t border-zeya-taupe/10 pt-6 space-y-3">
              <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">What’s next</p>
              <p className="text-sm text-zeya-ivory leading-relaxed">
                I’ll learn from every conversation. You’ll see every proposal I want to make. Nothing changes without your approval.
              </p>
              <button
                onClick={() => setPhase("completed")}
                className="w-full border border-zeya-champagne/60 px-6 py-4 text-sm text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors font-light mt-4"
                style={{letterSpacing:"0.06em"}}
              >
                I understand. Return home.
              </button>
            </div>
          </div>
        </div>
      ) : phase === "completed" && representationBrief ? (
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-6 py-8">
          <div className="w-full max-w-lg space-y-8">
            <div className="space-y-4">
              <p className="font-serif text-2xl text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                Your initial Representation is ready.
              </p>
              <p className="text-sm text-zeya-taupe leading-relaxed">
                Here is my current understanding:
              </p>
            </div>

            <div className="space-y-4 rounded border border-zeya-taupe/20 px-5 py-4 text-left">
              <div className="space-y-2">
                <p className="text-sm text-zeya-ivory leading-relaxed">
                  {representationBrief.whatIHeard}
                </p>
              </div>
              <div className="h-px bg-zeya-taupe/10" />
              <div className="space-y-2">
                <p className="text-xs text-zeya-taupe/70 uppercase tracking-wider">What stood out</p>
                <p className="text-sm text-zeya-ivory leading-relaxed">
                  {representationBrief.whatStoodOut}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-center">
              <p className="text-sm text-zeya-taupe">What would you like to do next?</p>
              <button
                onClick={() => setPhase("initial")}
                className="w-full border border-zeya-taupe/30 px-6 py-3 text-sm text-zeya-ivory hover:border-zeya-champagne hover:text-zeya-champagne transition-colors font-light"
              >
                Return home
              </button>
            </div>
          </div>
        </div>
      ) : (phase === "brief_review" || phase === "completed") && briefClarification ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 py-8">
          <div className="w-full max-w-lg space-y-6 text-center">
            <div className="space-y-3">
              <p className="font-serif text-xl text-zeya-ivory font-light" style={{letterSpacing:"0.08em"}}>
                {briefClarification.message}
              </p>
            </div>
            <div className="space-y-4 rounded border border-zeya-taupe/20 px-5 py-4">
              <p className="text-sm text-zeya-champagne leading-relaxed">
                {briefClarification.question}
              </p>
              <p className="text-xs text-zeya-taupe">
                Nothing has been invented beyond what you shared.
              </p>
            </div>
            <button
              onClick={() => setPhase("initial")}
              className="w-full border border-zeya-taupe/30 px-6 py-3 text-sm text-zeya-ivory hover:border-zeya-champagne hover:text-zeya-champagne transition-colors font-light"
            >
              Return to start
            </button>
          </div>
        </div>
      ) : phase === "completed" ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="w-full max-w-lg space-y-7 text-center" role="status" aria-live="polite">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zeya-champagne/60 text-xl text-zeya-champagne">✓</div>
            <div className="space-y-4">
              <p className="font-serif text-2xl text-zeya-ivory">Phone conversation completed.</p>
              <p className="text-sm leading-7 text-zeya-taupe">You have just experienced Business Representation Intelligence.</p>
              <p className="font-serif text-xl leading-8 text-zeya-champagne">One conversation became two.</p>
              {callOutcome?.visitorInterest === "interested" && <p className="text-sm leading-7 text-zeya-ivory">It sounds like you&apos;d like to explore what comes next.</p>}
              {callOutcome?.visitorInterest === "uncertain" && <p className="text-sm leading-7 text-zeya-ivory">You&apos;ve experienced how an informed conversation can continue naturally.</p>}
              {callOutcome?.visitorInterest === "not_interested" && <p className="text-sm leading-7 text-zeya-ivory">Thank you for trying the experience.</p>}
              {callOutcome?.relevantVisitorResponse && <p className="text-xs leading-6 text-zeya-taupe/80">Veya heard: &ldquo;{callOutcome.relevantVisitorResponse}&rdquo;</p>}
              <p className="text-sm leading-7 text-zeya-taupe">Imagine what happens when that becomes hundreds.</p>
            </div>
            <Link href="/" className="inline-block border border-zeya-champagne/60 px-6 py-3 text-sm text-zeya-champagne transition-colors hover:bg-zeya-champagne/5">
              Learn more
            </Link>
          </div>
        </div>
      ) : null}
    </main>
  );
}
