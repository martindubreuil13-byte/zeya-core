#!/usr/bin/env npx tsx
/**
 * P2.10D — CREATE FRESH DISPATCH VIA AUTHORITATIVE P2.9D RPC
 * 
 * Fixes: Create a v3 brief contract with full commercial conversation semantics
 * for existing mission and execution context.
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const MISSION_ID = '2efbdafc-07bd-4a6e-821a-dc6434e1911f';
const EXISTING_CONTEXT_ID = 'b0713c20-6c24-448a-84cf-f0b85319c1f6';

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

  console.log('\n=== CREATE FRESH V3 DISPATCH ===\n');

  try {
    // 1. Get commercial conversation policy constants
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

    // 2. Call the authoritative P2.9D RPC with a FRESH operation ID
    const freshOperationId = generateUuid();
    console.log('Calling zeya_prepare_governed_dispatch_v3...');
    console.log(`  Mission: ${MISSION_ID}`);
    console.log(`  Existing Context: ${EXISTING_CONTEXT_ID}`);
    console.log(`  Fresh Operation ID: ${freshOperationId}\n`);

    const result = await db.rpc('zeya_prepare_governed_dispatch_v3', {
      p_owner_id: QA_OWNER_ID,
      p_mission_id: MISSION_ID,
      p_operation_id: freshOperationId,
      p_worker: worker,
      p_conversation_policy: conversationPolicy,
      p_capabilities: capabilities,
      p_opening_contract: openingContract,
    });

    if (result.error) {
      console.error('RPC Error:', result.error.code, '-', result.error.message);
      process.exit(1);
    }

    const row = result.data?.[0];
    if (!row) {
      console.error('RPC returned no data');
      process.exit(1);
    }

    console.log('✓ Dispatch created via P2.9D RPC');
    console.log(`  Dispatch ID: ${row.dispatch_id}`);
    console.log(`  Worker Brief ID: ${row.worker_brief_id}`);
    console.log(`  Status: ${row.status}`);
    console.log(`  Replayed: ${row.replayed || false}`);

    // 3. Verify the brief was created with V3 contract
    const briefRes = await db
      .from('worker_briefs')
      .select('brief_payload')
      .eq('id', row.worker_brief_id)
      .single();

    if (briefRes.error || !briefRes.data) {
      console.error('Could not verify brief');
      process.exit(1);
    }

    const briefPayload = typeof briefRes.data.brief_payload === 'string'
      ? JSON.parse(briefRes.data.brief_payload)
      : briefRes.data.brief_payload;

    console.log(`\n✓ Brief verified`);
    console.log(`  Contract Version: ${briefPayload.contractVersion}`);
    console.log(`  Has worker: ${!!briefPayload.worker}`);
    console.log(`  Has conversationPolicy: ${!!briefPayload.conversationPolicy}`);
    console.log(`  Has capabilities: ${!!briefPayload.capabilities}`);
    console.log(`  Has prospect context: ${!!briefPayload.prospect?.context}`);
    console.log(`  Has opening contract: ${!!briefPayload.openingContract}`);

    // 4. Create fresh authorization for this dispatch
    console.log(`\nCreating authorization...\n`);
    const authOpId = generateUuid();
    
    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: row.dispatch_id,
      p_operation_id: authOpId,
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      console.error('Authorization RPC failed:', authRes.error.message);
      process.exit(1);
    }

    const authRow = authRes.data?.[0];
    if (!authRow) {
      console.error('Authorization RPC returned no data');
      process.exit(1);
    }

    console.log('✓ Authorization created');
    console.log(`  Authorization ID: ${authRow.id}`);
    console.log(`  Status: ${authRow.status}`);
    console.log(`  Consumed: ${authRow.consumed_at ? 'YES' : 'NO'}`);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  MATERIALIZED P2.10D V3 COMMERCIAL CHAIN                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('Mission ID:', MISSION_ID);
    console.log('Execution Context ID:', EXISTING_CONTEXT_ID);
    console.log('Worker Brief ID (V3):', row.worker_brief_id);
    console.log('Dispatch ID:', row.dispatch_id);
    console.log('Authorization ID:', authRow.id);

  } catch (err) {
    console.error('❌ Failed:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  }
}

run();
