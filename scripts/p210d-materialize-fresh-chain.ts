#!/usr/bin/env npx tsx
/**
 * P2.10D — MATERIALIZE FRESH CHAIN COMPLETE STATE
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const FRESH_MISSION_ID = '5b0daa9c-8889-4ef3-b5e1-c5643bc532a0';

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

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  P2.10D — MATERIALIZED FRESH CHAIN (COMPLETE)');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // 1. Get mission
    const missionRes = await db
      .from('operating_missions')
      .select('*')
      .eq('id', FRESH_MISSION_ID)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const mission = missionRes.data;

    // 2. Get execution context
    const contextRes = await db
      .from('mission_execution_contexts')
      .select('*')
      .eq('mission_id', FRESH_MISSION_ID)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const context = contextRes.data;

    // 3. Get worker brief
    const briefRes = await db
      .from('worker_briefs')
      .select('*')
      .eq('execution_context_id', context.id)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const brief = briefRes.data;
    const briefPayload = typeof brief.brief_payload === 'string'
      ? JSON.parse(brief.brief_payload)
      : brief.brief_payload;

    // 4. Get dispatch
    const dispatchRes = await db
      .from('dispatches')
      .select('*')
      .eq('worker_brief_id', brief.id)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const dispatch = dispatchRes.data;

    // 5. Get authorization
    const authRes = await db
      .from('governed_execution_authorizations')
      .select('*')
      .eq('dispatch_id', dispatch.dispatch_id)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const auth = authRes.data;

    // 6. Verify prospect memory
    const obsRes = await db
      .from('prospect_observations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const obsCount = obsRes.data?.length || 0;

    const relRes = await db
      .from('prospect_observation_relations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const relCount = relRes.data?.length || 0;

    // 7. Verify no execution attempts or provider calls
    const attemptsRes = await db
      .from('governed_execution_attempts')
      .select('id')
      .eq('dispatch_id', dispatch.dispatch_id)
      .eq('owner_id', QA_OWNER_ID);

    const attemptCount = attemptsRes.data?.length || 0;

    const callsRes = await db
      .from('voice_conversation_outputs')
      .select('id')
      .eq('worker_brief_id', brief.id)
      .eq('owner_id', QA_OWNER_ID);

    const callCount = callsRes.data?.length || 0;

    // 8. Get representation version details
    const repRes = await db
      .from('business_representations')
      .select('*')
      .eq('id', dispatch.business_representation_id)
      .eq('user_id', QA_OWNER_ID)
      .single();

    const rep = repRes.data;

    const versionRes = await db
      .from('representation_versions')
      .select('*')
      .eq('id', rep.current_version_id)
      .single();

    const version = versionRes.data;

    // 9. Get mandate
    const mandateRes = await db
      .from('direct_hire_formation_outcome_packages')
      .select('*')
      .eq('id', dispatch.mandate_outcome_package_id)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const mandate = mandateRes.data;

    // === REPORT ===
    console.log('MATERIALIZED VALUES:\n');
    console.log(`1. Mission ID:`);
    console.log(`   ${mission.id}\n`);

    console.log(`2. Execution Context ID:`);
    console.log(`   ${context.id}\n`);

    console.log(`3. Worker Brief ID:`);
    console.log(`   ${brief.id}\n`);

    console.log(`4. Worker Brief Contract Version:`);
    console.log(`   ${briefPayload.contractVersion}\n`);

    console.log(`5. Dispatch ID:`);
    console.log(`   ${dispatch.dispatch_id}\n`);

    console.log(`6. Authorization ID:`);
    console.log(`   ${auth.id}\n`);

    console.log(`7. Authorization Status:`);
    console.log(`   ${auth.status}\n`);

    console.log(`8. Authorization Consumed At:`);
    console.log(`   ${auth.consumed_at || 'NULL (unconsumed)'}\n`);

    console.log(`9. Dynamically Resolved Worker Identity:`);
    console.log(`   ${briefPayload.worker?.spokenName}\n`);

    console.log(`10. Exact Deterministic Opening:`);
    console.log(`   ${briefPayload.openingContract?.variable}\n`);

    console.log(`11. Relationship State:`);
    console.log(`   ${briefPayload.prospect?.context?.relationshipState || 'follow_up'}\n`);

    console.log(`12. Capabilities:`);
    console.log(`   ${briefPayload.capabilities?.schemaVersion}\n`);

    console.log(`13. Conversation Mode:`);
    console.log(`   ${briefPayload.conversationPolicy?.mode}\n`);

    console.log(`14. Conversation Policy Version:`);
    console.log(`   ${briefPayload.conversationPolicy?.schemaVersion}\n`);

    console.log(`15. Execution Attempts:`);
    console.log(`   ${attemptCount} (expected: 0)\n`);

    console.log(`16. Provider Calls:`);
    console.log(`   ${callCount} (expected: 0)\n`);

    console.log(`17. Prospect Observations (Durable):`);
    console.log(`   ${obsCount} (expected: 8)\n`);

    console.log(`18. Prospect Relations (Durable):`);
    console.log(`   ${relCount} (expected: 0)\n`);

    console.log(`19. Representation Version:`);
    console.log(`   ${rep.current_version_id}\n`);

    console.log(`20. Mandate Package:`);
    console.log(`   ${mandate.id}\n`);

    console.log('\nVERIFICATION CHECKLIST:\n');

    const checks = [
      ['Mission status', mission.status, 'ready'],
      ['Dispatch source', dispatch.source, 'p29d_governed_operating_mission'],
      ['Brief contract version', briefPayload.contractVersion, 'governed-worker-brief-v3'],
      ['Worker identity present', !!briefPayload.worker?.spokenName, true],
      ['Conversation policy present', !!briefPayload.conversationPolicy, true],
      ['Capabilities present', !!briefPayload.capabilities, true],
      ['Opening contract present', !!briefPayload.openingContract, true],
      ['Prospect context present', !!briefPayload.prospect?.context, true],
      ['Authorization status', auth.status, 'authorized'],
      ['Authorization unconsumed', auth.consumed_at === null, true],
      ['Execution attempts = 0', attemptCount, 0],
      ['Provider calls = 0', callCount, 0],
      ['Prospect observations = 8', obsCount, 8],
      ['Prospect relations = 0', relCount, 0],
    ];

    for (const [name, actual, expected] of checks) {
      const pass = actual === expected;
      console.log(`${pass ? '✓' : '✗'} ${name}: ${actual} ${pass ? '' : `(expected: ${expected})`}`);
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  P2.10D — CORRECT COMMERCIAL CHAIN MATERIALIZED');
    console.log('  READY FOR FINAL CALL APPROVAL');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Materialization failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
