#!/usr/bin/env npx tsx
/**
 * P2.10D — READ-ONLY MATERIALIZATION CHECK
 * Service-role direct query for existing P2.10D chain state
 */

import { createClient } from '@supabase/supabase-js';

const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_OWNER_EMAIL = 'mdubreu@gmail.com';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing credentials: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10D MATERIALIZATION CHECK ===\n');
  console.log('Searching for existing P2.10D chain...\n');

  try {
    const ownerId = QA_OWNER_ID;
    console.log(`✓ Owner ID resolved`);

    // 2. Search for recent mission for this lead
    const missionsResult = await db
      .from('operating_missions')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .order('created_at', { ascending: false })
      .limit(5);

    if (missionsResult.error || !missionsResult.data || missionsResult.data.length === 0) {
      console.error('❌ HOLD — P2.10D CHAIN WAS NEVER CREATED');
      console.error(`   No missions found for lead ${SYNTHETIC_LEAD_ID}`);
      process.exit(1);
    }

    const mission = missionsResult.data[0];
    console.log(`✓ Mission found: ${mission.id}`);

    // 3. Get execution context
    const contextResult = await db
      .from('operating_execution_contexts')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('mission_id', mission.id)
      .single();

    if (contextResult.error || !contextResult.data) {
      console.error('❌ No execution context found for mission');
      process.exit(1);
    }

    const context = contextResult.data;
    console.log(`✓ Execution Context found: ${context.id}`);

    // 4. Get worker brief
    const briefResult = await db
      .from('worker_briefs')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('execution_context_id', context.id)
      .single();

    if (briefResult.error || !briefResult.data) {
      console.error('❌ No worker brief found');
      process.exit(1);
    }

    const brief = briefResult.data;
    const briefPayload = typeof brief.brief_payload === 'string'
      ? JSON.parse(brief.brief_payload)
      : brief.brief_payload || {};
    console.log(`✓ Worker Brief found: ${brief.id}`);

    // 5. Get dispatch
    const dispatchResult = await db
      .from('dispatches')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('worker_brief_id', brief.id)
      .single();

    if (dispatchResult.error || !dispatchResult.data) {
      console.error('❌ No dispatch found');
      process.exit(1);
    }

    const dispatch = dispatchResult.data;
    console.log(`✓ Dispatch found: ${dispatch.dispatch_id}`);

    // 6. Get authorization
    const authResult = await db
      .from('governed_execution_authorizations')
      .select('*')
      .eq('owner_id', ownerId)
      .eq('dispatch_id', dispatch.dispatch_id)
      .single();

    if (authResult.error || !authResult.data) {
      console.error('❌ No authorization found');
      process.exit(1);
    }

    const auth = authResult.data;
    console.log(`✓ Authorization found: ${auth.id}`);
    console.log(`  Status: ${auth.status}`);
    console.log(`  Consumed At: ${auth.consumed_at || 'NULL (unconsumed)'}`);

    // 7. Get lead details (for phone verification)
    const leadResult = await db
      .from('mission_leads')
      .select('*')
      .eq('id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', ownerId)
      .single();

    if (leadResult.error || !leadResult.data) {
      console.error('❌ Lead not found');
      process.exit(1);
    }

    const lead = leadResult.data;
    console.log(`✓ Lead found`);

    // Verify phone is +66979211331
    const actualPhone = lead.phone;
    const phoneMatches = actualPhone === '+66979211331';
    console.log(`  Phone matches +66979211331: ${phoneMatches}`);
    if (!phoneMatches) {
      console.error(`  ⚠️  UNEXPECTED: Phone is ${actualPhone}`);
    }

    // 8. Get representation
    const repResult = await db
      .from('business_representations')
      .select('*')
      .eq('id', dispatch.business_representation_id)
      .single();

    if (repResult.error || !repResult.data) {
      console.error('❌ Representation not found');
      process.exit(1);
    }

    const rep = repResult.data;
    console.log(`✓ Representation: ${rep.id}`);
    console.log(`  Current Version: ${rep.current_version_id}`);

    // 9. Get representation version
    const versionResult = await db
      .from('representation_versions')
      .select('*')
      .eq('id', rep.current_version_id)
      .single();

    if (versionResult.error || !versionResult.data) {
      console.error('❌ Representation version not found');
      process.exit(1);
    }

    const version = versionResult.data;
    console.log(`  Version Fingerprint: ${version.representation_fingerprint_hash?.substring(0, 16)}...`);

    // 10. Get mandate
    const mandateResult = await db
      .from('direct_hire_formation_outcome_packages')
      .select('*')
      .eq('id', dispatch.mandate_outcome_package_id)
      .single();

    if (mandateResult.error || !mandateResult.data) {
      console.error('❌ Mandate not found');
      process.exit(1);
    }

    const mandate = mandateResult.data;
    console.log(`✓ Mandate: ${mandate.id}`);
    console.log(`  Fingerprint: ${mandate.outcome_fingerprint?.substring(0, 16)}...`);

    // 11. Check prospect memory for the lead
    const observationsResult = await db
      .from('prospect_observations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', ownerId);

    const obsCount = observationsResult.data?.length || 0;
    console.log(`✓ Prospect Observations: ${obsCount}`);

    const relationsResult = await db
      .from('prospect_observation_relations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', ownerId);

    const relCount = relationsResult.data?.length || 0;
    console.log(`✓ Prospect Relations: ${relCount}`);

    // Verify counts match expected (8, 0)
    const memoryIntact = obsCount === 8 && relCount === 0;
    console.log(`  Memory Integrity: ${memoryIntact ? '✓ PASS' : '⚠️  MISMATCH'}`);
    if (!memoryIntact) {
      console.log(`    Expected: 8 observations, 0 relations`);
      console.log(`    Actual: ${obsCount} observations, ${relCount} relations`);
    }

    // 12. Check execution attempts
    const attemptsResult = await db
      .from('governed_execution_attempts')
      .select('id')
      .eq('dispatch_id', dispatch.dispatch_id)
      .eq('owner_id', ownerId);

    const attemptCount = attemptsResult.data?.length || 0;
    console.log(`✓ Execution Attempts: ${attemptCount}`);

    // 13. Check provider calls
    const providerCallsResult = await db
      .from('voice_conversation_outputs')
      .select('id')
      .eq('worker_brief_id', brief.id)
      .eq('owner_id', ownerId);

    const callCount = providerCallsResult.data?.length || 0;
    console.log(`✓ Provider Calls: ${callCount}`);

    // Get the dynamically resolved worker identity
    const spokenWorkerIdentity = briefPayload.worker?.spokenName || 'unresolved';
    const opening = briefPayload.opening || 'not-set';

    console.log(`\n=== MATERIALIZED VALUES ===\n`);

    console.log('1. Mission ID:');
    console.log(`   ${mission.id}\n`);

    console.log('2. Execution Context ID:');
    console.log(`   ${context.id}\n`);

    console.log('3. Worker Brief ID:');
    console.log(`   ${brief.id}\n`);

    console.log('4. Dispatch ID:');
    console.log(`   ${dispatch.dispatch_id}\n`);

    console.log('5. Authorization ID:');
    console.log(`   ${auth.id}\n`);

    console.log('6. Authorization Status:');
    console.log(`   ${auth.status}\n`);

    console.log('7. Authorization Consumed At:');
    console.log(`   ${auth.consumed_at || 'NULL (unconsumed)'}\n`);

    console.log('8. Dynamically Resolved Worker Identity:');
    console.log(`   ${spokenWorkerIdentity}\n`);

    console.log('9. Preview Deployment URL:');
    console.log(`   ${process.env.PREVIEW_BASE_URL || 'https://[check PREVIEW_BASE_URL]'}\n`);

    console.log('10. QA Phone (masked):');
    const phoneParts = (actualPhone || '').split('');
    const maskedPhone = phoneParts.length >= 4
      ? phoneParts.slice(0, -4).join('') + '****'
      : '****';
    console.log(`   ${maskedPhone} (verified: ${actualPhone === '+66979211331' ? 'YES' : 'NO'})\n`);

    console.log('11. Exact Deterministic Opening:');
    console.log(`   ${opening}\n`);

    console.log('12. Current Representation Version ID:');
    console.log(`   ${rep.current_version_id}\n`);

    console.log('13. Representation Fingerprint:');
    console.log(`   ${version.representation_fingerprint_hash}\n`);

    console.log('14. Mandate/Package ID and Fingerprint:');
    console.log(`   Package ID: ${mandate.id}`);
    console.log(`   Fingerprint: ${mandate.outcome_fingerprint}\n`);

    console.log('15. Prospect Source Fingerprint:');
    const prospectCtxResult = await db
      .from('prospect_contexts')
      .select('source_fingerprint')
      .eq('operating_mission_id', mission.id)
      .single();
    console.log(`   ${prospectCtxResult.data?.source_fingerprint || 'pending'}\n`);

    console.log('16. Execution Context Fingerprint:');
    console.log(`   ${context.source_fingerprint}\n`);

    console.log('17. Worker Brief/Dispatch Fingerprint:');
    console.log(`   ${brief.source_fingerprint}\n`);

    console.log('18. Currentness Results:');
    console.log(`   Prospect memory intact: ${memoryIntact}`);
    console.log(`   Dispatch status: ${dispatch.status}`);
    console.log(`   Authorization status: ${auth.status}\n`);

    console.log('19. Execution Attempt Count:');
    console.log(`   ${attemptCount} (expected: 0)\n`);

    console.log('20. Provider Call Count:');
    console.log(`   ${callCount} (expected: 0)\n`);

    // Final verdict
    const allChecksPass =
      phoneMatches &&
      memoryIntact &&
      attemptCount === 0 &&
      callCount === 0 &&
      auth.status === 'authorized' &&
      !auth.consumed_at;

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    if (allChecksPass) {
      console.log('║  P2.10D — MATERIALIZED AND READY FOR FINAL CALL APPROVAL       ║');
    } else {
      console.log('║  HOLD — PRE-CALL STATE INCONSISTENCY                          ║');
    }
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    process.exit(allChecksPass ? 0 : 1);

  } catch (err) {
    console.error('❌ Materialization failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
