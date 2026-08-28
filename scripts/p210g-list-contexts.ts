#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

async function list() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const contexts = await db
    .from('mission_execution_contexts')
    .select(`
      id,
      mission_id,
      created_at,
      context_fingerprint,
      context_contract_version,
      operating_missions (
        id,
        lead_id,
        constraints
      )
    `)
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('\n═══════════════════════════════════════════\n');
  console.log('MISSION EXECUTION CONTEXTS (recent)\n');

  for (const c of contexts.data || []) {
    const mission = (c as any).operating_missions;
    console.log(`Context: ${c.id}`);
    console.log(`  Mission: ${mission?.id || c.mission_id}`);
    console.log(`  Lead: ${mission?.lead_id || 'unknown'}`);
    console.log(`  Constraints: ${JSON.stringify(mission?.constraints)}`);
    console.log(`  Fingerprint: ${c.context_fingerprint?.substring(0, 20)}...`);
    console.log(`  Created: ${c.created_at}`);
    console.log();
  }
}

list().catch(e => { console.error(e); process.exit(1); });
