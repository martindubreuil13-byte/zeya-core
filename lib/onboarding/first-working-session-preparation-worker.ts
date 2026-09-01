import type { SupabaseClient } from "@supabase/supabase-js";
import { executeDirectHirePreparation } from "./direct-hire-preparation";
import { acquirePendingRegisteredPublicSources } from "./registered-public-sources";
import { ensurePreparationIntelligence } from "./preparation-intelligence";
import {
  buildFirstWorkingSessionBrief,
  buildFirstWorkingSessionFinalizationPayload,
  FIRST_WORKING_SESSION_PREPARATION_VERSION,
  FirstWorkingSessionPreparationStageError,
} from "./first-working-session-brief";
import { PreparationReasoningStageError } from "./hypothesis-reasoning-service";
import { logPreparationStage, safePreparationFailureCode } from "./preparation-telemetry";

type FailureTelemetry = {
  terminalStage: string;
  failureCode: string;
  failurePersistenceSucceeded: boolean;
};
const failureTelemetry = new WeakMap<object, FailureTelemetry>();
export function getPreparationFailureTelemetry(error: unknown): FailureTelemetry | undefined {
  return error && typeof error === "object" ? failureTelemetry.get(error) : undefined;
}

type Claim = {
  working_session_id: string;
  onboarding_session_id: string;
  owner_id: string;
  business_id: string;
  business_representation_id: string;
  website_url: string;
  lease_id: string;
  website_persisted: boolean;
};

async function _runPreparationOrchestration(
  client: SupabaseClient,
  claim: Claim,
  executionDeadlineMs: number,
) {
  const telemetry = {
    workingSessionId: claim.working_session_id,
    onboardingSessionId: claim.onboarding_session_id,
    contractVersion: FIRST_WORKING_SESSION_PREPARATION_VERSION,
    correlationId: claim.lease_id,
  };
  let terminalStage = "source_loading";
  try {
    // Partial source failures remain truthful source outcomes and do not block
    // company-site research or reasoning when governed Evidence is available.
    let sourceOutcomes: Awaited<ReturnType<typeof acquirePendingRegisteredPublicSources>> = [];
    if (!claim.website_persisted) {
      logPreparationStage(telemetry, "registered_sources", "started");
      sourceOutcomes = await acquirePendingRegisteredPublicSources(client, {
        ownerId: claim.owner_id,
        onboardingSessionId: claim.onboarding_session_id,
      }, { telemetry });
      logPreparationStage(telemetry, "registered_sources", "completed", {
        registeredSourcesConsidered: sourceOutcomes.length,
        registeredEvidenceRecordsPersisted: sourceOutcomes.reduce((sum, outcome) => sum + outcome.evidenceCount, 0),
      });
      terminalStage = "website_acquisition";
      const research = await executeDirectHirePreparation(claim.website_url, {
        sourceScope: claim.onboarding_session_id,
        telemetry,
      });
      terminalStage = "evidence_persistence";
      logPreparationStage(telemetry, "evidence_persistence", "started", {
        evidenceRecordsPrepared: research.evidence.length,
        observationsProduced: research.observations.length,
      });
      const finalized = await client.rpc("zeya_persist_first_working_session_website_research", {
        p_working_session_id: claim.working_session_id,
        p_lease_id: claim.lease_id,
        p_final_status: research.status,
        p_failure_code: research.failureCode,
        p_successful_page_count: research.successfulPageCount,
        p_failed_page_count: research.failedPageCount,
        p_evidence: research.evidence,
        p_observations: research.observations,
      });
      if (finalized.error) throw new Error(`website_persistence_failed:${finalized.error.code}`);
      logPreparationStage(telemetry, "evidence_persistence", "completed", {
        evidenceRecordsPersisted: research.evidence.length,
        observationsPersisted: research.observations.length,
        researchStatus: research.status,
      });
      if (!['ready', 'partial'].includes(String(finalized.data))) {
        terminalStage = "website_research_outcome";
        throw new Error(`website_research_failed:${research.failureCode ?? "no_usable_evidence"}`);
      }
    }
    const scope = {
      ownerId: claim.owner_id, businessId: claim.business_id,
      businessRepresentationId: claim.business_representation_id,
      onboardingSessionId: claim.onboarding_session_id,
    };
    terminalStage = "hypotheses";
    logPreparationStage(telemetry, "hypotheses", "started");
    const hypotheses = await ensurePreparationIntelligence(client, scope);
    logPreparationStage(telemetry, "hypotheses", "completed", { hypothesesProduced: hypotheses.length });
    let synthesis;
    try {
      terminalStage = "preparation_brief";
      logPreparationStage(telemetry, "preparation_brief", "started");
      synthesis = await buildFirstWorkingSessionBrief(client, scope, { deadlineMs: executionDeadlineMs });
    } catch (error) {
      if (error instanceof FirstWorkingSessionPreparationStageError) throw error;
      throw new FirstWorkingSessionPreparationStageError("brief_input_snapshot_invalid");
    }
    const payload = buildFirstWorkingSessionFinalizationPayload(
      claim.working_session_id, claim.lease_id, synthesis,
    );
    logPreparationStage(telemetry, "preparation_brief", "completed", { briefGenerated: true });
    console.info("[first-working-session-preparation] brief_generation", {
      generationCount: synthesis.telemetry.generationCount,
      revisionCount: synthesis.telemetry.revisionCount,
      initialValidationCategory: synthesis.telemetry.initialValidationCategory,
      terminalValidationCategory: synthesis.telemetry.terminalValidationCategory,
      revisionExhausted: synthesis.telemetry.revisionExhausted,
      finalValidationPassed: synthesis.telemetry.finalValidationPassed,
      providerDurationsMs: synthesis.telemetry.providerDurationsMs,
    });
    terminalStage = "finalize";
    logPreparationStage(telemetry, "finalize", "started");
    const completion = await client.rpc("zeya_finalize_first_working_session_preparation", payload);
    if (completion.error) {
      throw new FirstWorkingSessionPreparationStageError("brief_database_finalization_failed");
    }
    logPreparationStage(telemetry, "finalize", "completed");
    return { claimed: true as const, ready: true as const, sourceOutcomes };
  } catch (error) {
    if (error instanceof FirstWorkingSessionPreparationStageError && error.revisionTelemetry) {
      console.info("[first-working-session-preparation] brief_generation", error.revisionTelemetry);
    }
    const failureCode = error instanceof PreparationReasoningStageError
      ? error.stageCode
      : error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode
      : safePreparationFailureCode(error);
    const failed = await client.rpc("zeya_fail_first_working_session_preparation", {
      p_working_session_id: claim.working_session_id,
      p_lease_id: claim.lease_id,
      p_failure_code: failureCode,
    });
    const failurePersistenceSucceeded = !failed.error;
    if (failed.error) console.error("[first-working-session-preparation] preparation_failure_recording_failed");
    logPreparationStage(telemetry, terminalStage, "failed", {
      failureCode,
      failurePersistenceSucceeded,
    });
    if (error && typeof error === "object") {
      failureTelemetry.set(error, { terminalStage, failureCode, failurePersistenceSucceeded });
    }
    throw error;
  }
}

