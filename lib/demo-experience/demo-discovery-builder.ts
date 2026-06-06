import type { DemoDiscoveryInput, DemoDiscoverySession } from "./demo-discovery-types";

const DEFAULT_DEMO_OUTCOME =
  "Demonstrate how Zeya can understand a business, brief Veya, and simulate a sales call.";

function generateDemoSessionId(): string {
  return `demo_session_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

function requireString(value: string | undefined, fieldName: string): string {
  if (!value?.trim()) {
    throw new Error(`${fieldName} is required`);
  }

  return value.trim();
}

function optionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function buildDemoDiscoverySession(input: DemoDiscoveryInput): DemoDiscoverySession {
  const now = new Date().toISOString();

  return {
    id: generateDemoSessionId(),
    visitorName: optionalString(input.visitorName),
    visitorPhone: optionalString(input.visitorPhone),
    visitorEmail: optionalString(input.visitorEmail),
    businessDescription: requireString(input.businessDescription, "businessDescription"),
    offer: requireString(input.offer, "offer"),
    idealCustomer: requireString(input.idealCustomer, "idealCustomer"),
    pricePoint: optionalString(input.pricePoint),
    commonObjection: optionalString(input.commonObjection),
    desiredOutcome: optionalString(input.desiredOutcome) ?? DEFAULT_DEMO_OUTCOME,
    status: "DISCOVERY",
    createdAt: now,
    updatedAt: now,
  };
}
