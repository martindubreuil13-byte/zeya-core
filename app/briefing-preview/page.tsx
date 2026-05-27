/**
 * /briefing-preview
 *
 * Dev/design bypass route — opens the Briefing Room directly with realistic
 * mock data. No authentication, no Supabase. Isolated from production logic.
 *
 * Usage: http://localhost:3000/briefing-preview
 */

import { ZeyaBriefingRoom, type PreviewData } from "@/components/briefing-room/ZeyaBriefingRoom";

// ─── Mock business data ───────────────────────────────────────────────────────
//
// Represents a fractional CFO firm at ~60% onboarding completion:
// core offer / ICP / pain points confirmed, objections assumed, tone missing.
// lastSessionStartedAt simulates a session completed yesterday (2026-05-26)
// so the daily brief shows realistic continuity context.

const MOCK_DATA: PreviewData = {
  businessName: "Meridian Advisory",
  progressPercent: 60,
  lastSessionStartedAt: "2026-05-26T14:30:00.000Z",
  eventCount: 8,
  pills: [
    {
      id: "offer",
      label: "Offer",
      status: "confirmed",
      content:
        "Fractional CFO and financial strategy for B2B services firms scaling from $2M to $20M ARR. We become the client's finance department — no full-time hire needed.",
    },
    {
      id: "icp",
      label: "ICP",
      status: "confirmed",
      content:
        "Founder-led services businesses, 10–80 employees. Bootstrapped or lightly funded. Decisions made by the founder without dedicated finance expertise. Typically $2M–$15M ARR.",
    },
    {
      id: "pain_points",
      label: "Pain Points",
      status: "confirmed",
      content:
        "Cash flow blind spots. Board or investor questions they can't answer confidently. No scenario modeling before major hires or contracts. Bookkeeper fills the role but can't advise.",
    },
    {
      id: "objections",
      label: "Objections",
      status: "assumed",
      content:
        "'We're not big enough for a CFO' and 'we already have a bookkeeper.' The real objection: they don't know what they're missing — they've never had real financial leadership.",
    },
    {
      id: "tone",
      label: "Tone",
      status: "missing",
      content: "Not captured yet.",
    },
    {
      id: "proof_points",
      label: "Proof Points",
      status: "assumed",
      content:
        "Average client grows 40% revenue in first 12 months post-engagement. Three clients successfully raised seed rounds after 6 months of financial restructuring with Meridian.",
    },
    {
      id: "pricing",
      label: "Pricing",
      status: "assumed",
      content: "$4,500–$12,000/month depending on complexity and stage. 3-month minimum engagement.",
    },
    {
      id: "sales_arguments",
      label: "Sales Arguments",
      status: "assumed",
      content:
        "You're making million-dollar decisions without a finance brain in the room. That's the gap we fill — without the cost of a full-time executive.",
    },
    {
      id: "missing_info",
      label: "Missing Info",
      status: "draft",
      content:
        "Preferred brand tone — not discussed\nSales cycle length — unknown\nCRM and outreach tools — not confirmed\nIdeal first outreach channel — not set",
      readOnly: true,
    },
    {
      id: "first_mission",
      label: "First Mission",
      status: "draft",
      content:
        "Target founder-led agencies ($3M–$8M ARR). Lead with cash visibility pain. Qualify on whether they have a dedicated finance function. Avoid companies with active CFO search.",
    },
    {
      id: "call_log",
      label: "Call Log",
      status: "confirmed",
      content: [
        "Zeya: What product or service are we focusing on?",
        "You: We're a fractional CFO firm — B2B services companies are our target.",
        "Zeya: CFO-level services for services businesses. Who feels that need most acutely?",
        "You: Founders scaling past $2M who realize their bookkeeper isn't enough.",
        "Zeya: Makes sense — they've outgrown the tool but haven't hired the person. What's the offer, specifically?",
        "You: We step in as their finance department. Strategy, cash flow, board prep, scenario modeling.",
        "Zeya: So you're not just reporting — you're advising and owning the financial narrative. What's the typical size of a client when they first come to you?",
        "You: Usually $2M to $8M ARR, sometimes up to $15M if they've been neglecting finance.",
      ].join("\n"),
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
  ],
};

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BriefingPreviewPage() {
  return <ZeyaBriefingRoom mockData={MOCK_DATA} />;
}
