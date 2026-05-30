export interface BusinessMemory {
  business_name: string | null;
  industry: string | null;
  offer: string | null;
  target_customers: string | null;
  differentiators: string | null;
  acquisition_channels: string | null;
  preferred_tone: string | null;
  pain_points: string | null;
  objections: string | null;
  goals: string | null;
  // Extended operational fields — promoted from memory_events when founder confirms or edits
  proof_points: string | null;
  sales_arguments: string | null;
  pricing: string | null;
  first_mission: string | null;
  // Positioning and synthesis fields — written by the memory metabolism engine
  positioning: string | null;
  last_session_synthesis: string | null;
  strategic_focus: string | null;
  current_mission: string | null;
  unresolved_tensions: string | null;
  strategic_gaps: string | null;
  // Epistemic layer — what is known, assumed, or validated by market evidence
  known_facts: string | null;         // newline-separated confirmed facts
  assumptions: string | null;         // newline-separated working hypotheses
  validated_learnings: string | null; // newline-separated evidence-backed learnings
  // Mission control — active structured sales mission (stored as JSON string)
  current_mission_detail: string | null;
  // Caller brief — prepared talking points for selected prospects (markdown format)
  caller_brief: string | null;
}

export function emptyBusinessMemory(): BusinessMemory {
  return {
    business_name: null,
    industry: null,
    offer: null,
    target_customers: null,
    differentiators: null,
    acquisition_channels: null,
    preferred_tone: null,
    pain_points: null,
    objections: null,
    goals: null,
    proof_points: null,
    sales_arguments: null,
    pricing: null,
    first_mission: null,
    positioning: null,
    last_session_synthesis: null,
    strategic_focus: null,
    current_mission: null,
    unresolved_tensions: null,
    strategic_gaps: null,
    known_facts: null,
    assumptions: null,
    validated_learnings: null,
    current_mission_detail: null,
    caller_brief: null,
  };
}

const INDUSTRY_SIGNALS: Record<string, string[]> = {
  coaching: ["coach", "coaching", "mentor", "mentoring", "mindset", "accountability"],
  consulting: ["consult", "consulting", "advisor", "advisory", "strategy", "strategist"],
  agency: ["agency", "studio", "creative", "branding", "marketing", "ads", "campaigns"],
  saas: ["software", "saas", "app", "platform", "tool", "subscription", "dashboard", "api"],
  ecommerce: ["shop", "store", "ecommerce", "products", "sell online", "shopify", "merchandise"],
  services: ["service", "freelance", "contractor", "done-for-you", "dfy"],
  education: ["course", "program", "training", "education", "teach", "workshop", "cohort"],
  health: ["health", "wellness", "fitness", "nutrition", "therapy", "clinic", "medical"],
  real_estate: ["real estate", "property", "properties", "realty", "homes", "housing"],
  finance: ["finance", "financial", "accounting", "bookkeeping", "investing", "wealth"],
};

const TONE_SIGNALS: Record<string, string[]> = {
  professional: ["professional", "formal", "corporate", "expert", "authoritative", "polished"],
  friendly: ["friendly", "warm", "approachable", "casual", "conversational", "relaxed"],
  bold: ["bold", "direct", "confident", "assertive", "powerful", "strong"],
  empathetic: ["empathetic", "caring", "supportive", "nurturing", "compassionate", "gentle"],
  playful: ["playful", "fun", "witty", "humorous", "lighthearted", "energetic"],
  premium: ["premium", "luxury", "high-end", "exclusive", "sophisticated", "elevated"],
};

const CHANNEL_SIGNALS: Record<string, string[]> = {
  referrals: ["referral", "word of mouth", "word-of-mouth", "clients refer", "recommendations"],
  instagram: ["instagram", "ig", "reels", "stories", "dms"],
  linkedin: ["linkedin", "linkedin outreach", "connections"],
  google: ["google", "seo", "search", "organic search", "google ads"],
  facebook: ["facebook", "fb", "facebook ads", "meta ads"],
  content: ["content", "blog", "youtube", "podcast", "articles"],
  email: ["email", "newsletter", "email list", "cold email"],
  paid_ads: ["paid ads", "ads", "advertising", "ppc", "paid traffic"],
  cold_outreach: ["cold outreach", "cold dms", "prospecting", "cold calling"],
  events: ["events", "conferences", "networking", "speaking"],
};

function detectCategory(text: string, signals: Record<string, string[]>): string | null {
  const lower = text.toLowerCase();
  let best: string | null = null;
  let bestCount = 0;

  for (const [category, keywords] of Object.entries(signals)) {
    const count = keywords.filter((kw) => lower.includes(kw)).length;
    if (count > bestCount) {
      bestCount = count;
      best = category;
    }
  }
  return best;
}

