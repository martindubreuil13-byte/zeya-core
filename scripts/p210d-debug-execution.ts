#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_47cde9b9d0224558a6e626d34974b280';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('Checking all attempts for this dispatch...\n');

  // Get ALL attempts for this dispatch
  const allRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID);

  console.log(`Total attempts found: ${allRes.data?.length || 0}\n`);

  if (allRes.data && allRes.data.length > 0) {
    for (const att of allRes.data) {
      console.log(`Attempt: ${att.id}`);
      console.log(`  Status: ${att.execution_status}`);
      console.log(`  Started: ${att.execution_started_at}`);
      console.log(`  Completed: ${att.execution_completed_at}`);
      console.log(`  Provider Call: ${att.provider_call_id}`);
      console.log();
    }
  } else {
    console.log('No attempts found for this dispatch.\n');
  }

  // Check dispatch itself
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  if (dispatchRes.data) {
    const dispatch = dispatchRes.data;
    console.log('Dispatch details:');
    console.log(`  ID: ${dispatch.dispatch_id}`);
    console.log(`  Status: ${dispatch.status}`);
    console.log(`  Execution allowed: ${dispatch.execution_allowed}`);
  }
}

run().catch(console.error);
