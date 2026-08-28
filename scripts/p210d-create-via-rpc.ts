#!/usr/bin/env npx tsx
/**
 * P2.10D — CREATE FRESH CHAIN VIA RPC CALLS
 * Direct governance RPCs for mission → prepare → dispatch → authorize
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function createChain() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10D FRESH CHAIN VIA RPC ===\n');

  try {
    // 1. Create mission via RPC
    console.log('Creating mission via zeya_create_operating_mission...');
    const missionOpId = generateUuid();

    const missionRes = await db.rpc('zeya_create_operating_mission', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
      p_operation_id: missionOpId,
      p_objective:
        'Reconnect after the prospect\'s prior callback request, use the governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
      p_qualification_goal:
        'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
      p_desired_next_step:
        'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
      p_allowed_channel: 'phone',
      p_constraints: { qaOnly: true, doNotExecute: true },
      p_notes: 'P2.10D: Fresh Call-2 for owner approval',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission RPC failed: ${missionRes.error.message}`);
    }

    const missionData = missionRes.data?.[0];
    if (!missionData?.mission_id) {
      throw new Error('Mission RPC returned no ID');
    }

    const missionId = missionData.mission_id;
    console.log(`✓ Mission created: ${missionId}`);

    // 2. Get the lead's prospect context (required for preparation)
    console.log('Retrieving prospect context...');
    const prospectCtxRes = await db
      .from('prospect_contexts')
      .select('*')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (prospectCtxRes.error || !prospectCtxRes.data) {
      throw new Error('No prospect context found');
    }

    const prospectCtx = prospectCtxRes.data;
    const contextData = typeof prospectCtx.context === 'string'
      ? JSON.parse(prospectCtx.context)
      : prospectCtx.context || {};

    console.log(`✓ Prospect context found: ${prospectCtx.id}`);

    // 3. Prepare mission via RPC
    console.log('Preparing mission via zeya_prepare_operating_mission_v2...');
    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: contextData,
      p_prospect_source_fingerprint: prospectCtx.source_fingerprint || generateUuid().replace(/-/g, '').substring(0, 64),
    });

    if (prepareRes.error) {
      throw new Error(`Preparation RPC failed: ${prepareRes.error.message}`);
    }

    const prepareData = prepareRes.data?.[0];
    if (!prepareData) {
      throw new Error('Preparation RPC returned no data');
    }

    console.log(`✓ Mission prepared: status = ${prepareData.status}`);
    const executionContextId = prepareData.execution_context;
    console.log(`  Execution context: ${executionContextId}`);

    // 4. Create dispatch via RPC
    console.log('Creating dispatch via zeya_prepare_governed_dispatch_v3...');
    const dispatchOpId = generateUuid();

    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_operation_id: dispatchOpId,
    });

    if (dispatchRes.error) {
      throw new Error(`Dispatch RPC failed: ${dispatchRes.error.message}`);
    }

    const dispatchData = dispatchRes.data?.[0];
    if (!dispatchData?.dispatch_id) {
      throw new Error('Dispatch RPC returned no ID');
    }

    const dispatchId = dispatchData.dispatch_id;
    console.log(`✓ Dispatch created: ${dispatchId}`);
    console.log(`  Status: ${dispatchData.status}`);
    console.log(`  Execution allowed: ${dispatchData.execution_allowed}`);

    // 5. Authorize dispatch via RPC
    console.log('Creating authorization via zeya_authorize_governed_execution...');
    const authOpId = generateUuid();

    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
      p_operation_id: authOpId,
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      throw new Error(`Authorization RPC failed: ${authRes.error.message}`);
    }

    const authData = authRes.data?.[0];
    if (!authData?.id) {
      throw new Error('Authorization RPC returned no ID');
    }

    const authorizationId = authData.id;
    console.log(`✓ Authorization created: ${authorizationId}`);
    console.log(`  Status: ${authData.status}`);
    console.log(`  Consumed: ${authData.consumed_at ? 'YES' : 'NO'}`);

    console.log('\n✅ Fresh P2.10D chain created successfully\n');
    console.log('Chain IDs:');
    console.log(`  Mission ID: ${missionId}`);
    console.log(`  Execution Context ID: ${executionContextId}`);
    console.log(`  Dispatch ID: ${dispatchId}`);
    console.log(`  Authorization ID: ${authorizationId}`);

  } catch (err) {
    console.error('❌ Chain creation failed:', err instanceof Error ? err.message : 'unknown');
    console.error('Stack:', err instanceof Error ? err.stack : '');
    process.exit(1);
  }
}

createChain();
