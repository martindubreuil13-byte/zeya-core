import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type OpenAI from "openai";
import { runP22DeployedProviderDiagnostic } from "../../app/api/internal/diagnostics/p2-2-openai/route";
import {
  buildFirstWorkingSessionBriefPrompt,
  buildFirstWorkingSessionBriefProviderRequest,
  buildFirstWorkingSessionBriefSchema,
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

  it("uses only synthetic UUIDs for finalization preflight", () => {
    expect(P2_2_DIAGNOSTIC_IDS.workingSession).toBe("10000000-0000-4000-8000-000000000003");
    expect(P2_2_DIAGNOSTIC_IDS.lease).toBe("10000000-0000-4000-8000-000000000004");
  });
});
