import fixtureJson from "../tests/fixtures/p2-12d-2h-v6-reasoning-snapshot.json";
import {
  generateHypotheses,
  HYPOTHESIS_REASONING_CONTRACT_VERSION,
  PreparationReasoningStageError,
  redactHypothesisCandidate,
} from "../lib/onboarding/hypothesis-reasoning-service";
import { generateReasoningRunFingerprint } from "../lib/onboarding/persist-hypotheses-orchestration";
import type {
  EvidenceInput,
  HypothesisReasoningRequest,
  ObservationInput,
} from "../lib/onboarding/hypothesis-reasoning-types";

type ReplayFixture = {
  reasoningContractVersion: string;
  failedCorrelationId: string;
  request: HypothesisReasoningRequest;
  evidence: EvidenceInput[];
  observations: ObservationInput[];
};

try {
  process.loadEnvFile?.(".env.local");
} catch {
  // The harness reports provider availability below; it never asks for keys.
}

async function main() {
  const fixture = fixtureJson as ReplayFixture;
  const requestedRuns = Number.parseInt(process.argv[2] ?? "3", 10);
  const runCount = Math.min(3, Math.max(1, Number.isFinite(requestedRuns) ? requestedRuns : 3));

  if (fixture.reasoningContractVersion !== HYPOTHESIS_REASONING_CONTRACT_VERSION) {
    throw new Error("Replay fixture reasoning contract does not match runtime contract");
  }
  if (fixture.evidence.length !== 21 || fixture.observations.length !== 7) {
    throw new Error("Replay fixture does not contain the exact expected snapshot counts");
  }

  fixture.request.requestTraceId = generateReasoningRunFingerprint(
    fixture.request.onboardingSessionId,
    fixture.request.businessRepresentationId,
    fixture.evidence.map(item => item.id).sort(),
    fixture.observations.map(item => item.id).sort(),
  );

  if (!process.env.OPENAI_API_KEY?.trim()) {
    console.log(JSON.stringify({
      providerAvailable: false,
      runs: [],
      evidenceCount: fixture.evidence.length,
      observationCount: fixture.observations.length,
      reasoningContractVersion: fixture.reasoningContractVersion,
    }, null, 2));
    return;
  }

  const runs = [];
  for (let index = 1; index <= runCount; index += 1) {
    try {
      const result = await generateHypotheses(fixture.request, fixture.evidence, fixture.observations);
      runs.push({ run: index, valid: true, diagnostic: null, candidate: redactHypothesisCandidate(result) });
    } catch (error) {
      if (!(error instanceof PreparationReasoningStageError)) throw error;
      runs.push({
        run: index,
        valid: false,
        stageCode: error.stageCode,
        diagnostic: error.validationDiagnostic ?? null,
        candidate: error.redactedCandidate ?? null,
      });
    }
  }

  console.log(JSON.stringify({
    providerAvailable: true,
    runs,
    evidenceCount: fixture.evidence.length,
    observationCount: fixture.observations.length,
    reasoningContractVersion: fixture.reasoningContractVersion,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "replay_failed");
  process.exitCode = 1;
});
