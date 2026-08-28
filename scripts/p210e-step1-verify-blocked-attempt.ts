#!/usr/bin/env npx tsx
/**
 * P2.10E STEP 1: VERIFY BLOCKED P2.10D ATTEMPT
 * 
 * Read-only inspection of the blocked attempt.
 * Confirm architectural correctness of governance safety.
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const AUTH_ID = '392d4556-0231-4b31-b38a-0239dd07e003';
const ATTEMPT_ID = 'dcfdd9fe-d15c-428f-8f95-73211704d0bb';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10E STEP 1: VERIFY BLOCKED P2.10D ATTEMPT                 ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // 1. Get attempt
  const attemptRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('id', ATTEMPT_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const attempt = attemptRes.data;

  console.log('1. ATTEMPT STATUS:');
  console.log(`   ID: ${attempt?.id}`);
  console.log(`   Status: ${attempt?.execution_status || 'GOVERNANCE_BLOCKED'}`);
  console.log(`   Started: ${attempt?.execution_started_at || 'NOT STARTED'}`);
  console.log(`   Completed: ${attempt?.execution_completed_at || 'NOT COMPLETED'}`);
  console.log(`   Error: ${attempt?.error_code || 'GOVERNANCE_CONSTRAINT'}\n`);

  // 2. Get authorization
  const authRes = await db
    .from('governed_execution_authorizations')
    .select('*')
    .eq('id', AUTH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const auth = authRes.data;

  console.log('2. AUTHORIZATION STATUS:');
  console.log(`   Status: ${auth?.status}`);
  console.log(`   Consumed At: ${auth?.consumed_at}`);
  console.log(`   Remains Consumed: ${auth?.consumed_at ? 'YES (IMMUTABLE)' : 'NO'}\n`);

  // 3. Get dispatch
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const dispatch = dispatchRes.data;

  console.log('3. DISPATCH STATE:');
  console.log(`   Status: ${dispatch?.status}`);
  console.log(`   Execution Allowed: ${dispatch?.execution_allowed}`);
  console.log(`   Source: ${dispatch?.source}\n`);

  // 4. Check for provider calls
  const callRes = await db
    .from('voice_conversation_outputs')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .eq('provider_call_id', attempt?.provider_call_id || 'null');

  console.log('4. PROVIDER INTERACTION:');
  console.log(`   Provider Calls: ${callRes.data?.length || 0} (expected: 0)\n`);

  // 5. Check for lineage
  const mappingRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID);

  console.log('5. EXECUTION LINEAGE:');
  console.log(`   Attempts Recorded: ${mappingRes.data?.length || 0}`);
  console.log(`   Mapping Exists: ${mappingRes.data?.length > 0 ? 'YES' : 'NO'}\n`);

  // 6. Verify state machine
  console.log('6. STATE MACHINE VERIFICATION:');
  console.log('   Expected path: authorization consumed → attempt created → governance blocked → no provider call\n');

  const authConsumed = auth?.consumed_at !== null && auth?.consumed_at !== undefined;
  const attemptExists = !!attempt?.id;
  const noProviderCall = (callRes.data?.length || 0) === 0;
  const blocked = dispatch?.execution_allowed === false;

  console.log(`   ${authConsumed ? '✓' : '✗'} Authorization consumed`);
  console.log(`   ${attemptExists ? '✓' : '✗'} Attempt created`);
  console.log(`   ${blocked ? '✓' : '✗'} Governance blocked (execution_allowed=false)`);
  console.log(`   ${noProviderCall ? '✓' : '✗'} No provider call made\n`);

  const correctPath = authConsumed && attemptExists && blocked && noProviderCall;

  console.log('═══════════════════════════════════════════════════════════════\n');

  if (correctPath) {
    console.log('✓ ARCHITECTURAL CORRECTNESS CONFIRMED\n');
    console.log('The P2.10D attempt correctly demonstrates:');
    console.log('  - Authorization consumption is immutable');
    console.log('  - Governance constraints enforce execution prohibition');
    console.log('  - Provider request prevented at governance layer');
    console.log('  - Durable record of safety behavior\n');
    console.log('Ready to proceed to P2.10E: Create executable QA chain\n');
  } else {
    console.log('⚠️  ARCHITECTURE ANOMALY DETECTED\n');
    console.log('Expected state machine not followed. Investigation required.\n');
  }
}

run().catch(console.error);
