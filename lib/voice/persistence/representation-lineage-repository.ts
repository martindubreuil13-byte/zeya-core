import type { SupabaseClient } from "@supabase/supabase-js";
import type { VoiceRepresentationLineage } from "@/lib/voice/representation-context";

export async function saveVoiceRepresentationLineage(input: {
  db: SupabaseClient;
  voiceContextId: string;
  workerBriefId: string;
  missionId: string;
  conversationId?: string | null;
  providerCallId?: string | null;
  lineage: VoiceRepresentationLineage;
}): Promise<void> {
  const result = await input.db.rpc("zeya_create_voice_representation_lineage", {
    p_voice_context_id: input.voiceContextId,
    p_worker_brief_id: input.workerBriefId,
    p_mission_id: input.missionId,
    p_conversation_id: input.conversationId ?? `voice_${input.voiceContextId}`,
    p_tenant_user_id: input.lineage.tenantUserId,
    p_business_id: input.lineage.businessId,
    p_business_representation_id: input.lineage.businessRepresentationId,
    p_canonical_version_id: input.lineage.canonicalVersionId,
    p_context_generated_at: input.lineage.generatedAt,
    p_authorized_element_keys: input.lineage.authorizedElementKeys,
    p_provisional_mode: input.lineage.provisionalMode,
    p_agent_id: input.lineage.agentId,
    p_agent_type: input.lineage.agentType,
    p_agent_role: input.lineage.agentRole,
    p_context_schema_version: input.lineage.contextSchemaVersion,
    p_prompt_assembly_version: input.lineage.promptAssemblyVersion,
  });
  if (result.error) throw new Error(`Voice lineage persistence failed: ${result.error.code}`);

  if (input.providerCallId) {
    await attachVoiceProviderIdentifiers({
      db: input.db,
      voiceContextId: input.voiceContextId,
      conversationId: input.conversationId ?? null,
      providerCallId: input.providerCallId,
    });
  }
}

export async function attachVoiceProviderIdentifiers(input: {
  db: SupabaseClient;
  voiceContextId: string;
  conversationId: string | null;
  providerCallId: string;
}): Promise<void> {
  const result = await input.db.rpc("zeya_attach_voice_provider_ids", {
    p_voice_context_id: input.voiceContextId,
    p_conversation_id: input.conversationId,
    p_provider_call_id: input.providerCallId,
  });
  if (result.error) throw new Error(`Voice provider attachment failed: ${result.error.code}`);
}
