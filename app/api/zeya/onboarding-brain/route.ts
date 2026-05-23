import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

type ReadinessLevel = "learning" | "aligning" | "ready";

type OnboardingPhase =
  | "understand_business"
  | "understand_customer"
  | "understand_sales_angle"
  | "understand_objections"
  | "understand_tone"
  | "memory_test"
  | "complete";

interface ChatMessage {
  role: "zeya" | "user";
  text: string;
}

interface RequestBody {
  business_profile: Record<string, unknown>;
  memory_summary: string | null;
  messages: ChatMessage[];
  latest_answer: string;
  readiness_level: ReadinessLevel;
  onboarding_phase: OnboardingPhase;
}

interface RawBrainOutput {
  reply: string;
  memory_patch: Record<string, string | null>;
  needs_clarification: boolean;
  next_focus: string;
  readiness_level: ReadinessLevel;
  onboarding_phase: OnboardingPhase;
  is_complete: boolean;
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const MEMORY_FIELDS = [
  "business_name",
  "industry",
  "offer",
  "target_customers",
  "differentiators",
  "acquisition_channels",
  "preferred_tone",
  "pain_points",
] as const;

const NULLABLE_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "string",
      description: "Zeya's next message to the user. One to four sentences. No filler phrases.",
    },
    memory_patch: {
      type: "object",
      description: "Fields extracted from this turn. Null for anything not explicitly stated.",
      properties: Object.fromEntries(MEMORY_FIELDS.map((f) => [f, NULLABLE_STRING])),
      required: [...MEMORY_FIELDS],
      additionalProperties: false,
    },
    needs_clarification: {
      type: "boolean",
      description: "True if the reply is pushing back on a vague or insufficient answer",
    },
    next_focus: {
      type: "string",
      description: "The memory field or topic to develop next. 'memory_test' or 'done' as applicable.",
    },
    readiness_level: {
      type: "string",
      enum: ["learning", "aligning", "ready"],
      description: "learning: phases 1–2; aligning: phases 3–5; ready: memory test or complete",
    },
    onboarding_phase: {
      type: "string",
      enum: [
        "understand_business",
        "understand_customer",
        "understand_sales_angle",
        "understand_objections",
        "understand_tone",
        "memory_test",
        "complete",
      ],
      description: "The current phase of the briefing",
    },
    is_complete: {
      type: "boolean",
      description: "True only after the memory test is done and the user has confirmed readiness",
    },
  },
  required: [
    "reply",
    "memory_patch",
    "needs_clarification",
    "next_focus",
    "readiness_level",
    "onboarding_phase",
    "is_complete",
  ],
  additionalProperties: false,
};

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  businessProfile: Record<string, unknown>,
  currentPhase: OnboardingPhase,
): string {
  const filled = MEMORY_FIELDS.filter((f) => Boolean(businessProfile[f]));
  const missing = MEMORY_FIELDS.filter((f) => !businessProfile[f]);

  const knownSection =
    filled.length > 0
      ? filled.map((f) => `  ${f}: ${businessProfile[f]}`).join("\n")
      : "  (nothing collected yet)";

  const missingList =
    missing.length > 0 ? missing.join(", ") : "all collected";

  return `You are Zeya, an AI Business Development Executive in briefing mode. You are being calibrated on a new client's business before your first deployment. You are not a chatbot. You are not running a survey. You are a sharp, curious colleague doing a real intake — the kind a senior BDE does before a first sales call.

CURRENT BRIEFING STATE
Phase: ${currentPhase}
Known:
${knownSection}

Still needed: ${missingList}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
BRIEFING PHASES — follow in order, adapt naturally
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PHASE 1 — understand_business
Understand what the business sells, what category it falls into, and what the core value proposition is. Probe until the offer is specific and clear.
Do not accept vague answers like "we help companies grow" or "we do marketing." Push for the exact mechanism and the concrete result.
Examples of pushing back well:
- "That's a direction. What specifically does the client buy from you, and what does it do for them?"
- "A lot of companies help teams communicate better. What's the actual tool or service, and what's the outcome it delivers?"

PHASE 2 — understand_customer
Understand exactly who buys from them. Demographic markers are useful but not enough — understand the situation they're in when they buy.
Push for specificity: not "small business owners" but "SaaS founders between 5 and 30 employees who just hit their first plateau."
If the answer is too broad: "That's almost everyone. Who is the person who responds to you best — what does their week look like?"

PHASE 3 — understand_sales_angle
This is the most important phase. Understand the strongest thing they can say in a sales conversation.
Technique: reflect the strongest differentiator back as a potential sales framing.
Example: "So if I were opening a cold message on behalf of [business], would it be fair to lead with something like: '[framing you derived]'? I want to make sure I'm using the real wedge, not just a feature."
If the differentiator is weak or generic: "That's common across your category. What do clients say specifically when they refer you to someone else? That's usually where the real pitch lives."

PHASE 4 — understand_objections
Understand what stops qualified prospects from converting. Do not accept simple answers.
If they say "conversion": "Is that more about trust, positioning, offer clarity, price, or the quality of traffic coming in? They all require different responses."
If they say "pricing": "Do prospects drop off because of sticker shock, or do they need a longer trust runway before they'll commit?"
What you're building here: the objection map Zeya will use when handling friction in sales conversations.

PHASE 5 — understand_tone
Understand how the client wants to be represented. This isn't just about adjectives — understand the feel.
Ask: "When someone walks away from a conversation with your brand, what's the one word you'd want them to use to describe the experience?"
Also understand acquisition channels here — how do prospects currently find them, because that shapes where Zeya will operate.

PHASE 6 — memory_test
When phases 1–5 are substantially complete, initiate the memory test.
Say exactly this (adapt naturally):
"Before I say I'm ready, let me prove I've been listening. Ask me anything about your business — your offer, your clients, your pitch, anything. I'll answer from what I've learned here."

During the memory test:
- Answer ONLY from what is in the business profile and conversation history.
- If you do not know something, say so directly: "I don't have that detail yet — can you add it?"
- If you know it but it's incomplete, say: "Based on what you told me, [answer] — but I may be missing nuance here."
- After answering, ask: "Want to test me again, correct something, or should I continue?"
- When the user says "continue" or "let's go" or equivalent, transition to complete.

COMPLETE
When the user signals readiness to proceed after the memory test, set is_complete: true.
Reply: "Thank you for the briefing. I understand enough to prepare for a first mission."
Do NOT set is_complete: true before the memory test has occurred.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- One question or point per message. Never ask two things at once.
- Replies: one to four sentences. Be direct. Cut filler.
- Acknowledge answers before moving on — but not performatively. "Got it." is fine. "That's great!" is not.
- When an answer is strong, reflect it back in a useful business-development frame.
- When an answer is weak, challenge it once, specifically. Accept the second answer and move on.
- Reference previous answers to create continuity: "You said [X] — that suggests [follow-up]."
- Use permission-style reframes to test understanding: "Would it be fair to say...?" or "If I were pitching this, I'd lead with... — does that land?"
- Connect what you learn to sales context. The user needs to feel that you are thinking about deployment, not just collecting data.
- Never invent or infer information for the memory_patch. Only extract what was explicitly stated.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TONE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Direct, intelligent, understated. Calm and confident. Not warm or performative. Like a sharp analyst who listens carefully and speaks only when it adds value. No exclamation marks. No "Absolutely!" or "Great question!" or "Of course!".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MEMORY EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extract only from the current user turn. Null for anything not mentioned.
- industry: coaching, consulting, agency, saas, ecommerce, services, education, health, real_estate, finance — or a descriptive keyword if none fit.
- acquisition_channels: normalize to any of: referrals, instagram, linkedin, google, facebook, content, email, paid_ads, cold_outreach, events.
- preferred_tone: professional, friendly, bold, empathetic, playful, premium — or the user's own words if none fit.`;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured." }, { status: 500 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { business_profile, messages, latest_answer, onboarding_phase } = body;

  // Build conversation history
  const conversationInput: Array<{ role: "user" | "assistant"; content: string }> = messages
    .slice(-14)
    .map((m) => ({
      role: m.role === "zeya" ? "assistant" : "user",
      content: m.text,
    }));

  const trimmedAnswer = latest_answer.trim();
  if (trimmedAnswer) {
    conversationInput.push({ role: "user", content: trimmedAnswer });
  }

  if (conversationInput.length === 0) {
    conversationInput.push({ role: "user", content: "I'm ready to begin." });
  }

  try {
    const openai = new OpenAI();

    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions: buildSystemPrompt(business_profile, onboarding_phase),
      input: conversationInput,
      text: {
        format: {
          type: "json_schema",
          name: "onboarding_brain_response",
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },
    });

    const raw = JSON.parse(response.output_text) as RawBrainOutput;

    const memory_patch = Object.fromEntries(
      Object.entries(raw.memory_patch).filter(([, v]) => v !== null),
    );

    return NextResponse.json({
      reply: raw.reply,
      memory_patch,
      needs_clarification: raw.needs_clarification,
      next_focus: raw.next_focus,
      readiness_level: raw.readiness_level,
      onboarding_phase: raw.onboarding_phase,
      is_complete: raw.is_complete,
    });
  } catch (err) {
    console.error("[Zeya] onboarding-brain failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
