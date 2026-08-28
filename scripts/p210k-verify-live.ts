#!/usr/bin/env npx tsx
/**
 * P2.10K LIVE VERIFICATION
 * Create fresh chain to verify deployed callback projection
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const PROSPECT_SOURCE_FP = '73d4944a7ee1b7f14dcfa282c9102f9d0cbd9d543c54d125450e47b417b38220';

const PROSPECT_CONTEXT = {
  schemaVersion: "prospect-context-v1",
  leadId: SYNTHETIC_LEAD_ID,
  provenance: { projectionVersion: "prospect-context-projection-v1", sourceFingerprint: PROSPECT_SOURCE_FP },
  obligations: [],
  currentFacts: [],
  relationshipState: "follow_up"
};

function generateUuid(): string {
  return crypto.randomUUID();
}

async function verifyLive() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10K LIVE VERIFICATION ===\n');

  try {
    // 1. Create fresh mission
    console.log('1. Creating fresh mission for callback verification...');
    const missionOpId = generateUuid();

    const missionRes = await db.rpc('zeya_create_operating_mission', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
      p_operation_id: missionOpId,
      p_objective: 'Reconnect after the prospect\'s prior callback request, use the governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
      p_qualification_goal: 'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
      p_desired_next_step: 'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
      p_allowed_channel: 'phone',
      p_constraints: { qaOnly: true, doNotExecute: false },
      p_notes: 'P2.10K: Live callback projection verification',
      p_priority: 'normal',
    });

    if (missionRes.error) throw new Error(`Mission failed: ${missionRes.error.message}`);
    const missionId = missionRes.data?.[0]?.mission_id;
    if (!missionId) throw new Error('No mission ID');
    console.log(`✓ Mission: ${missionId}`);

    // 2. Prepare mission with deployed projection
    console.log('2. Preparing mission (using deployed P2.10K projection)...');
    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: PROSPECT_CONTEXT,
      p_prospect_source_fingerprint: PROSPECT_SOURCE_FP,
    });

    if (prepareRes.error) throw new Error(`Prepare failed: ${prepareRes.error.message}`);
    const contextId = prepareRes.data?.[0]?.context_id;
    if (!contextId) throw new Error('No context');
    console.log(`✓ Context: ${contextId}`);

    // 3. Verify callback obligation in freshly projected context
    console.log('3. Verifying deployed callback projection...');
    const ctxRes = await db
      .from('mission_execution_contexts')
      .select('context')
      .eq('id', contextId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    if (ctxRes.error || !ctxRes.data) throw new Error('Cannot read context');
    
    const context = ctxRes.data.context as any;
    const obligations = context.prospectContext?.obligations || [];
    const relationshipState = context.prospectContext?.relationshipState;
    
    console.log(`\n✓ Relationship State: ${relationshipState}`);
    console.log(`✓ Obligations Count: ${obligations.length}`);
    
    const callbackObligation = obligations.find((o: any) => o.kind === 'callback');
    if (callbackObligation) {
      console.log(`✓ Callback Obligation:`);
      console.log(`  - kind: ${callbackObligation.kind}`);
      console.log(`  - status: ${callbackObligation.status}`);
      console.log(`  - requestedByProspect: ${callbackObligation.requestedByProspect}`);
      console.log(`  - scheduled: ${callbackObligation.scheduled}`);
      console.log(`  - summary: "${callbackObligation.summary}"`);
    } else {
      console.error(`✗ NO CALLBACK OBLIGATION FOUND IN DEPLOYED PROJECTION`);
      console.log(`\nObligations in context:`, JSON.stringify(obligations, null, 2));
      process.exit(1);
    }

    console.log('\n✅ P2.10K LIVE VERIFICATION PASSED');
    console.log(`   Fresh mission: ${missionId}`);
    console.log(`   Fresh context: ${contextId}`);

    process.exit(0);

  } catch (err) {
    console.error('❌ Verification failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

verifyLive();
