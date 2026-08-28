#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function debug() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const d = dispatchRes.data;
  console.log('\n═══════════════════════════════════════════\n');
  console.log('DISPATCH LINEAGE DEBUG\n');
  console.log(`Dispatch ID: ${d?.dispatch_id}`);
  console.log(`Status: ${d?.status}`);
  console.log(`execution_allowed: ${d?.execution_allowed}`);
  console.log(`execution_context_id: ${d?.execution_context_id}`);
  console.log(`worker_role: ${d?.worker_role}`);
  console.log(`channel: ${d?.channel}`);

  const briefRes = await db.from('worker_briefs').select('*').eq('id', d?.worker_brief_id).single();
  const b = briefRes.data;
  console.log(`\nBrief found: ${b ? '✓' : '✗'}`);
  if (b) {
    console.log(`  execution_allowed: dispatch=${d?.execution_allowed} brief=${b?.execution_allowed} match=${b?.execution_allowed === d?.execution_allowed}`);
    console.log(`  operating_mission_id match: ${b?.operating_mission_id === d?.mission_id}`);
    console.log(`  execution_context_id match: ${b?.execution_context_id === d?.execution_context_id}`);
  }

  const missionRes = await db.from('operating_missions').select('*').eq('id', d?.mission_id).single();
  const m = missionRes.data;
  console.log(`\nMission found: ${m ? '✓' : '✗'} status: ${m?.status}`);

  console.log('\n═══════════════════════════════════════════\n');
  const currentRes = await db.rpc('zeya_p26_dispatch_is_current', {
    p_owner_id: QA_OWNER_ID,
    p_dispatch_id: d?.dispatch_id,
  });
  console.log(`zeya_p26_dispatch_is_current result: ${currentRes.data}`);
  if (currentRes.error) console.log(`Error: ${currentRes.error.message}`);
}

debug().catch(e => { console.error(e); process.exit(1); });
