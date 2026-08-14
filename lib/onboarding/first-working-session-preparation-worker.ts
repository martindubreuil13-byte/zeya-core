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

export async function executeOneFirstWorkingSessionPreparation(client: SupabaseClient) {
  const executionDeadlineMs = Date.now() + 240_000;
  const claimResult = await client.rpc("zeya_claim_first_working_session_preparation", {
    p_contract_version: FIRST_WORKING_SESSION_PREPARATION_VERSION,
    p_lease_seconds: 600,
  });
  if (claimResult.error) throw new Error("preparation_claim_failed");
  const claim = claimResult.data?.[0] as Claim | undefined;
  if (!claim) return { claimed: false as const };

  try {
    // Partial source failures remain truthful source outcomes and do not block
    // company-site research or reasoning when governed Evidence is available.
    let sourceOutcomes: Awaited<ReturnType<typeof acquirePendingRegisteredPublicSources>> = [];
    if (!claim.website_persisted) {
      sourceOutcomes = await acquirePendingRegisteredPublicSources(client, {
        ownerId: claim.owner_id,
        onboardingSessionId: claim.onboarding_session_id,
      });
      const research = await executeDirectHirePreparation(claim.website_url, {
        sourceScope: claim.onboarding_session_id,
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
      if (!['ready', 'partial'].includes(String(finalized.data))) {
        throw new Error(`website_research_failed:${research.failureCode ?? "no_usable_evidence"}`);
      }
    }
    const scope = {
      ownerId: claim.owner_id, businessId: claim.business_id,
      businessRepresentationId: claim.business_representation_id,
      onboardingSessionId: claim.onboarding_session_id,
    };
    await ensurePreparationIntelligence(client, scope);
    let synthesis;
    try {
      synthesis = await buildFirstWorkingSessionBrief(client, scope, { deadlineMs: executionDeadlineMs });
    } catch (error) {
      if (error instanceof FirstWorkingSessionPreparationStageError) throw error;
      throw new FirstWorkingSessionPreparationStageError("brief_input_snapshot_invalid");
    }
    const payload = buildFirstWorkingSessionFinalizationPayload(
      claim.working_session_id, claim.lease_id, synthesis,
    );
    console.info("[first-working-session-preparation] brief_generation", {
      generationCount: synthesis.telemetry.generationCount,
      revisionCount: synthesis.telemetry.revisionCount,
      initialValidationCategory: synthesis.telemetry.initialValidationCategory,
      terminalValidationCategory: synthesis.telemetry.terminalValidationCategory,
      revisionExhausted: synthesis.telemetry.revisionExhausted,
      finalValidationPassed: synthesis.telemetry.finalValidationPassed,
      providerDurationsMs: synthesis.telemetry.providerDurationsMs,
    });
    const completion = await client.rpc("zeya_finalize_first_working_session_preparation", payload);
    if (completion.error) {
      throw new FirstWorkingSessionPreparationStageError("brief_database_finalization_failed");
    }
    return { claimed: true as const, ready: true as const, sourceOutcomes };
  } catch (error) {
    if (error instanceof FirstWorkingSessionPreparationStageError && error.revisionTelemetry) {
      console.info("[first-working-session-preparation] brief_generation", error.revisionTelemetry);
    }
    const failureCode = error instanceof PreparationReasoningStageError
      ? error.stageCode
      : error instanceof FirstWorkingSessionPreparationStageError
        ? error.stageCode
      : error instanceof Error ? error.message.split(":")[0] : "preparation_failed";
    const failed = await client.rpc("zeya_fail_first_working_session_preparation", {
      p_working_session_id: claim.working_session_id,
      p_lease_id: claim.lease_id,
      p_failure_code: failureCode,
    });
    if (failed.error) console.error("[first-working-session-preparation] preparation_failure_recording_failed");
    throw error;
  }
}
