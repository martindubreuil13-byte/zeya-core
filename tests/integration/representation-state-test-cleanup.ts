import { SupabaseClient } from '@supabase/supabase-js';
import { FixtureRegistry } from './representation-state-test-fixtures';

export async function cleanupFixtures(db: SupabaseClient, registry: FixtureRegistry) {
  const failures: string[] = [];
  for (const item of [...registry.representations].reverse()) {
    const purge = await db.rpc('zeya_purge_business_representation', { p_business_representation_id: item.id, p_expected_business_id: item.businessId });
    if (purge.error) failures.push(`representation ${item.id}: ${purge.error.code}`);
    else if ((await db.from('business_representations').select('id').eq('id', item.id).maybeSingle()).data) failures.push(`representation ${item.id}: still exists`);
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
