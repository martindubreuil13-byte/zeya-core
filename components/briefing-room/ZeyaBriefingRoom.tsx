"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { PresenceCore } from "@/components/presence";
import { buildBriefingData, parseMissionDetail, type MissionDetail, type PillData, type PillStatus } from "@/lib/briefing-room/briefing-room-data";
import { buildDailyBrief, type DailyBrief } from "@/lib/briefing-room/daily-brief";
import { getMemoryEvents, getLatestSession, getSessionMessages, updateBusinessProfile } from "@/lib/supabase/business-memory";
import { getLeadSummary } from "@/lib/supabase/mission-leads";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";
import type { LeadSummary } from "@/lib/leads/types";
import { LeadIntakePanel } from "@/components/leads/LeadIntakePanel";
import { useRealtimeBriefingSession } from "@/hooks/realtime/useRealtimeBriefingSession";
import { supabase } from "@/lib/supabase";
import type { VoiceState } from "@/types/voice";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PreviewData {
  businessName: string | null;
  progressPercent: number;
  pills: PillData[];
  lastSessionStartedAt?: string | null;
  eventCount?: number;
}

interface Props {
  businessId?: string;
  mockData?: PreviewData;
}

const EASE = [0.22, 1, 0.36, 1] as const;

// Core strategic pills shown by default
const CORE_IDS = new Set(["offer", "icp", "pain_points", "objections", "tone", "proof_points"]);

// ─── Design tokens (exact hex from tailwind config) ───────────────────────────

const COLOR = {
  champagne: "#d7c19b",
  hush:      "#b8ada0",
  ivory:     "#f4eee2",
  graphite:  "#3a3437",
  mineral:   "#8e8980",
} as const;

// ─── Pill → business_profile field map ────────────────────────────────────────
// Only editable (non-readOnly) pills that have a stable profile home are listed.
// Pill content written here survives reload and flows into serializeContext().

const PILL_PROFILE_FIELD: Partial<Record<string, keyof BusinessMemory>> = {
  offer:           "offer",
  icp:             "target_customers",
  pain_points:     "pain_points",
  objections:      "objections",
  tone:            "preferred_tone",
  proof_points:    "proof_points",
  sales_arguments: "sales_arguments",
  pricing:             "pricing",
  first_mission:       "first_mission",
  known_facts:         "known_facts",
  assumptions:         "assumptions",
  validated_learnings: "validated_learnings",
};

// ─── Status indicators ────────────────────────────────────────────────────────

const STATUS_DOT: Record<PillStatus, string> = {
  confirmed: "bg-zeya-champagne/75",
  assumed:   "bg-zeya-mineral/65",
  draft:     "bg-zeya-hush/42",
  missing:   "bg-zeya-graphite/55",
};

const STATUS_LABEL: Record<PillStatus, string> = {
  confirmed: "Confirmed",
  assumed:   "Assumed",
  draft:     "Draft",
  missing:   "Missing",
};

const STATUS_TEXT: Record<PillStatus, string> = {
  confirmed: "text-zeya-champagne/78",
  assumed:   "text-zeya-mineral/78",
  draft:     "text-zeya-hush/62",
  missing:   "text-zeya-hush/48",
};

// ─── Context serialiser ───────────────────────────────────────────────────────
// Builds the business context string injected into every briefing voice session.
// last_session_synthesis is placed first so Zeya opens with continuity awareness.

function serializeContext(
  pills: PillData[],
  name: string | null,
  progress: number,
  lastSessionSynthesis?: string | null,
  strategicFocus?: string | null,
  missionDetail?: MissionDetail | null,
  leadSummary?: LeadSummary | null,
): string {
  const lines: string[] = [];

  if (lastSessionSynthesis) {
    lines.push(`Last session: ${lastSessionSynthesis}`);
    lines.push("");
  }

  if (name) lines.push(`Business: ${name}`);
  lines.push(`Profile completion: ${progress}%`);

  for (const pill of pills) {
    if (
      pill.status !== "missing" &&
      pill.content &&
      pill.content !== "Not captured yet." &&
      pill.content !== "Not discussed yet." &&
      pill.content !== "Not developed yet." &&
      !pill.readOnly
    ) {
      lines.push(`${pill.label}: ${pill.content.slice(0, 220)}`);
    }
  }

  // Mission detail gives Zeya a clear operational focus for this session.
  // Falls back to strategicFocus string when no structured mission exists yet.
  if (missionDetail) {
    lines.push("");
    lines.push(`Active mission: ${missionDetail.name}`);
    lines.push(`Target: ${missionDetail.target_segment}`);
    lines.push(`Testing: ${missionDetail.hypothesis}`);
    lines.push(`Angle: ${missionDetail.sales_angle}`);
    if (missionDetail.required_inputs.length > 0) {
      lines.push(`Needs before action: ${missionDetail.required_inputs.join(", ")}`);
    }
    lines.push(`Next: ${missionDetail.next_action}`);
  } else if (strategicFocus) {
    lines.push("");
    lines.push(`Next focus: ${strategicFocus}`);
  }

  if (leadSummary && leadSummary.total > 0) {
    lines.push("");
    lines.push(
      `Mission leads: ${leadSummary.total} total — ${leadSummary.likelyMatch} likely match, ${leadSummary.possibleMatch} possible, ${leadSummary.weakMatch} weak. ${leadSummary.selected} selected.`,
    );
  }

  return lines.join("\n");
}

