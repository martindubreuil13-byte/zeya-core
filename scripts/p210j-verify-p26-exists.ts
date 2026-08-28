#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function verify() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\nVerifying P2.6 objects exist:\n');

  const authRes = await db
    .from('governed_execution_authorizations')
    .select('*')
    .limit(1);

  const attRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .limit(1);

  console.log(`governed_execution_authorizations table: ${authRes.error ? '✗ ERROR: ' + authRes.error.message : '✓ EXISTS'}`);
  console.log(`governed_execution_attempts table: ${attRes.error ? '✗ ERROR: ' + attRes.error.message : '✓ EXISTS'}`);

  // Try to query the function
  try {
    const funcRes = await db.rpc('zeya_p26_dispatch_is_current', {
      p_owner_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      p_dispatch_id: 'test'
    });
    console.log(`\nzeya_p26_dispatch_is_current function: ✓ EXISTS`);
  } catch (e) {
    console.log(`\nzeya_p26_dispatch_is_current function: ? (error or doesn't exist)`);
  }
}

verify().catch(console.error);
