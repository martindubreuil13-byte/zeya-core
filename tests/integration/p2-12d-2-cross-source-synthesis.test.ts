import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { synthesizeExecutiveObservations } from "../../lib/onboarding/executive-observation-synthesis";
import { collectFirstWorkingSessionBriefValidation } from "../../lib/onboarding/first-working-session-brief";
import type { EvidenceInput } from "../../lib/onboarding/hypothesis-reasoning-types";

const row = (id: string, sourceType: EvidenceInput["sourceType"], rawStatement: string, page = "homepage"): EvidenceInput => ({
  id, sourceType, rawStatement, affected_domains: ["whatYouSell", "whoItIsFor", "problemOrAspiration", "proposedDescription"],
  source_page_type: page, source_evidence_kind: "section_text",
  canonical_source_url: sourceType === "public_website" ? `https://example.test/${page}` : undefined,
  logical_source_key: sourceType === "public_website" ? `page:${page}` : `owner:${id}`,
  authority_type: sourceType === "public_website" ? "first_party_company" : "owner",
  authority_key: sourceType === "public_website" ? "company-site" : "owner",
});

const specimen = [
  row("owner-1", "direct_hire_induction", "We use artificial intelligence implementation and artificial intelligence workflows for entrepreneurs."),
  row("owner-2", "direct_hire_induction", "Our business architecture helps entrepreneurs validate a business before building."),
  row("home-1", "public_website", "Validate an idea and design the business architecture before committing to a launch.", "homepage"),
  row("work-1", "public_website", "For people exploring whether an idea can become a viable business through validation.", "products_services"),
  row("work-2", "public_website", "For founders who have started building and need business architecture, structure, execution and market readiness.", "products_services"),
  row("home-2", "public_website", "Business validation and business architecture create structure for entrepreneurs.", "homepage"),
];

describe("P2.12D.2 governed executive observation synthesis", () => {
  it("synthesizes cross-page segmentation, progression, owner/public tension, and confirmation deterministically", () => {
    const first = synthesizeExecutiveObservations(specimen);
    const replay = synthesizeExecutiveObservations([...specimen].reverse());
    expect(replay).toEqual(first);
    expect(first.map(item => item.category)).toEqual(expect.arrayContaining(["segmentation", "pattern", "tension", "confirmation"]));
    expect(first.find(item => item.category === "segmentation")!.evidenceIds).toEqual(expect.arrayContaining(["work-1", "work-2"]));
    expect(first.find(item => item.category === "pattern")!.interpretedMeaning).toMatch(/validation.*structure.*execution/i);
    expect(first.find(item => item.category === "tension")!.interpretedMeaning).toMatch(/pages acquired.*not proof/i);
    expect(first.find(item => item.category === "confirmation")!.evidenceIds.some(id => id.startsWith("owner"))).toBe(true);
    expect(first.find(item => item.category === "confirmation")!.evidenceIds.some(id => id.startsWith("home") || id.startsWith("work"))).toBe(true);
  });

  it("preserves all supporting provenance and uses bounded non-blanket confidence", () => {
    const output = synthesizeExecutiveObservations(specimen);
    expect(output.every(item => item.evidenceIds.length >= 2 && new Set(item.evidenceIds).size === item.evidenceIds.length)).toBe(true);
    expect(output.every(item => item.confidence >= 35 && item.confidence <= 85 && item.confidence % 5 === 0)).toBe(true);
    expect(new Set(output.map(item => item.confidence)).size).toBeGreaterThan(1);
  });

  it("preserves an explicit contradiction without resolving it", () => {
    const output = synthesizeExecutiveObservations([
      row("owner-a", "direct_hire_induction", "We offer advisory architecture and advisory planning."),
      row("public-a", "public_website", "We do not offer advisory services; our advisory partners remain separate.", "products_services"),
      row("public-b", "public_website", "Architecture planning is available for founders.", "homepage"),
    ]);
    const contradiction = output.find(item => item.category === "contradiction");
    expect(contradiction?.interpretedMeaning).toMatch(/conflict.*unresolved/i);
    expect(contradiction?.evidenceIds).toEqual(expect.arrayContaining(["owner-a", "public-a"]));
  });

  it("rejects unsupported inference, boilerplate, and fake minimum counts", () => {
    expect(synthesizeExecutiveObservations([
      row("contact", "public_website", "Contact us. Privacy policy. All rights reserved.", "contact"),
      row("thin", "public_website", "A short isolated statement with no corroborating source."),
    ])).toEqual([]);
  });

  it("governs schema, tenant scope, hypothesis consumption, brief opening insight selection, and v6 handoff", () => {
    const migration = readFileSync("supabase/migrations/20260901010000_p2_12d_2_cross_source_observations.sql", "utf8");
    const reasoning = readFileSync("lib/onboarding/hypothesis-reasoning-service.ts", "utf8");
    const brief = readFileSync("lib/onboarding/first-working-session-brief.ts", "utf8");
    expect(migration).toContain("supporting_evidence_ids uuid[]");
    expect(migration).toContain("e.business_representation_id<>s.business_representation_id");
    expect(migration).toContain("e.direct_hire_onboarding_session_id<>s.direct_hire_onboarding_session_id");
    expect(migration).toContain("first-working-session-preparation-v6");
    expect(migration).not.toMatch(/UPDATE public\.direct_hire_first_working_session_briefs|UPDATE public\.direct_hire_first_working_session_formation_handoffs/i);
    expect(reasoning).toContain("supported by Evidence");
    expect(reasoning).toContain("Preserve every cited Evidence ID");
    expect(brief).toContain("Exclude legacy/template restatements and generic praise");
    expect(brief).toContain('"first-working-session-preparation-v6"');
  });

  it("requires meaningful synthesized provenance in openingInsights and rejects bland praise", () => {
    const inputs = {
      evidence: [row("e1", "public_website", "Validate an idea before launch."), row("e2", "public_website", "Build structure for market execution.", "products_services")],
      observations: [{ id: "o1", evidenceId: "e1", evidenceIds: ["e1", "e2"], category: "pattern", interpreted_meaning: "A progression", confidence_in_interpretation: 65, affected_domains: ["whatYouSell"] }],
      hypotheses: [],
    } as any;
    const statement = (text: string, evidenceIds = ["e1"]) => ({ statement: text, kind: "interpretation", evidenceIds, hypothesisIds: [] });
    const brief = {
      businessRead: statement("A provisional business read."), offerRead: statement("A provisional offer read."),
      customerRead: statement("A provisional customer read."), problemOutcomeRead: statement("A provisional problem read."),
      positioningRead: statement("A provisional positioning read."), commercialSignals: [], contradictions: [], unknowns: [],
      workingOpinions: [], formationPriorities: [], questions: [], authorityGaps: [],
      openingInsights: [statement("This is an impressive business.", ["e1"])], governance: { canonical: false, containsChainOfThought: false },
    };
    const report = collectFirstWorkingSessionBriefValidation(brief, inputs);
    expect(report.valid).toBe(false);
    expect(report.defects.map(item => item.validatorRule)).toEqual(expect.arrayContaining([
      "opening_insight_must_cite_synthesized_observation_basis", "generic_praise_not_opening_insight",
    ]));
  });
});
