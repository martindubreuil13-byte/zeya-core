#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function test() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const result = await db
    .from('mission_execution_contexts')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const c = result.data;
  console.log('\n═══════════════════════════════════════════\n');
  console.log('FINGERPRINT CALCULATION TEST\n');
  console.log(`Stored fingerprint: ${c?.context_fingerprint}\n`);

  if (c?.context) {
    const context = c.context;
    const methods = [
      {
        name: 'direct JSON.stringify',
        calc: () => JSON.stringify(context),
      },
      {
        name: 'toString (if string)',
        calc: () => typeof context === 'string' ? context : JSON.stringify(context),
      },
    ];

    console.log('Testing calculation methods:\n');
    for (const method of methods) {
      try {
        const str = method.calc();
        const hash = crypto.createHash('sha256').update(str, 'utf8').digest('hex');
        const match = hash === c?.context_fingerprint;
        console.log(`${match ? '✓ MATCH' : '✗ MISMATCH'} ${method.name}`);
        if (!match) {
          console.log(`  Calculated: ${hash}`);
          console.log(`  Input length: ${str.length} bytes`);
        }
      } catch (e) {
        console.log(`✗ ERROR in ${method.name}`);
      }
    }
  }

  console.log('\n═══════════════════════════════════════════\n');
}

test().catch(console.error);
