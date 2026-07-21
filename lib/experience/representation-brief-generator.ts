import type {
  RepresentationBrief,
  RepresentationBriefEvidenceSource,
  RepresentationBriefValidation,
} from "@/types/experience";

export interface RepresentationBriefInput {
  visitorName: string | null;
  businessOffer: string | null;
  targetCustomer: string | null;
  zeyaTranscript: Array<{ role: string; text: string; id?: string }>;
  veyaTranscript: Array<{ role: string; text: string; id?: string }>;
}

interface ExtractedEvidence {
  businessDescription: string | null;
  emphasisPattern: { topic: string; strength: "clear" | "moderate" | "weak" } | null;
  contradiction: { statement1: string; statement2: string } | null;
  underemphasisedStrength: string | null;
  observations: string[];
}

function safeText(value: unknown, limit = 240): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/https?:\/\/\S+/gi, "[link]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[phone]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function getVisitorTurns(
  transcript: Array<{ role: string; text: string; id?: string }>,
): Array<{ text: string; id?: string }> {
  return transcript
    .filter((turn) => turn.role === "user" || turn.role === "customer")
    .map((turn) => ({ text: safeText(turn.text, 300), id: turn.id }))
    .filter((turn) => turn.text.length > 0);
}

function extractEvidence(input: RepresentationBriefInput): ExtractedEvidence {
  const zeyaTurns = getVisitorTurns(input.zeyaTranscript);
  const veyaTurns = getVisitorTurns(input.veyaTranscript);
  const allTurns = [...zeyaTurns, ...veyaTurns];

  if (allTurns.length === 0) {
    return {
      businessDescription: null,
      emphasisPattern: null,
      contradiction: null,
      underemphasisedStrength: null,
      observations: [],
    };
  }

  // Build business description from extracted fields
  const businessDescription = [
    input.businessOffer && `sells ${input.businessOffer}`,
    input.targetCustomer && `serves ${input.targetCustomer}`,
  ]
    .filter(Boolean)
    .join(" and ");

  // Detect emphasis patterns: look for repeated topics or strong conviction language
  const emphasisWords = ["definitely", "really", "important", "key", "always"];
  const weakWords = ["maybe", "might", "could", "possibly"];

  let emphasisTopic: string | null = null;
  let emphasisStrength: "clear" | "moderate" | "weak" = "weak";

  for (const turn of allTurns) {
    const hasEmphasis = emphasisWords.some((w) => turn.text.toLowerCase().includes(w));
    const hasWeak = weakWords.some((w) => turn.text.toLowerCase().includes(w));

    if (hasEmphasis && !hasWeak) {
      emphasisTopic = turn.text.substring(0, 100);
      emphasisStrength = "clear";
      break;
    } else if (hasEmphasis) {
      emphasisTopic = turn.text.substring(0, 100);
      emphasisStrength = "moderate";
    }
  }

  // Look for contradictions: comparing what's stated vs. outcomes
  let contradiction: { statement1: string; statement2: string } | null = null;
  if (allTurns.length >= 2) {
    const first = allTurns[0].text.toLowerCase();
    const last = allTurns[allTurns.length - 1].text.toLowerCase();

    // Simple contradiction detection: if tone/confidence changes significantly
    const firstHasChallenge = /challenge|difficult|hard|struggle|problem/.test(first);
    const lastHasOutcome = /outcome|result|success|achieved|learned/.test(last);

    if (firstHasChallenge && lastHasOutcome) {
      contradiction = {
        statement1: allTurns[0].text,
        statement2: allTurns[allTurns.length - 1].text,
      };
    }
  }

  // Look for underemphasized strengths: things mentioned passively that are actually valuable
  let underemphasisedStrength: string | null = null;
  const strengthKeywords = ["worked", "successfully", "repeat", "clients stay", "referred"];

  for (const turn of allTurns) {
    const lowerText = turn.text.toLowerCase();
    if (strengthKeywords.some((k) => lowerText.includes(k)) && !turn.text.includes("!")) {
      underemphasisedStrength = turn.text.substring(0, 120);
      break;
    }
  }

  return {
    businessDescription: businessDescription || null,
    emphasisPattern: emphasisTopic
      ? {
          topic: emphasisTopic,
          strength: emphasisStrength,
        }
      : null,
    contradiction,
    underemphasisedStrength,
    observations: allTurns.map((t) => t.text).slice(0, 3),
  };
}

