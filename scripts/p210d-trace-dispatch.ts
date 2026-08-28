#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const MISSION_ID = '2efbdafc-07bd-4a6e-821a-dc6434e1911f';

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

  // Get all dispatches for this mission
  const dispatchResult = await db
    .from('dispatches')
    .select('*')
    .eq('mission_id', MISSION_ID)
    .eq('owner_id', QA_OWNER_ID);

  if (dispatchResult.error || !dispatchResult.data) {
    console.error('No dispatches found:', dispatchResult.error?.message);
    process.exit(1);
  }

  const dispatches = dispatchResult.data;
  console.log(`\n=== DISPATCH CREATION PATH ANALYSIS ===\n`);
  console.log(`Found ${dispatches.length} dispatch(es) for mission ${MISSION_ID}\n`);

  for (const dispatch of dispatches) {
    console.log(`Dispatch ID: ${dispatch.dispatch_id}`);
    console.log(`  Created: ${dispatch.created_at}`);
    console.log(`  Status: ${dispatch.status}`);
    console.log(`  Source: ${dispatch.source || 'unknown'}`);
    console.log(`  Preparation Operation ID: ${dispatch.preparation_operation_id || 'NONE (direct insert or legacy path)'}`);
    console.log(`  Worker Brief ID: ${dispatch.worker_brief_id}`);
    console.log(`  Source Fingerprint: ${dispatch.source_fingerprint}`);
    console.log();
  }

  // Now check the mission record
  const missionResult = await db
    .from('operating_missions')
    .select('*')
    .eq('id', MISSION_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  if (!missionResult.error && missionResult.data) {
    const mission = missionResult.data;
    console.log(`\nMission: ${mission.id}`);
    console.log(`  Created: ${mission.created_at}`);
    console.log(`  Creation Operation ID: ${mission.operation_id || 'unknown'}`);
    console.log(`  Status: ${mission.status}`);
  }

  // Check if there's a migration history
  console.log(`\n\n=== DIAGNOSIS ===\n`);
  
  const dispatch = dispatches[0];
  if (!dispatch.preparation_operation_id) {
    console.log('⚠️  FINDING: Dispatch has NO preparation_operation_id');
    console.log('   This means it was NOT created via zeya_prepare_governed_dispatch_v3 RPC');
    console.log('   It was likely created via direct insert or older path');
  } else {
    console.log('✓ Dispatch has preparation_operation_id: ' + dispatch.preparation_operation_id);
    console.log('  This means it SHOULD have gone through the RPC');
  }

  if (dispatch.source && dispatch.source.includes('p29d')) {
    console.log('✓ Source indicates P2.9D path');
  } else if (dispatch.source) {
    console.log('⚠️  Source indicates legacy path: ' + dispatch.source);
  } else {
    console.log('⚠️  Source is NULL - cannot determine creation path');
  }
}

run().catch(console.error);