// ─── Waveform bars ────────────────────────────────────────────────────────────
//
// 7 bars, bottom-anchored, animated between minH and maxH px.
// Animation parameters adapt to voice state to create the right emotional signal:
//   idle      → very gentle breathing (Zeya is present, waiting)
//   connecting → brighter pulse (session is initializing)
//   listening  → active variation (user is speaking)
//   thinking   → nearly still, dim (processing)
//   speaking   → strong, rhythmic (Zeya is speaking)

const BAR_PROFILES = [0.65, 0.82, 0.95, 1.0, 0.90, 0.78, 0.60] as const;

interface WaveformConfig {
  minFactor: number;
  maxFactor: number;
  duration: number;
  stagger: number;
  opacity: number;
  color: string;
}

function getWaveformConfig(state: VoiceState | "inactive"): WaveformConfig {
  switch (state) {
    case "idle":
    case "inactive":
      return { minFactor: 0.12, maxFactor: 0.30, duration: 4.4, stagger: 0.40, opacity: 0.28, color: COLOR.hush };
    case "connecting":
      return { minFactor: 0.18, maxFactor: 0.52, duration: 1.5, stagger: 0.18, opacity: 0.45, color: COLOR.champagne };
    case "listening":
    case "interrupted":
      return { minFactor: 0.22, maxFactor: 0.88, duration: 0.88, stagger: 0.09, opacity: 0.65, color: COLOR.champagne };
    case "thinking":
    case "processing":
      return { minFactor: 0.08, maxFactor: 0.22, duration: 3.8, stagger: 0.50, opacity: 0.20, color: COLOR.hush };
    case "speaking":
      return { minFactor: 0.42, maxFactor: 1.0, duration: 0.62, stagger: 0.07, opacity: 0.85, color: COLOR.champagne };
    case "disconnected":
    case "error":
      return { minFactor: 0.08, maxFactor: 0.18, duration: 3.0, stagger: 0.35, opacity: 0.15, color: COLOR.hush };
  }
}

const BAR_MAX_PX = 28;
const BAR_MIN_FLOOR = 3;

function WaveformBars({ voiceState }: { voiceState: VoiceState | "inactive" }) {
  const cfg = getWaveformConfig(voiceState);

  return (
    <div className="flex items-end gap-[5px]" style={{ height: `${BAR_MAX_PX}px` }}>
      {BAR_PROFILES.map((profile, i) => {
        const minH = Math.max(BAR_MIN_FLOOR, Math.round(BAR_MAX_PX * cfg.minFactor * profile));
        const maxH = Math.max(minH + 2, Math.round(BAR_MAX_PX * cfg.maxFactor * profile));
        const delay = (i * cfg.stagger * cfg.duration) / BAR_PROFILES.length;

        return (
          <motion.div
            key={i}
            style={{ width: 3, borderRadius: 99, backgroundColor: cfg.color }}
            animate={{
              height: [`${minH}px`, `${maxH}px`, `${minH}px`],
              opacity: [cfg.opacity * 0.7, cfg.opacity, cfg.opacity * 0.7],
            }}
            transition={{
              height:  { duration: cfg.duration, repeat: Infinity, ease: "easeInOut", delay },
              opacity: { duration: cfg.duration, repeat: Infinity, ease: "easeInOut", delay },
            }}
          />
        );
      })}
    </div>
  );
}

// ─── Voice state label ────────────────────────────────────────────────────────

