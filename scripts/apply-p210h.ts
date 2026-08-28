#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

async function apply() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Read the migration file
  const migrationSql = readFileSync('/Users/martin/Documents/MINDRA/02_AIXIA/Zeya/supabase/migrations/20260827100000_p210h_context_fingerprint_validation_fix.sql', 'utf8');

  // Extract just the function definition (skip BEGIN/COMMIT)
  const sqlStatements = migrationSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('BEGIN') && !s.startsWith('COMMIT') && !s.startsWith('NOTIFY'));

  console.log('\n═══════════════════════════════════════════\n');
  console.log('APPLYING P2.10H MIGRATION\n');
  console.log(`Statements to execute: ${sqlStatements.length}\n`);

  for (const stmt of sqlStatements) {
    if (!stmt) continue;
    console.log(`Executing: ${stmt.substring(0, 60)}...\n`);
  }

  console.log('Note: Direct SQL execution via Supabase client not available in this context.');
  console.log('The migration needs to be applied via supabase CLI with proper database state.\n');

  console.log('═══════════════════════════════════════════\n');
}

apply().catch(e => { console.error(e); process.exit(1); });
