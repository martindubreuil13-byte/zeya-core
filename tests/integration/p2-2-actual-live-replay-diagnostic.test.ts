import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCompactFirstWorkingSessionBriefPrompt,
  buildCompactFirstWorkingSessionBriefSchema,
  buildFirstWorkingSessionBriefProviderContract,
  classifyFirstWorkingSessionProviderFailure,
  expandFirstWorkingSessionBriefProviderAliases,
  synthesizeFirstWorkingSessionBriefWithRevisions,
  type BriefProviderCallContext,
} from "../../lib/onboarding/first-working-session-brief";
import { buildP22LiveShapedDiagnosticInputs } from "../../scripts/diagnostics/p2-2-openai-brief-dry-run";
import { createDirectHireServiceClient } from "../../lib/onboarding/direct-hire-service-client";
import {
  P2_2_LIVE_REPLAY_WORKING_SESSION_ID,
  runP22ActualLiveCompactOnly,
  runP22ActualLiveMetricsOnly,
  runP22ActualLiveReplay,
} from "../../app/api/internal/diagnostics/p2-2-live-replay/route";

const routePath = "app/api/internal/diagnostics/p2-2-live-replay/route.ts";

describe("P2.2 actual-live replay diagnostic", () => {
  it("keeps the v4 live-quality inspection read-only and current", () => {
    const sql = readFileSync("supabase/manual/20260813_p2_2_live_quality_inspection.sql", "utf8");
    expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|MERGE|CALL)\b/i);
    expect(sql).not.toMatch(/\.rpc\s*\(/i);
    for (const check of [
      "first-working-session-preparation-v4",
      "exactly_one_current_private_brief",
      "appointment_and_brief_snapshot_match",
      "computed_hypothesis_trace_matches_brief",
      "brief_evidence_ids_are_effective",
      "brief_hypothesis_ids_are_current",
      "persisted_statement_text_contains_no_provider_aliases",
      "governance_canonical_is_false",
      "governance_contains_chain_of_thought_is_false",
      "authority_gaps_present_when_required",
      "formation_priorities_count_valid_when_unresolved_risk_remains",
      "historical_v1_brief_remains_non_current",
      "historical_v3_brief_remains_non_current",
    ]) expect(sql).toContain(check);
  });

  it("is exact-session, secret-protected, and read-only", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).toContain("DIRECT_HIRE_PREPARATION_WORKER_SECRET");
    expect(source).toContain("timingSafeEqual");
    expect(source).toContain("715f4971-4d3f-4f53-9b89-a9dd703349d8");
    expect(source).not.toMatch(/\.rpc\s*\(/);
    expect(source).not.toMatch(/\.from\s*\([^)]*\)[\s\S]{0,300}\.(insert|update|delete|upsert)\s*\(/);
    expect(source).not.toMatch(/zeya_(claim|fail|finalize|persist|recover|requeue)_/);
  });

  it("uses production snapshot, prompt, schema, request, client, and revision helpers", () => {
    const source = readFileSync(routePath, "utf8");
    for (const helper of [
      "loadFirstWorkingSessionBriefInputs",
      "buildFirstWorkingSessionBriefPrompt",
      "buildFirstWorkingSessionBriefSchema",
      "buildFirstWorkingSessionBriefProviderRequest",
      "createObservedFirstWorkingSessionBriefGenerator",
      "buildFirstWorkingSessionBriefArtifact",
      "buildFirstWorkingSessionFinalizationPayload",
    ]) expect(source).toContain(helper);
    expect(source).toContain("maxRevisions: 2");
    expect(source).toContain("deadlineMs: Date.now() + 240_000");
  });

  it("does not serialize governed content in the diagnostic response shape", () => {
    const source = readFileSync(routePath, "utf8");
    expect(source).not.toMatch(/rawStatement\s*:/);
    expect(source).not.toMatch(/brief\s*:/);
    expect(source).not.toMatch(/prompt\s*:/);
    expect(source).not.toMatch(/schema\s*:/);
    expect(source).toContain("providerRequestSha256");
    expect(source).toContain("serializedRequestBytes");
  });

  it("labels initial generation and bounded revisions without changing generator semantics", async () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const contexts: BriefProviderCallContext[] = [];
    await expect(synthesizeFirstWorkingSessionBriefWithRevisions(
      inputs,
      async (_prompt, _schema, context) => {
        contexts.push(context!);
        return {};
      },
      { maxRevisions: 2 },
    )).rejects.toThrow("brief_schema_invalid");
    expect(contexts).toEqual([{ logicalGeneration: 1, revisionNumber: 0 }]);
  });

  it("uses deterministic compact aliases and keeps UUIDs out of the provider contract", () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const first = buildFirstWorkingSessionBriefProviderContract(inputs);
    const reordered = buildFirstWorkingSessionBriefProviderContract({
      ...inputs,
      evidence: [...inputs.evidence].reverse(),
      hypotheses: [...inputs.hypotheses].reverse(),
    });
    expect([...first.evidenceAliasToId]).toEqual([...reordered.evidenceAliasToId]);
    expect([...first.hypothesisAliasToId]).toEqual([...reordered.hypothesisAliasToId]);
    const providerContract = JSON.stringify({
      prompt: buildCompactFirstWorkingSessionBriefPrompt(inputs, first),
      schema: buildCompactFirstWorkingSessionBriefSchema(inputs, first),
    });
    for (const item of [...inputs.evidence, ...inputs.hypotheses]) {
      expect(providerContract).not.toContain(item.id);
    }
    expect(providerContract).toContain('"E1"');
    expect(providerContract).toContain('"H1"');
  });

  it("expands aliases to exact UUID lineage and fails closed on unknown aliases", () => {
    const { inputs } = buildP22LiveShapedDiagnosticInputs();
    const contract = buildFirstWorkingSessionBriefProviderContract(inputs);
    const statement = { statement: "Governed", kind: "interpretation", evidenceIds: ["E1"], hypothesisIds: ["H1"] };
    const empty = { statement: "Unknown", kind: "unknown", evidenceIds: [], hypothesisIds: [] };
    const candidate = {
      businessRead: statement, offerRead: empty, customerRead: empty,
      problemOutcomeRead: empty, positioningRead: empty,
      commercialSignals: [], contradictions: [], unknowns: [], workingOpinions: [],
      formationPriorities: [], openingInsights: [], questions: [], authorityGaps: [],
      governance: { canonical: false, containsChainOfThought: false },
    };
    const expanded = expandFirstWorkingSessionBriefProviderAliases(candidate, contract) as typeof candidate;
    expect(expanded.businessRead.evidenceIds).toEqual([contract.evidenceAliasToId.get("E1")]);
    expect(expanded.businessRead.hypothesisIds).toEqual([contract.hypothesisAliasToId.get("H1")]);
    expect(() => expandFirstWorkingSessionBriefProviderAliases({
      ...candidate,
      businessRead: { ...statement, evidenceIds: ["E999"] },
    }, contract)).toThrow("brief_citation_scope_invalid");
  });

  it("classifies token TPM rejection without changing retry behavior", () => {
    expect(classifyFirstWorkingSessionProviderFailure({
      httpStatus: 429, errorType: "tokens", errorCode: "rate_limit_exceeded",
    })).toBe("brief_provider_rate_limited");
    expect(classifyFirstWorkingSessionProviderFailure({
      httpStatus: 500, errorType: "server_error", errorCode: null,
    })).toBe("brief_provider_request_failed");
  });

  it.skipIf(process.env.P2_2_RUN_LIVE_REPLAY !== "1")(
    "runs the explicitly enabled read-only Preview replay",
    async () => {
      process.loadEnvFile(".env.local");
      const result = await runP22ActualLiveReplay(
        createDirectHireServiceClient(),
        P2_2_LIVE_REPLAY_WORKING_SESSION_ID,
      );
      console.log("P2.2 safe live replay result", JSON.stringify(result, null, 2));
      expect(result.comparison.fixture.metrics.hypothesisCount).toBe(7);
      expect(result.comparison.live.metrics.hypothesisCount).toBe(7);
    },
    300_000,
  );

  it.skipIf(!process.env.P2_2_LIVE_STABILITY_RUNS)(
    "runs explicitly enabled paced compact live stability",
    async () => {
      process.loadEnvFile(".env.local");
      const runs = Number.parseInt(process.env.P2_2_LIVE_STABILITY_RUNS ?? "0", 10);
      expect(runs).toBeGreaterThan(0);
      expect(runs).toBeLessThanOrEqual(20);
      const client = createDirectHireServiceClient();
      const results = [];
      for (let run = 1; run <= runs; run += 1) {
        const result = await runP22ActualLiveCompactOnly(
          client, P2_2_LIVE_REPLAY_WORKING_SESSION_ID,
        );
        results.push(result);
        console.log("P2.2 compact stability progress", {
          run, success: result.outcome.success,
          providerCalls: result.outcome.providerCalls.length,
          stageCategory: result.outcome.stageCategory,
        });
        if (run < runs) {
          const paceMs = result.outcome.providerCalls.length > 1 ? 65_000 : 32_000;
          await new Promise((resolve) => setTimeout(resolve, paceMs));
        }
      }
      const successful = results.filter((result) => result.outcome.success);
      expect(successful.length).toBeGreaterThanOrEqual(Math.ceil(runs * 0.95));
      expect(results.flatMap((result) => result.outcome.providerCalls)
        .some((call) => call.httpStatus === 429)).toBe(false);
      expect(results.flatMap((result) => result.outcome.providerCalls)
        .every((call) => call.serializedRequestBytes < 60_000)).toBe(true);
      expect(successful.every((result) => result.outcome.citationLineagePassed
        && result.outcome.finalizationPayloadPreflightPassed)).toBe(true);
      console.log("P2.2 compact stability summary", {
        runs,
        passes: successful.length,
        failures: results.length - successful.length,
        maxProviderRequestBytes: Math.max(...results.flatMap((result) =>
          result.outcome.providerCalls.map((call) => call.serializedRequestBytes))),
        revisionCounts: results.map((result) => result.outcome.revisionCount),
        totalTokens: results.flatMap((result) => result.outcome.providerCalls
          .map((call) => call.totalTokens)),
        inputTokens: results.flatMap((result) => result.outcome.providerCalls
          .map((call) => call.inputTokens)),
        outputTokens: results.flatMap((result) => result.outcome.providerCalls
          .map((call) => call.outputTokens)),
      });
    },
    1_800_000,
  );

  it.skipIf(process.env.P2_2_RUN_LIVE_METRICS !== "1")(
    "reports read-only current live compaction metrics without provider calls",
    async () => {
      process.loadEnvFile(".env.local");
      const metrics = await runP22ActualLiveMetricsOnly(
        createDirectHireServiceClient(), P2_2_LIVE_REPLAY_WORKING_SESSION_ID,
      );
      console.log("P2.2 live compaction metrics", JSON.stringify(metrics, null, 2));
      expect(metrics.afterCompaction.serializedRequestBytes)
        .toBeLessThan(metrics.beforeCompaction.serializedRequestBytes);
    },
    30_000,
  );
});