function generateWhatIHeard(evidence: ExtractedEvidence): string {
  if (!evidence.businessDescription) {
    return "I heard enough about your business to begin understanding it.";
  }
  return `You ${evidence.businessDescription}.`;
}

function generateWhatStoodOut(
  evidence: ExtractedEvidence,
  input: RepresentationBriefInput,
): { text: string; sourceId?: string } | null {
  // Priority 1: underemphasized strength
  if (evidence.underemphasisedStrength) {
    return {
      text: `You mentioned that ${evidence.underemphasisedStrength}, but you did not lead with it.`,
    };
  }

  // Priority 2: emphasis pattern
  if (evidence.emphasisPattern && evidence.emphasisPattern.strength === "clear") {
    return {
      text: `You spoke with particular conviction about ${evidence.emphasisPattern.topic}.`,
    };
  }

  // Priority 3: contradiction
  if (evidence.contradiction) {
    return {
      text: `There is a contrast between what you described as the challenge and what you revealed as the actual outcome. That contrast is significant.`,
    };
  }

  return null;
}

function generateWhatThatMayMean(
  evidence: ExtractedEvidence,
  observation: { text: string } | null,
): string | null {
  if (!observation) return null;

  if (evidence.underemphasisedStrength) {
    return `That suggests your strongest position may not be what you currently lead with. It may be what you mentioned in passing.`;
  }

  if (evidence.emphasisPattern?.strength === "clear") {
    return `That suggests the way you talk about that topic may be how prospects actually want to understand your business.`;
  }

  if (evidence.contradiction) {
    return `That suggests the real value may be different from what you initially described as the challenge.`;
  }

  return null;
}

function generateWhereIWouldBegin(
  evidence: ExtractedEvidence,
  input: RepresentationBriefInput,
  observation: { text: string } | null,
): string {
  if (evidence.underemphasisedStrength) {
    return `I would begin by representing that strength more clearly. You understand it. I would help prospects understand it too.`;
  }

  if (evidence.emphasisPattern) {
    return `I would begin by leading with the thing you spoke about with the most conviction. That is what I would represent.`;
  }

  if (evidence.businessDescription) {
    return `I would begin by representing you with clarity: ${evidence.businessDescription}.`;
  }

  return `I would begin by clarifying how you want to be understood. That is the first representation I would want us to refine.`;
}

function generateAlignmentQuestion(): string {
  return "Is that aligned with how you want your business understood?";
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).length;
}

function validateEvidence(
  evidence: ExtractedEvidence,
  whatIHeard: string,
  whatStoodOut: string | null,
  whatThatMayMean: string | null,
): boolean {
  if (!whatIHeard || whatIHeard.length < 10) return false;
  if (!whatStoodOut) return false;
  if (!whatThatMayMean) return false;

  // No invented statistics allowed
  if (/\b\d+%\b/.test(whatIHeard + whatStoodOut + whatThatMayMean)) return false;

  return true;
}

function validateInterpretation(
  whatStoodOut: string | null,
  whatThatMayMean: string | null,
  whereIWouldBegin: string,
): boolean {
  if (!whatStoodOut) return false;
  if (!whatThatMayMean) return false;

  // Must not be purely generic
  const genericPhrases = ["improve", "optimize", "enhance"];
  const isGeneric = genericPhrases.every((p) => !whereIWouldBegin.includes(p));

  return isGeneric;
}

