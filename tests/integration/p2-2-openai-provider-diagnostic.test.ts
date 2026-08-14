import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { runP22DeployedProviderDiagnostic } from "../../app/api/internal/diagnostics/p2-2-openai/route";
import {
  buildFirstWorkingSessionBriefPrompt,
  buildFirstWorkingSessionBriefArtifact,
  buildFirstWorkingSessionBriefProviderRequest,
  buildFirstWorkingSessionBriefProviderContract,
  buildFirstWorkingSessionBriefSchema,
  createCompactFirstWorkingSessionBriefGenerator,
  collectFirstWorkingSessionBriefValidation,
  synthesizeFirstWorkingSessionBriefWithRevisions,
  validateFirstWorkingSessionBriefCandidates,
  FIRST_WORKING_SESSION_BRIEF_MODEL,
  FIRST_WORKING_SESSION_OPENAI_SDK_VERSION,
} from "../../lib/onboarding/first-working-session-brief";
import {
  buildP22LiveShapedDiagnosticInputs,
  P2_2_DIAGNOSTIC_IDS,
} from "../../scripts/diagnostics/p2-2-openai-brief-dry-run";

function validFixtureBrief() {
  const { inputs } = buildP22LiveShapedDiagnosticInputs();
  const [what, who, problem, , , authority] = inputs.hypotheses;
  const evidence = Object.fromEntries(inputs.evidence.map((item) => [item.rawStatement, item.id]));
  const home = evidence["You don’t need another idea. You need something that actually works. Turn your ideas into structured, scalable businesses with clarity, alignment, and execution. Arrival → Architecture → Assembly. Most people don’t lack ideas. They lack structure. Architecture: Reverse engineer the path."];
  const qualify = evidence["This isn’t for everyone. If you're serious about turning an idea into something structured, executable, and viable — this is where we start."];
  const offer = evidence["Business coaching and architecture"];
  const target = evidence["Startups globally in western developed country English speaking"];
  const statement = (text: string, evidenceIds = [home], hypothesisIds = [what.id]) => ({
    statement: text, kind: "interpretation", evidenceIds, hypothesisIds,
  });
  return {
    businessRead: statement("The public positioning emphasizes business architecture."),
    offerRead: { ...statement("The owner describes business coaching and architecture.", [offer]), kind: "supported_finding" },
    customerRead: statement("The owner-stated customer target is startups globally in western developed English-speaking markets.", [target], [who.id]),
    problemOutcomeRead: statement("Clients need to turn ideas into structured, scalable businesses.", [home], [problem.id]),
    positioningRead: statement("Architecture is central to the public positioning."),
    commercialSignals: [statement("The qualification page offers a path for serious prospects.", [qualify])],
    contradictions: [],
    unknowns: [{ statement: "Commercial authority remains unknown.", kind: "unknown", evidenceIds: [], hypothesisIds: [authority.id] }],
    workingOpinions: [{ ...statement("My provisional view is that architecture should anchor the offer.", [home, offer]), kind: "working_opinion" }],
    formationPriorities: [
      statement("Clarify the relationship between architecture and coaching.", [home, offer]),
      statement("Verify whether the owner-stated startup target remains current.", [target], [who.id]),
      { statement: "Clarify commercial authority boundaries.", kind: "unknown", evidenceIds: [], hypothesisIds: [authority.id] },
    ],
    openingInsights: [statement("Architecture and coaching provide a useful opening topic.", [home, offer])],
    questions: [{ statement: "Should the owner-stated startup target remain the priority?", kind: "unknown", evidenceIds: [target], hypothesisIds: [who.id] }],
    authorityGaps: [{ statement: "Pricing, promises, negotiation, commitments, and escalation authority remain unknown.", kind: "unknown", evidenceIds: [], hypothesisIds: [authority.id] }],
    governance: { canonical: false, containsChainOfThought: false },
  };
}

