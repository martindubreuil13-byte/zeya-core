#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const BRIEF_ID = 'p25_brief_95ff78b981714a69aa4aeccfe355e931';

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

  const result = await db
    .from('worker_briefs')
    .select('*')
    .eq('id', BRIEF_ID)
    .eq('owner_id', QA_OWNER_ID)
    .single();

  if (result.error || !result.data) {
    console.error('Brief not found:', result.error?.message);
    process.exit(1);
  }

  const brief = result.data;
  const payload = typeof brief.brief_payload === 'string'
    ? JSON.parse(brief.brief_payload)
    : brief.brief_payload || {};

  console.log('\n=== ACTUAL BRIEF PAYLOAD ===\n');
  console.log('Contract Version:', payload.contractVersion);
  console.log('\nPayload Top-Level Keys:', Object.keys(payload).sort());
  console.log('\nFull Payload:\n');
  console.log(JSON.stringify(payload, null, 2));

  // Verify what P2.9D contract should contain
  console.log('\n\n=== CHECKING REQUIRED P2.9D CONTRACT FIELDS ===\n');
  
  const requiredFields = [
    'contractVersion',
    'worker',
    'business',
    'prospect',
    'mission',
    'authority',
    'capabilities',
    'conversationPolicy',
    'openingContract',
    'constraints',
    'dispatch'
  ];

  for (const field of requiredFields) {
    const exists = field in payload;
    console.log(`${exists ? '✓' : '✗'} ${field}`);
  }

  console.log('\n\n=== VERDICT ===\n');
  if (payload.contractVersion === 'governed-worker-brief-v3') {
    console.log('✓ Contract version is CORRECT (V3)');
    const missingFields = requiredFields.filter(f => !(f in payload));
    if (missingFields.length > 0) {
      console.log('⚠️  MISSING REQUIRED FIELDS:', missingFields.join(', '));
    } else {
      console.log('✓ All required P2.9D fields present');
    }
  } else {
    console.log('✗ Contract version is WRONG:', payload.contractVersion);
    console.log('   Expected: governed-worker-brief-v3');
  }
}

run().catch(console.error);