function extractBusinessName(text: string): string | null {
  const patterns = [
    /(?:called|named|it's|it is|we are|we're|our business is|company is|brand is)\s+["']?([A-Z][a-zA-Z0-9\s&.',-]{1,40})["']?/i,
    /["']([A-Z][a-zA-Z0-9\s&.',-]{1,40})["']\s*(?:is|are|helps|sells|offers)/i,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

function cleanAnswer(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export type OnboardingStep =
  | "offer"
  | "target_customers"
  | "differentiators"
  | "acquisition_channels"
  | "preferred_tone"
  | "pain_points";

export function extractFromAnswer(
  step: OnboardingStep,
  answer: string,
  current: BusinessMemory
): Partial<BusinessMemory> {
  const updates: Partial<BusinessMemory> = {};
  const clean = cleanAnswer(answer);

  const maybeName = extractBusinessName(answer);
  if (maybeName && !current.business_name) {
    updates.business_name = maybeName;
  }

  switch (step) {
    case "offer": {
      updates.offer = clean;
      const industry = detectCategory(answer, INDUSTRY_SIGNALS);
      if (industry) updates.industry = industry;
      break;
    }
    case "target_customers": {
      updates.target_customers = clean;
      break;
    }
    case "differentiators": {
      updates.differentiators = clean;
      break;
    }
    case "acquisition_channels": {
      updates.acquisition_channels = clean;
      const channels = Object.keys(CHANNEL_SIGNALS).filter((ch) =>
        CHANNEL_SIGNALS[ch].some((kw) => answer.toLowerCase().includes(kw))
      );
      if (channels.length > 0) {
        updates.acquisition_channels = channels.join(", ");
      }
      break;
    }
    case "preferred_tone": {
      const tone = detectCategory(answer, TONE_SIGNALS);
      updates.preferred_tone = tone ?? clean;
      break;
    }
    case "pain_points": {
      updates.pain_points = clean;
      break;
    }
  }

  return updates;
}

export function applyCorrection(answer: string, current: BusinessMemory): Partial<BusinessMemory> {
  const updates: Partial<BusinessMemory> = {};
  const lower = answer.toLowerCase();

  if (lower.includes("name") || lower.includes("called")) {
    const name = extractBusinessName(answer);
    if (name) updates.business_name = name;
  }
  if (lower.includes("sell") || lower.includes("offer") || lower.includes("product") || lower.includes("service")) {
    updates.offer = cleanAnswer(answer);
  }
  if (lower.includes("customer") || lower.includes("client") || lower.includes("help") || lower.includes("audience")) {
    updates.target_customers = cleanAnswer(answer);
  }
  if (lower.includes("different") || lower.includes("unique") || lower.includes("special")) {
    updates.differentiators = cleanAnswer(answer);
  }
  if (lower.includes("find") || lower.includes("discover") || lower.includes("channel") || lower.includes("reach")) {
    updates.acquisition_channels = cleanAnswer(answer);
  }
  if (lower.includes("tone") || lower.includes("voice") || lower.includes("speak") || lower.includes("sound")) {
    updates.preferred_tone = cleanAnswer(answer);
  }
  if (lower.includes("frustrat") || lower.includes("problem") || lower.includes("struggle") || lower.includes("pain")) {
    updates.pain_points = cleanAnswer(answer);
  }

  return Object.keys(updates).length > 0 ? updates : { pain_points: cleanAnswer(answer) };
}

export function assessAnswerQuality(answer: string, step: OnboardingStep): "clear" | "needs_more" {
  const clean = answer.trim();
  const wordCount = clean.split(/\s+/).filter(Boolean).length;

  if (clean.length < 8 || wordCount < 2) return "needs_more";

  switch (step) {
    case "offer":
    case "differentiators":
      return wordCount >= 6 ? "clear" : "needs_more";
    case "target_customers":
      return wordCount >= 4 ? "clear" : "needs_more";
    case "preferred_tone":
      return wordCount >= 2 ? "clear" : "needs_more";
    default:
      return wordCount >= 5 ? "clear" : "needs_more";
  }
}

export function buildConversationalSummary(memory: BusinessMemory): string {
  const lines: string[] = [];

  if (memory.business_name) lines.push(memory.business_name + ".");

  if (memory.offer && memory.target_customers) {
    lines.push(
      `You work with ${memory.target_customers.toLowerCase()}, helping them with ${memory.offer.toLowerCase()}.`
    );
  } else if (memory.offer) {
    lines.push(`Offer: ${memory.offer}.`);
  } else if (memory.target_customers) {
    lines.push(`You work with ${memory.target_customers.toLowerCase()}.`);
  }

  if (memory.differentiators) lines.push(`What sets you apart: ${memory.differentiators}.`);
  if (memory.acquisition_channels) lines.push(`Clients find you through ${memory.acquisition_channels}.`);
  if (memory.preferred_tone) lines.push(`Tone I'll use: ${memory.preferred_tone}.`);
  if (memory.pain_points) lines.push(`Most pressing challenge: ${memory.pain_points}.`);

  return lines.join("\n");
}

// Kept for backward compatibility — new code should prefer buildConversationalSummary.
export function buildMemorySummary(memory: BusinessMemory): string {
  return buildConversationalSummary(memory);
}
