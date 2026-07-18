import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20260718220000_canonical_version_element_pointer_atomicity.sql','utf8');
const preflight = readFileSync('docs/database/preflight/canonical_version_element_pointer_atomicity_preflight.sql','utf8');
const verification = readFileSync('docs/database/verification/canonical_version_element_pointer_atomicity_verification.sql','utf8');
const rollback = readFileSync('docs/database/rollbacks/canonical_version_element_pointer_atomicity_rollback.sql','utf8');
const route = readFileSync('app/api/representation/versions/rollback/route.ts','utf8');
const service = readFileSync('lib/representation/representation-service.ts','utf8');
const testC = readFileSync('tests/integration/representation-state.test-c.ts','utf8');

for (const sql of [migration, verification]) {
  assert.match(sql,/zeya_create_canonical_version_atomic\s*\([\s\S]*?uuid[\s\S]*?uuid[\s\S]*?uuid[\s\S]*?jsonb[\s\S]*?smallint[\s\S]*?uuid[\s\S]*?uuid[\s\S]*?\)/i);
  assert.match(sql,/search_path\s*=\s*''|search_path=\"\"/i);
  assert.match(sql,/service_role/i);
  assert.match(sql,/current_value_version_id\s*=\s*v_new_version_id/i);
  assert.match(sql,/v_affected_rows\s*<>\s*v_expected_element_rows/i);
}
assert.match(migration,/SECURITY DEFINER/i);
assert.match(verification,/prosecdef/);
assert.match(migration,/p_element_values\s*\?\s*element_row\.element_key/i);
assert.match(verification,/p_element_values\\\?element_row\\\.element_key/i);
assert.doesNotMatch(migration,/INSERT INTO public\.representation_versions[\s\S]{0,500}content_hash/i);
assert.match(migration,/FOR UPDATE/i);
assert.match(migration,/MAX\(version_row\.version_number\)/i);
assert.match(migration,/version_rolled_back/i);
assert.match(preflight,/deployed_rpc_lacks_element_pointer_update/);
assert.match(preflight,/controlled_purge_compatible/);
assert.match(preflight,/cross_representation_count/);
assert.match(rollback,/known to fail Element-pointer assertions in Test C/);
assert.doesNotMatch(rollback,/CASCADE/i);
assert.match(route,/assertVisibleBusinessRepresentation/);
assert.match(route,/assertVisibleVersionForRepresentation/);
assert.match(route,/createRepresentationStateService\(auth\.supabase, canonicalVersionDb\)/);
assert.doesNotMatch(route,/console\.(?:log|error)[\s\S]{0,120}serviceRoleKey/);
assert.doesNotMatch(route,/\.from\(['"](?:business_representations|representation_elements)['"]\)\s*\.update/);
assert.doesNotMatch(service,/\.pointElementsToVersion\s*\(/);
assert.match(testC,/unrelated Element unchanged/);
assert.match(testC,/pointerBeforeRollback\.data\?\.current_value_version_id===v3\.id/);

console.log('Canonical Version Element-pointer atomicity static package — PASS');
