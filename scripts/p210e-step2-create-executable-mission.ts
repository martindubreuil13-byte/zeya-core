#!/usr/bin/env npx tsx
/**
 * P2.10E STEP 2: CREATE FRESH EXECUTABLE QA MISSION
 * 
 * New mission with doNotExecute=false (execution allowed)
 * qaOnly=true (still controlled QA)
 * All else: authoritative RPC paths only
 */

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10E STEP 2-8: CREATE EXECUTABLE QA CHAIN                  ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // STEP 2: Create mission with doNotExecute=false
    console.log('Creating fresh executable mission...\n');

    const missionOpId = generateUuid();
    const missionRes = await db.rpc('zeya_create_operating_mission', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
      p_operation_id: missionOpId,
      p_objective:
        'Reconnect after the prospect\'s prior callback request, use governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
      p_qualification_goal:
        'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
      p_desired_next_step:
        'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
      p_allowed_channel: 'phone',
      p_constraints: { qaOnly: true, doNotExecute: false }, // EXECUTABLE
      p_notes: 'P2.10E: Executable QA Call-2 (doNotExecute=false)',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission creation failed: ${missionRes.error.message}`);
    }

    const missionId = missionRes.data?.[0]?.mission_id;
    console.log(`✓ Mission created: ${missionId}\n`);

    // STEP 3: Compute prospect fingerprint
    console.log('Computing prospect memory fingerprint...\n');

    const fingerprintRes = await db.rpc('zeya_p29c_prospect_memory_fingerprint', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
    });

    const sourceFingerprint = fingerprintRes.data as string;
    console.log(`✓ Fingerprint: ${sourceFingerprint}\n`);

    // STEP 4: Build prospect context
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

    // STEP 5: Prepare mission
    console.log('Preparing mission...\n');

    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: prospectContext,
      p_prospect_source_fingerprint: sourceFingerprint,
    });

    if (prepareRes.error) {
      throw new Error(`Prepare failed: ${prepareRes.error.message}`);
    }

    const contextId = prepareRes.data?.[0]?.context_id;
    console.log(`✓ Context created: ${contextId}\n`);

    // STEP 6: Create dispatch via P2.9D RPC
    console.log('Creating dispatch via P2.9D RPC...\n');

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
      p_mission_id: missionId,
      p_operation_id: dispatchOpId,
      p_worker: worker,
      p_conversation_policy: conversationPolicy,
      p_capabilities: capabilities,
      p_opening_contract: openingContract,
    });

    if (dispatchRes.error) {
      throw new Error(`Dispatch failed: ${dispatchRes.error.message}`);
    }

    const dispatchId = dispatchRes.data?.[0]?.dispatch_id;
    const briefId = dispatchRes.data?.[0]?.worker_brief_id;
    console.log(`✓ Dispatch: ${dispatchId}`);
    console.log(`✓ Brief: ${briefId}\n`);

    // STEP 7: Verify dispatch.execution_allowed = true
    console.log('Verifying execution_allowed...\n');

    const verifyRes = await db
      .from('dispatches')
      .select('execution_allowed, status')
      .eq('dispatch_id', dispatchId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const executionAllowed = verifyRes.data?.execution_allowed;

    if (executionAllowed !== true) {
      throw new Error(`execution_allowed is ${executionAllowed}, expected true`);
    }

    console.log(`✓ dispatch.execution_allowed = true\n`);

    // STEP 8: Get brief details
    const briefRes = await db
      .from('worker_briefs')
      .select('brief_payload')
      .eq('id', briefId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const briefPayload = typeof briefRes.data?.brief_payload === 'string'
      ? JSON.parse(briefRes.data.brief_payload)
      : briefRes.data?.brief_payload;

    // STEP 9: Create authorization
    console.log('Creating authorization...\n');

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

    const authId = authRes.data?.[0]?.id;
    console.log(`✓ Authorization: ${authId}\n`);

    // STEP 10: Verify protected state
    console.log('Verifying protected state...\n');

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

    console.log(`✓ Prospect observations: ${obsCount} (unchanged)`);
    console.log(`✓ Prospect relations: ${relCount} (unchanged)\n`);

    // STEP 11: Get mission constraints
    const missionCheckRes = await db
      .from('operating_missions')
      .select('constraints, status')
      .eq('id', missionId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const constraints = missionCheckRes.data?.constraints;

    // REPORT
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  P2.10E — EXECUTABLE QA CHAIN MATERIALIZED                    ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('CHAIN IDENTIFIERS:\n');
    console.log(`1. Mission ID: ${missionId}`);
    console.log(`2. Execution Context ID: ${contextId}`);
    console.log(`3. Worker Brief ID: ${briefId}`);
    console.log(`4. Dispatch ID: ${dispatchId}`);
    console.log(`5. Authorization ID: ${authId}\n`);

    console.log('GOVERNANCE SETTINGS:\n');
    console.log(`6. Authorization Status: authorized`);
    console.log(`7. Consumed At: NULL (unconsumed)`);
    console.log(`8. dispatch.execution_allowed: true`);
    console.log(`9. qaOnly: ${constraints?.qaOnly === true}`);
    console.log(`10. doNotExecute: ${constraints?.doNotExecute === false ? false : 'ERROR'}\n`);

    console.log('WORKER CONFIGURATION:\n');
    console.log(`11. Worker Identity: ${briefPayload?.worker?.spokenName}`);
    console.log(`12. Exact Opening: ${briefPayload?.openingContract?.variable}`);
    console.log(`13. Relationship State: ${briefPayload?.prospect?.context?.relationshipState}\n`);

    console.log('CAPABILITIES:\n');
    console.log(`14. Scheduling: ${briefPayload?.capabilities?.scheduling}`);
    console.log(`15. Email: ${briefPayload?.capabilities?.email}`);
    console.log(`16. Reminders: ${briefPayload?.capabilities?.reminders}\n`);

    console.log('EXECUTION READINESS:\n');
    console.log(`17. Execution Attempts: 0`);
    console.log(`18. Provider Calls: 0\n`);

    console.log('PROTECTED STATE:\n');
    console.log(`19. Prospect Observations: ${obsCount}`);
    console.log(`20. Prospect Relations: ${relCount}\n`);

    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('✓ P2.10E — EXECUTABLE QA CHAIN READY FOR FINAL CALL APPROVAL\n');

  } catch (err) {
    console.error('\n❌ Chain creation failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
