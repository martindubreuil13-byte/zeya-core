#!/usr/bin/env npx tsx

import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const QA_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

async function main() {
  console.log('================================================================================');
  console.log('P2.10O — FRESH MISSION CHAIN CREATION (Current Lead Data Frozen)');
  console.log('================================================================================\n');

  // Create fresh mission
  console.log('[1] Creating fresh mission...');
  const missionRes = await db.rpc('zeya_create_operating_mission', {
    p_owner_id: QA_OWNER_ID,
    p_lead_id: QA_LEAD_ID,
    p_operation_id: randomUUID(),
    p_objective: 'Reconnect after prior callback request, verify fit, determine next step.',
    p_qualification_goal: 'Determine material fit and appropriate commercial next step.',
    p_desired_next_step: 'If qualified, recommend appropriate next conversation.',
    p_allowed_channel: 'phone',
    p_constraints: JSON.stringify({ qaOnly: true, doNotExecute: false }),
    p_notes: null,
    p_priority: 'normal',
  });

  if (missionRes.error) {
    console.error(`❌ Mission creation failed: ${missionRes.error.message}`);
    process.exit(1);
  }

  const missionId = missionRes.data[0]?.mission_id;
  console.log(`  ✓ Mission created: ${missionId}`);

  // Get prospect context first
  console.log('\n[1b] Loading prospect context...');
  const contextDataRes = await db.rpc('zeya_p29c_get_prospect_context', {
    p_owner_id: QA_OWNER_ID,
    p_lead_id: QA_LEAD_ID,
  });

  if (contextDataRes.error) {
    console.error(`❌ Context load failed: ${contextDataRes.error.message}`);
    process.exit(1);
  }

  const prospectContext = contextDataRes.data;
  const fingerprint = contextDataRes.fingerprint || '73d4944a7ee1b7f14dcfa282c9102f9d0cbd9d543c54d125450e47b417b38220';

  // Prepare mission (calls getProspectContext internally)
  console.log('\n[2] Preparing mission (will freeze prospect context)...');
  const prepRes = await db.rpc('zeya_prepare_operating_mission_v2', {
    p_owner_id: QA_OWNER_ID,
    p_mission_id: missionId,
    p_prospect_context: prospectContext,
    p_prospect_source_fingerprint: fingerprint,
  });

  if (prepRes.error) {
    console.error(`❌ Preparation failed: ${prepRes.error.message}`);
    process.exit(1);
  }

  const contextId = prepRes.data[0]?.context_id;
  const executionContext = prepRes.data[0]?.execution_context;

  console.log(`  ✓ Mission prepared: ${contextId}`);
  console.log(`  ✓ Frozen context.target.contactName: ${executionContext?.target?.contactName ?? '(NULL)'}`);
  console.log(`  ✓ relationshipState: ${executionContext?.prospectContext?.relationshipState}`);

  // Verify callback obligations
  console.log('\n[3] Verifying callback obligation in frozen context...');
  const prospectCtx = executionContext?.prospectContext;
  const obligations = prospectCtx?.obligations || [];
  const callbacks = obligations.filter((o: any) => o.kind === 'callback');
  console.log(`  ✓ Callback obligations: ${callbacks.length}`);
  callbacks.forEach((cb: any, i: number) => {
    console.log(`    ${i + 1}. "${cb.summary}"`);
  });

  // Create dispatch (will generate opening)
  console.log('\n[4] Creating dispatch (generates opening)...');
  const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
    p_owner_id: QA_OWNER_ID,
    p_mission_id: missionId,
    p_operation_id: randomUUID(),
    p_worker: {
      schemaVersion: 'dispatched-worker-identity-v1',
      workerRole: 'outbound_business_development_caller',
      provider: 'elevenlabs',
      spokenName: 'Veya',
      providerAgentIdentity: 'agent_9401ks7h7k14ev9a7t9rtsgbwkm3',
      providerBranchIdentity: 'agtbrch_0201ks7h7m0xfwj8kp1vgbay1q0n',
    },
    p_conversation_policy: { schemaVersion: 'commercial-conversation-policy-v1', role: 'business_representative' },
    p_capabilities: { schemaVersion: 'governed-commercial-capabilities-v1', scheduling: false, email: false, reminders: false },
    p_opening_contract: { schemaVersion: 'governed-commercial-opening-v1', owner: 'provider_first_message', variable: 'opening', introductionAlreadySpoken: true },
  });

  if (dispatchRes.error) {
    console.error(`❌ Dispatch creation failed: ${dispatchRes.error.message}`);
    process.exit(1);
  }

  const dispatchId = dispatchRes.data[0]?.dispatch_id;
  const workerBriefId = dispatchRes.data[0]?.worker_brief_id;
  const executionAllowed = dispatchRes.data[0]?.execution_allowed;

  console.log(`  ✓ Dispatch created: ${dispatchId}`);
  console.log(`  ✓ Worker Brief: ${workerBriefId}`);
  console.log(`  ✓ execution_allowed: ${executionAllowed}`);

  // Load worker brief to extract opening
  console.log('\n[5] Inspecting worker brief...');
  const briefRes = await db
    .from('worker_briefs')
    .select('brief_payload, target_name')
    .eq('id', workerBriefId)
    .single();

  if (briefRes.error) {
    console.error(`❌ Brief load failed: ${briefRes.error.message}`);
    process.exit(1);
  }

  const briefPayload = briefRes.data.brief_payload as Record<string, any>;
  const targetName = briefRes.data.target_name;
  const dynamicVariables = briefPayload?.dynamicVariables || {};
  const opening = dynamicVariables.opening || 'NOT FOUND';

  console.log(`  brief_payload.prospect.identity.contactName: ${briefPayload?.prospect?.identity?.contactName ?? '(NULL)'}`);
  console.log(`  brief_payload.prospect.identity.companyName: ${briefPayload?.prospect?.identity?.companyName ?? '(NULL)'}`);
  console.log(`  worker_briefs.target_name: ${targetName ?? '(NULL)'}`);
  console.log(`  dynamicVariables.opening: "${opening}"`);

  // Create authorization
  console.log('\n[6] Creating authorization...');
  const authRes = await db.rpc('zeya_authorize_governed_execution', {
    p_owner_id: QA_OWNER_ID,
    p_dispatch_id: dispatchId,
    p_operation_id: randomUUID(),
    p_purpose: 'controlled_preview_voice_qa',
  });

  if (authRes.error) {
    console.error(`❌ Authorization failed: ${authRes.error.message}`);
    process.exit(1);
  }

  const authorizationId = authRes.data[0]?.authorization_id;
  console.log(`  ✓ Authorization created: ${authorizationId}`);
  console.log(`  ✓ Status: ${authRes.data[0]?.status}`);

  console.log('\n================================================================================');
  console.log('P2.10O — FRESH CHAIN COMPLETE');
  console.log('================================================================================');
  console.log(`Mission:                    ${missionId}`);
  console.log(`Context:                    ${contextId}`);
  console.log(`Dispatch:                   ${dispatchId}`);
  console.log(`Worker Brief:               ${workerBriefId}`);
  console.log(`Authorization:              ${authorizationId}`);
  console.log(`\nFrozen Target contactName:  ${executionContext?.target?.contactName}`);
  console.log(`Relationship State:         ${prospectCtx?.relationshipState}`);
  console.log(`Callback Obligations:       ${callbacks.length}`);
  console.log(`Opening:                    ${opening}`);
  console.log(`\nSTOP BEFORE /execute`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
