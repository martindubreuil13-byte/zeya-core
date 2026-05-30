// Caller Brief structure and generation.
// A structured brief for the sales team before outreach.

export interface CallerBrief {
  mission: string;
  targetSegment: string;
  openingAngle: string;
  openingMessage: string;
  likelyObjections: string[];
  recommendedResponses: Record<string, string>;
  successMetric: string;
  generatedAt: string;
}

export interface BriefContext {
  missionName: string;
  targetSegment: string;
  hypothesis: string;
  salesAngle: string;
  selectedLeadsCount: number;
  selectedCompanies: string[];
  offer: string | null;
  icp: string | null;
  positioning: string | null;
  objections: string | null;
  salesArguments: string | null;
  knownFacts: string | null;
  assumptions: string | null;
  validatedLearnings: string | null;
}

export function generateCallerBrief(context: BriefContext): CallerBrief {
  // Parse structured fields (newline-separated lists)
  const parseList = (text: string | null): string[] => {
    if (!text) return [];
    return text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .slice(0, 5); // limit to 5 items for brevity
  };

  const objectionsList = parseList(context.objections);
  const argumentsList = parseList(context.salesArguments);
  const factsList = parseList(context.knownFacts);
  const assumptionsList = parseList(context.assumptions);

  // Build opening message from context
  const openingMessage = buildOpeningMessage(
    context.offer,
    context.targetSegment,
    context.positioning,
    argumentsList
  );

  // Build recommended responses to objections
  const recommendedResponses = buildResponses(objectionsList, argumentsList);

  // Build success metric from mission hypothesis
  const successMetric = buildSuccessMetric(context.hypothesis, context.selectedLeadsCount);

  return {
    mission: context.missionName,
    targetSegment: context.targetSegment,
    openingAngle: context.salesAngle,
    openingMessage,
    likelyObjections: objectionsList,
    recommendedResponses,
    successMetric,
    generatedAt: new Date().toISOString(),
  };
}

function buildOpeningMessage(
  offer: string | null,
  targetSegment: string,
  positioning: string | null,
  arguments_: string[]
): string {
  const parts: string[] = [];

  if (offer) {
    parts.push(`I help ${targetSegment || "businesses"} ${offer.toLowerCase()}.`);
  } else {
    parts.push(`I wanted to connect with ${targetSegment || "you"} about a specific opportunity.`);
  }

  if (positioning && arguments_.length > 0) {
    const key = arguments_[0];
    parts.push(`The reason I'm reaching out: ${key}`);
  }

  return parts.join(" ");
}

function buildResponses(
  objections: string[],
  arguments_: string[]
): Record<string, string> {
  const responses: Record<string, string> = {};

  objections.forEach((objection, i) => {
    const response = arguments_[i % arguments_.length]
      ? `That's a fair point. ${arguments_[i % arguments_.length]}`
      : "That's worth considering. Let me share what we've seen work for similar situations.";

    responses[objection] = response;
  });

  // Add generic fallbacks
  if (objections.length === 0) {
    responses["Price/budget concerns"] =
      "Most teams see ROI within 60 days. We can start with a small pilot.";
    responses["Timing not right"] =
      "No pressure. But when you're ready to explore this, I'm here. Can I check back in a month?";
    responses["Already have a solution"] =
      "Understood. Worth a quick conversation to compare approaches?";
  }

  return responses;
}

function buildSuccessMetric(hypothesis: string, selectedCount: number): string {
  const targetConversations = Math.max(3, Math.ceil(selectedCount * 0.4));

  if (hypothesis.toLowerCase().includes("response") || hypothesis.toLowerCase().includes("engagement")) {
    return `Book ${targetConversations}+ discovery calls from ${selectedCount} outreaches (${Math.round((targetConversations / selectedCount) * 100)}% conversion target)`;
  }

  if (hypothesis.toLowerCase().includes("objection")) {
    return `Surface 5+ common objections and refine responses based on ${selectedCount} conversations`;
  }

  return `Conduct ${selectedCount} outreaches and gather feedback on positioning — target: ${targetConversations}+ productive conversations`;
}

export function formatBriefAsMarkdown(brief: CallerBrief): string {
  const lines: string[] = [];

  lines.push(`# Caller Brief: ${brief.mission}`);
  lines.push("");
  lines.push(`**Target:** ${brief.targetSegment}`);
  lines.push(`**Angle:** ${brief.openingAngle}`);
  lines.push("");

  lines.push("## Opening");
  lines.push(brief.openingMessage);
  lines.push("");

  lines.push("## Likely Objections & Responses");
  if (brief.likelyObjections.length === 0) {
    lines.push("(None identified — be ready to listen and adapt)");
  } else {
    brief.likelyObjections.forEach((objection) => {
      const response = brief.recommendedResponses[objection] || "Listen and adapt.";
      lines.push(`- **${objection}**`);
      lines.push(`  → ${response}`);
    });
  }
  lines.push("");

  lines.push("## Success Metric");
  lines.push(brief.successMetric);
  lines.push("");

  lines.push("*Generated at: " + new Date(brief.generatedAt).toLocaleString() + "*");

  return lines.join("\n");
}
