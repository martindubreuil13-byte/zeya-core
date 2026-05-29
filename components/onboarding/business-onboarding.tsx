"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import {
  type BusinessMemory,
  buildConversationalSummary,
  emptyBusinessMemory,
} from "@/lib/memory/extract-business-memory";
import {
  appendMemoryEvent,
  appendMessage,
  createSession,
  getBusinessProfile,
  getLatestSession,
  getSessionMessages,
  initBusinessProfile,
  setMemorySummary,
  updateBusinessProfile,
  updateSessionSummary,
} from "@/lib/supabase/business-memory";
import { buildResumePrompt } from "@/lib/onboarding/onboarding-prompt";
import { useOnboardingVoiceConversation } from "@/hooks/voice/useOnboardingVoiceConversation";
import { PresenceCore } from "@/components/presence";
import { VoiceButton } from "@/components/voice/VoiceButton";
import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "loading" | "question" | "summary" | "confirmed" | "handoff";
export type ReadinessLevel = "learning" | "aligning" | "ready";

type OnboardingPhase =
  | "understand_business"
  | "understand_customer"
  | "understand_sales_angle"
  | "understand_objections"
  | "understand_tone"
  | "memory_test"
  | "complete";

interface ChatEntry {
  id: string;
  role: "zeya" | "user";
  text: string;
  variant?: "intro" | "thinking";
}

