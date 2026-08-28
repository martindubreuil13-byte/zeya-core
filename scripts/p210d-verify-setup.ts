#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';
const AUTH_ID = '392d4556-0231-4b31-b38a-0239dd07e003';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('P2.10D CHAIN VERIFICATION\n');

  // Check authorization
  const authRes = await db
    .from('governed_execution_authorizations')
    .select('*')
    .eq('id', AUTH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const auth = authRes.data;

  console.log('Authorization:');
  console.log(`  Status: ${auth?.status}`);
  console.log(`  Consumed: ${auth?.consumed_at || 'NO'}`);
  console.log(`  Dispatch ID: ${auth?.dispatch_id}\n`);

  // Check dispatch
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const dispatch = dispatchRes.data;

  console.log('Dispatch:');
  console.log(`  Status: ${dispatch?.status}`);
  console.log(`  Execution Allowed: ${dispatch?.execution_allowed}`);
  console.log(`  Source: ${dispatch?.source}\n`);

  // Check the actual RPC parameters
  const briefRes = await db
    .from('worker_briefs')
    .select('brief_payload')
    .eq('id', dispatch?.worker_brief_id)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const briefPayload = briefRes.data?.brief_payload;

  console.log('Worker Brief:');
  console.log(`  Contract: ${briefPayload?.contractVersion}`);
  console.log(`  Worker: ${briefPayload?.worker?.spokenName}\n`);

  console.log('ISSUE ANALYSIS:\n');

  if (dispatch?.execution_allowed === false) {
    console.log('⚠️  PROBLEM: dispatch.execution_allowed = false');
    console.log('   This means the mission had constraints.doNotExecute = true');
    console.log('   This blocks the execution even with authorization.\n');
  }

  if (auth?.status === 'authorized' && !auth?.consumed_at) {
    console.log('✓ Authorization is valid and unconsumed.\n');
  }

  console.log('RECOMMENDATION:');
  console.log('The dispatch cannot execute because it was created with doNotExecute=true.');
  console.log('This is by design for QA/testing (prevents accidental execution).');
  console.log('To enable execution, the constraint must be removed or changed.');
}

run().catch(console.error);
