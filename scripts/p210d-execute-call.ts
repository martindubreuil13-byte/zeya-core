#!/usr/bin/env npx tsx
/**
 * P2.10D CALL-2 EXECUTION
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const AUTHORIZATION_ID = '392d4556-0231-4b31-b38a-0239dd07e003';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const apiBaseUrl = process.env.PREVIEW_BASE_URL || 'http://localhost:3000';

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
    console.log('STEP 1: Invoking execution endpoint...\n');

    const executeResponse = await fetch(
      `${apiBaseUrl}/api/work/dispatches/${DISPATCH_ID}/execute`,
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

    if (!executeResponse.ok) {
      const errorText = await executeResponse.text();
      throw new Error(
        `Execution failed (${executeResponse.status}): ${errorText}`
      );
    }

    const executeData = (await executeResponse.json()) as Record<string, unknown>;
    console.log('✓ Execution endpoint invoked\n');

    const executionAttemptId = executeData.executionAttemptId || executeData.attemptId;
    console.log(`Attempt ID: ${executionAttemptId}\n`);

    // Wait for provider call
    console.log('STEP 2: Waiting for provider call...\n');

    let attempt = null;
    for (let i = 0; i < 30; i++) {
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

      if (i % 5 === 0) {
        console.log(`  Waiting... (${i * 2}s)`);
      }
      await sleep(2000);
    }

    if (!attempt) {
      throw new Error('No attempt found');
    }

    console.log('STEP 3: Retrieving call details...\n');

    const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

    // Get call output
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
      .eq('owner_id', QA_OWNER_ID);

    const observations = obsRes.data || [];

    // Get relations
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
    console.log(`   Provider: ${attempt.provider_call_id || 'unknown'}\n`);

    console.log('2. CALL DETAILS:');
    console.log(`   Status: ${attempt.execution_status}`);
    console.log(`   Started: ${attempt.execution_started_at}`);
    console.log(`   Completed: ${attempt.execution_completed_at}\n`);

    if (call) {
      console.log('3. PROVIDER OUTPUT:');
      console.log(`   ID: ${call.id}`);
      console.log(`   Duration: ${call.duration_seconds}s`);
      console.log(`   Status: ${call.conversation_status}`);
      console.log(`   Connected: ${call.conversation_status === 'completed' ? 'YES' : 'unknown'}\n`);

      if (call.transcript_raw) {
        console.log('4. TRANSCRIPT:');
        console.log(call.transcript_raw);
        console.log();
      }
    }

    if (interp) {
      console.log('5. INTERPRETATION:');
      if (interp.interpretation) {
        const interpData = typeof interp.interpretation === 'string'
          ? JSON.parse(interp.interpretation)
          : interp.interpretation;
        console.log(JSON.stringify(interpData, null, 2));
      }
      console.log();
    }

    if (outcome) {
      console.log('6. MISSION OUTCOME:');
      console.log(`   Outcome: ${outcome.outcome}\n`);
    }

    console.log('7. PROSPECT OBSERVATIONS:');
    console.log(`   Total: ${observations.length}`);
    if (observations.length > 8) {
      console.log(`   New: ${observations.length - 8}\n`);
    } else {
      console.log();
    }

    console.log('8. PROSPECT RELATIONS:');
    console.log(`   Total: ${relations.length}\n`);

    console.log('═══════════════════════════════════════════════════════════════\n');

    console.log('PIPELINE STATUS:');
    console.log(`  ✓ Call executed`);
    console.log(`  ${interp ? '✓' : '◯'} Interpretation processed`);
    console.log(`  ${outcome ? '✓' : '◯'} Outcome recorded`);
    console.log(`  ${observations.length > 8 ? '✓' : '◯'} Observations captured`);
    console.log();

  } catch (err) {
    console.error('\n❌ Execution failed:');
    console.error(err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

run();
