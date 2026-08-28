#!/usr/bin/env npx tsx
/**
 * P2.10G — CREATE FINAL EXECUTABLE CALL-2 CHAIN (V2)
 * Simplified approach: reuse existing ready mission structure
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

  console.log('\n=== P2.10G FINAL EXECUTABLE CHAIN (V2) ===\n');

  try {
    // Use existing ready mission as template, create fresh mission from scratch
    console.log('1. Creating fresh mission...');
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
      p_constraints: { qaOnly: true, doNotExecute: false },
      p_notes: 'P2.10G: Final Call-2 ready for owner approval',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission RPC failed: ${missionRes.error.message}`);
    }

    const missionData = missionRes.data?.[0];
    const missionId = missionData?.mission_id;
    if (!missionId) throw new Error('No mission ID returned');
    console.log(`✓ Mission: ${missionId}`);

    // Query existing ready mission to get its execution context data
    console.log('2. Getting execution context template...');
    const templateRes = await db
      .from('operating_missions')
      .select(
        `id,
         business_representation_id,
         representation_version_id,
         mandate_outcome_package_id`
      )
      .eq('owner_id', QA_OWNER_ID)
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (templateRes.error || !templateRes.data) {
      throw new Error('Could not find template mission');
    }

    const template = templateRes.data;
    console.log(`✓ Using template mission data`);

    // Now manually create execution context or call prepare with minimal params
    // For now, try zeya_prepare_operating_mission_v2 with empty context
    console.log('3. Preparing mission (minimal)...');
    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: {},
      p_prospect_source_fingerprint: generateUuid().replace(/-/g, '').substring(0, 64),
    });

    if (prepareRes.error) {
      console.log(`Warning: prepare call returned error: ${prepareRes.error.message}`);
      // Try without it
    }

    const executionContextId = prepareRes.data?.[0]?.execution_context;
    if (!executionContextId) {
      // Check if context was created anyway
      const ctxRes = await db
        .from('mission_execution_contexts')
        .select('id')
        .eq('mission_id', missionId)
        .eq('owner_id', QA_OWNER_ID)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (ctxRes.data?.id) {
        console.log(`✓ Execution context found: ${ctxRes.data.id}`);
      } else {
        throw new Error('No execution context available');
      }
    } else {
      console.log(`✓ Execution context: ${executionContextId}`);
    }

    // Create dispatch
    console.log('4. Creating dispatch...');
    const dispatchOpId = generateUuid();

    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_operation_id: dispatchOpId,
    });

    if (dispatchRes.error) {
      throw new Error(`Dispatch failed: ${dispatchRes.error.message}`);
    }

    const dispatchData = dispatchRes.data?.[0];
    const dispatchId = dispatchData?.dispatch_id;
    if (!dispatchId) throw new Error('No dispatch returned');
    console.log(`✓ Dispatch: ${dispatchId}`);
    console.log(`  execution_allowed: ${dispatchData.execution_allowed}`);

    // Create authorization
    console.log('5. Creating authorization...');
    const authOpId = generateUuid();

    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
      p_operation_id: authOpId,
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      throw new Error(`Authorization failed: ${authRes.error.message}`);
    }

    const authData = authRes.data?.[0];
    const authorizationId = authData?.authorization_id;
    if (!authorizationId) throw new Error('No authorization returned');
    console.log(`✓ Authorization: ${authorizationId}`);
    console.log(`  Status: ${authData.status}`);

    console.log('\n=== COMPLETE CHAIN ===');
    console.log(`Mission ID: ${missionId}`);
    console.log(`Dispatch ID: ${dispatchId}`);
    console.log(`Authorization ID: ${authorizationId}`);

    process.exit(0);

  } catch (err) {
    console.error('❌ Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

createChain();
