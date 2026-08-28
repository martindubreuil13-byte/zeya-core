#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl!, serviceRoleKey!);

async function main() {
  console.log('Checking actual database tables and attempting alternative paths...\n');

  // Try different table names for conversations
  const tablesToCheck = [
    'conversations',
    'conversation',
    'provider_conversations',
    'call_conversations',
    'elevenlabs_calls',
  ];

  for (const table of tablesToCheck) {
    try {
      const res = await db.from(table).select('id', { count: 'exact' }).limit(1);
      if (!res.error) {
        console.log(`✓ Found table: ${table}`);
        const sampleRes = await db.from(table).select('*').limit(1);
        if (sampleRes.data?.length) {
          console.log(`  Columns: ${Object.keys(sampleRes.data[0]).join(', ')}\n`);
        }
        break;
      }
    } catch (err) {
      // Continue
    }
  }

  // Try different names for interpretations
  const interpTables = [
    'conversation_interpretations',
    'interpretations',
    'call_interpretations',
  ];

  for (const table of interpTables) {
    try {
      const res = await db.from(table).select('id', { count: 'exact' }).limit(1);
      if (!res.error) {
        console.log(`✓ Found table: ${table}`);
        break;
      }
    } catch (err) {
      // Continue
    }
  }

  // Check for attempt records
  const attemptRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('id', 'c57f0773-148e-4517-bb91-eb5c61231bbf')
    .single();

  if (!attemptRes.error && attemptRes.data) {
    console.log('\n✓ Attempt record found:');
    console.log(JSON.stringify(attemptRes.data, null, 2));
  }
}

main().catch(err => console.error(err));
