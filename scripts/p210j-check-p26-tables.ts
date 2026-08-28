#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function check() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const authRes = await db.from('governed_execution_authorizations').select('*').limit(1);
  const attRes = await db.from('governed_execution_attempts').select('*').limit(1);

  console.log('\nP2.6 Tables in Preview:\n');
  console.log(`governed_execution_authorizations: ${authRes.error ? '✗ NOT FOUND' : '✓ EXISTS'}`);
  console.log(`governed_execution_attempts: ${attRes.error ? '✗ NOT FOUND' : '✓ EXISTS'}`);

  if (authRes.error) {
    console.log(`  Error: ${authRes.error.message}`);
  }

  console.log('\n');
}

check().catch(console.error);
