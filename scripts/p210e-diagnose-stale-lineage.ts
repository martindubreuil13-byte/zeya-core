#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const DISPATCH_ID = 'p25_dispatch_d82441c73099446c90e6ce6df01a7824';
const MISSION_ID = '98291c86-0a5f-4840-8e8b-81893824c334';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('Checking dispatch lineage for stale-state...\n');

  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('dispatch_id', DISPATCH_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const dispatch = dispatchRes.data;

  console.log('Dispatch state:');
  console.log(`  ID: ${dispatch?.dispatch_id}`);
  console.log(`  Status: ${dispatch?.status}`);
  console.log(`  Execution Allowed: ${dispatch?.execution_allowed}`);
  console.log(`  Mission ID: ${dispatch?.mission_id}`);
  console.log(`  Source: ${dispatch?.source}`);
  console.log(`  Source Fingerprint: ${dispatch?.source_fingerprint}\n`);

  const missionRes = await db
    .from('operating_missions')
    .select('*')
    .eq('id', MISSION_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const mission = missionRes.data;

  console.log('Mission state:');
  console.log(`  ID: ${mission?.id}`);
  console.log(`  Status: ${mission?.status}`);
  console.log(`  Representation: ${mission?.business_representation_id}`);
  console.log(`  Mandate: ${mission?.mandate_outcome_package_id}\n`);

  const contextRes = await db
    .from('mission_execution_contexts')
    .select('*')
    .eq('id', dispatch?.execution_context_id)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const context = contextRes.data;

  console.log('Execution context state:');
  console.log(`  ID: ${context?.id}`);
  console.log(`  Mission ID: ${context?.mission_id}`);
  console.log(`  Contract Version: ${context?.context_contract_version}`);
  console.log(`  Representation: ${context?.business_representation_id}`);
  console.log(`  Mandate: ${context?.mandate_outcome_package_id}`);
  console.log(`  Fingerprint current: ${context?.context_fingerprint}\n`);

  console.log('Likely issue: zeya_authorize_governed_execution checks dispatch/context/mission');
  console.log('lineage at authorization time. Something may have changed between dispatch');
  console.log('creation and authorization attempt.');
  console.log('\nPossible causes:');
  console.log('  - Mission status changed');
  console.log('  - Representation/mandate changed');
  console.log('  - Context fingerprint mismatch');
  console.log('  - Representation version changed');
  console.log('\nTrying authorization again...\n');

  // Try authorization again
  const authOpId = crypto.randomUUID();
  const authRes = await db.rpc('zeya_authorize_governed_execution', {
    p_owner_id: QA_OWNER_ID,
    p_dispatch_id: DISPATCH_ID,
    p_operation_id: authOpId,
    p_purpose: 'controlled_preview_voice_qa',
  });

  if (authRes.error) {
    console.error(`Authorization failed again: ${authRes.error.message}`);
    console.error(`Error code: ${authRes.error.code}`);
  } else {
    console.log('Authorization succeeded on retry!');
    console.log(`Auth ID: ${authRes.data?.[0]?.id}`);
  }
}

run().catch(console.error);
