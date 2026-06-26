import type { VoiceTranscriptEntry } from "@/types/voice";
import type { BusinessInsights, ConversationAnalysis } from "@/types/experience";

export function analyzeConversationInsights(
  transcript: VoiceTranscriptEntry[],
  visitorName?: string
): ConversationAnalysis {
  const userMessages = transcript
    .filter((entry) => entry.role === "user" && entry.isFinal && entry.text?.trim())
    .map((entry) => entry.text!.toLowerCase().trim());

  if (userMessages.length === 0) {
    return createFallbackAnalysis("No conversation data available");
  }

  const insights: BusinessInsights = {
    businessType: inferBusinessType(userMessages),
    offer: inferOffer(userMessages),
    targetCustomer: inferTargetCustomer(userMessages),
    goal: inferGoal(userMessages),
    challenge: inferChallenge(userMessages),
    opportunity: inferOpportunity(userMessages),
    buyingSignals: extractBuyingSignals(userMessages),
    concerns: extractConcerns(userMessages),
    representationFit: assessRepresentationFit(userMessages),
    representationReasoning: generateRepresentationReasoning(userMessages),
    recommendedNextStep: generateRecommendedNextStep(userMessages),
  };

  const confidence = calculateConfidence(userMessages, insights);
  const nameAnalysis = analyzeNameExtraction(userMessages);

  return {
    insights,
    confidence,
    extractedFrom: userMessages.length,
    nameConfidence: nameAnalysis.confidence,
    extractedName: nameAnalysis.name,
  };
}

function analyzeNameExtraction(messages: string[]): {
  name?: string;
  confidence: "high" | "medium" | "low";
} {
  if (messages.length === 0) {
    return { confidence: "low" };
  }

  const firstMessage = messages[0];

  // Check for clear name indicators
  const namePatterns = [
    /^(?:hi|hello|hey)?\s*(?:my name is|i'm|i am|it's|this is)\s+([a-z]+(?:\s+[a-z]+)?)/i,
    /^([a-z]+(?:\s+[a-z]+)?)\s+(?:here|speaking|calling)/i,
    /^([a-z]+(?:\s+[a-z]+)?)$/i, // Just a name by itself
  ];

  for (const pattern of namePatterns) {
    const match = firstMessage.match(pattern);
    if (match && match[1]) {
      const extractedName = match[1]
        .split(/\s+/)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");

      // Validate: name should be 1-3 words, each word 2-20 chars
      const words = extractedName.split(/\s+/);
      if (words.length <= 3 && words.every((w) => w.length >= 2 && w.length <= 20)) {
        return {
          name: extractedName,
          confidence: "high",
        };
      }
    }
  }

  // Medium confidence: try to extract first 1-2 words if they look like a name
  const firstWords = firstMessage.split(/\s+/);
  if (firstWords.length > 0) {
    const candidate = firstWords
      .slice(0, 2)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

    // Check if it looks like a name (not a common word, reasonable length)
    const commonWords = [
      "the",
      "hi",
      "hello",
      "hey",
      "you",
      "i",
      "me",
      "my",
      "yes",
      "no",
      "ok",
      "okay",
      "sure",
    ];
    const words = candidate.toLowerCase().split(/\s+/);

    if (
      words.every((w) => !commonWords.includes(w) && w.length >= 2 && w.length <= 20) &&
      !candidate.includes(".")
    ) {
      return {
        name: candidate,
        confidence: "medium",
      };
    }
  }

  return { confidence: "low" };
}

function inferBusinessType(messages: string[]): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/coach|coaching|mentor/i, "Coaching Practice"],
    [/agency|marketing|advertising/i, "Marketing Agency"],
    [/software|saas|app|development/i, "Software/Tech"],
    [/consultant|consulting/i, "Consulting"],
    [/course|training|education|academy/i, "Education/Training"],
    [/freelance|contractor/i, "Freelance Services"],
    [/e-commerce|shopify|store|product/i, "E-Commerce"],
    [/service|services/i, "Service Business"],
    [/management|operations/i, "Operations/Management"],
    [/real estate|property|realtor/i, "Real Estate"],
  ];

  for (const message of messages) {
    for (const [pattern, type] of patterns) {
      if (pattern.test(message)) {
        return type;
      }
    }
  }

  return undefined;
}

