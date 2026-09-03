import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import fixture from "../fixtures/p2-12d-2h-v6-reasoning-snapshot.json";
import {
  HypothesisReasoningValidationError,
  validateHypothesisReasoningResult,
} from "../../lib/onboarding/hypothesis-reasoning-validation";
import {
  HYPOTHESIS_REASONING_CONTRACT_VERSION,
  buildHypothesisSchema,
  buildReasoningPrompt,
  createReasoningOutputValidationFailure,
  redactHypothesisCandidate,
} from "../../lib/onboarding/hypothesis-reasoning-service";
import { validateHypothesisReasoningInput } from "../../lib/onboarding/hypothesis-reasoning-validation";
import type { EvidenceInput } from "../../lib/onboarding/hypothesis-reasoning-types";

const domains = [
  "whatYouSell", "whoItIsFor", "problemOrAspiration", "whyCustomersShouldCare",
  "proposedDescription", "authorityBoundaries", "clarificationsNeeded",
] as const;
const evidence: EvidenceInput[] = [
  { id: "owner", sourceType: "direct_hire_induction", rawStatement: "owner", affected_domains: [], authority_type: "owner", authority_key: "owner" },
  { id: "public-one", sourceType: "public_website", rawStatement: "public", affected_domains: [], authority_type: "first_party_company", authority_key: "company" },
  { id: "independent-a", sourceType: "public_website", rawStatement: "a", affected_domains: [], authority_type: "independent_third_party", authority_key: "a" },
  { id: "independent-b", sourceType: "public_website", rawStatement: "b", affected_domains: [], authority_type: "independent_third_party", authority_key: "b" },
];
const evidenceIds = new Set(evidence.map(item => item.id));
const evidenceMetadata = new Map(evidence.map(item => [item.id, item]));

function validResult() {
  return {
    generatedAt: "2026-09-02T13:11:15.000Z",
    hypotheses: domains.map(domain => ({
      constitutionalDomain: domain,
      epistemicState: "unknown",
      currentBelief: null,
      confidence: "unknown",
      representationRisk: domain === "authorityBoundaries" ? "high" : "low",
      riskReason: domain === "authorityBoundaries" ? "Authority is not established" : "",
      verificationNeed: null,
      sourceEvidenceIds: [],
      evidenceCutoffAt: "2026-09-02T13:11:15.000Z",
    })),
  };
}

