import { describe, expect, it } from "vitest";
import {
  buildFirstWorkingSessionBriefArtifact,
  buildFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionFinalizationPayload,
  validateFirstWorkingSessionBriefCandidates,
  FIRST_WORKING_SESSION_PREPARATION_VERSION,
} from "../../lib/onboarding/first-working-session-brief";
import {
  generateReasoningRunFingerprint,
  normalizeEffectivePreparationEvidence,
  normalizeEffectivePreparationObservations,
  toEvidenceInput,
  toObservationInput,
} from "../../lib/onboarding/persist-hypotheses-orchestration";
import { hasCurrentReasoningSnapshot, PREPARATION_DOMAINS } from "../../lib/onboarding/preparation-intelligence";
import type { DatabaseEvidence, DatabaseObservation } from "../../lib/onboarding/persist-hypotheses-types";

const IDS = {
  session: "10000000-0000-4000-8000-000000000001",
  representation: "10000000-0000-4000-8000-000000000002",
  workingSession: "10000000-0000-4000-8000-000000000003",
  lease: "10000000-0000-4000-8000-000000000004",
  v1Home: "10000000-0000-4000-8000-000000000010",
  v2Home: "10000000-0000-4000-8000-000000000011",
  qualify: "10000000-0000-4000-8000-000000000012",
  contact: "10000000-0000-4000-8000-000000000013",
  ownerOffer: "10000000-0000-4000-8000-000000000014",
  ownerTarget: "10000000-0000-4000-8000-000000000015",
  ownerGoal: "10000000-0000-4000-8000-000000000016",
  ownerProblem: "10000000-0000-4000-8000-000000000017",
  oldObservation: "10000000-0000-4000-8000-000000000020",
  homeObservation: "10000000-0000-4000-8000-000000000021",
  qualifyObservation: "10000000-0000-4000-8000-000000000022",
};

