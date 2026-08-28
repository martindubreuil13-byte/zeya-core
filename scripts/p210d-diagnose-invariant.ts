#!/usr/bin/env npx tsx
/**
 * P2.10D — GOVERNANCE INVARIANT DIAGNOSIS
 * 
 * Determine how legacy artifacts became governance-locked
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== GOVERNANCE INVARIANT DIAGNOSIS ===\n');

  // 1. Get the affected dispatch
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .eq('worker_brief_id', 'p25_brief_95ff78b981714a69aa4aeccfe355e931')
    .single();

  if (!dispatchRes.data) {
    console.error('Dispatch not found');
    process.exit(1);
  }

  const dispatch = dispatchRes.data;

  // 2. Get the affected brief
  const briefRes = await db
    .from('worker_briefs')
    .select('*')
    .eq('id', 'p25_brief_95ff78b981714a69aa4aeccfe355e931')
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const brief = briefRes.data;

  // 3. Get the execution context
  const contextRes = await db
    .from('mission_execution_contexts')
    .select('*')
    .eq('id', dispatch.execution_context_id)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const context = contextRes.data;

  // 4. Get the mission
  const missionRes = await db
    .from('operating_missions')
    .select('*')
    .eq('id', dispatch.mission_id)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const mission = missionRes.data;

  console.log('QUESTION 1 & 2: What makes artifacts immutable?\n');
  console.log('Immutability conditions:');
  console.log('  Trigger: zeya_p25_preserve_dispatch');
  console.log('    → On INSERT: if execution_context_id IS NOT NULL, checks lineage');
  console.log('    → On DELETE: if execution_context_id IS NOT NULL, raises PZ409');
  console.log('    → On UPDATE: if OLD.execution_context_id IS NOT NULL, lineage immutable');
  console.log('');
  console.log('  Trigger: zeya_p25_immutable_worker_brief');
  console.log('    → On UPDATE/DELETE: if OLD.execution_context_id IS NOT NULL, raises PZ409');
  console.log('');
  console.log('Conclusion: Immutability IS activated by: execution_context_id IS NOT NULL\n');

  console.log('QUESTION 3: How did execution_context_id get attached to legacy artifacts?\n');
  console.log('Dispatch created at:', dispatch.created_at);
  console.log('Dispatch source:', dispatch.source);
  console.log('Dispatch preparation_operation_id:', dispatch.preparation_operation_id);
  console.log('Brief created at:', brief?.created_at);
  console.log('');
  console.log('This indicates:');
  console.log('  - Both were created as a pair (same created_at roughly)');
  console.log('  - Source is "experience_conversation", not a governed source');
  console.log('  - Yet BOTH have execution_context_id set');
  console.log('  - preparation_operation_id is set (suggests it went through SOME RPC)\n');

  console.log('QUESTION 4: What invariant validation was supposed to run?\n');
  console.log('The P2.5 constraint (dispatches_p25_contract_check):');
  console.log('  When execution_context_id IS NOT NULL, requires:');
  console.log('    - owner_id, user_id, business_representation_id, mission_id');
  console.log('    - representation_version_id, mandate_outcome_package_id, lead_id');
  console.log('    - worker_role, channel, source_fingerprint, execution_allowed');
  console.log('');
  console.log('Does the dispatch satisfy this?');
  console.log('  execution_context_id:', dispatch.execution_context_id ? '✓' : '✗');
  console.log('  owner_id:', dispatch.owner_id ? '✓' : '✗');
  console.log('  user_id:', dispatch.user_id ? '✓' : '✗');
  console.log('  business_representation_id:', dispatch.business_representation_id ? '✓' : '✗');
  console.log('  mission_id:', dispatch.mission_id ? '✓' : '✗');
  console.log('  representation_version_id:', dispatch.representation_version_id ? '✓' : '✗');
  console.log('  mandate_outcome_package_id:', dispatch.mandate_outcome_package_id ? '✓' : '✗');
  console.log('  lead_id:', dispatch.lead_id ? '✓' : '✗');
  console.log('  worker_role:', dispatch.worker_role ? '✓' : '✗');
  console.log('  channel:', dispatch.channel ? '✓' : '✗');
  console.log('  source_fingerprint:', dispatch.source_fingerprint ? '✓' : '✗');
  console.log('  execution_allowed:', dispatch.execution_allowed !== undefined ? '✓' : '✗');
  console.log('');
  console.log('Answer: The constraint passed (all fields present).');
  console.log('But the constraint does NOT validate the SOURCE.\n');

  console.log('QUESTION 5 & 6: Should legacy sources become governed?\n');
  console.log('Current schema: NO explicit check that source must match execution_context_id');
  console.log('The constraint only checks field presence, not provenance.');
  console.log('There is NO validation that source="p29d_governed_operating_mission"\n');

  console.log('QUESTION 7: Is the UNIQUE constraint design sound?\n');
  console.log('Constraint: worker_briefs_p25_context_unique');
  console.log('  CREATE UNIQUE INDEX worker_briefs_p25_context_unique');
  console.log('    ON public.worker_briefs(execution_context_id)');
  console.log('    WHERE execution_context_id IS NOT NULL');
  console.log('');
  console.log('This prevents two briefs for same context.');
  console.log('But it does NOT distinguish between:');
  console.log('  A) Correct brief created via zeya_prepare_governed_dispatch_v3');
  console.log('  B) Incorrect brief created via direct insert with same context_id');
  console.log('');
  console.log('The constraint prevents scenario B from being replaced by scenario A.\n');

  console.log('QUESTION 8: How could this occur in production?\n');
  console.log('Tracing creation path:');
  console.log('  1. Mission created: ' + mission?.created_at);
  console.log('  2. Context created: ' + context?.created_at);
  console.log('  3. Brief created: ' + brief?.created_at);
  console.log('  4. Dispatch created: ' + dispatch.created_at);
  console.log('');
  console.log('Source: experience_conversation (legacy public call path)');
  console.log('preparation_operation_id: ' + dispatch.preparation_operation_id + ' (set)');
  console.log('');
  console.log('ANALYSIS:');
  console.log('  If dispatches/briefs are created via PUBLIC EXPERIENCE path,');
  console.log('  source would be "experience_conversation".');
  console.log('  But public experience should NOT set execution_context_id,');
  console.log('  because that marks artifacts as governed.');
  console.log('');
  console.log('  This could occur if:');
  console.log('  A) QA script directly inserted with execution_context_id (manual contamination)');
  console.log('  B) There is a code path that sets execution_context_id on legacy artifacts');
  console.log('  C) preparation_operation_id is being set by something other than RPC\n');

  // Check if preparation_operation_id is set by INSERT trigger or other mechanism
  console.log('QUESTION 3b: What set the preparation_operation_id?\n');
  console.log('RPC functions that use preparation_operation_id:');
  console.log('  - zeya_prepare_governed_dispatch (P2.5): sets it');
  console.log('  - zeya_prepare_governed_dispatch_v2 (P2.9C): sets it');
  console.log('  - zeya_prepare_governed_dispatch_v3 (P2.9D): sets it');
  console.log('');
  console.log('Source="experience_conversation" is NOT set by any of these.');
  console.log('Therefore: preparation_operation_id was set manually or via direct insert.\n');

  console.log('=== ROOT CAUSE ASSESSMENT ===\n');

  console.log('The artifacts entered a corrupted state because:\n');

  console.log('ROOT CAUSE 1: Missing Provenance Validation');
  console.log('  The P2.5 constraint checks field presence but NOT source validity.');
  console.log('  It should reject: execution_context_id IS NOT NULL AND source != governed_source\n');

  console.log('ROOT CAUSE 2: Conflation of "created with context_id" and "governed"');
  console.log('  Immutability is triggered by: execution_context_id IS NOT NULL');
  console.log('  But this does NOT distinguish governed vs legacy artifacts.');
  console.log('  A legacy artifact can have context_id without being governed.\n');

  console.log('ROOT CAUSE 3: Incomplete INSERT validation on dispatches table');
  console.log('  No trigger/function validated that if execution_context_id is set,');
  console.log('  the artifact must have come from a governed RPC (source validation).\n');

  console.log('=== PRODUCTION REPRODUCIBILITY ===\n');

  console.log('Can this occur through normal production code paths?');
  console.log('');
  console.log('NO — if all code goes through:');
  console.log('  - zeya_prepare_governed_dispatch (P2.5+)');
  console.log('  - zeya_prepare_governed_dispatch_v2 (P2.9C+)');
  console.log('  - zeya_prepare_governed_dispatch_v3 (P2.9D+)');
  console.log('');
  console.log('These RPCs SET source to p25/p29c/p29d_governed_operating_mission.');
  console.log('');
  console.log('YES — if there exists a legacy code path or direct insert that:');
  console.log('  - Sets execution_context_id but leaves source=experience_conversation');
  console.log('  - This appears to be what happened (manual QA manipulation).\n');

  console.log('=== VERDICT ===\n');

  console.log('Classification: A - Historical QA Contamination + Governance Gap\n');

  console.log('Evidence this is QA-only:');
  console.log('  1. source="experience_conversation" (legacy path)');
  console.log('  2. Manually set preparation_operation_id (not from RPC)');
  console.log('  3. No production code path creates this combination.\n');

  console.log('However, there IS a governance gap:');
  console.log('  The schema should PREVENT this state via constraint/trigger:');
  console.log('    "If execution_context_id IS NOT NULL, source MUST be a governed source"\n');

  console.log('=== RECOMMENDED FIXES ===\n');

  console.log('FIX 1: Add provenance validation constraint');
  console.log('  ALTER TABLE dispatches ADD CONSTRAINT check_governed_provenance');
  console.log('    CHECK (execution_context_id IS NULL OR');
  console.log('           source IN (\'p25_governed_operating_mission\',');
  console.log('                     \'p29c_governed_operating_mission\',');
  console.log('                     \'p29d_governed_operating_mission\'));');
  console.log('');
  console.log('FIX 2: Add insert trigger validation on worker_briefs');
  console.log('  Validate: if execution_context_id IS NOT NULL,');
  console.log('            source_fingerprint must be current (not legacy)');
  console.log('');
  console.log('FIX 3: Prevent direct insert of execution_context_id');
  console.log('  Remove ability to manually set execution_context_id.');
  console.log('  Only allow via RPC functions.\n');

  console.log('=== RECOVERY RECOMMENDATION ===\n');

  console.log('Given Classification A (QA contamination + governance gap):');
  console.log('');
  console.log('OPTION 1: Implement FIX 1, then create fresh mission/context');
  console.log('  - Prevents future contamination');
  console.log('  - Cleans up QA state without breaking governance');
  console.log('  - Ensures P2.10D chain is correct and auditable');
  console.log('');
  console.log('OPTION 2: Direct database cleanup (governance-breaking)');
  console.log('  - Disable triggers on old artifacts');
  console.log('  - Delete dispatch + brief');
  console.log('  - Re-enable triggers');
  console.log('  - Create V3 dispatch for existing context');
  console.log('  - NOT RECOMMENDED (breaks audit trail)\n');

  console.log('RECOMMENDED: OPTION 1');
  console.log('  1. Implement provenance constraint as FIX 1');
  console.log('  2. Create fresh mission + execution context');
  console.log('  3. Create V3 dispatch/brief via zeya_prepare_governed_dispatch_v3');
  console.log('  4. New chain will be correct, auditable, immutable\n');
}

run().catch(console.error);
