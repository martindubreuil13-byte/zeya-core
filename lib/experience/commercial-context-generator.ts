/**
 * Lightweight commercial context generation for Representation Brief enrichment.
 *
 * Purpose: Generate tentative commercial hypotheses based on Zeya and Veya conversation evidence.
 * All outputs are labeled as explicit (stated), observed (inferred from evidence), or hypothesis (educated guess).
 * Never claims certainty. Always acknowledges limitations.
 */

export type ConversationTurn = {
  role?: string;
  text?: string;
  id?: string;
};

export interface CommercialContext {
  businessCategory: {
    label: string;
    confidence: "explicit" | "observed" | "hypothesis";
    evidence?: string;
  };
  likelyCustomerType: {
    description: string;
    confidence: "explicit" | "observed" | "hypothesis";
    evidence?: string;
  };
  explicitProblems: Array<{
    problem: string;
    evidence: string;
  }>;
  acquisitionPattern: {
    current: string;
    confidence: "explicit" | "observed" | "hypothesis";
    evidence?: string;
  };
  industryHypotheses: Array<{
    hypothesis: string;
    applicability: string;
    confidence: "explicit" | "observed" | "hypothesis";
  }>;
  representationOpportunity: {
    description: string;
    confidence: "explicit" | "observed" | "hypothesis";
    evidence?: string;
  };
  importantUncertainty: string;
  overallConfidence: "high" | "moderate" | "low";
}

