// Structured business-intelligence extraction from compacted transcript turns.
// No LLM: context-aware Q→A pairing + signal-pattern fallback.
//
// Strategy:
//   1. Context-aware  — classify a user turn by the preceding assistant question
//                       (high precision, covers ~80 % of structured onboarding Q&A)
//   2. Signal-based   — keyword / regex patterns on the user turn itself
//                       (lower confidence, catches free-form disclosures)
//   3. Mission cues   — assistant turns that contain first-mission readiness language

import type { CompactedTurn } from "@/lib/memory/compact-transcript";

// ─── Types ────────────────────────────────────────────────────────────────────

export const STRUCTURED_EVENT_TYPES = [
  "business_name",
  "offer",
  "icp",
  "pain_point",
  "objection",
  "pricing",
  "positioning",
  "proof_point",
  "tone",
  "sales_argument",
  "differentiator",
  "acquisition_channel",
  "unresolved_question",
  "missing_information",
  "mission_recommendation",
] as const;

export type StructuredEventType = (typeof STRUCTURED_EVENT_TYPES)[number];

export interface ExtractedEvent {
  event_type: StructuredEventType;
  content: string;
}

// ─── Context inference ────────────────────────────────────────────────────────
// Map patterns found in Zeya's questions to the category the user's answer fits.

const QUESTION_TYPE_MAP: Array<[RegExp, StructuredEventType]> = [
  [
    /what\s+(product|service|are\s+(you|we)\s+(sell|offer|focus)|do\s+you\s+sell|should\s+we\s+focus|focus(?:ing\s+on)?)/i,
    "offer",
  ],
  [
    /who\s+(are|is)\s+(the\s+|your\s+)?(client|customer|buyer|target|audience)|who\s+do\s+you\s+(work\s+with|serve|help)|who\s+(feel|has)\s+(that\s+)?pain|who\s+should\s+we\s+(call|reach|target|attack)/i,
    "icp",
  ],
  [
    /pain|struggle|problem|challenge|frustrat|biggest\s+(issue|obstacle|challenge)|main\s+(problem|pain)/i,
    "pain_point",
  ],
  [
    /object|pushback|resist|hesitant|they\s+say\s+no|why\s+(don'?t|do\s+people\s+not)\s+buy|barrier|why\s+(leads?|prospects?)\s+(don'?t|hesitate)/i,
    "objection",
  ],
  [
    /price|cost|charge|how\s+much|pricing|what\s+(are\s+you\s+charging|does\s+it\s+cost)|say\s+about\s+pric/i,
    "pricing",
  ],
  [
    /different|unique|stand\s+out|better\s+than|unlike|set\s+you\s+apart|advantage|why\s+(you\s+over|choose\s+you|not\s+go\s+with)/i,
    "differentiator",
  ],
  [
    /tone|brand\s+voice|sound\s+(like|more|less)|come\s+across|how\s+(should|do)\s+(we|you)\s+(come\s+across|sound|show\s+up)/i,
    "tone",
  ],
  [
    /find\s+(clients?|leads?|customers?)|where\s+(do\s+)?clients\s+come\s+from|channel|how\s+do\s+(you|people)\s+discover|reach\s+(you|them)|where\s+(are|should)\s+(we|i|you)\s+(be|operat)/i,
    "acquisition_channel",
  ],
  [
    /proof|testimonial|case\s+stud|result|success\s+stor|evidence|example|reference|client\s+win/i,
    "proof_point",
  ],
  [
    /first\s+(mission|outreach|call|target|focus|step|campaign)|start\s+with|attack\s+first|which\s+(one|segment)\s+should/i,
    "mission_recommendation",
  ],
  [
    /pitch|hook|angle|lead\s+with|main\s+(message|benefit|value\s+prop)|why\s+(they|someone)\s+(buy|would\s+choose)/i,
    "sales_argument",
  ],
  [
    /what\s+(position|angle)|how\s+(do\s+you|should\s+we)\s+(position|frame|differentiate)|our\s+angle/i,
    "positioning",
  ],
];

