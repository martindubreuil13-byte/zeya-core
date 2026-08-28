#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function check() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\nChecking key tables/schema:\n');

  const tables = [
    { name: 'P2.8 (20260822000000)', table: 'conversation_interpretations' },
    { name: 'P2.9B (20260823000000)', table: 'prospect_observations' },
    { name: 'P2.9C (20260824000000)', table: 'mission_execution_contexts' },
    { name: 'P2.9D (20260825000000)', table: 'worker_briefs' },
    { name: 'P2.10D (20260826000000)', table: 'operating_missions' },
  ];

  for (const {name, table} of tables) {
    const res = await db.from(table).select('*').limit(0);
    const status = res.error ? '✗' : '✓';
    console.log(`${status} ${name}`);
  }

  console.log('\n');
}

check().catch(console.error);
