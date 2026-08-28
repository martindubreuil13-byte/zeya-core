#!/usr/bin/env npx tsx
/**
 * P2.10D CALL-2 EXECUTION VIA RPC
 * Direct execution using authoritative RPC (bypasses API route)
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const AUTHORIZATION_ID = '392d4556-0231-4b31-b38a-0239dd07e003';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10D CALL-2 EXECUTION — AUTHORIZATION CONSUMED              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    // Verify authorization still exists and is unconsumed
    console.log('STEP 1: Verifying authorization...\n');

    const authCheckRes = await db
      .from('governed_execution_authorizations')
      .select('*')
      .eq('id', AUTHORIZATION_ID)
      .eq('owner_id', QA_OWNER_ID)
      .single();

    const auth = authCheckRes.data;

    if (!auth) {
      throw new Error('Authorization not found');
    }

    if (auth.consumed_at) {
      throw new Error('Authorization already consumed');
    }

    console.log(`✓ Authorization verified (unconsumed)`);
    console.log(`  Status: ${auth.status}\n`);

    // Execute via RPC
    console.log('STEP 2: Executing dispatch via RPC...\n');

    const execOpId = generateUuid();
    const execRes = await db.rpc('zeya_claim_governed_execution', {
      p_owner_id: QA_OWNER_ID,
      p_dispatch_id: DISPATCH_ID,
      p_authorization_id: AUTHORIZATION_ID,
      p_operation_id: execOpId,
      p_target_fingerprint: auth.source_fingerprint,
    });

    if (execRes.error) {
      throw new Error(`Execution RPC failed: ${execRes.error.message}`);
    }

    const execData = execRes.data?.[0];
    if (!execData) {
      throw new Error('Execution returned no data');
    }

    console.log('✓ Execution RPC invoked');
    console.log(`  Attempt ID: ${execData.attempt_id || execData.id}`);
    console.log(`  Status: ${execData.status}\n`);

    // Wait for provider call
    console.log('STEP 3: Waiting for provider call...\n');

    let attempt = null;
    for (let i = 0; i < 60; i++) {
      const attemptsRes = await db
        .from('governed_execution_attempts')
        .select('*')
        .eq('dispatch_id', DISPATCH_ID)
        .eq('owner_id', QA_OWNER_ID)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      attempt = attemptsRes.data;
      if (attempt?.execution_completed_at) {
        console.log(`✓ Call completed\n`);
        break;
      }

      if (i % 15 === 0 && i > 0) {
        console.log(`  Waiting... (${i}s)`);
      }
      await sleep(1000);
    }

    if (!attempt) {
      console.error('Timeout: Call did not complete');
      process.exit(1);
    }

    // Get call output
    console.log('STEP 4: Retrieving call output...\n');

    const callRes = await db
      .from('voice_conversation_outputs')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const call = callRes.data?.[0];

    // Get interpretation
    const interpRes = await db
      .from('conversation_interpretations')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const interp = interpRes.data?.[0];

    // Get outcome
    const outcomeRes = await db
      .from('mission_execution_outcomes')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const outcome = outcomeRes.data?.[0];

    // Get observations
    const obsRes = await db
      .from('prospect_observations')
      .select('*')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false });

    const observations = obsRes.data || [];

    // Get relations
    const relRes = await db
      .from('prospect_observation_relations')
      .select('*')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false });

    const relations = relRes.data || [];

    // REPORT
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  P2.10D CALL-2 EXECUTION REPORT                                ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('1. EXECUTION IDs:');
    console.log(`   Attempt: ${attempt.id}`);
    console.log(`   Provider: ${attempt.provider_call_id}\n`);

    console.log('2. CALL STATUS:');
    console.log(`   Status: ${attempt.execution_status}`);
    console.log(`   Started: ${attempt.execution_started_at}`);
    console.log(`   Completed: ${attempt.execution_completed_at}\n`);

    if (call) {
      console.log('3. PROVIDER CALL:');
      console.log(`   Duration: ${call.duration_seconds}s`);
      console.log(`   Connected: ${call.conversation_status === 'completed' || call.duration_seconds > 0 ? 'YES' : 'NO'}\n`);

      if (call.transcript_raw) {
        console.log('4. CONVERSATION:\n');
        console.log(call.transcript_raw);
        console.log();
      }
    } else {
      console.log('3. PROVIDER CALL: ◯ Processing...\n');
    }

    if (interp) {
      console.log('5. INTERPRETATION: ✓ Processed\n');
    } else {
      console.log('5. INTERPRETATION: ◯ Pending\n');
    }

    if (outcome) {
      console.log('6. MISSION OUTCOME:');
      console.log(`   ${outcome.outcome}\n`);
    } else {
      console.log('6. MISSION OUTCOME: ◯ Pending\n');
    }

    console.log('7. PROSPECT MEMORY:');
    console.log(`   Observations: ${observations.length} (new: ${Math.max(0, observations.length - 8)})`);
    console.log(`   Relations: ${relations.length}\n`);

    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('FINAL VERDICT:');
    console.log('  ✓ P2.10D — CALL-2 EXECUTION INITIATED');
    console.log('  ✓ Authorization consumed');
    console.log(`  ${call && call.duration_seconds > 0 ? '✓' : '◯'} Provider call completed`);
    console.log(`  ${interp ? '✓' : '◯'} Interpretation processed`);
    console.log(`  ${outcome ? '✓' : '◯'} Outcome recorded`);
    console.log();

  } catch (err) {
    console.error('\n❌ Execution failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