interface BrainResponse {
  reply: string;
  memory_patch: Partial<BusinessMemory>;
  needs_clarification: boolean;
  next_focus: string;
  readiness_level: ReadinessLevel;
  onboarding_phase: OnboardingPhase;
  is_complete: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VOICE_STATUS_LABEL: Partial<Record<VoiceState, string>> = {
  connecting: "Connecting…",
  listening: "Listening…",
  thinking: "Processing…",
  processing: "Processing…",
  speaking: "Speaking…",
  interrupted: "Listening…",
};

const REALTIME_DEBUG = process.env.NEXT_PUBLIC_REALTIME_DEBUG === "true";

const REALTIME_FIRST_PROMPT =
  'Say exactly: "Hi, I\'m Zeya. I\'ll be your sales development executive — my job is to help you sell your product or service. Let\'s start: what would you like us to focus on?"';

// ─── Animation ────────────────────────────────────────────────────────────────

const EASE = [0.22, 1, 0.36, 1] as const;

const msgVariants: import("framer-motion").Variants = {
  hidden: { opacity: 0, y: 14, filter: "blur(12px)" },
  visible: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: 0.9, ease: EASE },
  },
  exit: {
    opacity: 0,
    y: -8,
    filter: "blur(8px)",
    transition: { duration: 0.45, ease: EASE },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFirstName(email: string | undefined): string | null {
  if (!email) return null;
  const local = email.split("@")[0];
  if (!local || local.length < 2 || /^\d+$/.test(local)) return null;
  const candidate = local.split(/[._-]/)[0];
  if (!candidate || candidate.length < 2) return null;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}

function hasNonEmptyValue(obj: Record<string, unknown>): boolean {
  return Object.values(obj).some((v) =>
    typeof v === "string" ? v.trim().length > 0 : v !== null && v !== undefined,
  );
}

// ─── Handoff insight ─────────────────────────────────────────────────────────
// Derives one synthesized sentence from captured memory for the bridge screen.
// Returns null when context is too thin — the screen degrades gracefully.

function buildHandoffInsight(memory: BusinessMemory): string | null {
  const offer    = memory.offer?.trim() ?? "";
  const audience = memory.target_customers?.trim() ?? "";
  if (offer && audience) {
    return `The offer is aimed at ${audience.toLowerCase()} — that's enough to begin the first contact sequence.`;
  }
  if (offer) return "The core offer is established. That's the anchor everything else builds from.";
  if (audience) return "The audience is defined. Positioning for that segment is the next layer.";
  return null;
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  existingBusinessId: string | null;
  onComplete: () => void;
}

export function BusinessOnboarding({ existingBusinessId, onComplete }: Props) {
  const { user, session } = useAuth();
  const voice = useOnboardingVoiceConversation();
  const { state: voiceState, transcript: voiceTranscript, isConfigured, startConversation, stopConversation } = voice;
  const isRealtimeVoice = voice.provider === "openai-realtime";

  const [phase, setPhase] = useState<Phase>("loading");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [memory, setMemory] = useState<BusinessMemory>(emptyBusinessMemory());
  const [readiness, setReadiness] = useState<ReadinessLevel>("learning");
  const [onboardingPhase, setOnboardingPhase] = useState<OnboardingPhase>("understand_business");
  const [businessId, setBusinessId] = useState<string | null>(existingBusinessId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [ttsSpeaking, setTtsSpeaking] = useState(false);
  const [callLogOpen, setCallLogOpen] = useState(false);
  const [callLogEntries, setCallLogEntries] = useState<VoiceTranscriptEntry[]>([]);
  const [handoffReady, setHandoffReady] = useState(false);
  const [realtimeCallEnded, setRealtimeCallEnded] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const chatRef = useRef<ChatEntry[]>([]);
  const memoryRef = useRef<BusinessMemory>(emptyBusinessMemory());
  const readinessRef = useRef<ReadinessLevel>("learning");
  const onboardingPhaseRef = useRef<OnboardingPhase>("understand_business");
  const lastVoiceEntryIdRef = useRef<string | null>(null);
  const lastRealtimeEntryIdRef = useRef<string | null>(null);
  const fullTranscriptRef = useRef<VoiceTranscriptEntry[]>([]);
  const ttsSpeakingRef = useRef(false);
  const phaseRef = useRef<Phase>("loading");
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const realtimeInitialPromptRef = useRef(REALTIME_FIRST_PROMPT);
  const realtimeHasStartedRef = useRef(false);
  const wasRealtimeActiveRef = useRef(false);

  useEffect(() => { chatRef.current = chat; }, [chat]);
  useEffect(() => { memoryRef.current = memory; }, [memory]);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  useEffect(() => { onboardingPhaseRef.current = onboardingPhase; }, [onboardingPhase]);
  useEffect(() => { ttsSpeakingRef.current = ttsSpeaking; }, [ttsSpeaking]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // ── Voice display state ───────────────────────────────────────────────────────

  const voiceDisplayState: VoiceState = ttsSpeaking
    ? "speaking"
    : sending
      ? "thinking"
      : voiceState;
  const realtimeVoiceActive =
    isRealtimeVoice &&
    ["connecting", "listening", "thinking", "speaking", "interrupted", "processing"].includes(
      voiceDisplayState,
    );

  // ── Message helpers ──────────────────────────────────────────────────────────

  const addMessage = useCallback(
    (role: ChatEntry["role"], text: string, variant?: ChatEntry["variant"]) => {
      const entry: ChatEntry = { id: crypto.randomUUID(), role, text, variant };
      setChat((prev) => [...prev, entry]);
      return entry;
    },
    [],
  );

  const removeMessage = useCallback((id: string) => {
    setChat((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const delayedZeya = useCallback(
    (text: string, delayMs = 640, variant?: ChatEntry["variant"]) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          addMessage("zeya", text, variant);
          resolve();
        }, delayMs);
      }),
    [addMessage],
  );

  // ── Textarea auto-grow ────────────────────────────────────────────────────────

  function growTextarea(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (!inputValue && inputRef.current) {
      inputRef.current.style.height = "";
    }
  }, [inputValue]);

  // ── TTS ───────────────────────────────────────────────────────────────────────
  //
  // Session recycling: ElevenLabs session is stopped before each callBrain() so
  // the ConvAI agent never generates its own audio response. speakReplyTTS()
  // restarts listening in its finally block — this is the conversational loop.
  //
  // setTtsSpeaking(true) is delayed until the audio blob is ready (not at fetch
  // start) so the "thinking" state is visible for the full latency window, and
  // speech/text display feel concurrent rather than sequential.

  const speakReplyTTS = useCallback(
    async (text: string) => {
      if (isRealtimeVoice) return;
      if (!isConfigured) return;
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
      try {
        const res = await fetch("/api/elevenlabs/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok || !res.body) return;
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        currentAudioRef.current = audio;
        // Set speaking only when audio is about to play, so the full TTS fetch
        // latency window shows as "thinking" rather than an invisible wait
        setTtsSpeaking(true);
        await new Promise<void>((resolve) => {
          audio.onended = () => { currentAudioRef.current = null; resolve(); };
          audio.onerror = () => { currentAudioRef.current = null; resolve(); };
          void audio.play();
        });
        URL.revokeObjectURL(url);
      } catch {
        // text already shown — silent failure is acceptable
      } finally {
        setTtsSpeaking(false);
        // Auto-restart listening after every TTS (the conversational loop)
        if (phaseRef.current === "loading" || phaseRef.current === "question") {
          void startConversation();
        }
      }
    },
    [isConfigured, isRealtimeVoice, startConversation],
  );

  // ── Init ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        let bid = existingBusinessId;
        let isRealResume = false;
        let resumeBusinessName: string | null = null;
        let recentMessages: { role: string; content: string }[] = [];

        if (!bid) {
          const business = await initBusinessProfile(user!.id);
          bid = business.id as string;
          setBusinessId(bid);
        } else {
          const existing = await getBusinessProfile(user!.id);

          // A real resume requires actual onboarding progress — not just a row
          // existing. Check top-level columns, JSONB profile fields, and whether
          // the summary was written (onboarding completed at some point).
          const rawProfile = existing?.business_profile as Record<string, unknown> | null;
          const memorySummary = existing?.memory_summary as string | null | undefined;

          if (rawProfile) {
            const profile = rawProfile as unknown as BusinessMemory;
            setMemory(profile);
            memoryRef.current = profile;
          }

          resumeBusinessName =
            typeof existing?.business_name === "string" ? existing.business_name : null;

          const hasMeaningfulProfile = rawProfile ? hasNonEmptyValue(rawProfile) : false;
          const hasTopLevelFields =
            typeof existing?.business_name === "string"
              ? existing.business_name.trim().length > 0
              : false ||
                (typeof existing?.industry === "string"
                  ? existing.industry.trim().length > 0
                  : false);
          const hasCompletedOnboarding =
            typeof memorySummary === "string" && memorySummary.trim().length > 0;

          isRealResume = hasMeaningfulProfile || hasTopLevelFields || hasCompletedOnboarding;

          // For realtime: also detect resume from message history even if profile is empty
          if (isRealtimeVoice) {
            const latestSession = await getLatestSession(bid);
            if (latestSession) {
              recentMessages = await getSessionMessages(latestSession.id, 20);
              if (!isRealResume && recentMessages.length > 0) isRealResume = true;
            }
          }
        }

        const session = await createSession(bid, "onboarding");
        setSessionId(session.id as string);

        if (isRealtimeVoice) {
          realtimeInitialPromptRef.current = isRealResume
            ? buildResumePrompt({
                businessName: resumeBusinessName,
                profile: memoryRef.current,
                recentMessages,
              })
            : REALTIME_FIRST_PROMPT;
        } else if (isRealResume) {
          await delayedZeya("Good to have you back.", 500);
          await delayedZeya(
            "Let me review what I have on the business before we continue.",
            1400,
          );
          await delayedZeya("What would you like to add or correct?", 2600);
          void startConversation();
        } else {
          const firstName = extractFirstName(user!.email);
          const greeting = firstName ? `Hi, ${firstName}.\nI'm Zeya.` : "Hi.\nI'm Zeya.";

          // Greeting TTS fires concurrently with text display.
          // speakReplyTTS.finally will open the mic when audio ends.
          const greetingForTTS = [
            firstName ? `Hi, ${firstName}. I'm Zeya.` : "Hi. I'm Zeya.",
            "I'll be your sales development executive.",
            "My job is simple: help you sell your product or service.",
            "I need to understand what we're selling, who should buy it, and what the market still needs to teach us.",
            "Let's start. What product or service would you like us to focus on?",
          ].join(" ");
          void speakReplyTTS(greetingForTTS);

          await delayedZeya(greeting, 500, "intro");
          await delayedZeya(
            "I'll be your sales development executive.",
            2000,
          );
          await delayedZeya(
            "My job is simple: help you sell your product or service. I need to understand what we're selling, who should buy it, and what the market still needs to teach us.",
            3200,
          );
          await delayedZeya(
            "Let's start. What product or service would you like us to focus on?",
            5600,
          );
        }

        setPhase("question");
      } catch (err) {
        console.error("[Zeya] onboarding init failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        await delayedZeya(`Something went quiet. Refresh and try again.\n\n${msg}`, 400);
      }
    }

    void init();
  }, [user, existingBusinessId, delayedZeya, isRealtimeVoice, speakReplyTTS, startConversation]);

  const startVoiceFirstConversation = useCallback(() => {
    if (!isRealtimeVoice) {
      void startConversation();
      return;
    }

    const prompt = realtimeHasStartedRef.current ? undefined : realtimeInitialPromptRef.current;
    realtimeHasStartedRef.current = true;
    void startConversation(prompt);
  }, [isRealtimeVoice, startConversation]);

  // ── Scroll ───────────────────────────────────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  // ── Focus ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (phase === "question") {
      setTimeout(() => inputRef.current?.focus(), 300);
    }
  }, [phase]);

  // ── Brain call ───────────────────────────────────────────────────────────────

  const callBrain = useCallback(
    async (answer: string) => {
      if (!answer.trim() || sending) return;
      setSending(true);
      setInputValue("");
      addMessage("user", answer);
      if (sessionId) void appendMessage(sessionId, "user", answer);

      // Thinking indicator — removed when reply arrives
      let thinkingId: string | null = addMessage("zeya", "", "thinking").id;

      try {
        const res = await fetch("/api/zeya/onboarding-brain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            business_profile: memoryRef.current,
            memory_summary: null,
            messages: chatRef.current.slice(-14),
            latest_answer: answer,
            readiness_level: readinessRef.current,
            onboarding_phase: onboardingPhaseRef.current,
          }),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          let errMsg = `Brain responded ${res.status}`;
          try { errMsg = (JSON.parse(errText) as { error?: string }).error ?? errMsg; } catch { /* use default */ }
          throw new Error(errMsg);
        }

        const raw = await res.text();
        if (!raw.trim()) throw new Error("No response from brain. Try again.");
        let result: BrainResponse;
        try {
          result = JSON.parse(raw) as BrainResponse;
        } catch {
          throw new Error("Malformed brain response. Try again.");
        }
        if (!result.reply || typeof result.reply !== "string") {
          throw new Error("Incomplete brain response. Try again.");
        }

        if (Object.keys(result.memory_patch).length > 0) {
          const newMemory = { ...memoryRef.current, ...result.memory_patch };
          setMemory(newMemory);
          memoryRef.current = newMemory;
          if (businessId) {
            void updateBusinessProfile(businessId, result.memory_patch);
            void appendMemoryEvent(businessId, "onboarding_answer", {
              answer,
              patch: result.memory_patch,
              phase: result.onboarding_phase,
            });
          }
        }

        setReadiness(result.readiness_level);
        readinessRef.current = result.readiness_level;
        setOnboardingPhase(result.onboarding_phase);
        onboardingPhaseRef.current = result.onboarding_phase;

        // Remove thinking, start TTS immediately (speech/text sync: TTS fetch runs
        // during the text-reveal delay so audio starts close to when text appears)
        removeMessage(thinkingId);
        thinkingId = null;
        void speakReplyTTS(result.reply);
        await delayedZeya(result.reply, 600);
        if (sessionId) void appendMessage(sessionId, "assistant", result.reply);

        if (result.is_complete) {
          setPhase("summary");
        }
      } catch (err) {
        if (thinkingId) { removeMessage(thinkingId); thinkingId = null; }
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        await delayedZeya(`I lost my train of thought. Try again.\n\n${msg}`, 600);
      } finally {
        setSending(false);
      }
    },
    [sending, sessionId, businessId, addMessage, removeMessage, delayedZeya, speakReplyTTS],
  );

  // ── Voice transcript → brain ──────────────────────────────────────────────────

  useEffect(() => {
    const finalUserEntries = voiceTranscript.filter((e) => e.role === "user" && e.isFinal);
    if (finalUserEntries.length === 0) return;
    const latest = finalUserEntries[finalUserEntries.length - 1];
    if (latest.id === lastVoiceEntryIdRef.current) return;
    if (isRealtimeVoice) return;
    if (ttsSpeakingRef.current) return;
    lastVoiceEntryIdRef.current = latest.id;
    void stopConversation();
    setTimeout(() => void callBrain(latest.text), 0);
  }, [voiceTranscript, stopConversation, callBrain, isRealtimeVoice]);

  // ── OpenAI Realtime transcript → persistence + call log ─────────────────────
  // Processes ALL new final entries since the last processed ID to avoid losing
  // entries when React batches multiple snapshot updates into one render cycle.

  useEffect(() => {
    if (!isRealtimeVoice) return;
    const finalEntries = voiceTranscript.filter((entry) => entry.isFinal);
    if (finalEntries.length === 0) return;

    const latest = finalEntries[finalEntries.length - 1];
    if (latest.id === lastRealtimeEntryIdRef.current) return;

    // Find the slice of entries not yet processed
    const lastIdx = lastRealtimeEntryIdRef.current
      ? finalEntries.findIndex((e) => e.id === lastRealtimeEntryIdRef.current)
      : -1;
    const newEntries = lastIdx === -1 ? finalEntries : finalEntries.slice(lastIdx + 1);
    if (newEntries.length === 0) return;

    lastRealtimeEntryIdRef.current = latest.id;

    for (const entry of newEntries) {
      // Accumulate full transcript for call log (dedup by id)
      if (!fullTranscriptRef.current.some((e) => e.id === entry.id)) {
        fullTranscriptRef.current = [...fullTranscriptRef.current, entry];
      }

      // Debug: render to chat UI
      if (REALTIME_DEBUG) {
        if (entry.role === "agent") {
          console.info("[Zeya realtime timing] assistant transcript rendered", {
            t: Math.round(performance.now()),
          });
        }
        window.setTimeout(() => {
          addMessage(entry.role === "user" ? "user" : "zeya", entry.text);
        }, 0);
      }

      // Persist message to DB (both user and assistant)
      if (sessionId) {
        void appendMessage(sessionId, entry.role === "user" ? "user" : "assistant", entry.text);
      }

      // Log each user turn as a memory event for future context
      if (entry.role === "user" && businessId) {
        void appendMemoryEvent(businessId, "onboarding_answer", { text: entry.text });
      }
    }
  }, [addMessage, businessId, isRealtimeVoice, sessionId, voiceTranscript]);

  // ── Background memory processor trigger ──────────────────────────────────────
  // Fires ~2.5s after the realtime session disconnects to give trailing messages
  // time to finish saving before the processor fetches them.

  useEffect(() => {
    if (!isRealtimeVoice) return;
    const ACTIVE_STATES: VoiceState[] = [
      "connecting", "listening", "thinking", "speaking", "interrupted", "processing",
    ];
    if (ACTIVE_STATES.includes(voiceState)) {
      wasRealtimeActiveRef.current = true;
      return;
    }
    if (!wasRealtimeActiveRef.current) return;
    if (voiceState !== "disconnected") return;
    if (!sessionId || !businessId || !session?.access_token) return;

    wasRealtimeActiveRef.current = false;
    const token = session.access_token;
    const sid = sessionId;
    const bid = businessId;

    const timer = setTimeout(() => {
      void fetch("/api/zeya/process-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ sessionId: sid, businessId: bid }),
      }).catch(() => {});
    }, 2500);

    return () => clearTimeout(timer);
  }, [voiceState, isRealtimeVoice, sessionId, businessId, session?.access_token]);

  // ── Handoff trigger ──────────────────────────────────────────────────────────
  // Single exit point for both text and voice paths.
  // Ensures memory is processed and memory_summary is written (the useAppMode
  // completion gate) before signalling the bridge screen that entry is ready.

  const triggerHandoff = useCallback(async () => {
    setPhase("handoff");

    // Extract structured intelligence from the session transcript.
    // process-memory is idempotent — deduped via processing_checkpoint.
    if (sessionId && businessId && session?.access_token) {
      try {
        await fetch("/api/zeya/process-memory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ sessionId, businessId }),
        });
      } catch (err) {
        console.error("[Zeya] handoff process-memory failed:", err);
        // Non-fatal — memory may have been processed by the auto-timer.
      }
    }

    // Write memory_summary — this is the signal useAppMode uses to route to
    // workspace. Without it the user stays in onboarding on every reload.
    if (businessId) {
      const summary = buildConversationalSummary(memoryRef.current);
      const safeSummary = summary.trim() || "Business context captured during onboarding.";
      try {
        await setMemorySummary(businessId, safeSummary);
      } catch {
        // Best-effort fallback: write a minimal marker so the gate is not stuck.
        try { await setMemorySummary(businessId, "Onboarding complete."); } catch {}
      }
    }

    if (sessionId) {
      const summary = buildConversationalSummary(memoryRef.current);
      void updateSessionSummary(sessionId, summary || "Onboarding session completed.").catch(() => {});
    }

    setHandoffReady(true);
  }, [sessionId, businessId, session]);

  // ── Voice call ended detection ─────────────────────────────────────────────
  // Tracks whether the realtime call was active and has now disconnected with
  // content — the signal to offer the "Complete onboarding" prompt.
  // Resets when the user restarts the call.

  useEffect(() => {
    if (!isRealtimeVoice) return;
    const ACTIVE_STATES: VoiceState[] = [
      "connecting", "listening", "thinking", "speaking", "interrupted", "processing",
    ];
    if (ACTIVE_STATES.includes(voiceState)) {
      setRealtimeCallEnded(false);
      return;
    }
    if (voiceState === "disconnected" && voiceTranscript.some((e) => e.isFinal)) {
      setRealtimeCallEnded(true);
    }
  }, [isRealtimeVoice, voiceState, voiceTranscript]);

  // ── Submit handlers ──────────────────────────────────────────────────────────

  async function handleSubmit() {
    const answer = inputValue.trim();
    if (!answer) return;
    await callBrain(answer);
  }

  async function handleConfirm() {
    setSending(true);
    addMessage("user", "Ready. Let's begin.");

    const summary = buildConversationalSummary(memoryRef.current);

    if (businessId) {
      void appendMemoryEvent(businessId, "confirmation", { confirmed: true });
      await Promise.all([
        updateBusinessProfile(businessId, memoryRef.current),
        setMemorySummary(businessId, summary),
      ]);
    }
    if (sessionId) void updateSessionSummary(sessionId, summary);

    await delayedZeya(
      "Thank you for the briefing.\n\nI still have a lot to learn over time, but I understand the offer, your audience, the strongest positioning angles, and the tone you want associated with the business.\n\nI'm ready for a first controlled mission.",
      700,
    );
    setPhase("confirmed");
    setSending(false);

    // After the closing message has been visible, move to the handoff bridge.
    // triggerHandoff handles process-memory + memory_summary write (idempotent —
    // memory_summary was already set above, the write is a safe no-op).
    setTimeout(() => void triggerHandoff(), 2800);
  }

  async function handleEdit() {
    addMessage("user", "Let me correct something first.");
    await delayedZeya("What would you like to change?", 500);
    setPhase("question");
    setSending(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (phase === "loading" && chat.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center" style={{ background: "#0a0709" }}>
        <motion.div
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
          className="h-1 w-1 rounded-full bg-zeya-champagne/60"
        />
      </div>
    );
  }

  // ── Handoff bridge (both paths) ────────────────────────────────────────────
  // Rendered after onboarding is confirmed complete — before entering workspace.
  // Two threshold lines frame the message. The "Enter the Briefing Room" button
  // appears only once memory processing is done and memory_summary is written.

  if (phase === "handoff") {
    const insight = buildHandoffInsight(memoryRef.current);
    return (
      <main
        className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-14"
        style={{ background: "#0a0709" }}
      >
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zeya-plum/15 blur-atmosphere" />
          <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-zeya-champagne/4 blur-atmosphere" />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)" }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.8, ease: EASE }}
          className="flex max-w-sm flex-col items-center gap-9 text-center"
        >
          {/* Upper threshold line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.3 }}
            className="h-px w-16 origin-center bg-gradient-to-r from-transparent via-zeya-champagne/30 to-transparent"
          />

          <div className="space-y-5">
            <p className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/75">
              I have enough context to begin working with you operationally.
            </p>
            {insight && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.2, ease: EASE, delay: 0.9 }}
                className="text-[0.875rem] font-light leading-relaxed tracking-wide text-zeya-hush/52"
              >
                {insight}
              </motion.p>
            )}
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.0, ease: EASE, delay: 1.3 }}
              className="text-[0.8125rem] font-light tracking-wide text-zeya-hush/38"
            >
              From now on, we continue inside the Briefing Room.
            </motion.p>
          </div>

          {/* Lower threshold line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.4, ease: EASE, delay: 0.5 }}
            className="h-px w-16 origin-center bg-gradient-to-r from-transparent via-zeya-champagne/18 to-transparent"
          />

          {/* Entry button — appears once memory processing is complete */}
          <div className="flex min-h-[3.5rem] items-center justify-center">
            <AnimatePresence mode="wait">
              {handoffReady ? (
                <motion.button
                  key="enter"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.9, ease: EASE }}
                  onClick={() => onComplete()}
                  className="rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 px-8 py-3.5 text-sm font-light tracking-wide text-zeya-champagne transition-all duration-300 hover:bg-zeya-champagne/16"
                >
                  Enter the Briefing Room
                </motion.button>
              ) : (
                <motion.p
                  key="preparing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0.28, 0] }}
                  transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
                  className="text-[0.6rem] font-light tracking-widest text-zeya-hush/22 uppercase"
                >
                  Preparing your first briefing
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </main>
    );
  }

  // ── Realtime voice-call UI ────────────────────────────────────────────────────
  // Rendered instead of the chat/input UI when the OpenAI Realtime provider is
  // active. Feels like starting a phone call: orb + status copy + single button.

  if (isRealtimeVoice) {
    const callNotStarted = voiceState === "idle" || voiceState === "disconnected";
    const callError = voiceState === "error";

    const realtimeStatusLabel: string | null = callNotStarted
      ? null
      : callError
        ? (voice.error ?? "Something went wrong.")
        : (VOICE_STATUS_LABEL[voiceDisplayState] ?? null);

    return (
      <main
        className="relative isolate flex min-h-dvh flex-col items-center justify-center overflow-hidden px-5 py-14"
        style={{ background: "#0a0709" }}
      >
        {/* Ambient backdrop */}
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zeya-plum/20 blur-atmosphere" />
          <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-zeya-champagne/6 blur-atmosphere" />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)" }}
          />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.6, ease: EASE }}
          className="flex flex-col items-center gap-10"
        >
          <PresenceCore state={callNotStarted ? "idle" : voiceDisplayState} />

          {/* Status copy */}
          <div className="flex min-h-[3.5rem] flex-col items-center justify-center gap-1 text-center">
            <AnimatePresence mode="wait">
              {callNotStarted && realtimeCallEnded ? (
                <motion.div
                  key="post-call"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className="flex flex-col items-center gap-1"
                >
                  <p className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/80">
                    Onboarding call ended.
                  </p>
                  <p className="text-sm font-light tracking-wide text-zeya-hush/50">
                    Complete onboarding to enter the Briefing Room.
                  </p>
                </motion.div>
              ) : callNotStarted ? (
                <motion.div
                  key="pre-call"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.6, ease: EASE }}
                  className="flex flex-col items-center gap-1"
                >
                  <p className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/80">
                    Zeya is ready.
                  </p>
                  <p className="text-sm font-light tracking-wide text-zeya-hush/50">
                    Tap to start your onboarding call.
                  </p>
                </motion.div>
              ) : realtimeStatusLabel ? (
                <motion.p
                  key={realtimeStatusLabel}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.4, ease: EASE }}
                  className={
                    callError
                      ? "max-w-[18rem] text-sm font-light tracking-wide text-zeya-hush/50"
                      : "text-[0.68rem] font-light tracking-widest text-zeya-hush/38 uppercase"
                  }
                >
                  {realtimeStatusLabel}
                </motion.p>
              ) : null}
            </AnimatePresence>
          </div>

          {/* Call button / completion prompt */}
          {callNotStarted && realtimeCallEnded ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, ease: EASE }}
              className="flex flex-col items-center gap-3"
            >
              <button
                onClick={() => void triggerHandoff()}
                className="rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 px-7 py-3 text-sm font-light tracking-wide text-zeya-champagne transition-all duration-300 hover:bg-zeya-champagne/16"
              >
                Complete onboarding
              </button>
              <button
                onClick={startVoiceFirstConversation}
                className="text-[0.7rem] font-light tracking-wide text-zeya-hush/32 transition-colors hover:text-zeya-hush/52"
              >
                Continue the conversation
              </button>
            </motion.div>
          ) : (
            <VoiceButton
              state={voiceDisplayState}
              disabled={phase === "loading"}
              onStart={startVoiceFirstConversation}
              onStop={() => void stopConversation()}
            />
          )}
        </motion.div>

        {/* Call log — discreet bottom-right button, visible once there is a transcript */}
        {voiceTranscript.filter((e) => e.isFinal).length > 0 && (
          <button
            onClick={() => {
              setCallLogEntries([...fullTranscriptRef.current]);
              setCallLogOpen(true);
            }}
            className="fixed bottom-6 right-6 text-[0.65rem] font-light tracking-widest text-zeya-hush/28 uppercase transition-colors duration-300 hover:text-zeya-hush/55"
          >
            Call log
          </button>
        )}

        {/* Call log modal */}
        {callLogOpen && (
          <div
            className="fixed inset-0 z-50 flex items-end justify-end p-4"
            onClick={() => setCallLogOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 8, filter: "blur(6px)" }}
              transition={{ duration: 0.35, ease: EASE }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-sm overflow-hidden rounded-presence border border-zeya-graphite/50 bg-zeya-plum/92 shadow-presence backdrop-blur-sm"
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-zeya-graphite/30 px-4 py-3">
                <span className="text-[0.65rem] font-light tracking-widest text-zeya-hush/45 uppercase">
                  Call log
                </span>
                <button
                  onClick={() => setCallLogOpen(false)}
                  className="text-sm leading-none text-zeya-hush/35 transition-colors hover:text-zeya-hush/65"
                  aria-label="Close call log"
                >
                  ✕
                </button>
              </div>

              {/* Transcript */}
              <div className="max-h-72 space-y-4 overflow-y-auto px-4 py-4" style={{ scrollbarWidth: "none" }}>
                {callLogEntries.length === 0 ? (
                  <p className="text-[0.8125rem] font-light text-zeya-hush/35">
                    No transcript yet.
                  </p>
                ) : (
                  callLogEntries.map((entry) => (
                    <div key={entry.id} className={entry.role === "user" ? "text-right" : "text-left"}>
                      <p className="mb-0.5 text-[0.62rem] font-light tracking-widest text-zeya-hush/30 uppercase">
                        {entry.role === "user" ? "You" : "Zeya"}
                      </p>
                      <p className="text-[0.8125rem] font-light leading-relaxed text-zeya-ivory/72">
                        {entry.text}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </main>
    );
  }

  const inputActive = phase === "question";
  const isMemoryTest = onboardingPhase === "memory_test";
  const voiceStatusLabel = isRealtimeVoice ? undefined : VOICE_STATUS_LABEL[voiceDisplayState];
  const visibleChat = isRealtimeVoice
    ? REALTIME_DEBUG
      ? chat.filter((entry) => entry.role === "user" || !realtimeVoiceActive)
      : []
    : chat;

  return (
    <main className="relative isolate flex min-h-dvh flex-col items-center overflow-hidden px-5 pb-10 pt-14 sm:justify-center sm:pb-14">
      {/* Ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-1/3 h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zeya-plum/20 blur-atmosphere" />
        <div className="absolute bottom-0 right-0 h-64 w-64 rounded-full bg-zeya-champagne/6 blur-atmosphere" />
        <div
          className="absolute inset-0"
          style={{
            background: "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)",
          }}
        />
      </div>

      {/* Readiness indicator */}
      <AnimatePresence>
        {phase !== "loading" && phase !== "confirmed" && readiness !== "learning" && (
          <motion.div
            key={readiness}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2, ease: EASE }}
            className="fixed right-5 top-6 flex items-center gap-1.5"
          >
            <motion.div
              animate={{ opacity: [0.3, 0.8, 0.3] }}
              transition={{ duration: 3.0, repeat: Infinity, ease: "easeInOut" }}
              className={[
                "h-1.5 w-1.5 rounded-full",
                readiness === "aligning" && "bg-zeya-champagne/45",
                readiness === "ready" && "bg-zeya-champagne/75",
              ]
                .filter(Boolean)
                .join(" ")}
            />
            <span className="text-[0.6rem] font-light tracking-widest text-zeya-hush/32 uppercase">
              {readiness === "aligning" ? "Aligning" : "Ready"}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat stream */}
      <div className="w-full max-w-[32rem] flex-1 overflow-y-auto sm:max-h-[65vh] sm:flex-none">
        <div className="flex flex-col gap-6 py-6">
          <AnimatePresence initial={false}>
            {visibleChat.map((entry) => (
              <motion.div
                key={entry.id}
                variants={msgVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                className={entry.role === "zeya" ? "self-start" : "self-end"}
              >
                {entry.role === "zeya" ? (
                  <ZeyaMessage text={entry.text} variant={entry.variant} />
                ) : (
                  <UserMessage text={entry.text} />
                )}
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Input area */}
      <AnimatePresence mode="wait">
        {phase === "summary" ? (
          <motion.div
            key="confirm-buttons"
            initial={{ opacity: 0, y: 16, filter: "blur(12px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, filter: "blur(8px)" }}
            transition={{ duration: 0.8, ease: EASE }}
            className="mt-6 flex w-full max-w-[32rem] gap-3"
          >
            <button
              onClick={() => void handleConfirm()}
              disabled={sending}
              className="flex-1 rounded-presence border border-zeya-champagne/20 bg-zeya-champagne/10 py-3.5 text-sm font-light tracking-wide text-zeya-champagne transition-all duration-300 hover:bg-zeya-champagne/18 disabled:opacity-40"
            >
              Begin first mission
            </button>
            <button
              onClick={() => void handleEdit()}
              disabled={sending}
              className="rounded-presence border border-zeya-graphite/60 px-5 py-3.5 text-sm font-light tracking-wide text-zeya-hush/70 transition-all duration-300 hover:border-zeya-hush/40 hover:text-zeya-hush disabled:opacity-40"
            >
              Edit
            </button>
          </motion.div>
        ) : phase === "confirmed" ? null : (
          <motion.div
            key="input-area"
            initial={{ opacity: 0, y: 16, filter: "blur(12px)" }}
            animate={{ opacity: inputActive ? 1 : 0.4, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, y: 8, filter: "blur(8px)" }}
            transition={{ duration: 0.8, ease: EASE }}
            className="mt-8 w-full max-w-[32rem] space-y-3"
          >
            {/* Voice section */}
            {isConfigured && (
              <div className="flex flex-col items-center gap-3 pb-1">
                <VoiceButton
                  state={voiceDisplayState}
                  disabled={!inputActive || (!isRealtimeVoice && ttsSpeaking)}
                  onStart={startVoiceFirstConversation}
                  onStop={() => void stopConversation()}
                />
                <div className="flex min-h-[1.1rem] items-center justify-center">
                  <AnimatePresence mode="wait">
                    {voiceStatusLabel ? (
                      <motion.p
                        key={voiceDisplayState}
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -3 }}
                        transition={{ duration: 0.4, ease: EASE }}
                        className="text-[0.68rem] font-light tracking-widest text-zeya-hush/38 uppercase"
                      >
                        {voiceStatusLabel}
                      </motion.p>
                    ) : null}
                  </AnimatePresence>
                </div>
              </div>
            )}

            {/* "or type" divider */}
            {isConfigured && !realtimeVoiceActive && (
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-zeya-graphite/25" />
                <span className="text-[0.65rem] font-light tracking-wider text-zeya-hush/22">
                  or type
                </span>
                <div className="h-px flex-1 bg-zeya-graphite/25" />
              </div>
            )}

            {/* Text input */}
            <div
              className={[
                "relative flex items-end gap-3 rounded-vessel border border-zeya-graphite/50 bg-zeya-plum/40 px-4 py-4 shadow-presence backdrop-blur-sm transition-all duration-300 focus-within:border-zeya-champagne/30 focus-within:bg-zeya-plum/55",
                realtimeVoiceActive ? "hidden" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => {
                  setInputValue(e.target.value);
                  growTextarea(e.target);
                }}
                onKeyDown={handleKeyDown}
                disabled={!inputActive || sending}
                placeholder={
                  isMemoryTest
                    ? "Ask me anything about your business…"
                    : "Type your answer…"
                }
                rows={3}
                className="min-h-[4.5rem] max-h-52 w-full resize-none bg-transparent text-[0.9375rem] font-light leading-relaxed tracking-wide text-zeya-ivory placeholder:text-zeya-hush/30 focus:outline-none disabled:opacity-40"
                style={{ scrollbarWidth: "none" }}
              />
              <button
                onClick={() => void handleSubmit()}
                disabled={!inputValue.trim() || !inputActive || sending}
                className="mb-1 ml-1 flex h-8 w-8 shrink-0 items-center justify-center self-end rounded-full border border-zeya-champagne/25 bg-zeya-champagne/12 text-zeya-champagne/80 transition-all duration-300 hover:bg-zeya-champagne/22 hover:text-zeya-champagne disabled:cursor-not-allowed disabled:opacity-30"
                aria-label="Send"
              >
                <SendIcon />
              </button>
            </div>
            <p className="text-center text-[0.68rem] font-light tracking-wide text-zeya-hush/22">
              Return to send · Shift+Return for new line
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ZeyaMessage({ text, variant }: { text: string; variant?: ChatEntry["variant"] }) {
  if (variant === "thinking") return <ZeyaThinkingMessage />;
  const isIntro = variant === "intro";
  return (
    <div className="flex items-start gap-3">
      <div
        className={[
          "shrink-0 flex items-center justify-center rounded-full border border-zeya-champagne/20 bg-zeya-aubergine",
          isIntro ? "mt-1 h-7 w-7" : "mt-0.5 h-6 w-6",
        ].join(" ")}
      >
        <div className={["rounded-full bg-zeya-champagne/70", isIntro ? "h-2 w-2" : "h-1.5 w-1.5"].join(" ")} />
      </div>
      <p
        className={[
          "font-light leading-relaxed tracking-wide text-zeya-ivory/90",
          isIntro ? "max-w-[24rem] text-[1.0625rem]" : "max-w-[22rem] text-[0.9375rem]",
        ].join(" ")}
        style={{ whiteSpace: "pre-line" }}
      >
        {text}
      </p>
    </div>
  );
}

function ZeyaThinkingMessage() {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 h-6 w-6 shrink-0 flex items-center justify-center rounded-full border border-zeya-champagne/20 bg-zeya-aubergine">
        <motion.div
          animate={{ opacity: [0.25, 0.7, 0.25] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
          className="h-1.5 w-1.5 rounded-full bg-zeya-champagne/70"
        />
      </div>
      <div className="flex items-end gap-[3px] pb-px pt-[5px]">
        {([0, 1, 2, 3] as const).map((i) => (
          <motion.div
            key={i}
            className="rounded-full bg-zeya-champagne/28"
            style={{ width: "2.5px", height: "14px", originY: 1 }}
            animate={{ scaleY: [0.18, 1, 0.18] }}
            transition={{
              duration: 1.6,
              repeat: Infinity,
              ease: "easeInOut",
              delay: i * 0.14,
            }}
          />
        ))}
      </div>
    </div>
  );
}

function UserMessage({ text }: { text: string }) {
  return (
    <div className="max-w-[22rem] rounded-presence rounded-br-calm border border-zeya-graphite/50 bg-zeya-plum/50 px-4 py-3 backdrop-blur-sm">
      <p className="text-[0.9375rem] font-light leading-relaxed tracking-wide text-zeya-hush/85">
        {text}
      </p>
    </div>
  );
}

function SendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
      <path
        d="M7 12V2M7 2L2.5 6.5M7 2L11.5 6.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
