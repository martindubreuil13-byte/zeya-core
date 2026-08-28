#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, supabaseKey);

async function main() {
  const briefRes = await db
    .from('worker_briefs')
    .select('id, brief_payload')
    .eq('id', 'p25_brief_a83e4f05e2b9406db494e14981c727f0')
    .single();

  if (briefRes.error) {
    console.error(`Error: ${briefRes.error.message}`);
    process.exit(1);
  }

  const payload = briefRes.data.brief_payload;

  console.log('================================================================================');
  console.log('BRIEF PAYLOAD STRUCTURE INSPECTION');
  console.log('================================================================================\n');

  console.log('[A] Top-level keys in brief_payload:');
  if (payload && typeof payload === 'object') {
    console.log('  ' + Object.keys(payload).map(k => `"${k}"`).join(', '));
  } else {
    console.log('  ⚠ payload is NOT an object:', typeof payload);
  }

  console.log('\n[B] prospect object:');
  const prospect = payload?.prospect;
  if (prospect && typeof prospect === 'object') {
    console.log('  Keys: ' + Object.keys(prospect).map(k => `"${k}"`).join(', '));
    console.log('  Object.keys().length = ' + Object.keys(prospect).length);
  } else {
    console.log('  ⚠ prospect is NOT an object:', typeof prospect, prospect);
  }

  console.log('\n[C] prospect.identity object:');
  const identity = payload?.prospect?.identity;
  if (identity && typeof identity === 'object') {
    console.log('  Type: ' + (Array.isArray(identity) ? 'ARRAY' : 'OBJECT'));
    console.log('  Keys: ' + Object.keys(identity).map(k => `"${k}"`).join(', '));
  } else {
    console.log('  ⚠ identity is NOT an object:', typeof identity);
  }

  console.log('\n[D] Extracted name values:');
  console.log(`  identity.contactName: ${JSON.stringify(payload?.prospect?.identity?.contactName)}`);
  console.log(`  identity.companyName: ${JSON.stringify(payload?.prospect?.identity?.companyName)}`);
  console.log(`  identity.leadId: ${JSON.stringify(payload?.prospect?.identity?.leadId)}`);

  console.log('\n[E] Simulate text() function (returns value if string, else empty string):');
  const text = (value: unknown) => typeof value === 'string' ? value : '';
  const contactName = payload?.prospect?.identity?.contactName;
  const companyName = payload?.prospect?.identity?.companyName;

  console.log(`  text(contactName): "${text(contactName)}"`);
  console.log(`  text(companyName): "${text(companyName)}"`);
  console.log(`  text(contactName) || text(companyName): "${text(contactName) || text(companyName)}"`);

  console.log('\n[F] Full brief_payload (JSON):');
  console.log(JSON.stringify(payload, null, 2));

  console.log('\n================================================================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
