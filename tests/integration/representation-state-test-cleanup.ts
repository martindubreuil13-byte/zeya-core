import { SupabaseClient } from '@supabase/supabase-js';
import { FixtureRegistry } from './representation-state-test-fixtures';

export async function cleanupFixtures(db: SupabaseClient, registry: FixtureRegistry) {
  const failures: string[] = [];
  for (const item of [...registry.representations].reverse()) {
    const purge = await db.rpc('zeya_purge_business_representation', { p_business_representation_id: item.id, p_expected_business_id: item.businessId });
    if (purge.error) failures.push(`representation ${item.id}: ${purge.error.code}`);
    else {
      const expectedOutputCount = registry.voiceOutputs.filter(output => output.businessRepresentationId === item.id).length;
      const expectedCandidateCount = registry.voiceCandidates.filter(candidate => candidate.businessRepresentationId === item.id).length;
      const expectedReviewCount = registry.conversationReviews.filter(row => row.businessRepresentationId === item.id).length;
      const expectedPromotionCount = registry.conversationPromotions.filter(row => row.businessRepresentationId === item.id).length;
      const deletedRows = (purge.data as { deleted?: Record<string, number> } | null)?.deleted;
      if (deletedRows?.voice_conversation_outputs !== expectedOutputCount) failures.push(`representation ${item.id}: output deletion count mismatch`);
      if (deletedRows?.voice_conversation_candidates !== expectedCandidateCount) failures.push(`representation ${item.id}: candidate deletion count mismatch`);
      if (deletedRows?.conversation_candidate_review_decisions !== expectedReviewCount) failures.push(`representation ${item.id}: review deletion count mismatch`);
      if (deletedRows?.conversation_candidate_promotions !== expectedPromotionCount) failures.push(`representation ${item.id}: promotion deletion count mismatch`);
      const lineageIds = registry.voiceLineages.filter(lineage => lineage.businessRepresentationId === item.id).map(lineage => lineage.id);
      if (lineageIds.length > 0) {
        const remainingLineage = await db.from('voice_representation_lineage').select('voice_context_id').in('voice_context_id', lineageIds);
        if (remainingLineage.error) failures.push(`representation ${item.id}: lineage verification ${remainingLineage.error.code}`);
        else if ((remainingLineage.data?.length ?? 0) > 0) failures.push(`representation ${item.id}: lineage still exists`);
      }
      const outputIds = registry.voiceOutputs.filter(output => output.businessRepresentationId === item.id).map(output => output.id);
      if (outputIds.length > 0) {
        const remainingOutputs = await db.from('voice_conversation_outputs').select('id').in('id', outputIds);
        if (remainingOutputs.error) failures.push(`representation ${item.id}: output verification ${remainingOutputs.error.code}`);
        else if ((remainingOutputs.data?.length ?? 0) > 0) failures.push(`representation ${item.id}: output still exists`);
      }
      const candidateIds = registry.voiceCandidates.filter(candidate => candidate.businessRepresentationId === item.id).map(candidate => candidate.id);
      if (candidateIds.length > 0) {
        const remainingCandidates = await db.from('voice_conversation_candidates').select('id').in('id', candidateIds);
        if (remainingCandidates.error) failures.push(`representation ${item.id}: candidate verification ${remainingCandidates.error.code}`);
        else if ((remainingCandidates.data?.length ?? 0) > 0) failures.push(`representation ${item.id}: candidate still exists`);
      }
      if ((await db.from('business_representations').select('id').eq('id', item.id).maybeSingle()).data) failures.push(`representation ${item.id}: still exists`);
    }
  }
  for (const business of [...registry.businesses].reverse()) {
    const representation = registry.representations.find(item => item.businessId === business.id);
    if (representation && failures.some(message => message.includes(representation.id))) continue;
    const owner = await db.from('businesses').select('user_id').eq('id', business.id).maybeSingle();
    if (owner.data && owner.data.user_id !== business.userId) { failures.push(`business ${business.id}: owner mismatch`); continue; }
    const deletion = await db.from('businesses').delete().eq('id', business.id).eq('user_id', business.userId);
    if (deletion.error) failures.push(`business ${business.id}: ${deletion.error.code}`);
    else if ((await db.from('businesses').select('id').eq('id', business.id).maybeSingle()).data) failures.push(`business ${business.id}: still exists`);
  }
  for (const user of [...registry.authUsers].reverse()) {
    const deletion = await db.auth.admin.deleteUser(user.id);
    if (deletion.error && !deletion.error.message.toLowerCase().includes('not found')) failures.push(`auth ${user.id}: deletion failed`);
    const verification = await db.auth.admin.getUserById(user.id);
    if (!verification.error && verification.data.user) failures.push(`auth ${user.id}: still exists`);
  }
  if (failures.length) await registry.writeRecovery(failures); else await registry.clearRecovery();
  return { success: failures.length === 0, failures };
}
