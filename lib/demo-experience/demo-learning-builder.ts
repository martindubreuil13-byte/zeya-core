import type { DemoDebrief } from "./demo-debrief-types";
import type { DemoDiscoverySession } from "./demo-discovery-types";
import type { DemoLearningPattern } from "./demo-learning-types";

function generatePatternId(index: number): string {
  return `demo_learning_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`;
}

function categorizeOffer(offer: string): string {
  const normalized = offer.toLowerCase();
  if (normalized.includes("coach") || normalized.includes("consult")) return "service";
  if (normalized.includes("software") || normalized.includes("app") || normalized.includes("tool")) return "software";
  if (normalized.includes("course") || normalized.includes("program")) return "education";
  return "general";
}

function categorizeIdealCustomer(idealCustomer: string): string {
  const normalized = idealCustomer.toLowerCase();
  if (normalized.includes("small business")) return "small_business";
  if (normalized.includes("freelancer")) return "freelancer";
  if (normalized.includes("enterprise")) return "enterprise";
  return "general";
}

function categorizeObjection(commonObjection?: string): string | undefined {
  const normalized = commonObjection?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized.includes("time")) return "time";
  if (normalized.includes("price") || normalized.includes("expensive") || normalized.includes("budget")) return "price";
  if (normalized.includes("trust") || normalized.includes("proof")) return "trust";
  return "general";
}

export function buildDemoLearningPatterns(
  session: DemoDiscoverySession,
  debrief: DemoDebrief
): DemoLearningPattern[] {
  const now = new Date().toISOString();
  const offerCategory = categorizeOffer(session.offer);
  const idealCustomerCategory = categorizeIdealCustomer(session.idealCustomer);
  const objectionCategory = categorizeObjection(session.commonObjection);
  const patterns: Omit<DemoLearningPattern, "id" | "createdAt">[] = [];

  if (!session.idealCustomer || session.idealCustomer.length < 24) {
    patterns.push({
      demoSessionId: session.id,
      offerCategory,
      idealCustomerCategory,
      objectionCategory,
      insight: "Visitors with unclear ICP need additional qualification.",
      recommendation: "Ask one sharper ICP question before generating the demo call brief.",
    });
  }

  if (!session.pricePoint) {
    patterns.push({
      demoSessionId: session.id,
      offerCategory,
      idealCustomerCategory,
      objectionCategory,
      insight: "Price-point missing reduces sales briefing quality.",
      recommendation: "Prompt for price or package range before the Veya roleplay.",
    });
  }

  if (session.commonObjection) {
    patterns.push({
      demoSessionId: session.id,
      offerCategory,
      idealCustomerCategory,
      objectionCategory,
      insight: "Common objection improves roleplay quality.",
      recommendation: "Carry objection guidance into Veya's brief and the post-call debrief.",
    });
  } else {
    patterns.push({
      demoSessionId: session.id,
      offerCategory,
      idealCustomerCategory,
      objectionCategory,
      insight: "Missing objection data makes the demo less realistic.",
      recommendation: "Ask for the most common sales objection during demo discovery.",
    });
  }

  if (debrief.weaknesses.length > 1) {
    patterns.push({
      demoSessionId: session.id,
      offerCategory,
      idealCustomerCategory,
      objectionCategory,
      insight: "Brief quality drops when multiple discovery fields are incomplete.",
      recommendation: "Keep demo discovery short, but require enough detail for price, ICP, and objection handling.",
    });
  }

  return patterns.map((pattern, index) => ({
    ...pattern,
    id: generatePatternId(index),
    createdAt: now,
  }));
}
