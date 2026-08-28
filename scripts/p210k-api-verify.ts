#!/usr/bin/env npx tsx
/**
 * P2.10K API VERIFICATION
 * Call deployed Next.js /api/work/missions/{missionId}/prepare
 * This triggers getProspectContext() with P2.10K fix
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const PREVIEW_URL = process.env.PREVIEW_BASE_URL || 'https://zeya-core-wh6u-full-cycle-backend-integration-martindubreuil13-bytes-projects.vercel.app';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function verifyViaAPI() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10K API VERIFICATION ===\n');
  console.log(`Preview URL: ${PREVIEW_URL}`);

  try {
    // 1. Create ONE fresh draft mission
    console.log('1. Creating fresh draft mission...');
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
      p_notes: 'P2.10K: API path verification',
      p_priority: 'normal',
    });

    if (missionRes.error) throw new Error(`Mission failed: ${missionRes.error.message}`);
    const missionId = missionRes.data?.[0]?.mission_id;
    if (!missionId) throw new Error('No mission ID');
    console.log(`✓ Mission (draft): ${missionId}`);

    // 2. Call deployed API endpoint to prepare mission
    console.log(`2. Calling deployed API: POST /api/work/missions/${missionId}/prepare`);
    console.log(`   This triggers getProspectContext() with P2.10K fix...`);
    
    const prepareRes = await fetch(`${PREVIEW_URL}/api/work/missions/${missionId}/prepare`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`,
      },
      body: JSON.stringify({
        operationId: generateUuid(),
      }),
    });

    if (!prepareRes.ok) {
      const errText = await prepareRes.text();
      throw new Error(`API failed ${prepareRes.status}: ${errText}`);
    }

    const prepareData = await prepareRes.json() as any;
    console.log(`✓ API returned status: ${prepareData.status || 'ok'}`);

    // 3. Read the persisted Execution Context to verify callback obligation
    console.log('3. Verifying persisted Execution Context V2...');
    const ctxRes = await db
      .from('mission_execution_contexts')
      .select('context')
      .eq('mission_id', missionId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    if (ctxRes.error || !ctxRes.data) throw new Error('Cannot read context');
    
    const context = ctxRes.data.context as any;
    const prospectCtx = context.prospectContext || {};
    const obligations = prospectCtx.obligations || [];
    
    console.log(`\n✓ ProspectContextV1:`);
    console.log(`  - relationshipState: ${prospectCtx.relationshipState}`);
    console.log(`  - obligations.length: ${obligations.length}`);
    
    const callbackOb = obligations.find((o: any) => o.kind === 'callback');
    if (!callbackOb) {
      console.error(`\n✗ CALLBACK OBLIGATION NOT FOUND IN API-PREPARED CONTEXT`);
      console.log(`\nObligations in persisted context:`, JSON.stringify(obligations, null, 2));
      console.log(`\nFull prospectContext:`, JSON.stringify(prospectCtx, null, 2));
      process.exit(1);
    }

    console.log(`\n✓ Callback Obligation Found:`);
    console.log(`  - kind: ${callbackOb.kind}`);
    console.log(`  - status: ${callbackOb.status}`);
    console.log(`  - requestedByProspect: ${callbackOb.requestedByProspect}`);
    console.log(`  - scheduled: ${callbackOb.scheduled}`);
    console.log(`  - dueAt: ${callbackOb.dueAt}`);
    console.log(`  - summary: "${callbackOb.summary}"`);

    console.log('\n✅ P2.10K API PATH VERIFICATION PASSED');
    console.log(`   Mission: ${missionId}`);
    console.log(`   Callback obligation confirmed in frozen context`);

    process.exit(0);

  } catch (err) {
    console.error('❌ API verification failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

verifyViaAPI();
