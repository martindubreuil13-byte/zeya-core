import type { BusinessMemory } from "@/lib/memory/extract-business-memory";

interface RecentMessage {
  role: "user" | "assistant";
  content: string;
}

interface MemoryEvent {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

interface ContextInput {
  business: (Partial<BusinessMemory> & { business_name?: string; industry?: string; business_profile?: Record<string, unknown> }) | null;
  recentMessages?: RecentMessage[];
  recentEvents?: MemoryEvent[];
}

export interface BusinessContext {
  identity: string;
  offer: string | null;
  audience: string | null;
  differentiators: string | null;
  tone: string | null;
  painPoints: string | null;
  channels: string | null;
  recentCorrections: string[];
}

export function buildContextPrompt(input: ContextInput): BusinessContext {
  const { business, recentMessages = [], recentEvents = [] } = input;

  const profile = (business?.business_profile ?? {}) as Record<string, string | null>;

  const identity = [business?.business_name, business?.industry]
    .filter(Boolean)
    .join(" · ");

  const corrections = recentEvents
    .filter((e) => e.event_type === "correction")
    .slice(-3)
    .map((e) => {
      const payload = e.payload as Record<string, string>;
      return Object.entries(payload)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
    });

  return {
    identity: identity || "Unknown business",
    offer: (profile.offer as string | null) ?? (business?.offer ?? null),
    audience: (profile.target_customers as string | null) ?? (business?.target_customers ?? null),
    differentiators: (profile.differentiators as string | null) ?? (business?.differentiators ?? null),
    tone: (profile.preferred_tone as string | null) ?? (business?.preferred_tone ?? null),
    painPoints: (profile.pain_points as string | null) ?? (business?.pain_points ?? null),
    channels: (profile.acquisition_channels as string | null) ?? (business?.acquisition_channels ?? null),
    recentCorrections: corrections,
  };
}

export function contextToString(ctx: BusinessContext): string {
  const parts: string[] = [`Business: ${ctx.identity}`];
  if (ctx.offer) parts.push(`Offer: ${ctx.offer}`);
  if (ctx.audience) parts.push(`Audience: ${ctx.audience}`);
  if (ctx.differentiators) parts.push(`Differentiators: ${ctx.differentiators}`);
  if (ctx.tone) parts.push(`Tone: ${ctx.tone}`);
  if (ctx.painPoints) parts.push(`Pain points: ${ctx.painPoints}`);
  if (ctx.channels) parts.push(`Channels: ${ctx.channels}`);
  if (ctx.recentCorrections.length > 0) {
    parts.push(`Recent corrections: ${ctx.recentCorrections.join(" | ")}`);
  }
  return parts.join("\n");
}