function invalid(mutator: (candidate: any) => void) {
  const candidate: any = structuredClone(validResult());
  mutator(candidate);
  try {
    validateHypothesisReasoningResult(candidate, evidenceIds, evidenceMetadata);
    throw new Error("Expected validation rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(HypothesisReasoningValidationError);
    return (error as HypothesisReasoningValidationError).diagnostic;
  }
}

describe("P2.12D.2h stable hypothesis diagnostics", () => {
  it("constrains provider citations to supplied Evidence IDs, never Observation IDs", () => {
    const allowedEvidenceIds = fixture.evidence.map(item => item.id);
    const observationIds = fixture.observations.map(item => item.id);
    const schema = buildHypothesisSchema({ mode: "all_domains" }, allowedEvidenceIds);
    const sourceEvidenceItems = schema.properties.hypotheses.items.properties.sourceEvidenceIds.items;

    expect(sourceEvidenceItems.enum).toEqual(allowedEvidenceIds);
    expect(sourceEvidenceItems.enum).toHaveLength(fixture.evidence.length);
    expect(sourceEvidenceItems.enum).toEqual(expect.arrayContaining(allowedEvidenceIds));
    expect(observationIds.some(id => sourceEvidenceItems.enum.includes(id))).toBe(false);
  });

  it("marks Observation IDs non-citable and their supporting Evidence IDs citable", () => {
    const prompt = buildReasoningPrompt(fixture.request, fixture.evidence as EvidenceInput[], fixture.observations);
    const multiEvidenceObservation = fixture.observations.find(item => (item.evidenceIds?.length ?? 0) > 1)!;

    expect(prompt).toContain(`Observation ID — NON-CITABLE: ${multiEvidenceObservation.id}`);
    expect(prompt).toContain(`CITABLE SUPPORTING EVIDENCE IDS: ${multiEvidenceObservation.evidenceIds.join(", ")}`);
    expect(prompt).toContain("never cite the Observation ID as Evidence");
  });

  it("attributes a non-object result", () => {
    expect(() => validateHypothesisReasoningResult(null, evidenceIds, evidenceMetadata)).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_RESULT_NOT_OBJECT" }) }));
  });

  it("accepts the valid seven-domain boundary", () => {
    expect(validateHypothesisReasoningResult(validResult(), evidenceIds, evidenceMetadata).hypotheses).toHaveLength(7);
  });

  const structuralCases: Array<[string, (candidate: any) => void, string, string | null]> = [
    ["HYPOTHESIS_LIST_NOT_ARRAY", c => { c.hypotheses = null; }, "hypotheses", null],
    ["HYPOTHESIS_GENERATED_AT_NOT_STRING", c => { c.generatedAt = null; }, "generatedAt", null],
    ["HYPOTHESIS_COUNT_MISMATCH", c => { c.hypotheses.pop(); }, "hypotheses", null],
    ["HYPOTHESIS_ITEM_NOT_OBJECT", c => { c.hypotheses[0] = null; }, "hypotheses[0]", null],
    ["HYPOTHESIS_DOMAIN_INVALID", c => { c.hypotheses[0].constitutionalDomain = "invalid"; }, "constitutionalDomain", null],
    ["HYPOTHESIS_DOMAIN_DUPLICATE", c => { c.hypotheses[1].constitutionalDomain = "whatYouSell"; }, "constitutionalDomain", "whatYouSell"],
    ["HYPOTHESIS_EPISTEMIC_STATE_INVALID", c => { c.hypotheses[0].epistemicState = "invalid"; }, "epistemicState", "whatYouSell"],
    ["HYPOTHESIS_CONFIDENCE_INVALID", c => { c.hypotheses[0].confidence = "invalid"; }, "confidence", "whatYouSell"],
    ["HYPOTHESIS_CONFIDENCE_STATE_MISMATCH", c => { c.hypotheses[0].confidence = "low"; }, "confidence", "whatYouSell"],
    ["HYPOTHESIS_REPRESENTATION_RISK_INVALID", c => { c.hypotheses[0].representationRisk = "invalid"; }, "representationRisk", "whatYouSell"],
    ["HYPOTHESIS_RISK_REASON_REQUIRED", c => { c.hypotheses[0].representationRisk = "medium"; }, "riskReason", "whatYouSell"],
    ["HYPOTHESIS_EVIDENCE_LIST_NOT_ARRAY", c => { c.hypotheses[0].sourceEvidenceIds = null; }, "sourceEvidenceIds", "whatYouSell"],
    ["HYPOTHESIS_UNKNOWN_EVIDENCE_FORBIDDEN", c => { c.hypotheses[0].sourceEvidenceIds = ["owner"]; }, "sourceEvidenceIds", "whatYouSell"],
    ["HYPOTHESIS_VERIFICATION_NEED_INVALID", c => { c.hypotheses[0].verificationNeed = 1; }, "verificationNeed", "whatYouSell"],
    ["HYPOTHESIS_EVIDENCE_CUTOFF_NOT_STRING", c => { c.hypotheses[0].evidenceCutoffAt = null; }, "evidenceCutoffAt", "whatYouSell"],
  ];
  for (const [ruleCode, mutate, field, domain] of structuralCases) {
    it(`attributes ${ruleCode}`, () => {
      expect(invalid(mutate)).toMatchObject({ ruleCode, field, domain });
    });
  }

  it("distinguishes null and non-null belief mismatches", () => {
    expect(invalid(c => { c.hypotheses[0].currentBelief = "claim"; })).toMatchObject({ ruleCode: "HYPOTHESIS_EPISTEMIC_BELIEF_MISMATCH", actualCategory: "non-null" });
    expect(invalid(c => Object.assign(c.hypotheses[0], { epistemicState: "partial", confidence: "low", currentBelief: null, sourceEvidenceIds: ["owner"] }))).toMatchObject({ ruleCode: "HYPOTHESIS_EPISTEMIC_BELIEF_MISMATCH" });
  });

  it("requires evidence for a non-unknown hypothesis", () => {
    expect(invalid(c => Object.assign(c.hypotheses[0], { epistemicState: "partial", confidence: "low", currentBelief: "claim" }))).toMatchObject({ ruleCode: "HYPOTHESIS_EVIDENCE_REQUIRED" });
  });

  it("diagnoses evidence type, scope, and duplication", () => {
    const base = (c: any) => Object.assign(c.hypotheses[0], { epistemicState: "partial", confidence: "low", currentBelief: "claim" });
    expect(invalid(c => { base(c); c.hypotheses[0].sourceEvidenceIds = [42]; })).toMatchObject({ ruleCode: "HYPOTHESIS_EVIDENCE_ID_NOT_STRING" });
    expect(invalid(c => { base(c); c.hypotheses[0].sourceEvidenceIds = ["outside"]; })).toMatchObject({ ruleCode: "HYPOTHESIS_EVIDENCE_OUT_OF_SCOPE" });
    expect(invalid(c => { base(c); c.hypotheses[0].sourceEvidenceIds = ["owner", "owner"]; })).toMatchObject({ ruleCode: "HYPOTHESIS_DUPLICATE_EVIDENCE" });
  });

  it("enforces public authority independence and accepts owner corroboration", () => {
    const high = (ids: string[]) => {
      const c: any = validResult();
      Object.assign(c.hypotheses[0], { epistemicState: "supported", confidence: "high", currentBelief: "claim", sourceEvidenceIds: ids });
      return c;
    };
    expect(() => validateHypothesisReasoningResult(high(["public-one"]), evidenceIds, evidenceMetadata)).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_HIGH_CONFIDENCE_AUTHORITY_INSUFFICIENT" }) }));
    expect(validateHypothesisReasoningResult(high(["independent-a", "independent-b"]), evidenceIds, evidenceMetadata)).toBeTruthy();
    expect(validateHypothesisReasoningResult(high(["owner", "public-one"]), evidenceIds, evidenceMetadata)).toBeTruthy();
  });

  it("attributes the specific authority-boundary scope rule", () => {
    const candidate: any = { generatedAt: validResult().generatedAt, hypotheses: [validResult().hypotheses[5]] };
    candidate.hypotheses[0].representationRisk = "low";
    expect(() => validateHypothesisReasoningResult(candidate, evidenceIds, evidenceMetadata, { mode: "specific_domain", constitutionalDomain: "authorityBoundaries" })).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_AUTHORITY_RISK_MISMATCH", domain: "authorityBoundaries" }) }));
  });

  it("attributes a specific-scope domain mismatch", () => {
    const candidate: any = { generatedAt: validResult().generatedAt, hypotheses: [validResult().hypotheses[0]] };
    expect(() => validateHypothesisReasoningResult(candidate, evidenceIds, evidenceMetadata, { mode: "specific_domain", constitutionalDomain: "whoItIsFor" })).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_SCOPE_DOMAIN_MISMATCH" }) }));
  });

  it("redacts prose while preserving diagnostic structure", () => {
    const candidate: any = validResult();
    candidate.hypotheses[0].currentBelief = "sensitive unrestricted prose";
    const redacted = redactHypothesisCandidate(candidate);
    expect(JSON.stringify(redacted)).not.toContain("sensitive unrestricted prose");
    expect(redacted.hypotheses[0]).toMatchObject({ domain: "whatYouSell", beliefPresence: "non-null", evidenceIds: [] });
  });

  it("propagates a stable diagnostic through the owner-safe stage error", () => {
    let validationError: HypothesisReasoningValidationError;
    try {
      validateHypothesisReasoningResult(null, evidenceIds, evidenceMetadata);
      throw new Error("Expected validation rejection");
    } catch (error) {
      validationError = error as HypothesisReasoningValidationError;
    }
    const failure = createReasoningOutputValidationFailure(validationError, validResult());
    expect(failure.stageCode).toBe("preparation_reasoning_output_validation_failed");
    expect(failure.validationDiagnostic?.ruleCode).toBe("HYPOTHESIS_RESULT_NOT_OBJECT");
    expect(JSON.stringify(failure.redactedCandidate)).not.toContain("Authority is not established");
  });

  it("attributes all input validation boundaries", () => {
    const request: any = { onboardingSessionId: "session", businessRepresentationId: "representation", businessId: "business" };
    expect(() => validateHypothesisReasoningInput({ ...request, businessId: "" }, evidence, [])).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_INPUT_IDENTITY_MISSING" }) }));
    expect(() => validateHypothesisReasoningInput({ ...request, scope: { mode: "specific_domain", constitutionalDomain: "invalid" } }, evidence, [])).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_INPUT_SCOPE_INVALID" }) }));
    expect(() => validateHypothesisReasoningInput(request, evidence, [{ id: "observation", evidenceId: "outside", interpreted_meaning: "shape", confidence_in_interpretation: 50, affected_domains: [] }])).toThrowError(expect.objectContaining({ diagnostic: expect.objectContaining({ ruleCode: "HYPOTHESIS_INPUT_OBSERVATION_OUT_OF_SCOPE" }) }));
  });

  it("emits only closed validation categories in Production telemetry", () => {
    const worker = readFileSync("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).toContain("validationRuleCode: error.validationDiagnostic.ruleCode");
    expect(worker).toContain("reasoningContractVersion: HYPOTHESIS_REASONING_CONTRACT_VERSION");
    expect(worker).not.toContain("redactedCandidate:");
    expect(worker).not.toContain("currentBelief:");
  });

  it("preserves the exact replay fixture contract and multi-evidence lineage", () => {
    expect(fixture.reasoningContractVersion).toBe(HYPOTHESIS_REASONING_CONTRACT_VERSION);
    expect(fixture.evidence).toHaveLength(21);
    expect(fixture.observations).toHaveLength(7);
    expect(fixture.observations.filter(item => (item.evidenceIds?.length ?? 0) > 1)).toHaveLength(5);
    const ids = new Set(fixture.evidence.map(item => item.id));
    expect(fixture.observations.flatMap(item => item.evidenceIds ?? [item.evidenceId]).every(id => ids.has(id))).toBe(true);
  });
});