export async function executeFirstWorkingSessionPreparationForSession(
  client: SupabaseClient,
  workingSessionId: string,
) {
  const executionDeadlineMs = Date.now() + 240_000;
  const claimContext = { workingSessionId, contractVersion: FIRST_WORKING_SESSION_PREPARATION_VERSION };
  logPreparationStage(claimContext, "claim", "started");
  const claimResult = await client.rpc("zeya_claim_first_working_session_preparation", {
    p_contract_version: FIRST_WORKING_SESSION_PREPARATION_VERSION,
    p_lease_seconds: 600,
    p_working_session_id: workingSessionId,
  });
  if (claimResult.error) {
    logPreparationStage(claimContext, "claim", "failed", { failureCode: "preparation_claim_failed" });
    throw new Error("preparation_claim_failed");
  }
  const claim = claimResult.data?.[0] as Claim | undefined;
  if (!claim) {
    logPreparationStage(claimContext, "claim", "completed", { claimed: false });
    return { claimed: false as const };
  }
  logPreparationStage({ ...claimContext, onboardingSessionId: claim.onboarding_session_id, correlationId: claim.lease_id }, "claim", "completed", { claimed: true });

  return _runPreparationOrchestration(client, claim, executionDeadlineMs);
}

export async function executeOneFirstWorkingSessionPreparation(client: SupabaseClient) {
  const executionDeadlineMs = Date.now() + 240_000;
  const claimResult = await client.rpc("zeya_claim_first_working_session_preparation", {
    p_contract_version: FIRST_WORKING_SESSION_PREPARATION_VERSION,
    p_lease_seconds: 600,
  });
  if (claimResult.error) throw new Error("preparation_claim_failed");
  const claim = claimResult.data?.[0] as Claim | undefined;
  if (!claim) return { claimed: false as const };

  return _runPreparationOrchestration(client, claim, executionDeadlineMs);
}
