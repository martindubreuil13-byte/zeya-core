// Asynchronous LLM memory synthesis — runs after a session ends, never during.
//
// Think of this as Zeya reviewing her notes after a meeting:
// transcript → operational understanding → evolving business_profile.
//
// Model: gpt-4o-mini (async extraction runs once per session, cost ~$0.003).

import OpenAI from "openai";
import type { BusinessMemory } from "@/lib/memory/extract-business-memory";
import type { CompactedTurn } from "@/lib/memory/compact-transcript";

// ─── Types ────────────────────────────────────────────────────────────────────

export const OPERATIONAL_EVENT_TYPES = [
  "icp_refined",
  "positioning_shift",
  "objection_detected",
  "pricing_strategy",
  "proof_point_added",
  "founder_priority",
  "strategic_gap",
  "mission_progress",
  "sales_argument",
  "differentiator",
  "acquisition_channel",
  "tone_calibration",
  "unresolved_tension",
  "founder_correction",
] as const;

export type OperationalEventType = (typeof OPERATIONAL_EVENT_TYPES)[number];

export interface OperationalMemoryEvent {
  type: string;
  content: string;
  importance: number;
  // Populated only for founder_correction events; null for all other types.
  field_changed: string | null;
  old_understanding: string | null;
  new_understanding: string | null;
}

export interface OperationalMemoryOutput {
  business_profile_patch: Partial<BusinessMemory>;
  memory_events: OperationalMemoryEvent[];
  strategic_gaps: string[];
  unresolved_tensions: string[];
  session_summary: string;
  recommended_next_focus: string;
  current_mission: string;
}

export interface OperationalMemoryInput {
  turns: CompactedTurn[];
  existingProfile: Partial<BusinessMemory> | null;
  sessionType: "onboarding" | "briefing";
}

// ─── Fallback returned when extraction cannot run ────────────────────────────

export const EMPTY_EXTRACTION: OperationalMemoryOutput = {
  business_profile_patch: {},
  memory_events: [],
  strategic_gaps: [],
  unresolved_tensions: [],
  session_summary: "",
  recommended_next_focus: "",
  current_mission: "",
};

// ─── JSON schema for structured output ───────────────────────────────────────

