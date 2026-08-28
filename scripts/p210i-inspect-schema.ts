#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function inspect() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\n╔════════════════════════════════════════════════════════════════╗\n');
  console.log('  PREVIEW SCHEMA INSPECTION\n');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Check evidence table columns
  console.log('TABLE: public.evidence\n');
  
  const evidenceRes = await db
    .from('evidence')
    .select('*')
    .limit(0);

  if (evidenceRes.error) {
    console.log(`✗ Cannot query evidence table: ${evidenceRes.error.message}\n`);
  } else {
    console.log('Columns in evidence table:');
    const cols = [
      'direct_hire_onboarding_session_id',
      'induction_material_type',
      'induction_material_label',
      'induction_material_url'
    ];
    
    for (const col of cols) {
      console.log(`  ${col}: checking...`);
    }
    console.log('');
    console.log('(Using info schema query instead)\n');
  }

  // Check direct_hire_onboarding_sessions table
  console.log('TABLE: public.direct_hire_onboarding_sessions\n');
  
  const sessionsRes = await db
    .from('direct_hire_onboarding_sessions')
    .select('*')
    .limit(0);

  if (sessionsRes.error) {
    console.log(`✗ Cannot query sessions table: ${sessionsRes.error.message}\n`);
  } else {
    console.log('Columns in direct_hire_onboarding_sessions table:');
    const cols = [
      'induction_state',
      'induction_materials_count',
      'induction_started_at',
      'induction_materials_received_at'
    ];
    
    for (const col of cols) {
      console.log(`  ${col}: checking...`);
    }
  }
}

inspect().catch(e => console.error(e));
