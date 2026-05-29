// Deterministic fit classification — no LLM.
// Compares lead fields against mission target, business ICP, hypothesis, and sales angle.

import type { LeadInput, FitStatus } from "@/lib/leads/types";
import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";

export interface ClassificationContext {
  targetSegment?: string | null;    // mission target segment
  icp?: string | null;              // business target_customers / ICP
  hypothesis?: string | null;       // mission hypothesis
  salesAngle?: string | null;       // mission sales angle
}

// ─── Keyword expansion map ────────────────────────────────────────────────────
// Root keys are matched against the target_segment string.
// When a root key matches, its likely/possible keywords are added to the search sets.
// Easy to extend — add new roots as new segments are tested.

const SEGMENT_KEYWORDS: Record<string, { likely: string[]; possible: string[] }> = {
  seo: {
    likely:   ["seo", "search engine", "search optimization", "search optimisation", "digital marketing", "marketing agency", "inbound marketing"],
    possible: ["web design", "web development", "website", "advertising", "ppc", "sem", "content marketing", "lead generation", "growth"],
  },
  web: {
    likely:   ["web design", "web designer", "web development", "web developer", "website", "ui ux", "front-end", "frontend"],
    possible: ["digital agency", "creative", "branding", "wordpress", "shopify", "ecommerce", "graphic design"],
  },
  agency: {
    likely:   ["agency", "studio", "consultancy", "firm", "bureau"],
    possible: ["marketing", "advertising", "creative", "digital", "media", "consulting", "branding"],
  },
  freelancer: {
    likely:   ["freelancer", "freelance", "independent", "contractor", "self-employed", "solo"],
    possible: ["designer", "developer", "writer", "copywriter", "photographer", "videographer", "consultant"],
  },
  coaching: {
    likely:   ["coach", "coaching", "mentor", "mentoring", "life coach", "business coach", "executive coach"],
    possible: ["trainer", "consultant", "speaker", "workshop", "therapist", "counselor", "accountability"],
  },
  saas: {
    likely:   ["saas", "software", "platform", "app", "application", "startup", "tech company"],
    possible: ["it", "digital", "cloud", "developer", "engineering", "product", "api"],
  },
  ecommerce: {
    likely:   ["ecommerce", "e-commerce", "online store", "shopify", "retail", "merchant", "shop"],
    possible: ["product", "brand", "dtc", "direct to consumer", "marketplace", "store"],
  },
  real_estate: {
    likely:   ["real estate", "realtor", "property", "realty", "mortgage", "housing"],
    possible: ["investment", "developer", "construction", "renovation", "broker"],
  },
  insurance: {
    likely:   ["insurance", "insurer", "broker", "underwriting"],
    possible: ["financial", "risk", "protection", "benefits", "healthcare", "coverage"],
  },
  consulting: {
    likely:   ["consulting", "consultant", "advisory", "advisor", "strategy", "strategist", "management consulting"],
    possible: ["business services", "operations", "analyst", "research"],
  },
  finance: {
    likely:   ["finance", "financial", "accounting", "bookkeeping", "investing", "wealth", "cfo"],
    possible: ["tax", "audit", "payroll", "banking", "credit"],
  },
  health: {
    likely:   ["health", "wellness", "fitness", "nutrition", "clinic", "medical", "therapy"],
    possible: ["yoga", "gym", "spa", "beauty", "mental health", "pharmacy"],
  },
};

// ─── Keyword extraction ───────────────────────────────────────────────────────

function buildKeywordSets(contextStrings: (string | null | undefined)[]): { likely: Set<string>; possible: Set<string> } {
  const likely  = new Set<string>();
  const possible = new Set<string>();

  // Process each context string — mission target, ICP, hypothesis, sales angle
  const allContextText = contextStrings
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!allContextText.trim()) return { likely, possible };

  // Always include words from the context as likely keywords
  const words = allContextText.split(/[\s,\/\-]+/).filter((w) => w.length > 2);
  words.forEach((w) => likely.add(w));
  likely.add(allContextText);

  // Expand using the segment keyword map
  // Check each root key and its likely/possible keywords against all context text
  for (const [rootKey, expansion] of Object.entries(SEGMENT_KEYWORDS)) {
    const allLikely = [rootKey.replace(/_/g, " "), ...expansion.likely];
    if (allLikely.some((term) => allContextText.includes(term))) {
      expansion.likely.forEach((k) => likely.add(k));
      expansion.possible.forEach((k) => possible.add(k));
    }
  }

  // Remove any possible keywords that are also in likely (likely takes precedence)
  for (const kw of likely) possible.delete(kw);

  return { likely, possible };
}

// ─── Main classifier ──────────────────────────────────────────────────────────

// Backward compatible: accepts either a MissionDetail or a ClassificationContext (plus optional ICP)
export function classifyLeadFit(
  lead: LeadInput,
  missionDetailOrContext: MissionDetail | ClassificationContext | null,
  businessIcp?: string | null,
): FitStatus {
  // Build the classification context from inputs
  let context: ClassificationContext;

  if (
    missionDetailOrContext &&
    "target_segment" in missionDetailOrContext &&
    "hypothesis" in missionDetailOrContext
  ) {
    // It's a MissionDetail
    context = {
      targetSegment: missionDetailOrContext.target_segment,
      hypothesis: missionDetailOrContext.hypothesis,
      salesAngle: missionDetailOrContext.sales_angle,
    };
  } else if (missionDetailOrContext) {
    // It's already a ClassificationContext
    context = missionDetailOrContext as ClassificationContext;
  } else {
    context = {};
  }

  // Merge in business ICP if provided
  if (businessIcp && !context.icp) {
    context.icp = businessIcp;
  }

  // Build keyword sets from all available context
  const { likely, possible } = buildKeywordSets([
    context.targetSegment,
    context.icp,
    context.hypothesis,
    context.salesAngle,
  ]);

  // No context at all = unreviewed
  if (likely.size === 0 && possible.size === 0) return "unreviewed";

  // Build a single searchable string from all meaningful lead fields
  const leadText = [
    lead.company_name,
    lead.industry,
    lead.notes,
    lead.website,
    lead.email?.split("@")[1], // domain may hint at industry
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (!leadText.trim()) return "weak_match";

  if ([...likely].some((kw) => leadText.includes(kw)))  return "likely_match";
  if ([...possible].some((kw) => leadText.includes(kw))) return "possible_match";
  return "weak_match";
}