const NULL_OR_STRING = { anyOf: [{ type: "string" }, { type: "null" }] };

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    business_profile_patch: {
      type: "object",
      description:
        "Merged operational understanding — combine existing knowledge with new evidence. Set null for fields not discussed.",
      properties: {
        offer:                NULL_OR_STRING,
        target_customers:     NULL_OR_STRING,
        pain_points:          NULL_OR_STRING,
        objections:           NULL_OR_STRING,
        positioning:          NULL_OR_STRING,
        pricing:              NULL_OR_STRING,
        preferred_tone:       NULL_OR_STRING,
        proof_points:         NULL_OR_STRING,
        sales_arguments:      NULL_OR_STRING,
        differentiators:      NULL_OR_STRING,
        acquisition_channels: NULL_OR_STRING,
        known_facts:          { anyOf: [{ type: "string" }, { type: "null" }], description: "Newline-separated confirmed facts. Include all existing items + new ones from this session. Null if nothing new." },
        assumptions:          { anyOf: [{ type: "string" }, { type: "null" }], description: "Newline-separated working hypotheses. Include all existing items + new ones from this session. Null if nothing new." },
        validated_learnings:  { anyOf: [{ type: "string" }, { type: "null" }], description: "Newline-separated evidence-backed learnings. Include all existing items + new ones. Null if nothing new." },
        current_mission_detail: {
          anyOf: [
            {
              type: "object",
              description: "Structured sales mission. Set null if not enough context exists.",
              properties: {
                name:            { type: "string", description: "Short mission name, e.g. 'Validate SEO agency outreach'" },
                status:          { type: "string", description: "Always 'preparing' for new missions" },
                objective:       { type: "string", description: "What this mission is trying to learn or achieve" },
                target_segment:  { type: "string", description: "Specific segment — never broad. E.g. 'SEO freelancers billing hourly', not 'businesses'" },
                hypothesis:      { type: "string", description: "The specific assumption being tested" },
                sales_angle:     { type: "string", description: "The opening value proposition for this segment" },
                success_metric:  { type: "string", description: "What counts as success, e.g. '5 interested conversations from 25 contacts'" },
                required_inputs: { type: "array", items: { type: "string" }, description: "What is needed before action. Almost always includes 'prospect_list'." },
                next_action:     { type: "string", description: "The immediate, specific next step" },
              },
              required: ["name", "status", "objective", "target_segment", "hypothesis", "sales_angle", "success_metric", "required_inputs", "next_action"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
        },
      },
      required: [
        "offer", "target_customers", "pain_points", "objections",
        "positioning", "pricing", "preferred_tone", "proof_points",
        "sales_arguments", "differentiators", "acquisition_channels",
        "known_facts", "assumptions", "validated_learnings",
        "current_mission_detail",
      ],
      additionalProperties: false,
    },
    memory_events: {
      type: "array",
      description: "Discrete strategic insights, decisions, or shifts — not conversation steps.",
      items: {
        type: "object",
        properties: {
          type:       { type: "string", description: "Operational event type from the taxonomy" },
          content:    { type: "string", description: "The specific operational insight — specific, not generic" },
          importance: { type: "integer", minimum: 1, maximum: 5 },
          // Correction metadata — required fields on every event; set to null for non-corrections.
          field_changed:     { anyOf: [{ type: "string" }, { type: "null" }], description: "Profile field being corrected, e.g. 'pricing'. Null if not a correction." },
          old_understanding: { anyOf: [{ type: "string" }, { type: "null" }], description: "What was previously understood about this field. Null if not a correction." },
          new_understanding: { anyOf: [{ type: "string" }, { type: "null" }], description: "The corrected value the founder provided. Null if not a correction." },
        },
        required: ["type", "content", "importance", "field_changed", "old_understanding", "new_understanding"],
        additionalProperties: false,
      },
    },
    strategic_gaps: {
      type: "array",
      description: "What is still unknown that matters for outbound execution",
      items: { type: "string" },
    },
    unresolved_tensions: {
      type: "array",
      description: "Conflicting signals or founder ambiguities detected",
      items: { type: "string" },
    },
    session_summary:        { type: "string" },
    recommended_next_focus: { type: "string" },
    current_mission:        { type: "string" },
  },
  required: [
    "business_profile_patch",
    "memory_events",
    "strategic_gaps",
    "unresolved_tensions",
    "session_summary",
    "recommended_next_focus",
    "current_mission",
  ],
  additionalProperties: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatExistingProfile(profile: Partial<BusinessMemory> | null): string {
  if (!profile) return "(none — this is a first session)";

  const fields: [keyof BusinessMemory, string][] = [
    ["offer",             "Offer"],
    ["target_customers",  "Target customers"],
    ["positioning",       "Positioning"],
    ["pain_points",       "Pain points"],
    ["objections",        "Objections"],
    ["pricing",           "Pricing"],
    ["preferred_tone",    "Tone"],
    ["proof_points",      "Proof points"],
    ["sales_arguments",   "Sales arguments"],
    ["differentiators",   "Differentiators"],
    ["acquisition_channels", "Acquisition channels"],
    ["current_mission",      "Current mission"],
    ["strategic_focus",      "Last strategic focus"],
    ["known_facts",          "Known facts"],
    ["assumptions",          "Working assumptions"],
    ["validated_learnings",  "Validated learnings"],
  ];

  const lines = fields
    .filter(([key]) => profile[key])
    .map(([key, label]) => `${label}: ${String(profile[key])}`);

  // Render current_mission_detail as a readable summary (it is stored as JSON string)
  if (profile.current_mission_detail) {
    try {
      const m = JSON.parse(profile.current_mission_detail) as Record<string, unknown>;
      lines.push(`Active mission: "${String(m.name ?? "unnamed")}" | target: ${String(m.target_segment ?? "?")} | testing: ${String(m.hypothesis ?? "?")}`);
    } catch {
      // Malformed JSON — skip silently
    }
  }

  return lines.length > 0 ? lines.join("\n") : "(profile exists but no fields filled yet)";
}

function formatTranscript(turns: CompactedTurn[]): string {
  // Take the last 40 turns to stay within the token budget for gpt-4o-mini.
  // Cap each turn at 600 chars to handle long monologues without inflating cost.
  return turns
    .slice(-40)
    .filter((t) => t.text.trim().length > 8)
    .map((t) => {
      const role = t.role === "user" ? "Founder" : "Zeya";
      return `${role}: ${t.text.slice(0, 600)}`;
    })
    .join("\n");
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(
  existingProfileText: string,
  transcriptText: string,
  sessionType: "onboarding" | "briefing",
): string {
  const sessionContext =
    sessionType === "onboarding"
      ? "SESSION TYPE: Initial onboarding. The founder is giving you your first briefing on the business. Your goal is to build the complete sales foundation from scratch."
      : "SESSION TYPE: Ongoing briefing. You already have prior knowledge of the business. Extract what evolved, shifted, or was decided in this session — do not re-extract what you already know unless it was refined.";

  return `You are Zeya — an AI Sales Development Executive.

Your job is NOT to summarize conversations. Your job is to understand how to successfully sell this founder's product or service.

After reading this conversation, you must know:
- Exactly what is being sold and what outcome it delivers
- Who should buy it and what makes them a qualified prospect
- Why they buy (pain, desire, or urgency)
- Why they hesitate or say no (objections)
- How to position the value in a first conversation
- Proof points that build credibility
- Pricing and offer structure a prospect would actually hear
- The strongest sales arguments to open with
- What is still unknown and needs to be validated in the field

${sessionContext}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXISTING KNOWLEDGE (what you already know about this business):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${existingProfileText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONVERSATION TRANSCRIPT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${transcriptText}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES — read these before filling any field
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1 — No generic summaries. Extract sales intelligence.

Bad:  "The founder discussed pricing strategy."
Good: "Starter plan is $9.99/month for 120 enriched leads — priced to let freelancers validate ROI before committing to the $29.99 growth tier."

Bad:  "Customers were mentioned."
Good: "Primary ICP: SEO freelancers, web designers, and digital consultants who handle their own client acquisition — specifically those billing hourly who lose 3–5 hours per week to manual prospect research."

Bad:  "Product helps with prospecting."
Good: "ALPA enriches outbound lead lists with verified website, email, and phone data — the core value is not the leads themselves but the hours of billable time freelancers recover by not searching manually."

RULE 2 — Correct obvious voice transcription errors using context.

This is a voice conversation. ASR systems make mistakes. Use the surrounding context to infer the intended word.

Examples:
- "power athletes" in a SaaS pricing conversation → likely "power users" or a pricing tier name
- "sea of freelancers" → likely "sea of freelancers" (correct) or "C-suite" depending on context
- Garbled numbers → use surrounding context to infer (e.g., "$9 point 99" → "$9.99")

When you correct a transcription error, write the corrected version without flagging it. Only flag if the meaning is genuinely ambiguous.

RULE 3 — Separate customer economics from product pricing. Route each to the correct field.

There are two distinct financial concepts in every sales conversation. Confusing them produces wrong pricing data and wastes the best sales arguments.

PRODUCT PRICING — what the founder charges customers for the product or service.
This and only this belongs in business_profile_patch.pricing.
Signals that a price is the product price: the sentence contains words like
"plan", "subscription", "package", "costs", "pay for the tool", "per month", "upgrade", "tier", "trial", "free plan".
Example: "Our starter plan is $9.99 a month for 120 leads." → pricing: "Starter $9.99/month · 120 leads."

CUSTOMER ECONOMICS — what customers earn, save, or recover by using the product.
This does NOT belong in pricing. Route it to:
→ sales_arguments  if it is a value proposition or ROI calculation
→ positioning      if it frames why the product is worth buying
→ proof_points     if it is a validated, concrete customer outcome

Example: "A freelancer charges $300–$500 per client. One new client from ALPA covers the subscription."
→ pricing: (nothing from this sentence — no product price mentioned)
→ sales_argument: "One new $300–$500 client pays for the annual subscription many times over."

Wrong:
pricing: "$300–$500/month"  ← this is what the customer earns, not what the product costs

Correct:
pricing: "Free trial: 25 leads. Starter $9.99/month. Growth $29.99/month."
sales_argument: "One new $300–$500 client covers the subscription — ROI is visible after the first conversion."

When multiple dollar amounts appear in the same conversation, always ask: is this what the customer PAYS FOR THE TOOL, or what they EARN/SAVE by using it? Only the former goes in pricing.

RULE 4 — Extract positioning as a sales angle, not a description.

Bad:  "A cost-effective prospecting platform."
Good: "ALPA sells time recovery: freelancers should spend their hours closing clients, not manually searching for contact information. The pitch is ROI on billable time, not access to a database."

Bad:  "Helps businesses find leads."
Good: "Positioned as a pipeline-building tool for solo operators who cannot afford to hire a sales researcher — ALPA is the researcher."

RULE 5 — Treat uncertainty as intelligence, not silence.

If the founder says they do not know something, that is operationally significant.

Create:
- A strategic_gap with the specific unknown
- A current_mission with the validation action needed

Example: Founder says "We're not sure if agencies really feel the manual search pain."
→ strategic_gap: "Unvalidated whether mid-size SEO agencies experience manual prospect research as a daily pain point — may only matter to solo operators"
→ current_mission: "Run 10 outreach conversations with SEO agency owners specifically to validate whether the time-recovery angle resonates at team scale"

RULE 6 — Preserve specificity. Names, numbers, and segments beat clean language.

RULE 7 — Correction signals override prior understanding. Detect them explicitly and act on them.

Correction signals in natural speech:
"no", "no that's wrong", "no that's not what I meant", "actually", "wait", "let me correct that",
"that's not right", "you misunderstood", "not exactly", "I meant", "to clarify",
"I said X not Y", "you got that wrong", "that's not the price", "that's what I earn, not what I charge"

When you detect a correction signal:

Step 1 — Identify which profile field is being corrected:
offer · target_customers · pain_points · objections · positioning · pricing
preferred_tone · proof_points · sales_arguments · differentiators · acquisition_channels · current_mission

Step 2 — Extract the corrected value from what the founder said.
Use it directly. Do NOT blend with the old value. Overwrite cleanly.

Priority order for any corrected field:
Founder correction > anything in the existing profile > earlier in this conversation

Step 3 — Put the corrected value in business_profile_patch for that field.

Step 4 — Create a founder_correction event:
- type: "founder_correction"
- content: one sentence explaining what changed and why (e.g., "Founder corrected pricing: product costs $9.99, not $300–$500 which is customer earnings.")
- field_changed: the exact field name (e.g., "pricing")
- old_understanding: what was previously stored or understood (from existing profile or transcript context)
- new_understanding: the corrected value the founder provided
- importance: 5 (corrections always carry maximum weight)

For every non-correction event, set field_changed, old_understanding, new_understanding to null.

Do NOT treat every new detail as a correction. Only explicit contradiction language creates founder_correction events.
Normal additions and refinements use existing event types with null correction fields.

Example:
Transcript: "No, that's not right — $300-$500 is what my customers earn. ALPA costs $9.99."
Existing profile pricing: "$300-$500/month"

business_profile_patch:
  pricing: "$9.99 entry plan"
  sales_arguments: "One acquired customer worth $300-$500 covers the full subscription cost"

memory_event:
  type: "founder_correction"
  content: "Founder corrected pricing confusion: $300-$500 is customer earnings, not product cost. ALPA entry plan is $9.99/month."
  field_changed: "pricing"
  old_understanding: "$300-$500/month"
  new_understanding: "$9.99 entry plan"
  importance: 5
  (field_changed, old_understanding, new_understanding null on all other events)

If the founder says "the SEO guys respond way better than the web designers" — write exactly that, not "certain segments show higher engagement."
If they say "$29.99" — write $29.99, not "a mid-tier pricing point."
If they say "coaches from Instagram DMs" — write that, not "social media channels."

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FIELD INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

business_profile_patch:
- Fields discussed in this conversation: write the MERGED/IMPROVED version combining existing knowledge with new evidence. Refine — do not just append.
- Fields NOT discussed: set null. Never copy old values into null fields.
- Write as if briefing a sales rep who starts calling tomorrow. They need to know exactly what to say, who to say it to, and how to handle pushback.
- Specific beats polished. A rough but accurate insight is more valuable than a clean but vague one.

memory_events:
- Include only events with genuine sales intelligence value: a new insight about the customer, a pricing decision, a discovered objection, a positioning shift, a proof point.
- Skip greetings, procedural steps, and information already captured in prior sessions.
- 1–6 events. Quality over quantity. One sharp insight beats five generic observations.
- Valid types: icp_refined, positioning_shift, objection_detected, pricing_strategy, proof_point_added, founder_priority, strategic_gap, mission_progress, sales_argument, differentiator, acquisition_channel, tone_calibration, unresolved_tension

session_summary:
- 2–3 sentences. What did you learn about how to sell this product after this session?
- Write as a briefing to the next agent taking over the account — what do they need to know to not start cold?

strategic_gaps:
- What you still do not know that would change how you sell this.
- Each gap must be specific: "No validated proof point for the agency segment — only have freelancer testimonials."
- Empty array only if every execution-critical unknown is resolved.

unresolved_tensions:
- Conflicting signals: "Founder says tone should be direct, but also says prospects respond better to 'empathetic' openers — unclear which to prioritize in cold outreach."
- Empty array if none detected.

recommended_next_focus:
- One sentence. The single insight or validation that would most improve your ability to sell this product.

current_mission:
- The specific, targeted outreach action being prepared. Include segment, angle, and goal if known.
- Example: "Run 15 cold DMs to SEO freelancers on LinkedIn testing the 'recover your prospecting hours' angle — goal is to validate whether time recovery resonates more than database access."
- Empty string only if no outbound action has been discussed.

known_facts:
- Definitive facts stated with confidence by the founder, or clearly established as true.
- Examples: confirmed pricing ("$9.99 starter"), verified product features, confirmed customer segment names, stated company metrics.
- If existing known_facts are in the profile: include ALL of them PLUS any new facts from this session, one per line.
- If no new facts were established in this session: output null (existing facts are preserved automatically).
- When in doubt, use assumptions instead. Do not promote guesses to facts.

assumptions:
- Beliefs, working hypotheses, or untested theories — anything uncertain.
- Examples: "SEO agencies may respond better to the time-recovery angle", "the $29.99 tier may be too high for solo freelancers."
- Triggered by language like: "I think", "probably", "maybe", "I believe", "we expect", "I'm not sure", "we assume", "might", "could".
- Also include strategic opinions not yet tested in the market.
- If existing assumptions are in the profile: include ALL of them PLUS any new ones from this session, one per line.
- If nothing new surfaced in this session: output null.
- When in doubt, put it here — not in known_facts.

validated_learnings:
- ONLY facts supported by actual market evidence: customer calls, prospect responses, tests, closed deals, observed conversion patterns.
- Examples: "20 SEO agencies called — 8 said email deliverability mattered more than time savings", "price objection appeared in 70% of first calls."
- This field should grow slowly. Most sessions will add nothing here.
- Never add a founder's opinion or hypothesis here, no matter how confident they sound.
- If real evidence was discussed in this session: include ALL existing validated_learnings PLUS the new items, one per line.
- If no validated evidence appeared: output null.

current_mission_detail:
Generate a structured mission object when there is enough context to define a specific, actionable sales mission.

A mission can be defined when you have ALL of: a clear target segment, at least one assumption worth testing, a sales angle for that segment, and a sense of what inputs are needed.
Do NOT invent a mission when context is still forming. Set null if unsure.

When generating the mission:
- name: short and specific ("Validate SEO agency outreach with time-recovery angle")
- status: always "preparing" for a new mission
- objective: what this mission is trying to learn or confirm
- target_segment: be precise — "SEO freelancers billing hourly" beats "freelancers"
- hypothesis: the specific assumption being tested (should connect to an item in assumptions)
- sales_angle: the opening value proposition for a first contact with this segment
- success_metric: a concrete, measurable outcome ("5 positive responses from 25 cold outreach messages")
- required_inputs: what is needed before execution. Almost always ["prospect_list"] unless contacts are already available
- next_action: the single most immediate step — specific and actionable

If a prior mission exists in the profile and this session did not change direction, preserve or refine it.
If this session revealed the mission is no longer valid, update it to reflect the new understanding.`.trim();
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractOperationalMemory(
  input: OperationalMemoryInput,
): Promise<OperationalMemoryOutput> {
  if (!process.env.OPENAI_API_KEY) {
    console.error("[Zeya memory] OPENAI_API_KEY not set — skipping LLM extraction.");
    return EMPTY_EXTRACTION;
  }

  if (input.turns.length === 0) return EMPTY_EXTRACTION;

  const transcriptText = formatTranscript(input.turns);
  if (!transcriptText.trim()) return EMPTY_EXTRACTION;

  const existingProfileText = formatExistingProfile(input.existingProfile);
  const systemPrompt = buildSystemPrompt(existingProfileText, transcriptText, input.sessionType);

  try {
    const openai = new OpenAI();

    const response = await openai.responses.create({
      model: "gpt-4o-mini",
      instructions: systemPrompt,
      input: [
        {
          role: "user",
          content: "Extract the operational memory from this session.",
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "operational_memory",
          schema: RESPONSE_SCHEMA,
          strict: true,
        },
      },
    });

    const raw = JSON.parse(response.output_text) as {
      business_profile_patch: Record<string, string | null | Record<string, unknown>>;
      memory_events: OperationalMemoryEvent[];
      strategic_gaps: string[];
      unresolved_tensions: string[];
      session_summary: string;
      recommended_next_focus: string;
      current_mission: string;
    };

    // Strip null / empty strings from the patch.
    // current_mission_detail is excluded here — serialised separately below.
    const patch = Object.fromEntries(
      Object.entries(raw.business_profile_patch).filter(
        ([k, v]) => k !== "current_mission_detail" && v !== null && v !== "",
      ),
    ) as Partial<BusinessMemory>;

    // Serialise the nested mission object to a JSON string so it fits the
    // string | null type and is stored cleanly in the JSONB profile.
    const rawMission = raw.business_profile_patch.current_mission_detail;
    if (rawMission && typeof rawMission === "object" && !Array.isArray(rawMission)) {
      patch.current_mission_detail = JSON.stringify(rawMission);
    }

    return {
      business_profile_patch: patch,
      memory_events: raw.memory_events,
      strategic_gaps: raw.strategic_gaps.filter(Boolean),
      unresolved_tensions: raw.unresolved_tensions.filter(Boolean),
      session_summary: raw.session_summary,
      recommended_next_focus: raw.recommended_next_focus,
      current_mission: raw.current_mission,
    };
  } catch (err) {
    console.error("[Zeya memory] LLM extraction failed:", err);
    return EMPTY_EXTRACTION;
  }
}