function extractVisitorUtterances(turns: ConversationTurn[]): string {
  return turns
    .filter((t) => t.role === "visitor")
    .map((t) => (typeof t.text === "string" ? t.text.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

function findExplicitReference(
  text: string,
  keywords: string[],
): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
}

function detectBusinessCategory(
  businessDescription: string | null,
  zeyaTranscript: ConversationTurn[],
  veyaTranscript: ConversationTurn[],
): CommercialContext["businessCategory"] {
  const allText = [
    businessDescription || "",
    extractVisitorUtterances(zeyaTranscript),
    extractVisitorUtterances(veyaTranscript),
  ].join(" ");

  const categories = [
    { names: ["coach", "coaching", "consulting", "consultant"], category: "Coaching or Consulting" },
    { names: ["product", "software", "app", "saas", "platform"], category: "Product or SaaS" },
    { names: ["service", "services", "agency", "freelance"], category: "Service Business" },
    { names: ["retail", "ecommerce", "store", "shop"], category: "Retail or E-commerce" },
    { names: ["manufacturing", "production", "maker"], category: "Manufacturing" },
  ];

  for (const { names, category } of categories) {
    if (names.some((n) => allText.toLowerCase().includes(n))) {
      return {
        label: category,
        confidence: businessDescription ? "explicit" : "observed",
        evidence: businessDescription || undefined,
      };
    }
  }

  return {
    label: "Business (category not clearly stated)",
    confidence: "hypothesis",
  };
}

function detectCustomerType(
  businessDescription: string | null,
  zeyaTranscript: ConversationTurn[],
  veyaTranscript: ConversationTurn[],
): CommercialContext["likelyCustomerType"] {
  const allText = [
    businessDescription || "",
    extractVisitorUtterances(zeyaTranscript),
    extractVisitorUtterances(veyaTranscript),
  ].join(" ");

  // Look for explicit mentions
  if (findExplicitReference(allText, ["small business", "sme", "smb"])) {
    return {
      description: "Small to medium-sized businesses",
      confidence: "explicit",
      evidence: "Visitor mentioned SMBs or small businesses",
    };
  }

  if (findExplicitReference(allText, ["enterprise", "large companies"])) {
    return {
      description: "Enterprise or large organizations",
      confidence: "explicit",
      evidence: "Visitor mentioned enterprise or large companies",
    };
  }

  if (findExplicitReference(allText, ["startup", "founder", "early stage"])) {
    return {
      description: "Startups or early-stage companies",
      confidence: "explicit",
      evidence: "Visitor mentioned startups or early-stage context",
    };
  }

  if (findExplicitReference(allText, ["individual", "freelance", "solo"])) {
    return {
      description: "Individual professionals or freelancers",
      confidence: "explicit",
      evidence: "Visitor mentioned individuals or freelance work",
    };
  }

  // Look for inferred patterns
  if (
    findExplicitReference(allText, ["b2b", "business to business", "companies", "organizations"]) ||
    findExplicitReference(allText, ["outbound", "sales", "leads"])
  ) {
    return {
      description: "Other businesses or B2B customers",
      confidence: "observed",
      evidence: "Context suggests B2B selling or business-to-business model",
    };
  }

  if (findExplicitReference(allText, ["b2c", "consumer", "individual", "people"])) {
    return {
      description: "Individual consumers or B2C customers",
      confidence: "observed",
      evidence: "Context suggests direct-to-consumer model",
    };
  }

  return {
    description: "Customer type not clearly specified",
    confidence: "hypothesis",
  };
}

function extractExplicitProblems(
  zeyaTranscript: ConversationTurn[],
  veyaTranscript: ConversationTurn[],
): CommercialContext["explicitProblems"] {
  const problems: CommercialContext["explicitProblems"] = [];
  const allText = [
    extractVisitorUtterances(zeyaTranscript),
    extractVisitorUtterances(veyaTranscript),
  ].join(" ");

  const problemKeywords = [
    { keyword: "struggle", problem: "Current struggle or challenge mentioned" },
    { keyword: "difficult", problem: "Difficulty mentioned in current approach" },
    { keyword: "hard", problem: "Difficulty or challenge in business operations" },
    { keyword: "limited", problem: "Limitation or constraint mentioned" },
    { keyword: "time", problem: "Time constraint or availability limitation" },
    { keyword: "reach", problem: "Limited reach or market penetration" },
    { keyword: "customer", problem: "Customer acquisition or retention challenge" },
    { keyword: "growth", problem: "Growth limitation or constraint" },
  ];

  for (const { keyword, problem } of problemKeywords) {
    if (allText.toLowerCase().includes(keyword.toLowerCase())) {
      problems.push({
        problem,
        evidence: `Keyword "${keyword}" found in conversation`,
      });
    }
  }

  return problems;
}

function detectAcquisitionPattern(
  zeyaTranscript: ConversationTurn[],
  veyaTranscript: ConversationTurn[],
): CommercialContext["acquisitionPattern"] {
  const allText = [
    extractVisitorUtterances(zeyaTranscript),
    extractVisitorUtterances(veyaTranscript),
  ].join(" ");

  if (findExplicitReference(allText, ["referral", "word of mouth", "recommendation"])) {
    return {
      current: "Primarily through referrals and word of mouth",
      confidence: "explicit",
      evidence: "Visitor mentioned referrals or recommendations",
    };
  }

  if (findExplicitReference(allText, ["inbound", "content", "marketing", "seo"])) {
    return {
      current: "Primarily through inbound marketing or content",
      confidence: "explicit",
      evidence: "Visitor mentioned inbound marketing or content strategy",
    };
  }

  if (findExplicitReference(allText, ["outbound", "cold call", "prospecting", "reach out"])) {
    return {
      current: "Through proactive outreach and prospecting",
      confidence: "explicit",
      evidence: "Visitor mentioned outbound outreach",
    };
  }

  if (findExplicitReference(allText, ["network", "relationship", "personal", "connection"])) {
    return {
      current: "Primarily through personal relationships and network",
      confidence: "observed",
      evidence: "Context suggests relationship-based acquisition",
    };
  }

  return {
    current: "Acquisition pattern not clearly specified",
    confidence: "hypothesis",
  };
}

function generateIndustryHypotheses(
  category: string,
  allText: string,
): CommercialContext["industryHypotheses"] {
  const hypotheses: CommercialContext["industryHypotheses"] = [];

  // Universal hypotheses
  hypotheses.push({
    hypothesis: "Business owners typically need to have ongoing informed conversations with prospects",
    applicability: "If not currently doing this at scale, there's opportunity to multiply conversations",
    confidence: "hypothesis",
  });

  hypotheses.push({
    hypothesis: "Consistent representation requires understanding the business's unique positioning",
    applicability: "Zeya's role is to learn and embody this understanding in conversations",
    confidence: "hypothesis",
  });

  // Category-specific hypotheses
  if (
    allText.toLowerCase().includes("coach") ||
    allText.toLowerCase().includes("consulting")
  ) {
    hypotheses.push({
      hypothesis: "Coaching and consulting businesses often rely on personal credibility and trust",
      applicability: "Representation must preserve the personal element while multiplying reach",
      confidence: "hypothesis",
    });

    hypotheses.push({
      hypothesis: "Prospects often need to hear the business's philosophy before committing",
      applicability: "Initial conversations are about alignment and understanding, not closing",
      confidence: "hypothesis",
    });
  }

  if (allText.toLowerCase().includes("product") || allText.toLowerCase().includes("service")) {
    hypotheses.push({
      hypothesis: "Product businesses often compete on differentiation and value proposition",
      applicability: "Veya's role includes validating whether prospects understand this value",
      confidence: "hypothesis",
    });
  }

  return hypotheses;
}

export function generateCommercialContext(
  businessDescription: string | null,
  zeyaTranscript: ConversationTurn[],
  veyaTranscript: ConversationTurn[],
): CommercialContext {
  const allText = [
    businessDescription || "",
    extractVisitorUtterances(zeyaTranscript),
    extractVisitorUtterances(veyaTranscript),
  ].join(" ");

  const businessCategory = detectBusinessCategory(businessDescription, zeyaTranscript, veyaTranscript);
  const customerType = detectCustomerType(businessDescription, zeyaTranscript, veyaTranscript);
  const acquisitionPattern = detectAcquisitionPattern(zeyaTranscript, veyaTranscript);
  const problems = extractExplicitProblems(zeyaTranscript, veyaTranscript);

  // Determine overall confidence based on evidence collected
  const evidenceCount = problems.length + (businessCategory.confidence !== "hypothesis" ? 1 : 0) + (customerType.confidence !== "hypothesis" ? 1 : 0);
  const overallConfidence: "high" | "moderate" | "low" =
    evidenceCount >= 4 ? "high" : evidenceCount >= 2 ? "moderate" : "low";

  return {
    businessCategory,
    likelyCustomerType: customerType,
    explicitProblems: problems,
    acquisitionPattern,
    industryHypotheses: generateIndustryHypotheses(businessCategory.label, allText),
    representationOpportunity: {
      description:
        acquisitionPattern.confidence === "explicit"
          ? `Zeya could extend the ${acquisitionPattern.current.toLowerCase()} channel by having more informed conversations`
          : "Zeya could represent this business by having informed conversations with prospects",
      confidence: acquisitionPattern.confidence,
      evidence: acquisitionPattern.evidence,
    },
    importantUncertainty:
      overallConfidence === "low"
        ? "More conversation is needed to understand the commercial landscape"
        : overallConfidence === "moderate"
          ? "A few more conversations with prospects would clarify the best representation approach"
          : "The commercial context is reasonably clear; implementation approach is the next discovery point",
    overallConfidence,
  };
}
