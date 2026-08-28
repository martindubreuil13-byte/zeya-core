#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

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

  // Get the dispatch with V1 brief
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .eq('worker_brief_id', 'p25_brief_95ff78b981714a69aa4aeccfe355e931')
    .single();

  if (dispatchRes.error || !dispatchRes.data) {
    console.error('Dispatch not found');
    process.exit(1);
  }

  const dispatch = dispatchRes.data;

  console.log('Dispatch source field:', dispatch.source);
  console.log('Created at:', dispatch.created_at);
  console.log('Preparation operation ID:', dispatch.preparation_operation_id);
  console.log('Mission ID:', dispatch.mission_id);

  // Check if this was created via one of the prepare RPC functions
  console.log('\n=== DIAGNOSIS ===');
  console.log('Source should be p25_governed_operating_mission for P2.5 RPC');
  console.log('Source should be p29c_governed_operating_mission for P2.9C RPC');
  console.log('Source should be p29d_governed_operating_mission for P2.9D RPC');
  console.log('\nActual source:', dispatch.source);

  if (dispatch.source === 'experience_conversation') {
    console.log('\n⚠️  CRITICAL: Dispatch was created via PUBLIC EXPERIENCE path, NOT governed path!');
  }

  // Try to find if V3 was ever created
  const briefV3Res = await db
    .from('worker_briefs')
    .select('id, brief_payload->contractVersion as contract_version')
    .eq('owner_id', QA_OWNER_ID)
    .eq('mission_id', dispatch.mission_id);

  console.log('\n=== ALL BRIEFS FOR THIS MISSION ===');
  if (briefV3Res.data) {
    for (const brief of briefV3Res.data) {
      console.log('Brief:', brief.id, '- Contract:', brief.contract_version);
    }
  }
}

run().catch(console.error);