function inferOffer(messages: string[]): string | undefined {
  const offerKeywords = ["offer", "provide", "sell", "help", "service", "build", "create", "develop", "teach", "train"];

  for (const message of messages.slice(0, 5)) {
    for (const keyword of offerKeywords) {
      const pattern = new RegExp(`(?:${keyword}|we)\\s+(?:help|provide|offer|sell|build)?\\s+([^.!?]+)`, "i");
      const match = message.match(pattern);
      if (match && match[1].length > 5 && match[1].length < 100) {
        return cleanExtractedText(match[1]);
      }
    }
  }

  return undefined;
}

function inferTargetCustomer(messages: string[]): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/b2b|businesses?|corporate|enterprise/i, "Businesses"],
    [/b2c|consumers?|individuals?|people/i, "Individuals"],
    [/startups?/i, "Startups"],
    [/small business|smbs/i, "Small Businesses"],
    [/entrepreneurs?/i, "Entrepreneurs"],
    [/executives?|leaders?|managers?/i, "Business Leaders"],
    [/sales|marketing|growth teams?/i, "Sales & Marketing Teams"],
  ];

  for (const message of messages) {
    for (const [pattern, type] of patterns) {
      if (pattern.test(message)) {
        return type;
      }
    }
  }

  return undefined;
}

function inferGoal(messages: string[]): "leads" | "revenue" | "operations" | "retention" | "other" | undefined {
  const patterns: Array<[RegExp, "leads" | "revenue" | "operations" | "retention" | "other"]> = [
    [/more (customers?|clients?|leads?|conversations?|sales?|revenue)/i, "leads"],
    [/increase revenue|make more money|grow revenue/i, "revenue"],
    [/improve|streamline|automate|efficiency|operations/i, "operations"],
    [/keep.*customer|retain|loyalty|reduce churn|engagement/i, "retention"],
  ];

  for (const message of messages) {
    for (const [pattern, goal] of patterns) {
      if (pattern.test(message)) {
        return goal;
      }
    }
  }

  return undefined;
}

function inferChallenge(messages: string[]): string | undefined {
  const challengeKeywords = ["challenge", "problem", "struggle", "difficult", "hard", "time-consuming", "bottleneck", "issue", "pain"];

  for (const message of messages) {
    for (const keyword of challengeKeywords) {
      const pattern = new RegExp(`(${keyword}[^.!?]*[.!?])`, "i");
      const match = message.match(pattern);
      if (match && match[1].length > 10 && match[1].length < 150) {
        return cleanExtractedText(match[1]);
      }
    }
  }

  if (messages.some((m) => m.includes("time") || m.includes("busy"))) {
    return "Limited time and capacity for outreach";
  }

  return undefined;
}

function inferOpportunity(messages: string[]): string | undefined {
  const challenge = inferChallenge(messages);
  const goal = inferGoal(messages);

  if (goal === "leads") {
    return "Automating prospect engagement while maintaining personal touch";
  }

  if (challenge?.toLowerCase().includes("time")) {
    return "Freeing time from repetitive outreach to focus on closing";
  }

  return "Delegating customer conversations while maintaining business voice";
}

function extractBuyingSignals(messages: string[]): string[] {
  const signals: string[] = [];

  const patterns: Array<[RegExp, string]> = [
    [/interested|excited|sounds good|that makes sense/i, "Expressed Interest"],
    [/need|problem|struggling|challenge/i, "Acknowledged Need"],
    [/growth|scaling|expanding/i, "Growth Mindset"],
    [/delegate|automate|system|process/i, "Systems-Oriented"],
    [/timeline|soon|asap|quickly/i, "Timeline Urgency"],
  ];

  for (const message of messages) {
    for (const [pattern, signal] of patterns) {
      if (pattern.test(message) && !signals.includes(signal)) {
        signals.push(signal);
      }
    }
  }

  return signals.slice(0, 3);
}

