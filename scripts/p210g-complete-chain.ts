#!/usr/bin/env npx tsx
/**
 * P2.10G — COMPLETE FRESH CHAIN CREATION
 * Creates mission → context → dispatch → authorization
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const PROSPECT_SOURCE_FP = '73d4944a7ee1b7f14dcfa282c9102f9d0cbd9d543c54d125450e47b417b38220';

// Template prospect context from the existing mission
const PROSPECT_CONTEXT = {
  "schemaVersion": "prospect-context-v1",
  "leadId": SYNTHETIC_LEAD_ID,
  "provenance": {
    "projectionVersion": "prospect-context-projection-v1",
    "sourceFingerprint": PROSPECT_SOURCE_FP
  },
  "obligations": [],
  "currentFacts": [],
  "relationshipState": "follow_up"
};

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

  console.log('\n=== P2.10G CREATE FRESH CHAIN ===\n');

  try {
    // 1. Create mission
    console.log('1. Creating mission...');
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
      p_notes: 'P2.10G: Final executable Call-2 chain',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission RPC failed: ${missionRes.error.message}`);
    }

    const missionData = missionRes.data?.[0];
    const missionId = missionData?.mission_id;
    if (!missionId) throw new Error('No mission ID returned');
    console.log(`✓ Mission: ${missionId}`);

    // 2. Prepare mission with prospect context
    console.log('2. Preparing mission...');
    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: PROSPECT_CONTEXT,
      p_prospect_source_fingerprint: PROSPECT_SOURCE_FP,
    });

    if (prepareRes.error) {
      throw new Error(`Prepare failed: ${prepareRes.error.message}`);
    }

    const prepareData = prepareRes.data?.[0];
    const contextId = prepareData?.context_id;
    if (!contextId) throw new Error('No context ID returned');
    console.log(`✓ Context: ${contextId}`);

    // 3. Get template brief config
    console.log('3. Getting dispatch configuration...');
    const templateBriefRes = await db
      .from('worker_briefs')
      .select('brief_payload')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (templateBriefRes.error || !templateBriefRes.data) {
      throw new Error('Could not get template brief');
    }

    const templatePayload = templateBriefRes.data.brief_payload as any;
    console.log(`✓ Configuration retrieved`);

    // 4. Create dispatch
    console.log('4. Creating dispatch...');
    const dispatchOpId = generateUuid();

    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_operation_id: dispatchOpId,
      p_worker: templatePayload.worker,
      p_conversation_policy: templatePayload.conversationPolicy,
      p_capabilities: templatePayload.capabilities,
      p_opening_contract: templatePayload.openingContract,
    });

    if (dispatchRes.error) {
      throw new Error(`Dispatch failed: ${dispatchRes.error.message}`);
    }

    const dispatchData = dispatchRes.data?.[0];
    const dispatchId = dispatchData?.dispatch_id;
    const briefId = dispatchData?.worker_brief_id;
    if (!dispatchId) throw new Error('No dispatch ID returned');
    console.log(`✓ Dispatch: ${dispatchId}`);
    console.log(`  execution_allowed: ${dispatchData.execution_allowed}`);
    console.log(`  Brief: ${briefId}`);

    // 5. Create authorization
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
    if (!authorizationId) throw new Error('No authorization ID returned');
    console.log(`✓ Authorization: ${authorizationId}`);
    console.log(`  Status: ${authData.status}`);
    console.log(`  Consumed: ${authData.consumed_at ? 'YES' : 'NO'}`);

    console.log('\n=== P2.10G FINAL CHAIN ===');
    console.log(`Mission:      ${missionId}`);
    console.log(`Context:      ${contextId}`);
    console.log(`Dispatch:     ${dispatchId}`);
    console.log(`Brief:        ${briefId}`);
    console.log(`Authorization: ${authorizationId}`);

    process.exit(0);

  } catch (err) {
    console.error('❌ Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

createChain();