const VOICE_LABEL: Partial<Record<VoiceState, string>> = {
  connecting:  "Connecting",
  listening:   "Listening",
  interrupted: "Listening",
  thinking:    "Processing",
  processing:  "Processing",
  speaking:    "",          // Zeya is speaking — no label needed
  disconnected: "",
  error:       "Connection error",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function ZeyaBriefingRoom({ businessId, mockData }: Props) {
  const { session } = useAuth();

  // ── Data state ──────────────────────────────────────────────────────────────
  const [pills, setPills] = useState<PillData[]>([]);
  const [businessName, setBusinessName] = useState<string | null>(null);
  const [progressPercent, setProgressPercent] = useState(0);
  const [lastSessionStartedAt, setLastSessionStartedAt] = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [lastSessionSynthesis, setLastSessionSynthesis] = useState<string | null>(null);
  const [strategicFocus, setStrategicFocus] = useState<string | null>(null);
  const [missionDetail, setMissionDetail] = useState<MissionDetail | null>(null);
  const [leadSummary, setLeadSummary]     = useState<LeadSummary | null>(null);
  const [showLeadIntake, setShowLeadIntake] = useState(false);
  const [loading, setLoading] = useState(true);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [selectedPillId, setSelectedPillId] = useState<string | null>(null);
  const [pillsExpanded, setPillsExpanded] = useState(false);

  // ── Panel state ─────────────────────────────────────────────────────────────
  const [panelContent, setPanelContent] = useState("");
  const [panelEditing, setPanelEditing] = useState(false);
  const [panelDraft, setPanelDraft] = useState("");
  const localEditsRef = useRef<Record<string, string>>({});

  // ── Load data ───────────────────────────────────────────────────────────────

  useEffect(() => {
    if (mockData) {
      setBusinessName(mockData.businessName);
      setProgressPercent(mockData.progressPercent);
      setPills(mockData.pills);
      setLastSessionStartedAt(mockData.lastSessionStartedAt ?? null);
      setEventCount(mockData.eventCount ?? 0);
      setLoading(false);
      return;
    }

    if (!businessId) return;
    let cancelled = false;

    async function load() {
      try {
        const [{ data: bizRow }, events, dbSession] = await Promise.all([
          supabase
            .from("businesses")
            .select("business_name, business_profile, memory_summary")
            .eq("id", businessId)
            .maybeSingle(),
          getMemoryEvents(businessId!),
          getLatestSession(businessId!),
        ]);

        const callLog = dbSession ? await getSessionMessages(dbSession.id, 100) : [];
        if (cancelled) return;

        const result = buildBriefingData(
          (bizRow?.business_profile as Record<string, unknown> | null) ?? null,
          typeof bizRow?.business_name === "string" ? bizRow.business_name : null,
          typeof bizRow?.memory_summary === "string" ? bizRow.memory_summary : null,
          events,
          callLog,
        );

        setBusinessName(result.businessName);
        setProgressPercent(result.progressPercent);
        setPills(result.pills);
        setLastSessionStartedAt(dbSession?.started_at ?? null);
        setEventCount(events.length);
        setLastSessionSynthesis(result.lastSessionSynthesis ?? null);
        setStrategicFocus(result.strategicFocus ?? null);
        setMissionDetail(result.missionDetail ?? null);

        // Fetch lead summary for the active mission (non-fatal if unavailable)
        const mKey = result.missionDetail?.name ?? undefined;
        void getLeadSummary(businessId!, mKey).then(setLeadSummary).catch(() => {});
      } catch (e) {
        console.error("[Zeya] BriefingRoom load failed:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [businessId, mockData]);

  // ── Voice session ───────────────────────────────────────────────────────────

  const businessContext = loading
    ? ""
    : serializeContext(pills, businessName, progressPercent, lastSessionSynthesis, strategicFocus, missionDetail, leadSummary);

  const briefingSession = useRealtimeBriefingSession({
    businessContext,
    businessId:   businessId ?? undefined,
    accessToken:  session?.access_token ?? undefined,
  });

  const isSessionActive =
    briefingSession.connectionStatus !== "idle" &&
    briefingSession.connectionStatus !== "disconnected";

  // Auto-reset to idle after session ends (500ms grace period)
  useEffect(() => {
    if (briefingSession.connectionStatus === "disconnected") {
      const t = setTimeout(() => briefingSession.resetIdle(), 500);
      return () => clearTimeout(t);
    }
  }, [briefingSession.connectionStatus]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep transcript scrolled to bottom
  const transcriptBottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (briefingSession.transcript.length > 0) {
      transcriptBottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [briefingSession.transcript.length]);

  // ── Panel handlers ──────────────────────────────────────────────────────────

  function openPill(pill: PillData) {
    const content = localEditsRef.current[pill.id] ?? pill.content;
    setSelectedPillId(pill.id);
    setPanelContent(content);
    setPanelDraft(content);
    setPanelEditing(false);
  }

  function closePanel() {
    setSelectedPillId(null);
    setPanelEditing(false);
  }

  function saveEdit() {
    if (!selectedPillId) return;
    localEditsRef.current[selectedPillId] = panelDraft;
    setPanelContent(panelDraft);
    setPills((prev) =>
      prev.map((p) =>
        p.id === selectedPillId
          ? { ...p, content: panelDraft, status: p.status === "missing" ? "draft" : p.status }
          : p,
      ),
    );
    setPanelEditing(false);

    // Persist to business_profile so the edit survives reload and flows into
    // future briefing context. statusOf() will derive "confirmed" automatically
    // on next load because a profile value is present.
    const profileField = PILL_PROFILE_FIELD[selectedPillId];
    if (profileField && businessId && panelDraft.trim()) {
      const patch: Partial<BusinessMemory> = {};
      patch[profileField] = panelDraft;
      void updateBusinessProfile(businessId, patch).catch((err) =>
        console.error("[Zeya] pill save failed:", selectedPillId, err),
      );
    }
  }

  function markConfirmed() {
    if (!selectedPillId) return;

    // Resolve the content being confirmed: prefer in-flight local edit, then pill state.
    const confirmedContent =
      localEditsRef.current[selectedPillId] ??
      pills.find((p) => p.id === selectedPillId)?.content ??
      "";

    setPills((prev) =>
      prev.map((p) => (p.id === selectedPillId ? { ...p, status: "confirmed" } : p)),
    );
    const coreIds = ["offer", "icp", "pain_points", "objections", "tone"];
    const updated = pills.map((p) =>
      p.id === selectedPillId ? { ...p, status: "confirmed" as PillStatus } : p,
    );
    const filled = coreIds.filter((id) => {
      const pi = updated.find((p) => p.id === id);
      return pi && pi.status !== "missing";
    }).length;
    setProgressPercent(Math.round((filled / coreIds.length) * 100));

    // Persist confirmed value to business_profile. Writing the content here
    // promotes an "assumed" (event-only) value to "confirmed" (profile-backed)
    // and ensures Zeya carries this understanding into future sessions.
    const profileField = PILL_PROFILE_FIELD[selectedPillId];
    if (profileField && businessId && confirmedContent.trim()) {
      const patch: Partial<BusinessMemory> = {};
      patch[profileField] = confirmedContent;
      void updateBusinessProfile(businessId, patch).catch((err) =>
        console.error("[Zeya] pill confirm failed:", selectedPillId, err),
      );
    }
  }

  // ── Derived ─────────────────────────────────────────────────────────────────

  const corePills    = pills.filter((p) => CORE_IDS.has(p.id));
  const extraPills   = pills.filter((p) => !CORE_IDS.has(p.id));
  const visiblePills = pillsExpanded ? pills : corePills;

  const brief        = buildDailyBrief(pills, progressPercent, lastSessionStartedAt, eventCount);
  const selectedPill = pills.find((p) => p.id === selectedPillId) ?? null;

  const statusLine =
    progressPercent >= 80
      ? "Strategic context established."
      : progressPercent >= 40
        ? "Building strategic context."
        : "Establishing operational baseline.";

  const missionReadiness =
    progressPercent >= 80
      ? "Ready to prepare."
      : progressPercent >= 40
        ? "Completing context before preparation."
        : "Awaiting business context.";

  // ── Loading ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="flex min-h-dvh flex-col items-center justify-center gap-8"
        style={{ background: "#0a0709" }}
      >
        <div className="pointer-events-none fixed inset-0 -z-10">
          <div className="absolute left-1/2 top-1/3 h-[30rem] w-[30rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zeya-plum/10 blur-atmosphere" />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)" }}
          />
        </div>
        <motion.div
          initial={{ opacity: 0, filter: "blur(24px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          transition={{ duration: 2.0, ease: EASE }}
        >
          <PresenceCore state="idle" className="size-32 sm:size-40" />
        </motion.div>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.38, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
          className="text-[0.6rem] font-light tracking-widest text-zeya-hush/35 uppercase"
        >
          Reviewing your operation
        </motion.p>
      </div>
    );
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div
      className="relative isolate flex min-h-dvh flex-col items-center overflow-x-hidden px-4 pb-24 pt-12 sm:pt-16"
      style={{ background: "#0a0709" }}
    >
      {mockData && (
        <div className="fixed left-4 top-4 z-50">
          <span className="text-[0.52rem] font-light tracking-widest text-zeya-hush/25 uppercase">
            Preview
          </span>
        </div>
      )}

      {/* Ambient backdrop */}
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute left-1/2 top-[38%] h-[32rem] w-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-zeya-plum/11 blur-atmosphere" />
        <div className="absolute bottom-0 right-0 h-56 w-56 rounded-full bg-zeya-champagne/3 blur-atmosphere" />
        <div className="absolute left-0 top-[68%] h-40 w-40 rounded-full bg-zeya-aubergine/20 blur-atmosphere" />
        <div
          className="absolute inset-0"
          style={{ background: "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)" }}
        />
      </div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* CENTER PRESENCE                                                        */}
      {/* Recedes softly when a voice session is active.                        */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 16, filter: "blur(18px)" }}
        animate={{
          opacity: isSessionActive ? 0.45 : 1,
          y: isSessionActive ? -8 : 0,
          filter: "blur(0px)",
        }}
        transition={{ duration: isSessionActive ? 0.65 : 1.8, ease: EASE }}
        className="flex w-full max-w-lg flex-col items-center gap-5 text-center"
      >
        <PresenceCore
          state={
            briefingSession.voiceState === "speaking" ? "speaking"
            : briefingSession.voiceState === "listening" ? "listening"
            : briefingSession.voiceState === "thinking" ? "thinking"
            : "idle"
          }
          className="size-36 sm:size-48"
        />

        <div className="flex flex-col items-center gap-1">
          <h1 className="text-[1.0rem] font-light tracking-[0.2em] text-zeya-ivory/88 uppercase">
            Zeya
          </h1>
          {businessName && (
            <p className="mt-0.5 text-[0.875rem] font-light tracking-wide text-zeya-champagne/72">
              {businessName}
            </p>
          )}
          <p className="mt-1.5 text-[0.72rem] font-light tracking-wide text-zeya-hush/52">
            {statusLine}
          </p>
        </div>

        <div className="w-full max-w-[9rem]">
          <div className="h-px w-full overflow-hidden rounded-full bg-zeya-graphite/28">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-zeya-champagne/28 to-zeya-champagne/55"
              initial={{ width: 0 }}
              animate={{ width: `${progressPercent}%` }}
              transition={{ duration: 1.6, ease: EASE, delay: 0.5 }}
            />
          </div>
        </div>
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* MEMORY PILL CLOUD                                                      */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 10, filter: "blur(10px)" }}
        animate={{
          opacity: isSessionActive ? 0.32 : 1,
          y: 0,
          filter: "blur(0px)",
        }}
        transition={{ duration: isSessionActive ? 0.65 : 1.4, ease: EASE, delay: isSessionActive ? 0 : 0.3 }}
        className="mt-10 flex w-full max-w-lg flex-wrap justify-center gap-2"
      >
        {visiblePills.map((pill, i) => (
          <motion.button
            key={pill.id}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.42, ease: EASE, delay: 0.35 + i * 0.032 }}
            onClick={() => openPill(pill)}
            className={[
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition-all duration-200",
              selectedPillId === pill.id
                ? "border-zeya-champagne/28 bg-zeya-champagne/7"
                : "border-zeya-graphite/32 bg-zeya-aubergine/42 hover:border-zeya-graphite/55 hover:bg-zeya-aubergine/65",
            ].join(" ")}
          >
            <span className={["h-1.5 w-1.5 shrink-0 rounded-full", STATUS_DOT[pill.status]].join(" ")} />
            <span className="text-[0.72rem] font-light tracking-wide text-zeya-hush/78">
              {pill.label}
            </span>
          </motion.button>
        ))}

        {!pillsExpanded && extraPills.length > 0 && (
          <motion.button
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.42, ease: EASE, delay: 0.35 + corePills.length * 0.032 }}
            onClick={() => setPillsExpanded(true)}
            className="flex items-center rounded-full border border-zeya-graphite/22 px-3 py-1.5 transition-all duration-200 hover:border-zeya-graphite/42"
          >
            <span className="text-[0.68rem] font-light tracking-wide text-zeya-hush/32">
              +{extraPills.length}
            </span>
          </motion.button>
        )}
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* DAILY BRIEF                                                            */}
      {/* Recedes into background when a session is active.                     */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{
          opacity: isSessionActive ? 0.28 : 1,
          y: 0,
        }}
        transition={{ duration: isSessionActive ? 0.65 : 1.3, ease: EASE, delay: isSessionActive ? 0 : 0.48 }}
        className="mt-12 w-full max-w-lg"
      >
        <BriefSection brief={brief} />
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* VOICE ACTIVATION SURFACE                                              */}
      {/*                                                                       */}
      {/* Pre-session: waveform breathes gently + "Continue briefing" label.   */}
      {/* Active session: waveform responds to voice state + live transcript.  */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1.4, ease: EASE, delay: 0.62 }}
        className="mt-4 w-full max-w-lg"
      >
        <div className="border-t border-zeya-graphite/14 pt-8 pb-6">
          <AnimatePresence mode="wait">

            {/* ── Pre-session: invitation ──────────────────────────────────────── */}
            {briefingSession.connectionStatus === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4, filter: "blur(4px)" }}
                transition={{ duration: 0.45, ease: EASE }}
                className="flex flex-col items-center gap-5"
              >
                {/* Waveform — gentle idle breathing */}
                <button
                  onClick={() => void briefingSession.startSession()}
                  className="group flex flex-col items-center gap-5 transition-all duration-500"
                  aria-label="Begin briefing session"
                >
                  <motion.div
                    animate={{ opacity: [0.7, 1.0, 0.7] }}
                    transition={{ duration: 4.2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <WaveformBars voiceState="inactive" />
                  </motion.div>

                  <div className="flex flex-col items-center gap-1.5">
                    {/* Primary label — breathing, implies live presence */}
                    <motion.span
                      animate={{ opacity: [0.32, 0.58, 0.32] }}
                      transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
                      className="text-[0.62rem] font-light tracking-[0.28em] uppercase transition-colors duration-500 group-hover:text-zeya-ivory/72"
                      style={{ color: COLOR.hush, opacity: 0.45 }}
                    >
                      Ready to talk
                    </motion.span>

                    {/* Secondary intent label */}
                    <motion.span
                      animate={{ opacity: [0.22, 0.40, 0.22] }}
                      transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
                      className="text-[0.68rem] font-light tracking-wide transition-colors duration-500 group-hover:text-zeya-champagne/60"
                      style={{ color: COLOR.champagne, opacity: 0.30 }}
                    >
                      Continue today's briefing
                    </motion.span>
                  </div>
                </button>
              </motion.div>
            )}

            {/* ── Active session ────────────────────────────────────────────────── */}
            {briefingSession.connectionStatus !== "idle" && (
              <motion.div
                key="active"
                initial={{ opacity: 0, y: 10, filter: "blur(8px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -6, filter: "blur(6px)" }}
                transition={{ duration: 0.55, ease: EASE }}
                className="flex flex-col items-center gap-6"
              >
                {/* Waveform — responds to voice state */}
                <WaveformBars voiceState={briefingSession.voiceState} />

                {/* Voice state label */}
                <AnimatePresence mode="wait">
                  {briefingSession.voiceState !== "speaking" && (
                    <motion.span
                      key={briefingSession.voiceState}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.25 }}
                      className="text-[0.58rem] font-light tracking-[0.24em] uppercase"
                      style={{ color: COLOR.hush, opacity: 0.40 }}
                    >
                      {briefingSession.connectionStatus === "connecting"
                        ? "Connecting"
                        : briefingSession.connectionStatus === "error"
                          ? "Connection error"
                          : (VOICE_LABEL[briefingSession.voiceState] ?? "")}
                    </motion.span>
                  )}
                </AnimatePresence>

                {/* Live transcript — pure text, no bubbles */}
                {briefingSession.transcript.length > 0 && (
                  <div className="w-full space-y-4">
                    <AnimatePresence initial={false}>
                      {briefingSession.transcript.slice(-6).map((entry) => (
                        <motion.div
                          key={entry.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.42, ease: EASE }}
                          className={entry.role === "user" ? "text-right" : ""}
                        >
                          {entry.role === "agent" ? (
                            <p className="text-[0.875rem] font-light leading-relaxed tracking-wide text-zeya-ivory/78">
                              {entry.text}
                            </p>
                          ) : (
                            <p className="text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-hush/55">
                              {entry.text}
                            </p>
                          )}
                        </motion.div>
                      ))}
                    </AnimatePresence>
                    <div ref={transcriptBottomRef} />
                  </div>
                )}

                {/* End session — minimal, intentional */}
                {briefingSession.connectionStatus === "connected" && (
                  <motion.button
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 1.2, duration: 0.5 }}
                    onClick={() => briefingSession.endSession()}
                    className="mt-2 text-[0.56rem] font-light tracking-widest text-zeya-hush/25 uppercase transition-colors hover:text-zeya-hush/48"
                  >
                    End session
                  </motion.button>
                )}
              </motion.div>
            )}

          </AnimatePresence>
        </div>
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* MISSION SECTION                                                        */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{
          opacity: isSessionActive ? 0.22 : 1,
          y: 0,
        }}
        transition={{ duration: isSessionActive ? 0.65 : 1.3, ease: EASE, delay: isSessionActive ? 0 : 0.72 }}
        className="w-full max-w-lg"
      >
        <div className="border-t border-zeya-graphite/14 py-5">
          <div className="mb-3.5 flex items-center justify-between">
            <span className="text-[0.55rem] font-light tracking-widest text-zeya-hush/38 uppercase">
              Mission
            </span>
            <span
              className={[
                "h-1.5 w-1.5 rounded-full",
                missionDetail
                  ? "bg-zeya-champagne/55"
                  : pills.find((p) => p.id === "first_mission")?.status === "draft"
                    ? "bg-zeya-champagne/30"
                    : "bg-zeya-graphite/35",
              ].join(" ")}
            />
          </div>

          <div className="space-y-3.5">
            {missionDetail ? (
              <>
                <MissionRow label="Mission"  value={missionDetail.name} />
                <MissionRow label="Target"   value={missionDetail.target_segment} />
                <MissionRow label="Testing"  value={missionDetail.hypothesis} />
                <MissionRow label="Angle"    value={missionDetail.sales_angle} />
                {missionDetail.required_inputs.length > 0 && (
                  <MissionRow label="Needs"  value={missionDetail.required_inputs.join(" · ")} />
                )}
                <MissionRow label="Next"     value={missionDetail.next_action} />
                {/* Lead intake CTA — shown when prospect list is required */}
                {missionDetail.required_inputs.includes("prospect_list") && (
                  <div className="pt-1">
                    {leadSummary && leadSummary.total > 0 ? (
                      <button
                        onClick={() => setShowLeadIntake(true)}
                        className="text-[0.72rem] font-light tracking-wide text-zeya-champagne/55 transition-colors hover:text-zeya-champagne/78"
                      >
                        {leadSummary.total} lead{leadSummary.total !== 1 ? "s" : ""} added
                        {leadSummary.likelyMatch > 0 && ` · ${leadSummary.likelyMatch} likely match`}
                        {" "}· Manage
                      </button>
                    ) : (
                      <button
                        onClick={() => setShowLeadIntake(true)}
                        className="text-[0.72rem] font-light tracking-wide text-zeya-hush/38 transition-colors hover:text-zeya-champagne/60"
                      >
                        + Add prospects for this mission
                      </button>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                <MissionRow
                  label="Target"
                  value={pills.find((p) => p.id === "icp")?.content}
                />
                <MissionRow
                  label="Focus"
                  value="Validate messaging and objection patterns with the first prospect segment."
                />
                <MissionRow
                  label="Readiness"
                  value={missionReadiness}
                />
              </>
            )}
          </div>
        </div>
      </motion.div>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* LEAD INTAKE PANEL                                                      */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showLeadIntake && businessId && (
          <LeadIntakePanel
            businessId={businessId}
            missionDetail={missionDetail}
            businessIcp={pills.find((p) => p.id === "icp")?.content ?? null}
            onClose={() => setShowLeadIntake(false)}
            onImported={(summary) => {
              setLeadSummary(summary);
              setShowLeadIntake(false);
            }}
          />
        )}
      </AnimatePresence>

      {/* ────────────────────────────────────────────────────────────────────── */}
      {/* GLASS DETAIL PANEL                                                     */}
      {/* ────────────────────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {selectedPill && (
          <>
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="fixed inset-0 z-40 bg-zeya-void/52 backdrop-blur-[2px]"
              onClick={closePanel}
            />

            <motion.div
              key="panel"
              initial={{ opacity: 0, y: 32, filter: "blur(12px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 20, filter: "blur(10px)" }}
              transition={{ duration: 0.38, ease: EASE }}
              className={[
                "fixed z-50 flex flex-col overflow-hidden",
                "inset-x-3 bottom-3 max-h-[78vh] rounded-[1.5rem]",
                "sm:inset-x-auto sm:inset-y-4 sm:right-4 sm:bottom-auto sm:w-[26rem] sm:max-h-none sm:rounded-calm",
                "border border-zeya-graphite/35 bg-zeya-aubergine/96 shadow-presence backdrop-blur-sm",
              ].join(" ")}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-zeya-graphite/20 px-5 py-4">
                <div className="flex items-center gap-2.5">
                  <span className={["h-2 w-2 rounded-full", STATUS_DOT[selectedPill.status]].join(" ")} />
                  <span className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/86">
                    {selectedPill.label}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={[
                      "text-[0.6rem] font-light tracking-widest uppercase",
                      STATUS_TEXT[selectedPill.status],
                    ].join(" ")}
                  >
                    {STATUS_LABEL[selectedPill.status]}
                  </span>
                  <button
                    onClick={closePanel}
                    className="text-sm leading-none text-zeya-hush/35 transition-colors hover:text-zeya-hush/62"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto px-5 py-5" style={{ scrollbarWidth: "none" }}>
                {panelEditing ? (
                  <textarea
                    autoFocus
                    value={panelDraft}
                    onChange={(e) => setPanelDraft(e.target.value)}
                    className="min-h-[8rem] w-full resize-none bg-transparent text-[0.875rem] font-light leading-relaxed tracking-wide text-zeya-ivory/82 placeholder:text-zeya-hush/30 focus:outline-none"
                    placeholder="Enter details…"
                  />
                ) : (
                  <p className="whitespace-pre-wrap text-[0.875rem] font-light leading-relaxed tracking-wide text-zeya-ivory/80">
                    {panelContent}
                  </p>
                )}
              </div>

              <div className="shrink-0 border-t border-zeya-graphite/20 px-5 py-3.5">
                {panelEditing ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      className="flex-1 rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 py-2 text-[0.75rem] font-light tracking-wide text-zeya-champagne transition-all duration-200 hover:bg-zeya-champagne/15"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => { setPanelEditing(false); setPanelDraft(panelContent); }}
                      className="flex-1 rounded-presence border border-zeya-graphite/40 py-2 text-[0.75rem] font-light tracking-wide text-zeya-hush/62 transition-all duration-200 hover:text-zeya-hush/82"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    {!selectedPill.readOnly && (
                      <button
                        onClick={() => { setPanelEditing(true); setPanelDraft(panelContent); }}
                        className="rounded-presence border border-zeya-graphite/38 px-3.5 py-1.5 text-[0.72rem] font-light tracking-wide text-zeya-hush/62 transition-all duration-200 hover:border-zeya-graphite/65 hover:text-zeya-hush/82"
                      >
                        Edit
                      </button>
                    )}
                    {selectedPill.status !== "confirmed" && !selectedPill.readOnly && (
                      <button
                        onClick={markConfirmed}
                        className="rounded-presence border border-zeya-champagne/18 bg-zeya-champagne/6 px-3.5 py-1.5 text-[0.72rem] font-light tracking-wide text-zeya-champagne/68 transition-all duration-200 hover:bg-zeya-champagne/12 hover:text-zeya-champagne/90"
                      >
                        Mark confirmed
                      </button>
                    )}
                    <button
                      disabled
                      className="rounded-presence border border-zeya-graphite/25 px-3.5 py-1.5 text-[0.72rem] font-light tracking-wide text-zeya-hush/28 disabled:cursor-not-allowed"
                    >
                      Ask Zeya
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Daily brief section ──────────────────────────────────────────────────────

function BriefSection({ brief }: { brief: DailyBrief }) {
  const { dateLabel, lastEngaged, sections } = brief;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-[0.58rem] font-light tracking-widest text-zeya-hush/35 uppercase">
          {dateLabel}
        </span>
        {lastEngaged && (
          <span className="text-[0.58rem] font-light tracking-wide text-zeya-hush/30">
            Last session {lastEngaged}
          </span>
        )}
      </div>

      {sections.yesterday.length > 0 && (
        <div className="border-t border-zeya-graphite/14 py-4">
          <p className="mb-2.5 text-[0.55rem] font-light tracking-widest text-zeya-hush/38 uppercase">
            Yesterday
          </p>
          {sections.yesterday.map((entry, i) => (
            <p key={i} className="text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-hush/62">
              {entry.text}
            </p>
          ))}
        </div>
      )}

      <div className="border-t border-zeya-graphite/14 py-4">
        <p className="mb-2.5 text-[0.55rem] font-light tracking-widest text-zeya-hush/38 uppercase">
          Today
        </p>
        {sections.today.map((entry, i) => (
          <p key={i} className="text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-ivory/72">
            {entry.text}
          </p>
        ))}
      </div>

      <div className="border-t border-zeya-graphite/14 py-4">
        <p className="mb-2.5 text-[0.55rem] font-light tracking-widest text-zeya-hush/38 uppercase">
          Observations
        </p>
        {sections.observations.map((entry, i) => (
          <p key={i} className="text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-hush/60">
            {entry.text}
          </p>
        ))}
      </div>
    </div>
  );
}

// ─── Mission row ──────────────────────────────────────────────────────────────

function MissionRow({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="flex items-start gap-5">
      <span className="w-14 shrink-0 pt-px text-[0.58rem] font-light tracking-widest text-zeya-hush/38 uppercase">
        {label}
      </span>
      <span className="line-clamp-2 text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-hush/65">
        {value && value !== "Not captured yet." ? value : "—"}
      </span>
    </div>
  );
}
