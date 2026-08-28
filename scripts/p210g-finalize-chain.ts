#!/usr/bin/env npx tsx
/**
 * P2.10G — FINALIZE EXECUTABLE CALL-2 CHAIN
 * Uses existing context and creates dispatch + authorization
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const MISSION_ID = '461f6ed0-f23c-4365-9896-4edd7242466a';
const CONTEXT_ID = '80b0458a-b13e-48d5-a413-7bf1ba57d16b';
const BUSINESS_REPR_ID = 'df5cb68f-9894-4dce-a20b-e8d3386509ab';
const REPR_VERSION_ID = '02546bd3-dd7d-488c-8a04-304d1598502f';
const MANDATE_PKG_ID = 'f7dbf7e0-4f37-4ba8-8c46-a2ba8e137328';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function finalizeChain() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing Supabase credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10G FINALIZE CHAIN ===\n');

  try {
    // Get template brief for worker/policy/capabilities config
    console.log('1. Getting template brief configuration...');
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
    const workerConfig = templatePayload.worker;
    const conversationPolicy = templatePayload.conversationPolicy;
    const capabilities = templatePayload.capabilities;
    const openingContract = templatePayload.openingContract;
    console.log(`✓ Template brief config retrieved`);

    // Update mission
    console.log('2. Updating mission...');
    const updateMissionRes = await db
      .from('operating_missions')
      .update({ 
        status: 'ready',
        business_representation_id: BUSINESS_REPR_ID,
        representation_version_id: REPR_VERSION_ID,
        mandate_outcome_package_id: MANDATE_PKG_ID,
      })
      .eq('id', MISSION_ID)
      .eq('owner_id', QA_OWNER_ID);

    if (updateMissionRes.error) {
      throw new Error(`Mission update failed: ${updateMissionRes.error.message}`);
    }
    console.log(`✓ Mission ready`);

    // Create dispatch with full worker configuration
    console.log('3. Creating dispatch...');
    const dispatchOpId = generateUuid();

    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: MISSION_ID,
      p_operation_id: dispatchOpId,
      p_worker: workerConfig,
      p_conversation_policy: conversationPolicy,
      p_capabilities: capabilities,
      p_opening_contract: openingContract,
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
    console.log(`  worker_brief_id: ${briefId}`);

    // Create authorization
    console.log('4. Creating authorization...');
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

    console.log('\n=== FINAL CHAIN ===');
    console.log(`Mission: ${MISSION_ID}`);
    console.log(`Context: ${CONTEXT_ID}`);
    console.log(`Dispatch: ${dispatchId}`);
    console.log(`Brief: ${briefId}`);
    console.log(`Auth: ${authorizationId}`);

    process.exit(0);

  } catch (err) {
    console.error('❌ Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

finalizeChain();
