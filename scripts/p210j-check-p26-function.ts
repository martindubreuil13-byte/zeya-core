#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function check() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\n═══════════════════════════════════════════\n');
  console.log('Testing zeya_p26_dispatch_is_current() behavior\n');

  // Get a dispatch with execution_allowed=true
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('execution_allowed', true)
    .limit(1)
    .single();

  if (!dispatchRes.data) {
    console.log('No executable dispatch found for testing\n');
    return;
  }

  const d = dispatchRes.data;
  console.log(`Found dispatch: ${d.dispatch_id}`);
  console.log(`execution_allowed: ${d.execution_allowed}`);
  console.log(`Testing function call...\n`);

  const funcRes = await db.rpc('zeya_p26_dispatch_is_current', {
    p_owner_id: d.owner_id,
    p_dispatch_id: d.dispatch_id
  });

  console.log(`Function result: ${funcRes.data}`);

  if (funcRes.data === true) {
    console.log(`\n✓ P2.10F APPEARS TO BE APPLIED`);
    console.log(`  Function accepts execution_allowed=true`);
  } else {
    console.log(`\n✗ P2.10F NOT APPLIED (or dispatch fails other checks)`);
    console.log(`  Function still rejects OR dispatch fails lineage validation`);
  }

  console.log('\n═══════════════════════════════════════════\n');
}

check().catch(console.error);