function extractConcerns(messages: string[]): string[] {
  const concerns: string[] = [];

  const patterns: Array<[RegExp, string]> = [
    [/cost|price|expensive|afford/i, "Cost Concerns"],
    [/control|trust|quality|brand/i, "Control & Quality"],
    [/time|implementation|complex/i, "Implementation Complexity"],
    [/data|privacy|security|information/i, "Data & Privacy"],
  ];

  for (const message of messages) {
    for (const [pattern, concern] of patterns) {
      if (pattern.test(message) && !concerns.includes(concern)) {
        concerns.push(concern);
      }
    }
  }

  return concerns.slice(0, 2);
}

function assessRepresentationFit(messages: string[]): "high" | "medium" | "low" {
  let score = 0;

  if (messages.length >= 4) score += 2;
  if (messages.length >= 7) score += 1;

  if (inferBusinessType(messages)) score += 2;
  if (inferOffer(messages)) score += 2;
  if (inferGoal(messages)) score += 2;
  if (inferChallenge(messages)) score += 1;

  if (extractBuyingSignals(messages).length > 0) score += 1;
  if (extractConcerns(messages).length === 0) score += 1;

  if (score >= 9) return "high";
  if (score >= 5) return "medium";
  return "low";
}

function generateRepresentationReasoning(messages: string[]): string {
  const businessType = inferBusinessType(messages);
  const offer = inferOffer(messages);
  const goal = inferGoal(messages);
  const challenge = inferChallenge(messages);
  const fit = assessRepresentationFit(messages);

  // High confidence case - make specific statements
  if (fit === "high" && businessType && offer) {
    return `You seem to work with ${businessType.toLowerCase()} and help them with ${offer.toLowerCase()}. Your focus on ${goal ? `${goal === "leads" ? "generating more conversations" : goal === "revenue" ? "growing revenue" : "growing your business"}` : "growth"} is a natural fit for representation.`;
  }

  // Medium confidence case - hedge with interpretive language
  if (fit === "medium") {
    const parts: string[] = [];
    if (businessType) {
      parts.push(`I see you're in ${businessType.toLowerCase()}`);
    }
    if (offer) {
      parts.push(`focused on ${offer.toLowerCase()}`);
    }
    if (goal) {
      const goalMap: Record<string, string> = {
        leads: "generating conversations",
        revenue: "growing revenue",
        operations: "improving operations",
        retention: "retaining customers",
        other: "growing your business",
      };
      parts.push(`with a goal around ${goalMap[goal]}`);
    }
    if (parts.length > 0) {
      return parts.join(", ") + ". I'd want to understand more about the specifics before committing to full representation.";
    }
    return "There's potential here, but I'd benefit from more context about your specific goals.";
  }

  // Low confidence case - be honest about lack of context
  return "I don't have enough detail yet to assess representation fit. Let's have a deeper conversation about your business and goals.";
}

function generateRecommendedNextStep(messages: string[]): string {
  const goal = inferGoal(messages);
  const fit = assessRepresentationFit(messages);

  if (fit === "high") {
    if (goal === "leads") {
      return "Running daily prospect conversations to fill your pipeline";
    }
    return "Taking outreach conversations off your plate entirely";
  }

  if (fit === "medium") {
    return "Testing representation on a specific customer segment first";
  }

  return "Having a detailed conversation about your specific goals";
}

function calculateConfidence(messages: string[], insights: BusinessInsights): "high" | "medium" | "low" {
  let extractedFields = 0;
  if (insights.businessType) extractedFields++;
  if (insights.offer) extractedFields++;
  if (insights.targetCustomer) extractedFields++;
  if (insights.goal) extractedFields++;
  if (insights.challenge) extractedFields++;

  if (messages.length >= 6 && extractedFields >= 4) return "high";
  if (messages.length >= 3 && extractedFields >= 2) return "medium";
  return "low";
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/^(that|this|which)\s+/i, "")
    .replace(/[.!?]+$/, "")
    .trim()
    .split(/[.!?]/)[0]
    .trim();
}

function createFallbackAnalysis(reason: string): ConversationAnalysis {
  return {
    insights: {
      businessType: undefined,
      offer: undefined,
      targetCustomer: undefined,
      goal: undefined,
      challenge: "Need more information about your business",
      opportunity: "Understanding your goals and challenges",
      buyingSignals: [],
      concerns: [],
      representationFit: "low",
      representationReasoning: reason,
      recommendedNextStep: "Let's have a deeper conversation about your business",
    },
    confidence: "low",
    extractedFrom: 0,
  };
}
