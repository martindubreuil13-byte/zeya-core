#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

async function verify() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\n╔════════════════════════════════════════════════════════════════╗\n');
  console.log('  PREVIEW FUNCTION STATE VERIFICATION\n');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Test with a known dispatch
  const dispatchRes = await db
    .from('dispatches')
    .select('*')
    .eq('execution_allowed', true)
    .eq('status', 'draft')
    .limit(1)
    .single();

  if (dispatchRes.data) {
    const d = dispatchRes.data;
    console.log(`Found dispatch: ${d.dispatch_id}`);
    console.log(`execution_allowed: ${d.execution_allowed}`);
    console.log(`status: ${d.status}\n`);

    const authRes = await db.rpc('zeya_authorize_governed_execution', {
      p_owner_id: d.owner_id,
      p_dispatch_id: d.dispatch_id,
      p_operation_id: crypto.randomUUID(),
      p_purpose: 'controlled_preview_voice_qa',
    });

    if (authRes.error) {
      console.log(`✗ Authorization FAILED: ${authRes.error.message}`);
      console.log(`  Status: P2.10F NOT DEPLOYED or P2.10H needed\n`);
    } else {
      console.log(`✓ Authorization SUCCEEDED`);
      console.log(`  Status: P2.10F IS DEPLOYED\n`);
    }
  } else {
    console.log(`No executable draft dispatches found in Preview\n`);
    console.log(`Cannot verify P2.10F function state\n`);
  }

  console.log('═════════════════════════════════════════════════════════════════\n');
}

verify().catch(e => { console.error(e); process.exit(1); });