function validateGovernance(
  whatThatMayMean: string | null,
  whereIWouldBegin: string,
  alignmentQuestion: string,
): boolean {
  if (!whatThatMayMean) return false;

  // Must not use directive language
  const forbiddenPhrases = ["you must", "you need to", "you should"];
  const hasDirective = forbiddenPhrases.some((p) =>
    (whatThatMayMean + whereIWouldBegin).includes(p),
  );

  if (hasDirective) return false;

  // Must have alignment question
  if (!alignmentQuestion.includes("?")) return false;

  return true;
}

export function generateRepresentationBrief(
  input: RepresentationBriefInput,
): RepresentationBrief | { error: string; type: "insufficient_evidence" | "validation_failed" } {
  // Basic evidence check
  if (input.zeyaTranscript.length === 0 && input.veyaTranscript.length === 0) {
    return {
      error: "No conversation transcript available.",
      type: "insufficient_evidence",
    };
  }

  const evidence = extractEvidence(input);

  if (evidence.observations.length === 0) {
    return {
      error: "I heard enough to understand the outline of your business, but not enough to offer a useful interpretation yet.",
      type: "insufficient_evidence",
    };
  }

  // Generate sections
  const whatIHeard = generateWhatIHeard(evidence);
  const observation = generateWhatStoodOut(evidence, input);
  const whatStoodOut = observation?.text || null;
  const whatThatMayMean = generateWhatThatMayMean(evidence, observation);
  const whereIWouldBegin = generateWhereIWouldBegin(evidence, input, observation);
  const alignmentQuestion = generateAlignmentQuestion();

  // Validate
  const evidencePass = validateEvidence(evidence, whatIHeard, whatStoodOut, whatThatMayMean);
  const interpretationPass = validateInterpretation(whatStoodOut, whatThatMayMean, whereIWouldBegin);
  const governancePass = validateGovernance(whatThatMayMean, whereIWouldBegin, alignmentQuestion);

  const validation: RepresentationBriefValidation = {
    evidence: evidencePass ? "pass" : "fail",
    interpretation: interpretationPass ? "pass" : "fail",
    governance: governancePass ? "pass" : "fail",
    violations: [
      !evidencePass && "Evidence validation failed",
      !interpretationPass && "Interpretation validation failed",
      !governancePass && "Governance validation failed",
    ].filter(Boolean) as string[],
  };

  if (!evidencePass || !interpretationPass || !governancePass) {
    return {
      error: `The brief does not meet production standards: ${validation.violations.join("; ")}`,
      type: "validation_failed",
    };
  }

  const fullText = [whatIHeard, whatStoodOut, whatThatMayMean, whereIWouldBegin, alignmentQuestion]
    .filter(Boolean)
    .join(" ");

  const wordCount = countWords(fullText);
  const isValidLength = wordCount >= 150 && wordCount <= 320;

  if (!isValidLength) {
    return {
      error: `The brief is ${wordCount} words; target is 150–250.`,
      type: "validation_failed",
    };
  }

  const evidenceSources: RepresentationBriefEvidenceSource[] = [];

  // Build evidence sources from observations
  if (input.zeyaTranscript.length > 0) {
    const relevantTurn = input.zeyaTranscript.find(
      (t) => t.role === "user" && t.text?.includes(evidence.observations[0]?.substring(0, 20)),
    );
    if (relevantTurn) {
      evidenceSources.push({
        sourceType: "zeya_conversation",
        sourceId: relevantTurn.id || "zeya_turn_0",
        speaker: "visitor",
        excerpt: evidence.observations[0],
        supports: ["what_i_heard", "what_stood_out"],
      });
    }
  }

  return {
    whatIHeard,
    whatStoodOut: whatStoodOut || "",
    whatThatMayMean: whatThatMayMean || "",
    whereIWouldBegin,
    alignmentQuestion,
    confidenceLevel: evidence.emphasisPattern ? "high" : "medium",
    totalWordCount: wordCount,
    evidenceSources,
    validation,
  };
}
