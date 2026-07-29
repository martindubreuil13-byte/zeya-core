// Formation Voice Context Assembly
// Creates Representation-scoped voice context for first working conversation
// Reuses existing voice context infrastructure

import { SupabaseClient } from '@supabase/supabase-js';
import { assembleVoiceRepresentationContext } from '@/lib/voice/representation-context';

/**
 * Create Formation-scoped voice context for first working conversation
 * Generates new voice_context_id per Formation session (not reusing Public Experience context)
 */
export async function createFormationVoiceContext(input: {
  supabase: SupabaseClient;
  businessId: string;
  businessRepresentationId: string;
  ownerId: string;
  formationSessionId: string;
}): Promise<{
  voiceContextId: string;
  conversationId: string;
  systemContext: string;
  lineage: any;
}> {
  const voiceContextId = crypto.randomUUID();
  const conversationId = `formation_${input.formationSessionId}_${voiceContextId}`;

  // Assemble Representation context for Formation owner
  const voiceContext = await assembleVoiceRepresentationContext({
    db: input.supabase,
    tenantUserId: input.ownerId,
    businessId: input.businessId,
    agent: {
      id: 'zeya-formation',
      type: 'ZEYA',
      role: 'formation_first_working_conversation',
    },
    provisionalMode: false,
  });

  return {
    voiceContextId,
    conversationId,
    systemContext: voiceContext.systemContext,
    lineage: voiceContext.lineage,
  };
}

/**
 * Validate that conversation output belongs to Formation's Business and Representation
 */
export async function validateFormationConversationOutput(input: {
  supabase: SupabaseClient;
  conversationOutputId: string;
  expectedBusinessRepresentationId: string;
  expectedBusinessId: string;
}): Promise<{
  valid: boolean;
  businessRepresentationId?: string;
  businessId?: string;
  error?: string;
}> {
  const { data: output, error } = await input.supabase
    .from('voice_conversation_outputs')
    .select('id, business_representation_id, voice_context_id')
    .eq('id', input.conversationOutputId)
    .maybeSingle();

  if (error || !output) {
    return { valid: false, error: 'Conversation output not found' };
  }

  if (output.business_representation_id !== input.expectedBusinessRepresentationId) {
    return {
      valid: false,
      error: 'Conversation belongs to different representation',
      businessRepresentationId: output.business_representation_id,
    };
  }

  // Verify business_id through representation
  const { data: rep, error: repError } = await input.supabase
    .from('business_representations')
    .select('business_id')
    .eq('id', output.business_representation_id)
    .maybeSingle();

  if (repError || !rep) {
    return { valid: false, error: 'Representation not found' };
  }

  if (rep.business_id !== input.expectedBusinessId) {
    return { valid: false, error: 'Business mismatch', businessId: rep.business_id };
  }

  return {
    valid: true,
    businessRepresentationId: output.business_representation_id,
    businessId: rep.business_id,
  };
}