function providerAliasBrief(brief: ReturnType<typeof validFixtureBrief>) {
  const { inputs } = buildP22LiveShapedDiagnosticInputs();
  const contract = buildFirstWorkingSessionBriefProviderContract(inputs);
  const value = structuredClone(brief) as Record<string, unknown>;
  const mapStatement = (candidate: unknown) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const statement = candidate as { evidenceIds: string[]; hypothesisIds: string[] };
    statement.evidenceIds = statement.evidenceIds.map((id) => contract.evidenceIdToAlias.get(id)!);
    statement.hypothesisIds = statement.hypothesisIds.map((id) => contract.hypothesisIdToAlias.get(id)!);
  };
  for (const key of ["businessRead", "offerRead", "customerRead", "problemOutcomeRead", "positioningRead"]) {
    mapStatement(value[key]);
  }
  for (const key of ["commercialSignals", "contradictions", "unknowns", "workingOpinions", "formationPriorities", "openingInsights", "questions", "authorityGaps"]) {
    (value[key] as unknown[]).forEach(mapStatement);
  }
  return value;
}

describe("P2.2 deployed OpenAI provider diagnostic", () => {
  it("reports the exact installed OpenAI SDK version", () => {
    const installed = JSON.parse(readFileSync("node_modules/openai/package.json", "utf8")) as { version: string };
    expect(FIRST_WORKING_SESSION_OPENAI_SDK_VERSION).toBe(installed.version);
  });

  it("uses the same client, model, prompt, schema, and request builder as production", async () => {
    const requests: unknown[] = [];
    const outputs = [{ ok: true }, {}, validFixtureBrief()];
    const client = {
      responses: {
        create: async (request: unknown) => {
          requests.push(request);
          return {
            status: "completed",
            output_text: JSON.stringify(outputs[requests.length - 1]),
            _request_id: `req_test_${requests.length}`,
          };
        },
      },
    } as unknown as OpenAI;

    const calls = await runP22DeployedProviderDiagnostic(client);
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const schema = buildFirstWorkingSessionBriefSchema(inputs);
    const prompt = buildFirstWorkingSessionBriefPrompt(inputs);

    expect(requests).toHaveLength(3);
    expect(requests[2]).toEqual(buildFirstWorkingSessionBriefProviderRequest(prompt, schema));
    expect((requests[2] as { model: string }).model).toBe(FIRST_WORKING_SESSION_BRIEF_MODEL);
    expect(calls.map((call) => call.name)).toEqual([
      "BASIC CONTROL", "PRODUCTION SCHEMA CONTROL", "FULL FIXTURE REQUEST",
    ]);
    expect(calls.every((call) => call.success)).toBe(true);
    expect(calls[2].validationPassed).toBe(true);
  });

  it("has no database or preparation-state-machine dependency", () => {
    const route = readFileSync("app/api/internal/diagnostics/p2-2-openai/route.ts", "utf8");
    expect(route).not.toMatch(/supabase|createDirectHireServiceClient|executeOneFirstWorkingSessionPreparation/);
    expect(route).not.toMatch(/\.rpc\(|claim|finalize_direct_hire|fail_direct_hire/);
  });

  it("returns only safe rule metadata for semantic failures", async () => {
    const invalid = validFixtureBrief();
    invalid.businessRead.evidenceIds = [];
    invalid.businessRead.hypothesisIds = [];
    const outputs = [{ ok: true }, {}, invalid, invalid, invalid];
    let callIndex = 0;
    const client = {
      responses: {
        create: async () => ({
          status: "completed",
          output_text: JSON.stringify(outputs[callIndex++]),
          _request_id: `req_safe_${callIndex}`,
        }),
      },
    } as unknown as OpenAI;

    const calls = await runP22DeployedProviderDiagnostic(client);
    expect(calls[2].validationFailure).toEqual({
      section: "businessRead",
      kind: "interpretation",
      category: "brief_semantic_revision_exhausted",
      validatorRule: "interpretation_or_working_opinion_basis_required",
    });
    expect(JSON.stringify(calls[2])).not.toContain(invalid.businessRead.statement);
    expect(JSON.stringify(calls[2])).not.toContain(P2_2_DIAGNOSTIC_IDS.v2Home);
  });

  it("uses only synthetic UUIDs for finalization preflight", () => {
    expect(P2_2_DIAGNOSTIC_IDS.workingSession).toBe("10000000-0000-4000-8000-000000000003");
    expect(P2_2_DIAGNOSTIC_IDS.lease).toBe("10000000-0000-4000-8000-000000000004");
  });

  it.each([
    {
      name: "accepts interpretation with an in-scope cited basis",
      statement: "Architecture is central to the public positioning.",
      evidence: "home",
      expectedAccepted: true,
      expectedRule: null,
    },
    {
      name: "rejects interpretation without Evidence or hypothesis basis",
      statement: "Architecture is central to the public positioning.",
      evidence: "none",
      expectedAccepted: false,
      expectedRule: "interpretation_or_working_opinion_basis_required",
    },
    {
      name: "accepts guarded synthesis explicitly present in its cited basis",
      statement: "The owner-stated target is global startups in western developed English-speaking markets.",
      evidence: "target",
      expectedAccepted: true,
      expectedRule: null,
    },
    {
      name: "rejects a guarded concrete claim absent from its cited basis",
      statement: "The business targets North American technology startups.",
      evidence: "target",
      expectedAccepted: false,
      expectedRule: "guarded_concrete_claim_supported_by_cited_basis:geography",
    },
  ])("$name", ({ statement, evidence, expectedAccepted, expectedRule }) => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const home = inputs.evidence.find((item) => item.rawStatement.startsWith("You don’t need another idea"))!;
    const target = inputs.evidence.find((item) => item.rawStatement.startsWith("Startups globally"))!;
    const result = validateFirstWorkingSessionBriefCandidates(inputs, [{
      section: "businessRead",
      item: {
        statement,
        kind: "interpretation",
        evidenceIds: evidence === "home" ? [home.id] : evidence === "target" ? [target.id] : [],
        hypothesisIds: [],
      },
    }])[0];
    expect(result.accepted).toBe(expectedAccepted);
    expect(result.validatorRule).toBe(expectedRule);
  });
});

