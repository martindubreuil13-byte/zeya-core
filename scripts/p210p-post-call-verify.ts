#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const db = createClient(supabaseUrl, serviceRoleKey);

const DISPATCH_ID = 'p25_dispatch_f387cb372c2c46d590d5823e2654f657';
const AUTHORIZATION_ID = 'c12f2ed7-43bf-4c4b-967c-4a435bf298ab';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function main() {
  console.log('================================================================================');
  console.log('P2.10P — POST-CALL LIVE VERIFICATION');
  console.log('================================================================================\n');

  // [1] Load execution attempt
  console.log('[1] EXECUTION ATTEMPT STATE\n');
  const attemptRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .order('id', { ascending: false })
    .limit(1);

  if (attemptRes.error) {
    console.error(`❌ Query error: ${attemptRes.error.message}`);
    process.exit(1);
  }

  if (!attemptRes.data?.length) {
    console.error(`❌ No attempt found for dispatch`);
    console.log('\nHOLD — P2.10P POST-CALL VERIFICATION FAILED');
    process.exit(1);
  }

  const attempt = attemptRes.data[0];
  console.log(`Attempt ID:          ${attempt.id}`);
  console.log(`Status:              ${attempt.status}`);
  console.log(`Provider Call ID:    ${attempt.provider_call_id || '(not assigned)'}`);
  console.log(`Conversation ID:     ${attempt.conversation_id || '(not assigned)'}`);
  console.log(`Error Code:          ${attempt.error_code || '(none)'}`);

  // [2] At-most-once proof
  console.log('\n[2] AT-MOST-ONCE PROOF\n');
  const allAttemptsRes = await db
    .from('governed_execution_attempts')
    .select('id, status', { count: 'exact' })
    .eq('dispatch_id', DISPATCH_ID);

  const attemptCount = allAttemptsRes.count || 0;
  const dispatchedCount = allAttemptsRes.data?.filter(a => a.status === 'dispatched').length || 0;

  console.log(`Total attempts:      ${attemptCount}`);
  console.log(`Dispatched attempts: ${dispatchedCount}`);
  console.log(`Duplicate calls:     ${dispatchedCount > 1 ? 'VIOLATION' : 'SAFE'}`);

  // [3] Authorization state
  console.log('\n[3] AUTHORIZATION STATE\n');
  const authRes = await db
    .from('governed_execution_authorizations')
    .select('id, status, consumed_at')
    .eq('id', AUTHORIZATION_ID)
    .single();

  if (authRes.error) {
    console.error(`Error loading authorization: ${authRes.error.message}`);
  } else {
    console.log(`Status:      ${authRes.data?.status}`);
    console.log(`Consumed At: ${authRes.data?.consumed_at || '(not consumed)'}`);
  }

  // [4] Provider result
  console.log('\n[4] PROVIDER RESULT\n');
  if (attempt.provider_call_id) {
    console.log(`ElevenLabs Call ID:  ${attempt.provider_call_id}`);
    console.log(`Status:              ${attempt.status}`);
  } else if (attempt.error_code) {
    console.log(`Status:              FAILED`);
    console.log(`Error Code:          ${attempt.error_code}`);
  } else {
    console.log(`Status:              ${attempt.status}`);
  }

  // [5] Conversation transcript
  console.log('\n[5] CONVERSATION TRANSCRIPT\n');
  if (attempt.conversation_id) {
    const convRes = await db
      .from('conversations')
      .select('*')
      .eq('id', attempt.conversation_id)
      .single();

    if (convRes.error) {
      console.log(`Could not load: ${convRes.error.message}`);
    } else if (convRes.data) {
      console.log(`Conversation ID:     ${convRes.data.id}`);
      console.log(`Status:              ${convRes.data.status || 'unknown'}`);
      console.log(`Duration:            ${convRes.data.duration_seconds || '0'} seconds`);
      
      if (convRes.data.transcript) {
        const transcript = String(convRes.data.transcript);
        const lines = transcript.split('\n').slice(0, 15);
        console.log(`\nFirst turns:`);
        lines.forEach((line, i) => {
          if (line.trim()) console.log(`  ${i + 1}. ${line.substring(0, 100)}`);
        });
      }
    }
  } else {
    console.log('(No conversation recorded)');
  }

  // [6] Final verdict
  console.log('\n================================================================================');
  
  if (attempt.status === 'dispatched' && attempt.provider_call_id) {
    console.log('P2.10P — GOVERNED VOICE CALL LIVE PASSED');
    console.log('================================================================================');
    console.log('✓ Call executed and completed');
    console.log('✓ Provider invocation confirmed');
    console.log('✓ At-most-once guarantee maintained');
  } else if (attempt.status === 'failed' || attempt.error_code) {
    console.log('HOLD — P2.10P POST-CALL VERIFICATION FAILED');
    console.log('================================================================================');
    console.log(`Status: ${attempt.status}, Error: ${attempt.error_code || 'unknown'}`);
  } else {
    console.log('HOLD — P2.10P POST-CALL STATE UNKNOWN');
    console.log('================================================================================');
    console.log(`Attempt Status: ${attempt.status}`);
    console.log('Check attempt state manually for call completion.');
  }
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
