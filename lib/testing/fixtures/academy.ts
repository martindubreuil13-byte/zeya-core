import type { RepresentationBrief } from "../../../types/experience";
import type { FormationSummary } from "../../../types/formation";
import type { VoiceTranscriptEntry } from "../../../types/voice";

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const ACADEMY_IDS = deepFreeze({
  business: "screenlab:academy:business",
  representation: "screenlab:academy:representation",
  brief: "screenlab:academy:brief",
  formation: "screenlab:academy:formation",
  version: "screenlab:academy:version",
});

export const ACADEMY_PROFILE = deepFreeze({
  founder: "Martin",
  businessName: "AI Architecture Academy for Small Businesses",
  audience: "Small-business owners and entrepreneurs",
  offers: [
    "Practical AI workshops",
    "AI adoption advisory",
    "AI architecture consulting",
    "Founder education programmes",
  ],
  positioning:
    "Helping small businesses adopt AI strategically instead of chasing disconnected tools.",
  objections: ["Cost", "Complexity", "Trust", "Implementation risk"],
  channels: ["LinkedIn", "Workshops", "Referrals", "Email", "Partnerships"],
});

export const ACADEMY_BRIEF: RepresentationBrief = deepFreeze({
  id: ACADEMY_IDS.brief,
  whatIHeard:
    "The AI Architecture Academy helps small-business owners make deliberate AI decisions before investing in tools, vendors, or automation.",
  whatStoodOut:
    "Martin combines practical education with architecture advice, making strategic AI adoption understandable without removing its commercial and operational realities.",
  whatThatMayMean:
    "The strongest early audience is an owner who sees AI opportunity but is concerned about cost, complexity, trust, and implementation risk.",
  whereIWouldBegin:
    "I would begin with workshops and advisory conversations sourced through LinkedIn, trusted referrals, email, and small-business partnerships.",
  alignmentQuestion:
    "Does this reflect how you want the Academy to be understood by a small-business owner?",
  confidenceLevel: "high",
  totalWordCount: 100,
  evidenceSources: [
    {
      sourceType: "zeya_conversation",
      sourceId: "screenlab:academy:evidence:zeya",
      speaker: "visitor",
      excerpt:
        "I want owners to make an AI architecture decision before they start collecting tools.",
      supports: ["what_i_heard", "what_stood_out"],
    },
    {
      sourceType: "veya_call",
      sourceId: "screenlab:academy:evidence:veya",
      speaker: "visitor",
      excerpt:
        "They worry about cost, complexity, trust, and whether their team can implement any of it.",
      supports: ["what_that_may_mean", "where_i_would_begin"],
    },
  ],
  validation: {
    evidence: "pass",
    interpretation: "pass",
    governance: "pass",
    violations: [],
  },
});

export const ACADEMY_TRANSCRIPT: VoiceTranscriptEntry[] = deepFreeze([
  {
    id: "screenlab:academy:transcript:zeya:1",
    role: "agent",
    text: "What do you want small-business owners to understand before adopting AI?",
    isFinal: true,
    createdAt: 1,
  },
  {
    id: "screenlab:academy:transcript:martin:1",
    role: "user",
    text: "They need a coherent architecture and adoption plan, not another list of tools.",
    isFinal: true,
    createdAt: 2,
  },
]);

export const ACADEMY_FORMATION_SUMMARY: FormationSummary = deepFreeze({
  proposalId: "screenlab:academy:formation:proposal",
  sourceFingerprint: "screenlab:academy:formation:fingerprint",
  generatorVersion: "screenlab-fixture-v1",
  isCurrent: true,
  sections: [
    {
      title: "Purpose",
      content:
        "Help small businesses adopt AI strategically through education, advisory work, and practical architecture.",
    },
    {
      title: "Audience and need",
      content:
        "Owners and entrepreneurs who see the opportunity but need clarity on cost, complexity, trust, and implementation risk.",
    },
    {
      title: "Commercial expression",
      content:
        "Lead with practical workshops and trusted advisory conversations, then deepen into architecture consulting where appropriate.",
    },
  ],
});

export const ACADEMY_LIVING_REPRESENTATION = deepFreeze({
  businessId: ACADEMY_IDS.business,
  representationId: ACADEMY_IDS.representation,
  version: {
    id: ACADEMY_IDS.version,
    number: 1,
    confidenceScore: 82,
    createdAt: "2026-08-01T00:00:00.000Z",
    isCanonical: true,
    elementValues: {
      business_identity: { value: ACADEMY_PROFILE.businessName },
      offer: { value: ACADEMY_PROFILE.offers.join(", ") },
      customer: { value: ACADEMY_PROFILE.audience },
      positioning: { value: ACADEMY_PROFILE.positioning },
      objections: { value: ACADEMY_PROFILE.objections.join(", ") },
      channel_expression: { value: ACADEMY_PROFILE.channels.join(", ") },
    },
  },
});

export const ACADEMY_OPERATIONAL_CONCEPTS = deepFreeze({
  documents: [
    { id: "screenlab:academy:document:workshop", name: "AI Readiness Workshop.pdf", state: "ready" },
    { id: "screenlab:academy:document:framework", name: "Small Business AI Architecture.md", state: "processing" },
  ],
  connectors: [
    { id: "screenlab:academy:connector:linkedin", name: "LinkedIn", state: "connected" },
    { id: "screenlab:academy:connector:email", name: "Email", state: "error" },
  ],
  leads: [
    { id: "screenlab:academy:lead:bakery", company: "North Star Bakery", fit: "Likely match", source: "Workshop" },
    { id: "screenlab:academy:lead:studio", company: "Practical Growth Studio", fit: "Possible match", source: "Referral" },
  ],
});
