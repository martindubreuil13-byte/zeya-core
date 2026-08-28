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

  // Check the old dispatch
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('worker_brief_id', 'p25_brief_95ff78b981714a69aa4aeccfe355e931')
    .eq('owner_id', QA_OWNER_ID)
    .single();

  if (dispatchRes.error || !dispatchRes.data) {
    console.error('Dispatch not found');
    process.exit(1);
  }

  const dispatch = dispatchRes.data;
  const briefRes = await db
    .from('worker_briefs')
    .select('*')
    .eq('id', 'p25_brief_95ff78b981714a69aa4aeccfe355e931')
    .eq('owner_id', QA_OWNER_ID)
    .single();

  const brief = briefRes.data;

  console.log('\n=== IMMUTABILITY CHECK ===\n');

  console.log('OLD DISPATCH:');
  console.log('  ID:', dispatch.dispatch_id);
  console.log('  execution_context_id:', dispatch.execution_context_id);
  console.log('  status:', dispatch.status);
  console.log('  source:', dispatch.source);
  console.log('  Is Governed:', !!dispatch.execution_context_id);

  console.log('\nOLD BRIEF:');
  console.log('  ID:', brief?.id);
  console.log('  execution_context_id:', brief?.execution_context_id);
  console.log('  Is Governed:', !!brief?.execution_context_id);

  console.log('\n=== ANALYSIS ===');

  if (dispatch.execution_context_id) {
    console.log('✗ BLOCKED: Old dispatch is marked GOVERNED');
    console.log('  Trigger: zeya_p25_preserve_dispatch will reject DELETE');
    console.log('  Trigger: zeya_p25_preserve_dispatch will reject UPDATE of lineage');
  }

  if (brief?.execution_context_id) {
    console.log('✗ BLOCKED: Old brief is marked GOVERNED');
    console.log('  Trigger: zeya_p25_immutable_worker_brief will reject DELETE');
    console.log('  Constraint: worker_briefs_p25_context_unique prevents new brief for same context');
  }

  console.log('\n=== POSSIBLE SOLUTIONS ===');
  console.log('1. If source=experience_conversation, may not be considered "governed" by triggers');
  console.log('2. Check if brief/dispatch can be deleted via legacy cleanup');
  console.log('3. Check if we must use a different context');
  console.log('4. Use RPC to explicitly clear the "governed" designation');
}

run().catch(console.error);
