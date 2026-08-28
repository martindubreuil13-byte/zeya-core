#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10D EXECUTION STATE                                        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get attempt
  const attRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const attempt = attRes.data;

  console.log('1. EXECUTION ATTEMPT:');
  console.log(`   ID: ${attempt?.id}`);
  console.log(`   Status: ${attempt?.execution_status}`);
  console.log(`   Started: ${attempt?.execution_started_at}`);
  console.log(`   Completed: ${attempt?.execution_completed_at || 'NOT YET'}`);
  console.log(`   Provider Call ID: ${attempt?.provider_call_id}\n`);

  // Get call output
  const callRes = await db
    .from('voice_conversation_outputs')
    .select('*')
    .eq('provider_call_id', attempt?.provider_call_id || '')
    .eq('owner_id', QA_OWNER_ID);

  const call = callRes.data?.[0];

  console.log('2. PROVIDER CALL OUTPUT:');
  if (call) {
    console.log(`   ID: ${call.id}`);
    console.log(`   Provider: ${call.provider}`);
    console.log(`   Status: ${call.conversation_status}`);
    console.log(`   Duration: ${call.duration_seconds}s`);
    console.log(`   Created: ${call.created_at}\n`);

    if (call.transcript_raw) {
      console.log('3. TRANSCRIPT:');
      console.log(call.transcript_raw);
      console.log();
    } else {
      console.log('3. TRANSCRIPT: NOT AVAILABLE YET\n');
    }
  } else {
    console.log('   NOT YET RECEIVED\n');
  }

  // Get interpretation
  const interpRes = await db
    .from('conversation_interpretations')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  const interp = interpRes.data?.[0];

  console.log('4. INTERPRETATION:');
  console.log(`   ${interp ? 'PROCESSED' : 'PENDING'}\n`);

  // Get mission outcome
  const outcomeRes = await db
    .from('mission_execution_outcomes')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  const outcome = outcomeRes.data?.[0];

  console.log('5. MISSION OUTCOME:');
  console.log(`   ${outcome ? outcome.outcome : 'PENDING'}\n`);

  // Get observations
  const obsRes = await db
    .from('prospect_observations')
    .select('*')
    .eq('lead_id', SYNTHETIC_LEAD_ID)
    .eq('owner_id', QA_OWNER_ID);

  console.log('6. PROSPECT OBSERVATIONS:');
  console.log(`   Total: ${obsRes.data?.length || 0}`);
  console.log(`   New: ${Math.max(0, (obsRes.data?.length || 0) - 8)}\n`);

  // Get relations
  const relRes = await db
    .from('prospect_observation_relations')
    .select('*')
    .eq('lead_id', SYNTHETIC_LEAD_ID)
    .eq('owner_id', QA_OWNER_ID);

  console.log('7. PROSPECT RELATIONS:');
  console.log(`   Total: ${relRes.data?.length || 0}\n`);

  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('SUMMARY:');
  console.log(`  Execution Status: ${attempt?.execution_status || 'unknown'}`);
  console.log(`  Call Status: ${call?.conversation_status || 'pending'}`);
  console.log(`  Interpretation: ${interp ? '✓' : '◯'}`);
  console.log(`  Outcome: ${outcome ? '✓' : '◯'}`);
  console.log(`  Observations: ${(obsRes.data?.length || 0) > 8 ? '✓ captured' : '◯'}\n`);
}

run().catch(console.error);
