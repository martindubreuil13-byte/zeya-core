#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function inspect() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\n╔════════════════════════════════════════════════════════════════╗\n');
  console.log('  PREVIEW SCHEMA: dispatches TABLE\n');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Get one row to see all columns
  const res = await db.from('dispatches').select('*').limit(1);
  
  if (res.error) {
    console.log(`Error querying dispatches: ${res.error.message}\n`);
    process.exit(1);
  }

  if (!res.data || res.data.length === 0) {
    console.log('No rows in dispatches table\n');
  }

  // Check which columns exist by looking at the first row
  if (res.data && res.data[0]) {
    const cols = Object.keys(res.data[0]);
    console.log('Columns present in dispatches table:\n');
    for (const col of cols.sort()) {
      console.log(`  ✓ ${col}`);
    }
  }

  console.log('\nKey columns to verify:\n');
  const keyChecks = [
    { name: 'user_id (pre-existing)', expected: true },
    { name: 'owner_id (P2.5 addition)', expected: true },
    { name: 'business_representation_id', expected: true },
    { name: 'mission_id', expected: true },
    { name: 'execution_context_id', expected: true },
    { name: 'source_fingerprint', expected: true },
    { name: 'execution_allowed', expected: true },
  ];

  for (const check of keyChecks) {
    const exists = res.data && res.data[0] && (check.name.split('(')[0].trim() in res.data[0]);
    const status = exists ? '✓' : '✗';
    console.log(`  ${status} ${check.name}`);
  }
}

inspect().catch(e => { console.error(e); process.exit(1); });
