#!/usr/bin/env npx tsx
/**
 * P2.10D CALL-2 EXECUTION
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const AUTHORIZATION_ID = '392d4556-0231-4b31-b38a-0239dd07e003';
const PREVIEW_BASE_URL = 'https://zeya-core-wh6u-full-cycle-backend-integration-martindubreuil13-bytes-projects.vercel.app';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10D CALL-2 EXECUTION — AUTHORIZATION CONSUMED              ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    console.log(`Invoking: POST ${PREVIEW_BASE_URL}/api/work/dispatches/${DISPATCH_ID}/execute\n`);

    const executeResponse = await fetch(
      `${PREVIEW_BASE_URL}/api/work/dispatches/${DISPATCH_ID}/execute`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${serviceRoleKey}`,
        },
        body: JSON.stringify({
          authorizationId: AUTHORIZATION_ID,
        }),
      }
    );

    console.log(`Response status: ${executeResponse.status}\n`);

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text();
      throw new Error(`Execution failed: ${errorText}`);
    }

    const executeData = (await executeResponse.json()) as Record<string, unknown>;
    console.log('✓ Execution endpoint invoked\n');
    console.log('Response data:');
    console.log(JSON.stringify(executeData, null, 2));
    console.log();

    // Wait for provider call
    console.log('Waiting for provider call to complete...\n');

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
        console.log(`✓ Call completed at ${attempt.execution_completed_at}\n`);
        break;
      }

      if (i % 10 === 0 && i > 0) {
        console.log(`  Still waiting... (${i * 1}s elapsed)`);
      }
      await sleep(1000);
    }

    if (!attempt) {
      throw new Error('Timeout waiting for call');
    }

    // Get details
    const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

    const callRes = await db
      .from('voice_conversation_outputs')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const call = callRes.data?.[0];

    const interpRes = await db
      .from('conversation_interpretations')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const interp = interpRes.data?.[0];

    const outcomeRes = await db
      .from('mission_execution_outcomes')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .order('created_at', { ascending: false })
      .limit(1);

    const outcome = outcomeRes.data?.[0];

    const obsRes = await db
      .from('prospect_observations')
      .select('*')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const observations = obsRes.data || [];

    const relRes = await db
      .from('prospect_observation_relations')
      .select('*')
      .eq('lead_id', SYNTHETIC_LEAD_ID)
      .eq('owner_id', QA_OWNER_ID);

    const relations = relRes.data || [];

    // REPORT
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║  P2.10D EXECUTION REPORT                                       ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('1. EXECUTION IDs:');
    console.log(`   Attempt: ${attempt.id}`);
    console.log(`   Provider Call: ${attempt.provider_call_id || 'pending'}\n`);

    console.log('2. CALL EXECUTION:');
    console.log(`   Status: ${attempt.execution_status}`);
    console.log(`   Started: ${attempt.execution_started_at}`);
    console.log(`   Completed: ${attempt.execution_completed_at}\n`);

    if (call) {
      console.log('3. PROVIDER CALL OUTPUT:');
      console.log(`   ID: ${call.id}`);
      console.log(`   Duration: ${call.duration_seconds}s`);
      console.log(`   Connected: ${call.conversation_status === 'completed' ? 'YES' : 'NO'}\n`);

      if (call.transcript_raw) {
        console.log('4. CONVERSATION TRANSCRIPT:\n');
        console.log(call.transcript_raw);
        console.log();
      }

      if (call.user_message) {
        console.log('5. WORKER OPENING:\n');
        console.log(call.user_message);
        console.log();
      }
    }

    if (interp && interp.interpretation) {
      console.log('6. INTERPRETATION:\n');
      const interpData = typeof interp.interpretation === 'string'
        ? JSON.parse(interp.interpretation)
        : interp.interpretation;
      console.log(JSON.stringify(interpData, null, 2));
      console.log();
    }

    if (outcome) {
      console.log('7. MISSION OUTCOME:');
      console.log(`   Outcome: ${outcome.outcome}\n`);
    }

    console.log('8. PROSPECT MEMORY:');
    console.log(`   Observations: ${observations.length} (was 8, new: ${observations.length - 8})`);
    console.log(`   Relations: ${relations.length}\n`);

    console.log('═══════════════════════════════════════════════════════════════\n');

  } catch (err) {
    console.error('\n❌ Execution failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
