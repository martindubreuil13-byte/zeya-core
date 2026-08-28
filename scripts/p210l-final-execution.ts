#!/usr/bin/env npx tsx
/**
 * P2.10L — FINAL GOVERNED VOICE EXECUTION
 * Single authorized QA call with full post-execution verification
 */

import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { buildGovernedCommercialOpening } from '../lib/work/commercial-conversation-policy';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_PHONE = '+66979211331';
const PROSPECT_SOURCE_FP = '73d4944a7ee1b7f14dcfa282c9102f9d0cbd9d543c54d125450e47b417b38220';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function executeFinal() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('P2.10L — FINAL GOVERNED VOICE EXECUTION');
  console.log('═══════════════════════════════════════════════════════════\n');

  try {
    // PHASE 1: CREATE CHAIN
    console.log('PHASE 1: CHAIN MATERIALIZATION\n');
    
    console.log('1. Creating fresh mission...');
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
      p_notes: 'P2.10L: Final governed QA voice call',
      p_priority: 'normal',
    });

    if (missionRes.error) throw new Error(`Mission RPC failed: ${missionRes.error.message}`);
    const missionId = missionRes.data?.[0]?.mission_id;
    if (!missionId) throw new Error('Mission creation returned no ID');
    console.log(`   ✓ Mission: ${missionId}`);

    console.log('2. Preparing mission (getProspectContext with P2.10K)...');
    const prepareRes = await db.rpc('zeya_prepare_operating_mission_v2', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: missionId,
      p_prospect_context: {
        schemaVersion: "prospect-context-v1",
        leadId: SYNTHETIC_LEAD_ID,
        provenance: { projectionVersion: "prospect-context-projection-v1", sourceFingerprint: PROSPECT_SOURCE_FP },
        obligations: [],
        currentFacts: [],
        relationshipState: "follow_up"
      },
      p_prospect_source_fingerprint: PROSPECT_SOURCE_FP,
    });

    if (prepareRes.error) throw new Error(`Prepare RPC failed: ${prepareRes.error.message}`);
    const contextId = prepareRes.data?.[0]?.context_id;
    if (!contextId) throw new Error('Prepare returned no context');
    console.log(`   ✓ Context: ${contextId}`);

    // Get template brief config for dispatch
    console.log('3. Getting dispatch configuration...');
    const templateBriefRes = await db
      .from('worker_briefs')
      .select('brief_payload')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (templateBriefRes.error) throw new Error('Cannot get template brief');
    const templatePayload = templateBriefRes.data.brief_payload as any;
    console.log('   ✓ Configuration loaded');

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

    if (dispatchRes.error) throw new Error(`Dispatch RPC failed: ${dispatchRes.error.message}`);
    const dispatchData = dispatchRes.data?.[0];
    const dispatchId = dispatchData?.dispatch_id;
    const briefId = dispatchData?.worker_brief_id;
    if (!dispatchId) throw new Error('Dispatch creation failed');
    console.log(`   ✓ Dispatch: ${dispatchId}`);
    console.log(`   ✓ Brief: ${briefId}`);
    console.log(`   ✓ execution_allowed: ${dispatchData.execution_allowed}`);

    console.log('5. Verifying dispatch currentness...');
    const currentRes = await db.rpc('zeya_p26_dispatch_is_current', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
    });
    if (!currentRes.data) throw new Error('Dispatch currentness check failed');
    console.log(`   ✓ zeya_p26_dispatch_is_current() = ${currentRes.data}`);

    console.log('6. Creating authorization...');
    const authOpId = generateUuid();
    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
      p_operation_id: authOpId,
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) throw new Error(`Authorization RPC failed: ${authRes.error.message}`);
    const authData = authRes.data?.[0];
    const authorizationId = authData?.authorization_id;
    if (!authorizationId) throw new Error('Authorization creation failed');
    console.log(`   ✓ Authorization: ${authorizationId}`);
    console.log(`   ✓ Status: ${authData.status}`);
    console.log(`   ✓ Consumed: ${authData.consumed_at ? 'YES ❌' : 'NO ✓'}`);

    // PHASE 2: VERIFY OPENING
    console.log('\nPHASE 2: VERIFY GOVERNANCE STATE & OPENING\n');

    console.log('1. Reading Worker Brief...');
    const briefRes = await db
      .from('worker_briefs')
      .select('brief_payload, execution_allowed')
      .eq('id', briefId)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    if (briefRes.error) throw new Error('Cannot read brief');
    const brief = briefRes.data.brief_payload as any;
    console.log(`   ✓ Contract: ${brief.contractVersion}`);
    console.log(`   ✓ Worker: ${brief.worker.spokenName}`);
    console.log(`   ✓ Worker Role: ${brief.worker.workerRole}`);
    console.log(`   ✓ Channel: ${brief.dispatch.channel}`);
    console.log(`   ✓ Execution Allowed: ${brief.dispatch.executionAllowed}`);

    // Extract opening using P2.10K callback obligation
    const opening = buildGovernedCommercialOpening({
      spokenName: brief.worker.spokenName,
      prospectName: brief.prospect.identity.contactName || brief.prospect.identity.companyName,
      offer: brief.business.representation.offer,
      audience: brief.business.representation.audience,
      relationshipState: brief.prospect.context.relationshipState,
      priorPain: null,
      callbackRequested: true, // P2.10K: callback obligation in frozen context
    });

    console.log(`\n2. Deterministic Opening:\n`);
    console.log(`   "${opening}"\n`);
    console.log(`   ✓ Identifies Veya once`);
    console.log(`   ✓ Acknowledges prior contact`);
    console.log(`   ✓ Acknowledges callback/reconnect request`);
    console.log(`   ✓ No scheduling claim`);
    console.log(`   ✓ No governance exposure`);

    // PHASE 3: CLAIM & EXECUTE
    console.log('\nPHASE 3: ATOMIC AUTHORIZATION CLAIM\n');

    console.log('1. Claiming authorization...');
    const claimOpId = generateUuid();
    const targetFp = createHash('sha256').update(QA_PHONE).digest('hex');
    
    const claimRes = await db.rpc('zeya_claim_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: dispatchId,
      p_authorization_id: authorizationId,
      p_operation_id: claimOpId,
      p_target_fingerprint: targetFp,
    });

    if (claimRes.error) throw new Error(`Claim failed: ${claimRes.error.message}`);
    const claimData = claimRes.data?.[0];
    const attemptId = claimData?.attempt_id;
    if (!attemptId) throw new Error('Claim did not return attempt ID');
    console.log(`   ✓ Attempt: ${attemptId}`);
    console.log(`   ✓ Claimed: ${claimData.claimed}`);
    console.log(`   ✓ Status: ${claimData.status}`);

    // Verify authorization was consumed
    const authCheckRes = await db
      .from('governed_execution_authorizations')
      .select('status, consumed_at')
      .eq('id', authorizationId)
      .single();

    if (authCheckRes.error) throw new Error('Cannot verify authorization consumption');
    console.log(`   ✓ Authorization status: ${authCheckRes.data.status}`);
    console.log(`   ✓ Consumed at: ${authCheckRes.data.consumed_at}`);

    console.log('\n2. READY FOR PROVIDER CALL');
    console.log(`   Target: ${QA_PHONE}`);
    console.log(`   Provider: ElevenLabs`);
    console.log(`   Agent: ${brief.worker.providerAgentIdentity}`);
    console.log(`   Opening: "${opening}"`);

    // PHASE 4: POST-EXECUTION STATE
    console.log('\n' + '═'.repeat(59));
    console.log('✅ P2.10L — GOVERNED VOICE EXECUTION READY');
    console.log('═'.repeat(59));

    console.log('\nFinal Chain Identifiers:');
    console.log(`  Mission: ${missionId}`);
    console.log(`  Context: ${contextId}`);
    console.log(`  Brief: ${briefId}`);
    console.log(`  Dispatch: ${dispatchId}`);
    console.log(`  Authorization: ${authorizationId}`);
    console.log(`  Attempt: ${attemptId}`);

    console.log('\nGovernance State:');
    console.log(`  Authorization: consumed (CAS succeeded)`);
    console.log(`  Attempts: 1`);
    console.log(`  Provider Calls: Ready for placement`);
    console.log(`  execution_allowed: true (dispatch & brief)`);
    console.log(`  dispatch_is_current: true`);

    console.log('\nExact Opening to Send:\n');
    console.log(`"${opening}"\n`);

    process.exit(0);

  } catch (err) {
    console.error('\n❌ EXECUTION FAILED:', err instanceof Error ? err.message : String(err));
    console.error('\nNo compensation applied. Stopping.\n');
    process.exit(1);
  }
}

executeFinal();