function inferTypeFromQuestion(question: string): StructuredEventType | null {
  for (const [pattern, type] of QUESTION_TYPE_MAP) {
    if (pattern.test(question)) return type;
  }
  return null;
}

// ─── Signal-based patterns ────────────────────────────────────────────────────
// Tested against lowercased user text. Each pattern should be specific enough
// to avoid false positives on generic conversation fragments.

const SIGNAL_PATTERNS: Partial<Record<StructuredEventType, RegExp>> = {
  offer:
    /\b(we\s+sell|we\s+offer|we\s+build|we\s+create|our\s+(product|service|tool|software|platform|app)|we\s+automate|we\s+help\s+\w+\s+(with|to\s+\w)|i\s+(sell|offer|coach|consult|run\s+a))\b/i,

  icp:
    /\b(our\s+(clients?|customers?|buyers?|audience)|we\s+(work\s+with|target|serve|focus\s+on)|ideal\s+customer|for\s+(coaches?|agencies|saas\s+companies?|startups?|small\s+businesses?|freelancers?|b2b\s+companies?))\b/i,

  pain_point:
    /\b(they\s+(spend\s+hours?|waste\s+time|can'?t\s+(find|scale))|manually\s+(search|find|do|track|build|scrape)|too\s+(slow|manual|tedious|time[- ]consuming)|frustrat(?:ed|ing)|overwhelm(?:ed|ing)|stressful)\b/i,

  objection:
    /\b(they\s+say|they\s+think\s+they\s+can|too\s+expensive|can\s+do\s+it\s+(myself|themselves|yourself|for\s+free)|(for\s+)?free\s+(on|via|through|with)\s+(linkedin|google|apollo)|don'?t\s+need\s+it)\b/i,

  pricing:
    /(\$\s*[\d,]+\.?\d*|\b\d[\d,]*\.?\d*\s*(dollars?|bucks?)\b|\b\d+\s*(per\s+(month|year|lead|contact|user)|a\s+(month|year)|monthly|annually)\b|free\s+trial|\bplans?\s+(start|begin)\s+at\b)/i,

  missing_information:
    /\b(don'?t\s+know\s+yet|not\s+sure\s+(yet|about\s+that)?|haven'?t\s+(decided|figured|tested|tried|gotten)|just\s+(launched|started\s+selling|built\s+this)|still\s+(figuring|working\s+on|developing|testing)|no\s+(testimonials?|proof\s+points?|case\s+studies?|real\s+data|feedback\s+yet)|need\s+to\s+(figure|test|find\s+out)|will\s+have\s+to\s+(see|test))\b/i,

  tone:
    /\b(our\s+tone|brand\s+voice|sound\s+(more\s+)?(human|warm|direct|casual|professional)|come\s+across\s+as|not\s+(corporate|salesy|pushy|robotic)|conversational|empathetic)\b/i,

  differentiator:
    /\b(only\s+we|no\s+one\s+else|sets?\s+us\s+apart|makes?\s+us\s+(unique|different|special)|our\s+(edge|advantage)|verified\s+(contacts?|leads?|emails?|phone\s+numbers?)|faster\s+than\s+\w|more\s+accurate)\b/i,

  positioning:
    /\b(unlike\s+\w|different\s+from\s+\w|better\s+than\s+\w|our\s+angle\s+is|we'?re\s+not\s+(just|another|a\s+typical)|what\s+makes\s+us\s+(different|unique|stand\s+out)|we\s+stand\s+out\s+because)\b/i,

  acquisition_channel:
    /\b(referrals?|word\s+of\s+mouth|instagram|linkedin\s+(outreach|dms?|posts?)?|google\s+(ads?|seo)?|facebook\s+ads?|meta\s+ads?|cold\s+(email|outreach|dms?|calls?)|email\s+(list|newsletter|marketing)|paid\s+(ads?|traffic)|organic\s+(traffic|growth))\b/i,

  proof_point:
    /\b(case\s+stud(?:y|ies)|testimonial|helped\s+\w+\s+(achieve|get|grow|convert|generate|save)|client\s+(got|said\s+they|achieved)|success\s+stor(?:y|ies)|roi|return\s+on\s+investment)\b/i,

  sales_argument:
    /\b(the\s+(?:pitch|hook)|our\s+(main\s+)?value\s+prop|what\s+we\s+lead\s+with|the\s+(key\s+)?(?:selling\s+point|message|benefit)|why\s+they\s+(buy|choose\s+us|pay\s+for\s+it))\b/i,

  unresolved_question:
    /\b(not\s+sure\s+if|should\s+we\s+(go\s+with|focus\s+on|target)|(?:which|what)\s+(approach|direction|one)\s+(should\s+we|do\s+you\s+think)|i'?m\s+(torn|undecided|debating)|wondering\s+(?:if|whether))\b/i,
};

// ─── Business name extraction ─────────────────────────────────────────────────

function extractBusinessName(text: string): string | null {
  const patterns = [
    /(?:(?:we'?re?|we\s+are|it'?s|is\s+)?called|named|our\s+(?:company|business|brand)\s+is(?:\s+called)?)\s+["']?([A-Z][a-zA-Z0-9\s&.',-]{1,40})["']?(?:\s|,|\.|$)/i,
    /["']([A-Z][a-zA-Z0-9\s&.',-]{1,40})["']\s*(?:is|are|helps?|sells?|offers?)/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m?.[1]?.trim()) return m[1].trim();
  }
  return null;
}

// ─── Main extraction ──────────────────────────────────────────────────────────

const MIN_WORDS = 3;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function extractMemoryEvents(turns: CompactedTurn[]): ExtractedEvent[] {
  const events: ExtractedEvent[] = [];
  // Dedup by (event_type, normalised content prefix).
  const emitted = new Set<string>();

  function emit(type: StructuredEventType, content: string) {
    const key = `${type}:${content.toLowerCase().trim().slice(0, 80)}`;
    if (emitted.has(key)) return;
    emitted.add(key);
    events.push({ event_type: type, content: content.trim() });
  }

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const text = turn.text.trim();

    if (wordCount(text) < MIN_WORDS) continue;

    // ── User turns ────────────────────────────────────────────────────────────
    if (turn.role === "user") {
      // 1. Context-aware: infer category from the preceding assistant question
      let contextType: StructuredEventType | null = null;
      if (i > 0 && turns[i - 1].role === "assistant") {
        contextType = inferTypeFromQuestion(turns[i - 1].text);
      }

      if (contextType) {
        if (contextType === "business_name") {
          const name = extractBusinessName(text);
          emit("business_name", name ?? text);
        } else {
          emit(contextType, text);
        }
      }

      // 2. Signal-based: additional types not caught by context
      for (const [rawType, pattern] of Object.entries(SIGNAL_PATTERNS)) {
        const type = rawType as StructuredEventType;
        if (!pattern?.test(text)) continue;
        if (type === "business_name") {
          const name = extractBusinessName(text);
          if (name) emit("business_name", name);
        } else {
          emit(type, text);
        }
      }

      // 3. Try to extract a business name from any user turn
      const maybeName = extractBusinessName(text);
      if (maybeName) emit("business_name", maybeName);
    }

    // ── Assistant turns: detect first-mission readiness ───────────────────────
    if (turn.role === "assistant") {
      if (
        /\b(i\s+have\s+enough\s+to\s+start|first\s+mission|i'?d\s+focus\s+(on\s+)?coaches?|let'?s\s+(start\s+with|attack|focus\s+on)|ready\s+to\s+start|i\s+recommend\s+(starting|focusing\s+on|going\s+with))\b/i.test(
          text,
        )
      ) {
        emit("mission_recommendation", text);
      }
    }
  }

  return events;
}