function evidence(id: string, overrides: Partial<DatabaseEvidence>): DatabaseEvidence {
  return {
    id, business_representation_id: IDS.representation,
    direct_hire_onboarding_session_id: IDS.session,
    source_type: "public_website", raw_statement: "Business architecture for founders.",
    affected_domains: ["whatYouSell"], created_at: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

function liveFixture() {
  const rows: DatabaseEvidence[] = [
    evidence(IDS.v1Home, { canonical_source_url: "https://modernbusinessarchitect.com/", source_content_hash: "old", extraction_method_version: "direct-hire-web-v1", source_retrieved_at: "2026-08-01T00:00:00.000Z" }),
    evidence(IDS.v2Home, { canonical_source_url: "https://modernbusinessarchitect.com/", source_content_hash: "home-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "homepage", source_evidence_kind: "section_text", raw_statement: "You don’t need another idea. You need something that actually works. Turn your ideas into structured, scalable businesses with clarity, alignment, and execution. Arrival → Architecture → Assembly. Most people don’t lack ideas. They lack structure. Architecture: Reverse engineer the path." }),
    evidence(IDS.qualify, { canonical_source_url: "https://modernbusinessarchitect.com/qualify", source_content_hash: "qualify-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "products_services", source_evidence_kind: "section_list", raw_statement: "This isn’t for everyone. If you're serious about turning an idea into something structured, executable, and viable — this is where we start." }),
    evidence(IDS.contact, { canonical_source_url: "https://modernbusinessarchitect.com/contact", source_content_hash: "contact-v2", extraction_method_version: "direct-hire-web-v2", source_retrieved_at: "2026-08-12T00:00:00.000Z", source_page_type: "contact", source_evidence_kind: "section_text", raw_statement: "Prospective clients can request a conversation through the contact page." }),
    evidence(IDS.ownerOffer, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "description", induction_material_label: "What the business sells", captured_by_actor: "owner", raw_statement: "Business coaching and architecture", created_at: "2026-08-10T00:00:00.000Z" }),
    evidence(IDS.ownerTarget, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "description", induction_material_label: "Target customer", captured_by_actor: "owner", raw_statement: "Startups globally in western developed country English speaking", created_at: "2026-08-10T00:00:01.000Z" }),
    evidence(IDS.ownerGoal, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "note", induction_material_label: "Growth priority", captured_by_actor: "owner", raw_statement: "find new potential clients", created_at: "2026-08-10T00:00:02.000Z" }),
    evidence(IDS.ownerProblem, { source_type: "direct_hire_induction", source_content_hash: null, induction_material_type: "note", induction_material_label: "Owner context", captured_by_actor: "owner", raw_statement: "people dont always understand business architecture", created_at: "2026-08-10T00:00:03.000Z" }),
  ];
  const allObservations: DatabaseObservation[] = [
    { id: IDS.oldObservation, business_representation_id: IDS.representation, evidence_id: IDS.v1Home, interpreted_meaning: "Historical homepage", confidence_in_interpretation: 50, affected_domains: ["whatYouSell"], created_at: "2026-08-01T00:00:00.000Z" },
    { id: IDS.homeObservation, business_representation_id: IDS.representation, evidence_id: IDS.v2Home, interpreted_meaning: "Architecture leads the public positioning", confidence_in_interpretation: 70, affected_domains: ["whatYouSell"], created_at: "2026-08-12T00:00:00.000Z" },
    { id: IDS.qualifyObservation, business_representation_id: IDS.representation, evidence_id: IDS.qualify, interpreted_meaning: "Qualification emphasizes readiness for structural decisions", confidence_in_interpretation: 65, affected_domains: ["whoItIsFor"], created_at: "2026-08-12T00:00:01.000Z" },
  ];
  const effective = normalizeEffectivePreparationEvidence(rows);
  const effectiveIds = new Set(effective.map((item) => item.id));
  const observations = normalizeEffectivePreparationObservations(allObservations, effectiveIds);
  const reasoningRunId = generateReasoningRunFingerprint(
    IDS.session, IDS.representation, [...effectiveIds].sort(), observations.map((item) => item.id).sort(),
  );
  const hypotheses = PREPARATION_DOMAINS.map((domain, index) => ({
    id: `20000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    constitutionalDomain: domain,
    epistemicState: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "unknown" as const : "partial" as const,
    currentBelief: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? null
      : domain === "whatYouSell" ? "Business coaching and architecture services"
        : domain === "whoItIsFor" ? "Startups globally in western developed country English speaking"
          : domain === "problemOrAspiration" ? "Clients need to turn ideas into structured, scalable businesses"
            : domain === "proposedDescription" ? "Helps startups turn ideas into structured, scalable businesses"
              : "The service provides clarity, alignment, and execution for business ideas",
    confidence: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "unknown" as const : "medium" as const,
    representationRisk: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? "high" as const : "medium" as const,
    riskReason: domain === "authorityBoundaries" ? "Pricing promises negotiation commitments and escalation authority are unknown." : "Positioning requires owner verification.",
    verificationNeed: null,
    sourceEvidenceIds: domain === "authorityBoundaries" || domain === "clarificationsNeeded" ? [] : [IDS.v2Home, IDS.ownerOffer],
    hypothesisVersion: 5,
    previousHypothesisId: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    ownerDecision: null,
    requestTraceId: reasoningRunId,
    createdByActor: "zeya_reasoning_service",
  }));
  return { effective, observations, reasoningRunId, hypotheses };
}

function providerBrief(fixture: ReturnType<typeof liveFixture>) {
  const [what, who, , , , authority] = fixture.hypotheses;
  const finding = (statement: string, evidenceIds = [IDS.v2Home], hypothesisIds = [what.id]) =>
    ({ statement, kind: "supported_finding" as const, evidenceIds, hypothesisIds });
  const interpretation = (statement: string, evidenceIds = [IDS.v2Home], hypothesisIds = [what.id]) =>
    ({ statement, kind: "interpretation" as const, evidenceIds, hypothesisIds });
  return {
    businessRead: interpretation("The public positioning is architecture-led while the owner also describes coaching."),
    offerRead: finding("The offer includes business architecture and coaching.", [IDS.v2Home, IDS.ownerOffer]),
    customerRead: interpretation("Startups are the owner-stated priority while the public qualification path emphasizes readiness.", [IDS.ownerTarget, IDS.qualify], [who.id]),
    problemOutcomeRead: interpretation("The work appears oriented toward structural business decisions.", [IDS.v2Home, IDS.qualify]),
    positioningRead: interpretation("Architecture is the stronger public positioning anchor."),
    commercialSignals: [interpretation("The qualification page creates a deliberate conversation path.", [IDS.qualify, IDS.contact])],
    contradictions: [],
    unknowns: [{ statement: "Commercial authority remains unresolved.", kind: "unknown" as const, evidenceIds: [], hypothesisIds: [authority.id] }],
    workingOpinions: [{ statement: "My provisional view is that architecture should lead and coaching should support the explanation.", kind: "working_opinion" as const, evidenceIds: [IDS.v2Home, IDS.ownerOffer], hypothesisIds: [what.id] }],
    formationPriorities: [
      interpretation("Clarify whether architecture or coaching should lead the commercial offer.", [IDS.v2Home, IDS.ownerOffer]),
      { statement: "Clarify whether the owner-stated startup target matches the qualification path.", kind: "interpretation" as const, evidenceIds: [IDS.ownerTarget, IDS.qualify], hypothesisIds: [who.id] },
      { statement: "Clarify commercial target and authority boundaries.", kind: "unknown" as const, evidenceIds: [], hypothesisIds: [who.id, authority.id] },
    ],
    openingInsights: [interpretation("The architecture-versus-coaching emphasis is a useful opening topic.", [IDS.v2Home, IDS.ownerOffer])],
    questions: [{ statement: "Should startups remain the priority when the public qualification language is broader?", kind: "unknown" as const, evidenceIds: [IDS.ownerTarget, IDS.qualify], hypothesisIds: [who.id] }],
    authorityGaps: [{ statement: "Pricing, promises, negotiation, commitments, and escalation authority remain unknown.", kind: "unknown" as const, evidenceIds: [], hypothesisIds: [authority.id] }],
    governance: { canonical: false as const, containsChainOfThought: false as const },
  };
}

describe("P2.2 forensic live-shaped end-to-end contract", () => {
  it("evaluates the complete live guarded-claim matrix without stopping at the first failure", () => {
    const fixture = liveFixture();
    const inputs = { evidence: toEvidenceInput(fixture.effective), observations: toObservationInput(fixture.observations), hypotheses: fixture.hypotheses };
    const [what, who, , , , authority] = fixture.hypotheses;
    const item = (statement: string, kind: "supported_finding" | "interpretation" | "working_opinion" | "unknown" = "interpretation", evidenceIds = [IDS.v2Home], hypothesisIds = [what.id]) =>
      ({ statement, kind, evidenceIds, hypothesisIds });
    const candidates = [
      { section: "customerRead" as const, item: item("The owner describes the commercial target as startups in English-speaking developed markets.", "supported_finding", [IDS.ownerTarget], [who.id]) },
      { section: "workingOpinions" as const, item: item("My working interpretation is that the public positioning appears broader than the owner’s stated startup target.", "working_opinion", [IDS.v2Home, IDS.qualify, IDS.ownerTarget], [who.id]) },
      { section: "workingOpinions" as const, item: item("The public positioning appears more architecture-led than coaching-led.", "working_opinion", [IDS.v2Home, IDS.ownerOffer], [what.id]) },
      { section: "authorityGaps" as const, item: item("Pricing, negotiation authority, promises and commitments remain unestablished.", "unknown", [], [authority.id]) },
      { section: "questions" as const, item: item("I should verify whether startups in English-speaking developed markets are the priority segment rather than the full market served.", "unknown", [IDS.ownerTarget], [who.id]) },
      { section: "businessRead" as const, item: item("The business uses a three-step commercial process.", "supported_finding", [IDS.v2Home]) },
      { section: "customerRead" as const, item: item("The business serves 10 markets.", "supported_finding", [IDS.ownerTarget]) },
      { section: "commercialSignals" as const, item: item("Clients typically grow by 25%.", "supported_finding") },
      { section: "offerRead" as const, item: item("The service guarantees scalable growth.", "supported_finding") },
      { section: "businessRead" as const, item: item("The company is GDPR compliant.", "supported_finding") },
      { section: "customerRead" as const, item: item("The offer serves SMEs with 10–50 employees.", "supported_finding", [IDS.ownerTarget]) },
      { section: "customerRead" as const, item: item("The offer is for Series A SaaS founders.", "interpretation", [IDS.ownerTarget], [who.id]) },
      { section: "customerRead" as const, item: item("The offer targets North American technology startups.", "working_opinion", [IDS.ownerTarget], [who.id]) },
      { section: "positioningRead" as const, item: item("The company is the leading architecture consultancy.", "supported_finding") },
      { section: "commercialSignals" as const, item: item("The team will deliver results within 30 days.", "supported_finding") },
      { section: "commercialSignals" as const, item: item("Zeya is authorized to commit to delivery timelines.", "interpretation", [], [authority.id]) },
      { section: "formationPriorities" as const, item: item("Verify whether a $5,000 package should exist.", "interpretation", [], [authority.id]) },
      { section: "questions" as const, item: item("Is the company compliant with GDPR?", "unknown", [], [authority.id]) },
      { section: "openingInsights" as const, item: item("Three priorities will structure the first working session.", "interpretation", [IDS.v2Home], [what.id]) },
      { section: "problemOutcomeRead" as const, item: item("Clients need to turn ideas into structured, scalable businesses.", "interpretation", [IDS.v2Home], [fixture.hypotheses[2].id]) },
      { section: "offerRead" as const, item: item("The owner describes business coaching and architecture.", "supported_finding", [IDS.ownerOffer]) },
      { section: "commercialSignals" as const, item: item("The site invites serious prospects to begin through qualification.", "interpretation", [IDS.qualify]) },
    ];
    const results = validateFirstWorkingSessionBriefCandidates(inputs, candidates);
    expect(results).toHaveLength(22);
    expect(results.map(({ accepted, category }) => ({ accepted, category }))).toEqual([
      ...Array.from({ length: 5 }, () => ({ accepted: true, category: null })),
      ...Array.from({ length: 11 }, (_, index) => ({
        accepted: false,
        category: index === 0 || index === 1 || index === 2 || index === 3 || index === 4 || index === 5 || index === 8 || index === 9
          ? "brief_semantic_supported_finding_invalid"
          : index === 6 || index === 10 ? "brief_semantic_interpretation_invalid"
            : "brief_semantic_working_opinion_invalid",
      })),
      ...Array.from({ length: 6 }, () => ({ accepted: true, category: null })),
    ]);
    expect(results.every((result) => result.section && result.kind)).toBe(true);
  });

  it("uses only v2 pages, reuses fresh v5 hypotheses, and reaches a DB-compatible payload deterministically", async () => {
    const fixture = liveFixture();
    expect(fixture.effective.map((item) => item.id).sort()).toEqual([
      IDS.v2Home, IDS.qualify, IDS.contact, IDS.ownerOffer, IDS.ownerTarget, IDS.ownerGoal, IDS.ownerProblem,
    ].sort());
    expect(fixture.effective.map((item) => item.canonical_source_url).filter(Boolean)).toEqual([
      "https://modernbusinessarchitect.com/", "https://modernbusinessarchitect.com/qualify", "https://modernbusinessarchitect.com/contact",
    ]);
    expect(fixture.effective.some((item) => item.id === IDS.v1Home)).toBe(false);
    expect(fixture.observations.some((item) => item.id === IDS.oldObservation)).toBe(false);
    expect(hasCurrentReasoningSnapshot(fixture.hypotheses, fixture.reasoningRunId)).toBe(true);

    const inputs = {
      evidence: toEvidenceInput(fixture.effective),
      observations: toObservationInput(fixture.observations),
      hypotheses: fixture.hypotheses,
    };
    const brief = providerBrief(fixture);
    const schema = buildFirstWorkingSessionBriefSchema(inputs) as any;
    expect(schema.properties.formationPriorities.minItems).toBe(3);
    expect(schema.properties.formationPriorities.maxItems).toBe(7);
    expect(schema.properties.contradictions.items.properties.evidenceIds.minItems).toBe(2);
    expect(schema.properties.authorityGaps.items.properties.hypothesisIds.items.enum).toEqual([fixture.hypotheses[5].id]);
    expect(JSON.stringify(schema)).not.toContain("uniqueItems");

    const first = await buildFirstWorkingSessionBriefArtifact(inputs, fixture.reasoningRunId, async () => brief);
    const replay = await buildFirstWorkingSessionBriefArtifact(inputs, fixture.reasoningRunId, async () => brief);
    expect(replay).toEqual(first);
    expect(first.sourceEvidenceIds).not.toContain(IDS.v1Home);
    const payload = buildFirstWorkingSessionFinalizationPayload(IDS.workingSession, IDS.lease, first);
    expect(payload.p_contract_version).toBe(FIRST_WORKING_SESSION_PREPARATION_VERSION);
    expect(payload.p_source_evidence_ids).toEqual(first.sourceEvidenceIds);
    expect(payload.p_source_hypothesis_ids).toEqual(first.sourceHypothesisIds);
    expect(payload.p_snapshot_fingerprint).toMatch(/^[0-9a-f]{64}$/);

    const durableContext = {
      websiteCheckpointPresent: true, recovery: { from: "first-working-session-preparation-v3", to: FIRST_WORKING_SESSION_PREPARATION_VERSION },
      retiredBrief: { contract: "first-working-session-preparation-v1", current: false },
    };
    expect(durableContext.websiteCheckpointPresent).toBe(true);
    expect(durableContext.recovery.to).toBe("first-working-session-preparation-v4");
    expect(durableContext.retiredBrief.current).toBe(false);
  });

  it.each([
    ["supported finding without Evidence", (brief: any) => ({ ...brief, businessRead: { ...brief.businessRead, kind: "supported_finding", evidenceIds: [] } }), "brief_semantic_supported_finding_invalid"],
    ["interpretation without basis", (brief: any) => ({ ...brief, businessRead: { ...brief.businessRead, evidenceIds: [], hypothesisIds: [] } }), "brief_semantic_interpretation_invalid"],
    ["working opinion without basis", (brief: any) => ({ ...brief, workingOpinions: [{ statement: "A provisional view.", kind: "working_opinion", evidenceIds: [], hypothesisIds: [] }] }), "brief_semantic_working_opinion_invalid"],
    ["authority gap without authority hypothesis", (brief: any) => ({ ...brief, authorityGaps: [{ ...brief.authorityGaps[0], hypothesisIds: [] }] }), "brief_authority_gap_invalid"],
    ["formation priority without basis", (brief: any) => ({ ...brief, formationPriorities: [{ ...brief.formationPriorities[0], evidenceIds: [], hypothesisIds: [] }, ...brief.formationPriorities.slice(1)] }), "brief_semantic_interpretation_invalid"],
    ["contradiction without conflicting basis", (brief: any) => ({ ...brief, contradictions: [{ statement: "The sources conflict.", kind: "contradiction", evidenceIds: [IDS.v2Home], hypothesisIds: [brief.businessRead.hypothesisIds[0]] }] }), "brief_contradiction_invalid"],
    ["duplicate citation", (brief: any) => ({ ...brief, businessRead: { ...brief.businessRead, evidenceIds: [IDS.v2Home, IDS.v2Home] } }), "brief_citation_scope_invalid"],
  ])("fails %s at a stable category", async (_label, mutate, category) => {
    const fixture = liveFixture();
    const inputs = { evidence: toEvidenceInput(fixture.effective), observations: toObservationInput(fixture.observations), hypotheses: fixture.hypotheses };
    await expect(buildFirstWorkingSessionBriefArtifact(inputs, fixture.reasoningRunId, async () => mutate(providerBrief(fixture))))
      .rejects.toThrow(category);
  });

  it.each([
    ["fake price", "The package costs $5,000."],
    ["fake market size", "The addressable market is 5 billion customers."],
    ["fake geography", "The business serves North American startups."],
    ["fake segment", "The business serves Series A SaaS founders."],
    ["fake guarantee", "The service guarantees scalable growth."],
    ["fake compliance", "The company is GDPR compliant."],
    ["fake performance", "Clients typically grow by 25%."],
    ["fake superlative", "The company is the leading architecture consultancy."],
    ["fake timeline", "The team will deliver results within 30 days."],
    ["unauthorized commitment", "Zeya is authorized to commit to delivery timelines."],
  ])("rejects a complete brief containing %s", async (_label, statement) => {
    const fixture = liveFixture();
    const inputs = { evidence: toEvidenceInput(fixture.effective), observations: toObservationInput(fixture.observations), hypotheses: fixture.hypotheses };
    const invalid = { ...providerBrief(fixture), businessRead: { ...providerBrief(fixture).businessRead, statement, kind: "supported_finding" as const } };
    await expect(buildFirstWorkingSessionBriefArtifact(inputs, fixture.reasoningRunId, async () => invalid))
      .rejects.toThrow("brief_semantic_supported_finding_invalid");
  });

  it("rejects a non-UUID finalization boundary before Supabase", async () => {
    const fixture = liveFixture();
    const inputs = { evidence: toEvidenceInput(fixture.effective), observations: toObservationInput(fixture.observations), hypotheses: fixture.hypotheses };
    const artifact = await buildFirstWorkingSessionBriefArtifact(inputs, fixture.reasoningRunId, async () => providerBrief(fixture));
    expect(() => buildFirstWorkingSessionFinalizationPayload("not-a-uuid", IDS.lease, artifact))
      .toThrow("brief_finalization_payload_invalid");
  });
});
