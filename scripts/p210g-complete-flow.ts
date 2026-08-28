#!/usr/bin/env npx tsx
/**
 * P2.10G: DEPLOY REPAIR + MATERIALIZE FINAL CHAIN
 * 
 * 1. Deploy P2.10F migration (the authorization gate repair)
 * 2. Verify repair works
 * 3. Create ONE fresh executable mission
 * 4. Materialize complete chain
 * 5. STOP before execution
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
  console.log('║  P2.10G — FINAL EXECUTABLE CHAIN MATERIALIZATION               ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // STEP 1: Create fresh executable mission
    console.log('STEP 1: Creating fresh executable mission...\n');

    const missionRes = await db.rpc('zeya_create_operating_mission', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
      p_operation_id: generateUuid(),
      p_objective:
        'Reconnect after the prospect\'s prior callback request, use governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
      p_qualification_goal:
        'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
      p_desired_next_step:
        'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
      p_allowed_channel: 'phone',
      p_constraints: { qaOnly: true, doNotExecute: false },
      p_notes: 'P2.10G: Final executable Call-2 chain',
      p_priority: 'normal',
    });

    if (missionRes.error) throw new Error(`Mission: ${missionRes.error.message}`);
    const missionId = missionRes.data?.[0]?.mission_id;
    console.log(`✓ Mission: ${missionId}\n`);

    // STEP 2: Prepare mission
    console.log('STEP 2: Preparing mission...\n');

    const fingerprintRes = await db.rpc('zeya_p29c_prospect_memory_fingerprint', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
    });

    const sourceFingerprint = fingerprintRes.data as string;
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

    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: prospectContext,
      p_prospect_source_fingerprint: sourceFingerprint,
    });

    if (prepareRes.error) throw new Error(`Prepare: ${prepareRes.error.message}`);
    const contextId = prepareRes.data?.[0]?.context_id;
    console.log(`✓ Context: ${contextId}\n`);

    // STEP 3: Create dispatch via P2.9D RPC
    console.log('STEP 3: Creating dispatch (V3)...\n');

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

    const dispatchRes = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_operation_id: generateUuid(),
      p_worker: worker,
      p_conversation_policy: conversationPolicy,
      p_capabilities: capabilities,
      p_opening_contract: openingContract,
    });

    if (dispatchRes.error) throw new Error(`Dispatch: ${dispatchRes.error.message}`);
    const dispatchId = dispatchRes.data?.[0]?.dispatch_id;
    const briefId = dispatchRes.data?.[0]?.worker_brief_id;
    console.log(`✓ Dispatch: ${dispatchId}`);
    console.log(`✓ Brief: ${briefId}\n`);

    // STEP 4: Verify execution_allowed=true
    console.log('STEP 4: Verifying execution_allowed=true...\n');

    const dispatchCheckRes = await db
      .from('dispatches')
      .select('*')
      .eq('dispatch_id', dispatchId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const dispatch = dispatchCheckRes.data;
    if (dispatch?.execution_allowed !== true) {
      throw new Error(`execution_allowed=${dispatch?.execution_allowed}, expected true`);
    }
    console.log(`✓ dispatch.execution_allowed = true\n`);

    // STEP 5: Create authorization
    console.log('STEP 5: Creating authorization...\n');

    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
      p_operation_id: generateUuid(),
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      throw new Error(`Authorization: ${authRes.error.message}`);
    }

    const authId = authRes.data?.[0]?.authorization_id;
    console.log(`✓ Authorization: ${authId}\n`);

    // STEP 6: Verify authorization is unconsumed
    console.log('STEP 6: Verifying authorization...\n');

    const authCheckRes = await db
      .from('governed_execution_authorizations')
      .select('*')
      .eq('id', authId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const auth = authCheckRes.data;
    if (auth?.status !== 'authorized' || auth?.consumed_at !== null) {
      throw new Error(`Auth status=${auth?.status}, consumed=${auth?.consumed_at}`);
    }
    console.log(`✓ Authorization status: ${auth?.status}`);
    console.log(`✓ Authorization consumed_at: NULL\n`);

    // STEP 7: Get full brief payload
    console.log('STEP 7: Retrieving complete chain state...\n');

    const briefRes = await db
      .from('worker_briefs')
      .select('*')
      .eq('id', briefId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const briefPayload = typeof briefRes.data?.brief_payload === 'string'
      ? JSON.parse(briefRes.data.brief_payload)
      : briefRes.data?.brief_payload;

    const exactOpening = briefPayload?.openingContract?.variable || 
                        briefPayload?.opening || 
                        'opening';

    // Get mission
    const missionCheckRes = await db
      .from('operating_missions')
      .select('*')
      .eq('id', missionId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const mission = missionCheckRes.data;

    // Get context
    const contextCheckRes = await db
      .from('mission_execution_contexts')
      .select('*')
      .eq('id', contextId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const context = contextCheckRes.data;

    // Get representation
    const repRes = await db
      .from('business_representations')
      .select('*')
      .eq('id', dispatch?.business_representation_id)
      .single();

    const rep = repRes.data;

    // Get version
    const versionRes = await db
      .from('representation_versions')
      .select('*')
      .eq('id', rep?.current_version_id)
      .single();

    const version = versionRes.data;

    // Get mandate
    const mandateRes = await db
      .from('direct_hire_formation_outcome_packages')
      .select('*')
      .eq('id', dispatch?.mandate_outcome_package_id)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const mandate = mandateRes.data;

    // Get lead
    const leadRes = await db
      .from('mission_leads')
      .select('*')
      .eq('id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const lead = leadRes.data;

    // Check attempts
    const attemptsRes = await db
      .from('governed_execution_attempts')
      .select('id')
      .eq('dispatch_id', dispatchId)
      .eq('owner_id', QA_OWNER_ID);

    const attemptCount = attemptsRes.data?.length || 0;

    // Check provider calls
    const callsRes = await db
      .from('voice_conversation_outputs')
      .select('id')
      .eq('worker_brief_id', briefId)
      .eq('owner_id', QA_OWNER_ID);

    const callCount = callsRes.data?.length || 0;

    // Check observations
    const obsRes = await db
      .from('prospect_observations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const obsCount = obsRes.data?.length || 0;

    // Check relations
    const relRes = await db
      .from('prospect_observation_relations')
      .select('id')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const relCount = relRes.data?.length || 0;

    // FINAL MATERIALIZATION REPORT
    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('P2.10G — FINAL EXECUTABLE CHAIN MATERIALIZED\n');

    console.log('CHAIN IDs:\n');
    console.log(`1.  Mission ID: ${missionId}`);
    console.log(`2.  Execution Context ID: ${contextId}`);
    console.log(`3.  Worker Brief ID: ${briefId}`);
    console.log(`4.  Worker Brief Contract: ${briefPayload?.contractVersion}`);
    console.log(`5.  Dispatch ID: ${dispatchId}`);
    console.log(`6.  Dispatch Source: ${dispatch?.source}`);
    console.log(`7.  execution_allowed: ${dispatch?.execution_allowed}`);
    console.log(`8.  Authorization ID: ${authId}`);
    console.log(`9.  Authorization Status: ${auth?.status}`);
    console.log(`10. Consumed At: ${auth?.consumed_at || 'NULL'}\n`);

    console.log('GOVERNANCE STATE:\n');
    console.log(`11. Worker Identity: ${briefPayload?.worker?.spokenName}`);
    console.log(`12. Opening: ${exactOpening}`);
    console.log(`13. Relationship State: ${briefPayload?.prospect?.context?.relationshipState}`);
    console.log(`14. Capabilities: ${briefPayload?.capabilities?.schemaVersion}`);
    console.log(`15. Conversation Mode: ${briefPayload?.conversationPolicy?.mode}`);
    console.log(`16. Policy Version: ${briefPayload?.conversationPolicy?.schemaVersion}`);
    console.log(`17. Prospect Fingerprint: ${sourceFingerprint}`);
    console.log(`18. Context Fingerprint: ${context?.context_fingerprint}`);
    console.log(`19. Brief Fingerprint: ${briefRes.data?.source_fingerprint}\n`);

    console.log('CURRENTNESS:\n');
    console.log(`20. Representation Version: ${rep?.current_version_id}`);
    console.log(`21. Mandate: ${mandate?.id}`);
    console.log(`22. Lead Fingerprint: ${mission?.lead_fingerprint}\n`);

    console.log('EXECUTION STATE:\n');
    console.log(`23. Execution Attempts: ${attemptCount}`);
    console.log(`24. Provider Calls: ${callCount}`);
    console.log(`25. Prospect Observations: ${obsCount}`);
    console.log(`26. Prospect Relations: ${relCount}\n`);

    console.log('═══════════════════════════════════════════════════════════════\n');
    console.log('✓ P2.10G — FINAL EXECUTABLE CHAIN READY FOR CALL APPROVAL\n');

  } catch (err) {
    console.error('❌ Pre-call governance failure:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
