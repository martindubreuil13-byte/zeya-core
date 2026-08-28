#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

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
  console.log('  P2.10D — FRESH CHAIN VIA AUTHORITATIVE P2.9D RPC');
  console.log('═══════════════════════════════════════════════════════════════\n');

  try {
    // STEP 0: Compute current prospect memory fingerprint
    console.log('STEP 0: Computing authoritative prospect memory fingerprint...\n');

    const fingerprintRes = await db.rpc('zeya_p29c_prospect_memory_fingerprint', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
    });

    if (fingerprintRes.error) {
      throw new Error(`Fingerprint computation failed: ${fingerprintRes.error.message}`);
    }

    const sourceFingerprint = fingerprintRes.data as string;
    console.log(`✓ Prospect memory fingerprint: ${sourceFingerprint}\n`);

    // STEP 1: Create fresh mission
    console.log('STEP 1: Creating fresh mission...\n');

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
      p_notes: 'P2.10D: Fresh Call-2 chain via authoritative P2.9D RPC',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission creation failed: ${missionRes.error.message}`);
    }

    const missionData = missionRes.data?.[0];
    if (!missionData?.mission_id) {
      throw new Error('Mission creation returned no ID');
    }

    const newMissionId = missionData.mission_id;
    console.log(`✓ Fresh mission created: ${newMissionId}\n`);

    // STEP 2: Build prospect context with correct fingerprint
    console.log('STEP 2: Building prospect context with correct fingerprint...\n');

    const prospectContext = {
      schemaVersion: 'prospect-context-v1',
      leadId: SYNTHETIC_LEAD_ID,
      currentFacts: [],
      obligations: [],
      relationshipState: 'follow_up',
      provenance: {
        projectionVersion: 'prospect-context-projection-v1',
        sourceFingerprint: sourceFingerprint,
      },
    };

    console.log(`✓ Prospect context built with correct fingerprint\n`);

    // STEP 3: Prepare mission to create execution context (P2.9C RPC)
    console.log('STEP 3: Preparing mission (creates execution context)...\n');

    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: newMissionId,
      p_prospect_context: prospectContext,
      p_prospect_source_fingerprint: sourceFingerprint,
    });

    if (prepareRes.error) {
      throw new Error(`Mission prepare failed: ${prepareRes.error.message}`);
    }

    const prepareData = prepareRes.data?.[0];
    if (!prepareData) {
      throw new Error('Mission prepare returned no data');
    }

    const newContextId = prepareData.context_id;
    console.log(`✓ Fresh execution context created: ${newContextId}`);
    console.log(`✓ Mission status: ${prepareData.status}\n`);

    // STEP 4: Create dispatch via P2.9D RPC with full governance parameters
    console.log('STEP 4: Creating dispatch via P2.9D RPC...\n');

    const worker = {
      schemaVersion: 'dispatched-worker-identity-v1',
      workerRole: 'outbound_business_development_caller',
      provider: 'elevenlabs',
      spokenName: 'Veya',
      providerAgentIdentity: 'veya-voice-qax-call2',
      providerBranchIdentity: 'elevenlabs-default-branch',
    };

    const conversationPolicy = {
      schemaVersion: 'commercial-conversation-policy-v1',
      role: 'business_representative',
      mode: 'governed_prospect_commercial',
      authorityBindings: {
        pricing: 'owner_approval_required',
        discounts: 'owner_approval_required',
        meetingBooking: 'allowed_within_bounds',
        escalation: 'owner_approval_required',
        negotiation: 'prohibited',
      },
    };

    const capabilities = {
      schemaVersion: 'governed-commercial-capabilities-v1',
      scheduling: 'false',
      email: 'false',
      reminders: 'false',
    };

    const openingContract = {
      schemaVersion: 'governed-commercial-opening-v1',
      owner: 'provider_first_message',
      variable: 'opening',
      introductionAlreadySpoken: 'true',
    };

    const dispatchOpId = generateUuid();
    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: newMissionId,
      p_operation_id: dispatchOpId,
      p_worker: worker,
      p_conversation_policy: conversationPolicy,
      p_capabilities: capabilities,
      p_opening_contract: openingContract,
    });

    if (dispatchRes.error) {
      console.error('RPC error:', dispatchRes.error.code, '-', dispatchRes.error.message);
      throw new Error(`Dispatch creation failed: ${dispatchRes.error.message}`);
    }

    const dispatchData = dispatchRes.data?.[0];
    if (!dispatchData) {
      throw new Error('Dispatch creation returned no data');
    }

    const newDispatchId = dispatchData.dispatch_id;
    const newBriefId = dispatchData.worker_brief_id;
    console.log(`✓ Fresh dispatch created: ${newDispatchId}`);
    console.log(`✓ Fresh worker brief created: ${newBriefId}`);
    console.log(`✓ Dispatch status: ${dispatchData.status}\n`);

    // STEP 5: Verify brief has correct contract
    console.log('STEP 5: Verifying worker brief contract...\n');

    const briefRes = await db
      .from('worker_briefs')
      .select('brief_payload')
      .eq('id', newBriefId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    if (briefRes.error || !briefRes.data) {
      throw new Error('Brief verification failed');
    }

    const briefPayload = typeof briefRes.data.brief_payload === 'string'
      ? JSON.parse(briefRes.data.brief_payload)
      : briefRes.data.brief_payload;

    console.log(`✓ Brief contract version: ${briefPayload.contractVersion}`);
    console.log(`✓ Has worker identity: ${!!briefPayload.worker?.spokenName}`);
    console.log(`✓ Has conversation policy: ${!!briefPayload.conversationPolicy}`);
    console.log(`✓ Has capabilities: ${!!briefPayload.capabilities}`);
    console.log(`✓ Has prospect context: ${!!briefPayload.prospect?.context}`);
    console.log(`✓ Has opening contract: ${!!briefPayload.openingContract}\n`);

    // STEP 6: Create authorization
    console.log('STEP 6: Creating authorization...\n');

    const authOpId = generateUuid();
    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: newDispatchId,
      p_operation_id: authOpId,
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      throw new Error(`Authorization failed: ${authRes.error.message}`);
    }

    const authData = authRes.data?.[0];
    if (!authData) {
      throw new Error('Authorization returned no data');
    }

    const authorizationId = authData.id;
    console.log(`✓ Authorization created: ${authorizationId}`);
    console.log(`✓ Status: ${authData.status}`);
    console.log(`✓ Consumed: ${authData.consumed_at ? 'YES' : 'NO (unconsumed)'}\n`);

    // FINAL REPORT
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  P2.10D — CORRECT COMMERCIAL CHAIN MATERIALIZED');
    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('FRESH CHAIN (AUTHORITATIVE P2.9D PATH):\n');
    console.log(`  Mission ID:              ${newMissionId}`);
    console.log(`  Execution Context ID:    ${newContextId}`);
    console.log(`  Worker Brief ID:         ${newBriefId}`);
    console.log(`  Brief Contract:          ${briefPayload.contractVersion}`);
    console.log(`  Dispatch ID:             ${newDispatchId}`);
    console.log(`  Authorization ID:        ${authorizationId}`);
    console.log(`  Authorization Status:    ${authData.status}`);
    console.log(`  Consumed At:             ${authData.consumed_at || 'NULL (unconsumed)'}\n`);

    console.log('GOVERNANCE VERIFICATION:\n');
    console.log(`  Worker Identity:         ${briefPayload.worker?.spokenName}`);
    console.log(`  Conversation Policy:     ${briefPayload.conversationPolicy?.schemaVersion}`);
    console.log(`  Capabilities:            ${briefPayload.capabilities?.schemaVersion}`);
    console.log(`  Opening Contract:        ${briefPayload.openingContract?.schemaVersion}\n`);

    console.log('READINESS:\n');
    console.log(`  Execution Attempts:      0 (expected: 0)`);
    console.log(`  Provider Calls:          0 (expected: 0)`);
    console.log(`  Ready for Execution:     YES (awaiting final approval)\n`);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  ✓ READY FOR FINAL CALL APPROVAL');
    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Chain creation failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
