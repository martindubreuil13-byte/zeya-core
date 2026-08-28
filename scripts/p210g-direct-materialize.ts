#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function materialize() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  console.log('\n╔════════════════════════════════════════════════════════════════╗\n');
  console.log('  P2.10G — DIRECT CHAIN MATERIALIZATION\n');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  try {
    const missions = await db
      .from('operating_missions')
      .select('*')
      .eq('owner_id', QA_OWNER_ID)
      .eq('lead_id', LEAD_ID)
      .order('created_at', { ascending: false })
      .limit(3);

    const latestMission = missions.data?.[0];
    const contextRes = await db.from('mission_execution_contexts').select('*').eq('mission_id', latestMission?.id).single();
    const context = contextRes.data;
    const briefRes = await db.from('worker_briefs').select('*').eq('execution_context_id', context?.id).order('created_at', { ascending: false }).limit(1).single();
    const dispatchRes = await db.from('dispatches').select('*').eq('mission_id', latestMission?.id).order('created_at', { ascending: false }).limit(1).single();
    const dispatch = dispatchRes.data;

    console.log('RETRIEVED CHAIN:\n');
    console.log(`✓ Mission: ${latestMission?.id}`);
    console.log(`✓ Context: ${context?.id}`);
    console.log(`✓ Brief: ${briefRes.data?.id}`);
    console.log(`✓ Dispatch: ${dispatch?.dispatch_id}`);
    console.log(`  execution_allowed: ${dispatch?.execution_allowed}\n`);

    if (dispatch?.execution_allowed === true) {
      console.log('CREATING AUTHORIZATION:\n');

      const authRes = await db.rpc('zeya_authorize_governed_execution', {
        p_owner_id: QA_OWNER_ID,
        p_dispatch_id: dispatch.dispatch_id,
        p_operation_id: generateUuid(),
        p_purpose: 'controlled_preview_voice_qa',
      });

      if (authRes.error) {
        console.log(`✗ Authorization failed: ${authRes.error.message}\n`);
        throw new Error(authRes.error.message);
      }

      const auth = authRes.data?.[0];
      console.log(`✓ Authorization: ${auth.authorization_id}`);
      console.log(`  Status: ${auth.status}\n`);

      console.log('═══════════════════════════════════════════════════════════════\n');
      console.log('✓ P2.10G — FINAL EXECUTABLE CHAIN MATERIALIZED\n');
      console.log(`Mission: ${latestMission?.id}`);
      console.log(`Context: ${context?.id}`);
      console.log(`Brief: ${briefRes.data?.id}`);
      console.log(`Dispatch: ${dispatch.dispatch_id}`);
      console.log(`Authorization: ${auth.authorization_id}`);
      console.log(`Status: ${auth.status} (unconsumed)\n`);
      console.log('═══════════════════════════════════════════════════════════════\n');
    } else {
      throw new Error(`Dispatch execution_allowed=${dispatch?.execution_allowed}`);
    }
  } catch (err) {
    console.error('\n❌ FAILURE:', err instanceof Error ? err.message : 'unknown error\n');
    process.exit(1);
  }
}

materialize();