describe("P2.2 bounded semantic revision", () => {
  const invalidCustomerCitation = () => {
    const brief = validFixtureBrief();
    brief.businessRead = {
      ...brief.businessRead,
      statement: "The business provides architecture for startups.",
    };
    return brief;
  };

  it.each([
    { label: "initial pass", outputs: () => [validFixtureBrief()], calls: 1, revisions: 0 },
    { label: "revision one recovery", outputs: () => [invalidCustomerCitation(), validFixtureBrief()], calls: 2, revisions: 1 },
    { label: "revision two recovery", outputs: () => [invalidCustomerCitation(), invalidCustomerCitation(), validFixtureBrief()], calls: 3, revisions: 2 },
  ])("supports $label", async ({ outputs, calls, revisions }) => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const queue = outputs();
    const prompts: string[] = [];
    const result = await synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async (prompt) => {
      prompts.push(prompt);
      return structuredClone(queue[prompts.length - 1]);
    });
    expect(prompts).toHaveLength(calls);
    expect(result.telemetry.revisionCount).toBe(revisions);
    expect(result.telemetry.finalValidationPassed).toBe(true);
  });

  it("exhausts after exactly two unsuccessful revisions", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async () => {
      calls += 1;
      return invalidCustomerCitation();
    })).rejects.toThrow("brief_semantic_revision_exhausted");
    expect(calls).toBe(3);
  });

  it("repairs provider citation aliases in prose before UUID lineage and persistence", async () => {
    const { inputs, reasoningRunId } = buildP22LiveShapedDiagnosticInputs();
    const leakedUuidCandidate = validFixtureBrief();
    leakedUuidCandidate.businessRead.statement = "Architecture is central (E2, H1).";
    const leakageReport = collectFirstWorkingSessionBriefValidation(leakedUuidCandidate, inputs);
    expect(leakageReport.repairable).toBe(true);
    expect(leakageReport.defects[0].validatorRule)
      .toBe("provider_citation_alias_not_allowed_in_statement");
    const leaked = providerAliasBrief(validFixtureBrief());
    (leaked.businessRead as { statement: string }).statement = "Architecture is central (E2, H1).";
    const clean = providerAliasBrief(validFixtureBrief());
    const outputs = [leaked, clean];
    let calls = 0;
    const artifact = await buildFirstWorkingSessionBriefArtifact(
      inputs,
      reasoningRunId,
      createCompactFirstWorkingSessionBriefGenerator(async () => outputs[calls++]),
      { maxRevisions: 2 },
    );
    expect(calls).toBe(2);
    expect(artifact.telemetry.initialValidationCategory).toBe("brief_semantic_interpretation_invalid");
    expect(JSON.stringify(artifact.brief)).not.toMatch(/\b(?:E|H)\d+\b/);
    expect(artifact.sourceEvidenceIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
    expect(artifact.sourceHypothesisIds.every((id) => /^[0-9a-f-]{36}$/i.test(id))).toBe(true);
  });

  it("does not revise an out-of-scope namespace failure", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const invalid = validFixtureBrief();
    invalid.businessRead.evidenceIds = ["90000000-0000-4000-8000-000000000001"];
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async () => {
      calls += 1;
      return invalid;
    })).rejects.toThrow("brief_citation_scope_invalid");
    expect(calls).toBe(1);
  });

  it("stops on revision provider transport failure", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async () => {
      calls += 1;
      if (calls === 2) throw new Error("transport failed");
      return invalidCustomerCitation();
    })).rejects.toThrow("transport failed");
    expect(calls).toBe(2);
  });

  it("does not begin a revision without the reserved execution budget", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(
      inputs,
      async () => { calls += 1; return invalidCustomerCitation(); },
      { deadlineMs: Date.now() + 79_000 },
    )).rejects.toThrow("brief_semantic_revision_time_budget_exhausted");
    expect(calls).toBe(1);
  });

  it("revalidates the complete candidate and restores required sections", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const missingAuthority = validFixtureBrief();
    missingAuthority.authorityGaps = [];
    const missingPriorities = validFixtureBrief();
    missingPriorities.formationPriorities = [];
    const outputs = [invalidCustomerCitation(), missingAuthority, missingPriorities];
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async () => outputs[calls++]))
      .rejects.toThrow("brief_semantic_revision_exhausted");
    expect(calls).toBe(3);
  });

  it("freezes governed inputs and includes all safe defects", async () => {
    const fixture = buildP22LiveShapedDiagnosticInputs();
    const before = JSON.stringify(fixture.inputs);
    const invalid = invalidCustomerCitation();
    invalid.offerRead = { ...invalid.offerRead, statement: "The leading offer costs $5,000." };
    const report = collectFirstWorkingSessionBriefValidation(invalid, fixture.inputs);
    expect(report.defects.length).toBeGreaterThanOrEqual(3);
    expect(report.defects.every((defect) => defect.section && defect.validatorRule)).toBe(true);
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(fixture.inputs, async () => invalid))
      .rejects.toThrow("brief_semantic_revision_exhausted");
    expect(JSON.stringify(fixture.inputs)).toBe(before);
  });

  it.each([
    ["fake price", "The package costs $5,000."],
    ["fake segment", "The business serves Series A SaaS founders."],
    ["fake geography", "The business serves North American startups."],
    ["fake compliance", "The company is GDPR compliant."],
    ["fake guarantee", "The service guarantees scalable growth."],
    ["fake performance", "Clients grow by 25%."],
    ["fake superlative", "The company is the leading consultancy."],
    ["fake timeline", "The team will deliver within 30 days."],
    ["unauthorized commitment", "Zeya is authorized to commit to delivery."],
  ])("never launders %s through revision", async (_label, statement) => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const invalid = validFixtureBrief();
    invalid.businessRead = { ...invalid.businessRead, statement, kind: "supported_finding" };
    let calls = 0;
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(inputs, async () => {
      calls += 1;
      return invalid;
    })).rejects.toThrow("brief_semantic_revision_exhausted");
    expect(calls).toBe(3);
  });
});
