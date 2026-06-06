import { buildWorkerBrief } from "@/lib/workers";
import type { WorkerBrief } from "@/lib/workers";

import type { DemoDiscoverySession } from "./demo-discovery-types";

export function buildDemoWorkerBriefFromDiscovery(session: DemoDiscoverySession): WorkerBrief {
  return buildWorkerBrief({
    missionId: session.id,
    workerType: "CALLER",
    companyContext: [
      "This is a demo call.",
      "The visitor is testing Zeya and wants to hear how well Zeya can understand their business.",
      `Business: ${session.businessDescription}`,
      `Offer: ${session.offer}`,
      `Ideal customer: ${session.idealCustomer}`,
      session.pricePoint ? `Price point: ${session.pricePoint}` : "Price point: not provided",
    ].join("\n"),
    leadContext: [
      session.visitorName ? `Visitor name: ${session.visitorName}` : "Visitor name: not provided",
      session.visitorPhone ? `Visitor phone: ${session.visitorPhone}` : "Visitor phone: not provided",
      session.visitorEmail ? `Visitor email: ${session.visitorEmail}` : "Visitor email: not provided",
      "Roleplay selling the visitor's own offer back to them so they can experience the caller quality.",
    ].join("\n"),
    objective:
      "Run a concise, natural demo sales conversation as Veya, selling the visitor's own offer back to them.",
    desiredOutcome:
      "The visitor understands how Zeya briefs Veya, experiences a realistic sales call, and returns to Zeya for a debrief.",
    keyQuestions: [
      "What problem does the visitor's offer solve for the ideal customer?",
      "What makes the offer valuable or timely?",
      "What would make the ideal customer comfortable taking the next step?",
    ],
    objectionGuidance: [
      session.commonObjection
        ? `If the visitor raises "${session.commonObjection}", acknowledge it, explore the concern, and respond professionally.`
        : "Ask about likely objections if none were provided, then handle them professionally.",
      "Stay curious and avoid overexplaining.",
      "Keep the conversation brief enough to feel like a demo, not a full sales cycle.",
    ],
    escalationRules: [
      "Do not claim this is a live production outbound call.",
      "Do not ask for payment or sensitive financial information.",
      "End by inviting the visitor back to Zeya for a debrief.",
    ],
    successCriteria:
      "Veya clearly roleplays the offer, asks essential sales questions, handles at least one objection professionally, and closes by sending the visitor back to Zeya.",
    toneGuidance: "Concise, natural, curious, and professionally confident.",
    dynamicVariables: {
      demoSessionId: session.id,
      businessDescription: session.businessDescription,
      offer: session.offer,
      idealCustomer: session.idealCustomer,
      pricePoint: session.pricePoint ?? null,
      commonObjection: session.commonObjection ?? null,
      desiredOutcome: session.desiredOutcome,
      isDemo: true,
    },
  });
}
