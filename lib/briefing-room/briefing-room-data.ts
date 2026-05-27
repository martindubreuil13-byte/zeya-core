// Maps raw business profile + memory_events into the pill/panel data model
// consumed by ZeyaBriefingRoom. No LLM — pure field mapping + gap detection.

export type PillStatus = "confirmed" | "assumed" | "missing" | "draft";

export interface PillData {
  id: string;
  label: string;
  status: PillStatus;
  content: string;
  readOnly?: boolean;
}

export interface BriefingRoomData {
  businessName: string | null;
  memorySummary: string | null;
  pills: PillData[];
  progressPercent: number;
}

interface MemoryEvent {
  event_type: string;
  content: string;
}

function latest(events: MemoryEvent[], type: string): string | null {
  const hits = events.filter((e) => e.event_type === type);
  return hits.length > 0 ? hits[hits.length - 1].content : null;
}

function statusOf(profileVal: string | null, eventVal: string | null): PillStatus {
  if (profileVal?.trim()) return "confirmed";
  if (eventVal?.trim()) return "assumed";
  return "missing";
}

export function buildBriefingData(
  rawProfile: Record<string, unknown> | null,
  businessName: string | null,
  memorySummary: string | null,
  memoryEvents: MemoryEvent[],
  callLog: { role: string; content: string }[],
): BriefingRoomData {
  const p = rawProfile ?? {};
  const g = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : null);

  // Profile fields
  const offerP = g("offer");
  const icpP = g("target_customers");
  const painP = g("pain_points");
  const objP = g("objections");
  const toneP = g("preferred_tone");

  // Event fields
  const offerE = latest(memoryEvents, "offer");
  const icpE = latest(memoryEvents, "icp");
  const painE = latest(memoryEvents, "pain_point");
  const objE = latest(memoryEvents, "objection");
  const toneE = latest(memoryEvents, "tone");
  const pricingE = latest(memoryEvents, "pricing");
  const proofE = latest(memoryEvents, "proof_point");
  const salesArgE =
    latest(memoryEvents, "sales_argument") ??
    latest(memoryEvents, "differentiator") ??
    latest(memoryEvents, "positioning");
  const missionE = latest(memoryEvents, "mission_recommendation");

  // Missing info: captured gaps + static gap detection
  const capturedGaps = memoryEvents
    .filter((e) => e.event_type === "missing_information" || e.event_type === "unresolved_question")
    .map((e) => e.content);
  const staticGaps: string[] = [];
  if (!offerP && !offerE) staticGaps.push("Core offer — not captured");
  if (!icpP && !icpE) staticGaps.push("Ideal customer profile — not defined");
  if (!proofE) staticGaps.push("Strongest proof point — unknown");
  if (!pricingE) staticGaps.push("Pricing context — not discussed");
  if (!toneP && !toneE) staticGaps.push("Brand tone preference — not set");
  const allGaps = [...new Set([...capturedGaps, ...staticGaps])];

  const pills: PillData[] = [
    {
      id: "offer",
      label: "Offer",
      status: statusOf(offerP, offerE),
      content: offerP ?? offerE ?? "Not captured yet.",
    },
    {
      id: "icp",
      label: "ICP",
      status: statusOf(icpP, icpE),
      content: icpP ?? icpE ?? "Not captured yet.",
    },
    {
      id: "pain_points",
      label: "Pain Points",
      status: statusOf(painP, painE),
      content: painP ?? painE ?? "Not captured yet.",
    },
    {
      id: "objections",
      label: "Objections",
      status: statusOf(objP, objE),
      content: objP ?? objE ?? "Not captured yet.",
    },
    {
      id: "pricing",
      label: "Pricing",
      status: statusOf(null, pricingE),
      content: pricingE ?? "Not discussed yet.",
    },
    {
      id: "tone",
      label: "Tone",
      status: statusOf(toneP, toneE),
      content: toneP ?? toneE ?? "Not captured yet.",
    },
    {
      id: "proof_points",
      label: "Proof Points",
      status: statusOf(null, proofE),
      content: proofE ?? "No proof points captured yet.",
    },
    {
      id: "sales_arguments",
      label: "Sales Arguments",
      status: statusOf(null, salesArgE),
      content: salesArgE ?? "Not developed yet.",
    },
    {
      id: "missing_info",
      label: "Missing Info",
      status: allGaps.length > 0 ? "draft" : "confirmed",
      content: allGaps.length > 0 ? allGaps.join("\n") : "No critical gaps identified.",
      readOnly: true,
    },
    {
      id: "first_mission",
      label: "First Mission",
      status: missionE ? "draft" : "missing",
      content: missionE ?? "Zeya will recommend a first mission once enough context is captured.",
    },
    {
      id: "call_log",
      label: "Call Log",
      status: callLog.length > 0 ? "confirmed" : "missing",
      content:
        callLog.length > 0
          ? callLog
              .map((m) => `${m.role === "user" ? "You" : "Zeya"}: ${m.content}`)
              .join("\n\n")
          : "No call log yet.",
      readOnly: true,
    },
    {
      id: "agent_roster",
      label: "Agent Roster",
      status: "missing",
      content: "No agents deployed yet. Agents will be assigned after the first mission is approved.",
      readOnly: true,
    },
    {
      id: "tools",
      label: "Tools",
      status: "missing",
      content: "No tools configured. Connect CRM, email, or dialer integrations here.",
      readOnly: true,
    },
    {
      id: "routine",
      label: "Routine",
      status: "missing",
      content: "No outreach routine defined. Routine will be shaped after first mission debrief.",
      readOnly: true,
    },
  ];

  // Progress over core strategic fields only
  const coreIds = ["offer", "icp", "pain_points", "objections", "tone"];
  const filledCount = coreIds.filter((id) => {
    const pill = pills.find((pi) => pi.id === id);
    return pill && pill.status !== "missing";
  }).length;
  const progressPercent = Math.round((filledCount / coreIds.length) * 100);

  return { businessName, memorySummary, pills, progressPercent };
}
