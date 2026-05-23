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
  initBusinessProfile,
  setMemorySummary,
  updateBusinessProfile,
  updateSessionSummary,
} from "@/lib/supabase/business-memory";

// ─── Types ────────────────────────────────────────────────────────────────────

type Phase = "loading" | "question" | "summary" | "confirmed";
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
  variant?: "intro";
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
    filter: "blur(10px)",
    transition: { duration: 0.5, ease: EASE },
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFirstName(email: string | undefined): string | null {
  if (!email) return null;
  const local = email.split("@")[0];
  // Filter out emails that are clearly not names (numbers-only, very short, etc.)
  if (!local || local.length < 2 || /^\d+$/.test(local)) return null;
  const candidate = local.split(/[._-]/)[0];
  if (!candidate || candidate.length < 2) return null;
  return candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
}

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  existingBusinessId: string | null;
  onComplete: () => void;
}

export function BusinessOnboarding({ existingBusinessId, onComplete }: Props) {
  const { user } = useAuth();

  const [phase, setPhase] = useState<Phase>("loading");
  const [chat, setChat] = useState<ChatEntry[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [memory, setMemory] = useState<BusinessMemory>(emptyBusinessMemory());
  const [readiness, setReadiness] = useState<ReadinessLevel>("learning");
  const [onboardingPhase, setOnboardingPhase] = useState<OnboardingPhase>("understand_business");
  const [businessId, setBusinessId] = useState<string | null>(existingBusinessId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const initRef = useRef(false);
  const chatRef = useRef<ChatEntry[]>([]);
  const memoryRef = useRef<BusinessMemory>(emptyBusinessMemory());
  const readinessRef = useRef<ReadinessLevel>("learning");
  const onboardingPhaseRef = useRef<OnboardingPhase>("understand_business");

  useEffect(() => { chatRef.current = chat; }, [chat]);
  useEffect(() => { memoryRef.current = memory; }, [memory]);
  useEffect(() => { readinessRef.current = readiness; }, [readiness]);
  useEffect(() => { onboardingPhaseRef.current = onboardingPhase; }, [onboardingPhase]);

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const addMessage = useCallback((role: ChatEntry["role"], text: string, variant?: ChatEntry["variant"]) => {
    const entry: ChatEntry = { id: crypto.randomUUID(), role, text, variant };
    setChat((prev) => [...prev, entry]);
    return entry;
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

  // ── Init ──────────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user || initRef.current) return;
    initRef.current = true;

    async function init() {
      try {
        const isResume = existingBusinessId !== null;
        let bid = existingBusinessId;

        if (!bid) {
          const business = await initBusinessProfile(user!.id);
          bid = business.id as string;
          setBusinessId(bid);
        } else {
          const existing = await getBusinessProfile(user!.id);
          if (existing?.business_profile) {
            const profile = existing.business_profile as BusinessMemory;
            setMemory(profile);
            memoryRef.current = profile;
          }
        }

        const session = await createSession(bid, "onboarding");
        setSessionId(session.id as string);

        if (isResume) {
          await delayedZeya("Good to have you back.", 500);
          await delayedZeya(
            "Let me review what I have on the business before we continue.",
            1400,
          );
          await delayedZeya("What would you like to add or correct?", 2600);
        } else {
          // Warm introduction — 4 deliberate beats
          const firstName = extractFirstName(user!.email);
          const greeting = firstName ? `Hi, ${firstName}.\nI'm Zeya.` : "Hi.\nI'm Zeya.";

          await delayedZeya(greeting, 500, "intro");

          await delayedZeya(
            "We're going to be working together over time. My role is to help develop the business — outreach, conversations, follow-ups, and eventually identifying opportunities worth pursuing.",
            2000,
          );

          await delayedZeya(
            "Before I start making calls on your behalf, I need to understand how you think about the offer, who you're trying to reach, and how you want the brand to come across.",
            4000,
          );

          await delayedZeya(
            "Would it be alright if I asked you a few practical questions first?",
            6200,
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
  }, [user, existingBusinessId, delayedZeya]);

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
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? `Brain responded ${res.status}`);
        }

        const result = (await res.json()) as BrainResponse;

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

        await delayedZeya(result.reply, 600);
        if (sessionId) void appendMessage(sessionId, "assistant", result.reply);

        if (result.is_complete) {
          setPhase("summary");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong.";
        await delayedZeya(`I lost my train of thought. Try again.\n\n${msg}`, 600);
      } finally {
        setSending(false);
      }
    },
    [sending, sessionId, businessId, addMessage, delayedZeya],
  );

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

    setTimeout(() => onComplete(), 2800);
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

  const inputActive = phase === "question";
  const isMemoryTest = onboardingPhase === "memory_test";

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

      {/* Readiness indicator — top right. Barely visible in learning phase. */}
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
            {chat.map((entry) => (
              <motion.div
                key={entry.id}
                variants={msgVariants}
                initial="hidden"
                animate="visible"
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
            <div className="relative flex items-end gap-3 rounded-vessel border border-zeya-graphite/50 bg-zeya-plum/40 px-4 py-4 shadow-presence backdrop-blur-sm transition-all duration-300 focus-within:border-zeya-champagne/30 focus-within:bg-zeya-plum/55">
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

function ZeyaMessage({ text, variant }: { text: string; variant?: "intro" }) {
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
          isIntro
            ? "max-w-[24rem] text-[1.0625rem]"
            : "max-w-[22rem] text-[0.9375rem]",
        ].join(" ")}
        style={{ whiteSpace: "pre-line" }}
      >
        {text}
      </p>
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
