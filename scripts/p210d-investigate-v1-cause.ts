#!/usr/bin/env npx tsx
/**
 * P2.10D — INVESTIGATE WHY V1 WAS CREATED
 * 
 * Follow the exact execution path that produced V1 brief
 */

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

  console.log('\n=== INVESTIGATION: WHY V1 WAS CREATED ===\n');

  // Question 1: Check the dispatch metadata
  console.log('QUESTION: What created this dispatch?\n');

  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('mission_id', MISSION_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const dispatch = dispatchRes.data;
  
  console.log('Dispatch details:');
  console.log('  source:', dispatch.source);
  console.log('  preparation_operation_id:', dispatch.preparation_operation_id);
  console.log('  created_at:', dispatch.created_at);
  console.log('  agent_brief payload contractVersion:', dispatch.agent_brief?.contractVersion);

  // Question 2: What RPC functions exist?
  console.log('\n\nQUESTION: Which RPC created the V1 brief?\n');

  console.log('RPC functions for dispatch creation:');
  console.log('  1. zeya_prepare_governed_dispatch (P2.5)');
  console.log('     → source: p25_governed_operating_mission');
  console.log('     → brief contract: governed-worker-brief-v1');
  console.log('     → DOES NOT include P2.9D params (worker, policy, capabilities, opening)');
  console.log('');
  console.log('  2. zeya_prepare_governed_dispatch_v2 (P2.9C)');
  console.log('     → source: p29c_governed_operating_mission');
  console.log('     → brief contract: (need to check)');
  console.log('');
  console.log('  3. zeya_prepare_governed_dispatch_v3 (P2.9D)');
  console.log('     → source: p29d_governed_operating_mission');
  console.log('     → brief contract: governed-worker-brief-v3');
  console.log('     → INCLUDES P2.9D params (worker, policy, capabilities, opening)');
  console.log('');

  // Question 3: Which code path called the RPC?
  console.log('\nQUESTION: Which API/script created this dispatch?\n');

  console.log('Current dispatch route at /api/work/missions/[missionId]/dispatch:');
  console.log('  → Calls zeya_prepare_governed_dispatch_v3 (CORRECT)');
  console.log('  → Passes p_worker, p_conversation_policy, p_capabilities, p_opening_contract');
  console.log('  → Should create V3 brief');
  console.log('');
  console.log('But this dispatch has:');
  console.log('  → source: experience_conversation (NOT p29d_governed_operating_mission)');
  console.log('  → brief contract: v1 (NOT v3)');
  console.log('');
  console.log('CONCLUSION: This dispatch was NOT created via current API route.');
  console.log('It was created via direct insert or legacy script.\n');

  // Question 4: Can we replace this brief?
  console.log('\nQUESTION: Can we create a V3 brief for the existing context?\n');

  console.log('Constraint: worker_briefs_p25_context_unique');
  console.log('  CREATE UNIQUE INDEX worker_briefs_p25_context_unique');
  console.log('    ON public.worker_briefs(execution_context_id)');
  console.log('    WHERE execution_context_id IS NOT NULL');
  console.log('');
  console.log('Execution Context ID:', dispatch.execution_context_id);
  console.log('');

  const briefsRes = await db
    .from('worker_briefs')
    .select('id, brief_payload->contractVersion as contract_version')
    .eq('execution_context_id', dispatch.execution_context_id)
    .eq('owner_id', QA_OWNER_ID);

  console.log(`Briefs for this context: ${briefsRes.data?.length || 0}`);
  if (briefsRes.data) {
    for (const brief of briefsRes.data) {
      console.log(`  - ${brief.id}: ${brief.contract_version || 'unknown'}`);
    }
  }

  console.log('');
  console.log('CONSTRAINT CHECK:');
  if (briefsRes.data && briefsRes.data.length > 0) {
    console.log('  ✗ BLOCKED: Context already has a brief');
    console.log('  → Cannot create second brief for same context_id');
    console.log('  → UNIQUE constraint violation');
  }
}

run().catch(console.error);
