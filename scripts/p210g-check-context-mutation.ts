#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function check() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  // Get most recent context
  const cRes = await db
    .from('mission_execution_contexts')
    .select('*')
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  const c = cRes.data;
  console.log('\n═══════════════════════════════════════════\n');
  console.log('CONTEXT FINGERPRINT ANALYSIS\n');
  console.log(`Context ID: ${c?.id}`);
  console.log(`Stored fingerprint: ${c?.context_fingerprint}`);

  // Get the raw context JSON
  const contextJson = c?.context;
  console.log(`\nContext type: ${typeof contextJson}`);
  console.log(`Context keys: ${Object.keys(contextJson || {}).join(', ')}`);

  // Try different calculation methods
  const methods = [
    {
      name: 'direct JSON.stringify',
      fn: () => JSON.stringify(contextJson),
    },
    {
      name: 'sorted keys (recursive)',
      fn: () => JSON.stringify(sortKeys(contextJson)),
    },
    {
      name: 'toString then SHA256',
      fn: () => contextJson.toString(),
    },
  ];

  console.log(`\nTesting SHA256 calculations:\n`);
  for (const method of methods) {
    try {
      const str = method.fn();
      const hash = crypto.createHash('sha256').update(str, 'utf8').digest('hex');
      const match = hash === c?.context_fingerprint ? '✓ MATCH' : '✗ NO MATCH';
      console.log(`${match} ${method.name}`);
      console.log(`   Input length: ${str.length}`);
      console.log(`   Hash: ${hash.substring(0, 20)}...`);
    } catch (e) {
      console.log(`✗ ${method.name}: ${e instanceof Error ? e.message : 'error'}`);
    }
  }

  // Check if the context has been modified after creation
  console.log(`\nContext metadata:\n`);
  console.log(`Created at: ${c?.created_at}`);
  console.log(`Updated at: ${c?.updated_at}`);
  console.log(`Age: ${c?.created_at === c?.updated_at ? 'unchanged' : 'modified'}`);
}

function sortKeys(obj: any): any {
  if (Array.isArray(obj)) {
    return obj.map(sortKeys);
  } else if (obj !== null && typeof obj === 'object') {
    const sorted: any = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = sortKeys(obj[key]);
    });
    return sorted;
  }
  return obj;
}

check().catch(e => { console.error(e); process.exit(1); });
