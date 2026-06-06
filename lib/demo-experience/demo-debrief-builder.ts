import type { CallOutcome } from "@/lib/call-outcomes";
import type { WorkerBrief } from "@/lib/workers";

import type { DemoDebrief } from "./demo-debrief-types";
import type { DemoDiscoverySession } from "./demo-discovery-types";

function generateDebriefId(): string {
  return `demo_debrief_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export function buildDemoDebrief(
  session: DemoDiscoverySession,
  workerBrief: WorkerBrief,
  callOutcome?: CallOutcome
): DemoDebrief {
  const strengths = [
    session.offer
      ? `The offer is concrete enough for Veya to explain: ${session.offer}.`
      : "The offer was introduced during discovery.",
    session.idealCustomer
      ? `The ideal customer is clear enough to anchor the roleplay: ${session.idealCustomer}.`
      : "The call can still qualify the ideal customer through discovery.",
  ];

  if (callOutcome?.keyInsights.length) {
    strengths.push(`The simulated call produced useful insight: ${callOutcome.keyInsights[0]}`);
  }

  const weaknesses: string[] = [];
  if (!session.pricePoint) {
    weaknesses.push("Price point was missing, which limits how specific Veya can be about value and commitment.");
  }
  if (!session.commonObjection) {
    weaknesses.push("Common objection was missing, so Veya had less guidance for realistic objection handling.");
  }
  if (!callOutcome) {
    weaknesses.push("No call outcome was provided yet, so this debrief is based on the brief rather than observed call behavior.");
  }

  const suggestedImprovements = [
    "Add one sharper proof point or customer result to make the pitch more credible.",
    session.pricePoint
      ? "Connect the price point to a clear expected result or time saved."
      : "Add a price point or package range before dispatching a production call.",
    session.commonObjection
      ? "Prepare a short story or example that directly addresses the common objection."
      : "Capture the top objection customers usually raise so Veya can practice handling it.",
  ];

  return {
    id: generateDebriefId(),
    demoSessionId: session.id,
    workerBriefId: workerBrief.id,
    callOutcomeId: callOutcome?.id,
    strengths,
    weaknesses,
    suggestedImprovements,
    salesAngle: `Position ${session.offer} as the practical next step for ${session.idealCustomer} who want ${session.desiredOutcome.toLowerCase()}`,
    objectionHandlingAdvice: session.commonObjection
      ? `When "${session.commonObjection}" comes up, validate the concern, ask one clarifying question, then connect the answer back to the outcome.`
      : "Start by asking what would make the customer hesitate, then respond to the specific concern instead of guessing.",
    followUpRecommendation: callOutcome?.followUpRequired
      ? callOutcome.nextAction ?? "Follow up with the next step identified during the call."
      : "Invite the visitor to refine the brief with price, objections, proof points, and a stronger call objective.",
    createdAt: new Date().toISOString(),
  };
}
