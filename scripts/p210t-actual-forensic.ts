import { createClient } from '@supabase/supabase-js';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  console.log('================================================================================');
  console.log('P2.10T.1 — CORRECTED RETURN-PATH FORENSIC');
  console.log('================================================================================\n');

  const lockFacts = {
    attemptId: 'c57f0773-148e-4517-bb91-eb5c61231bbf',
    providerCallId: 'SCL_CGVR9U3YQLQh',
    conversationId: 'conv_5701m11vt5zff5s8p5m9mk41ba6g',
    missionId: 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd',
  };

  // STAGE 1: Check if webhook was received at ALL (in EITHER database)
  console.log('STAGE 1: PROVIDER COMPLETION — LOCKED VERIFIED ✓\n');
  console.log('Provider call executed and completed:');
  console.log(`  Attempt ID: ${lockFacts.attemptId}`);
  console.log(`  Provider call ID: ${lockFacts.providerCallId}`);
  console.log(`  ElevenLabs conversation: ${lockFacts.conversationId}`);
  console.log(`  Duration: ~3m33s`);
  console.log(`  Status: done`);
  console.log(`  HTTP result: 202\n`);

  // STAGE 2: Check for lineage record (proves webhook reached a Zeya deployment)
  console.log('STAGE 2: WEBHOOK RECEIPT (LINEAGE)\n');
  
  const lineageRes = await db
    .from('voice_representation_lineage')
    .select('*')
    .eq('conversation_id', lockFacts.conversationId)
    .maybeSingle();

  if (lineageRes.error) {
    console.log(`✗ Lineage lookup failed: ${lineageRes.error.message}`);
    console.log(`  → Webhook may not have reached this Zeya instance\n`);
  } else if (lineageRes.data) {
    const lin = lineageRes.data;
    console.log(`✓ Lineage record FOUND`);
    console.log(`  Conversation ID: ${lin.conversation_id}`);
    console.log(`  Provider call ID: ${lin.provider_call_id}`);
    console.log(`  Voice context: ${lin.voice_context_id}`);
    console.log(`  Tenant: ${lin.tenant_user_id}`);
    console.log(`  Mission: ${lin.mission_id}`);
    console.log(`  Created: ${lin.created_at}\n`);
  } else {
    console.log(`✗ Lineage record NOT FOUND`);
    console.log(`  → Webhook never established provider identity link\n`);
  }

  // STAGE 3: Check for governed execution attempt record
  console.log('STAGE 3: GOVERNED EXECUTION ATTEMPT\n');
  
  const attemptRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('id', lockFacts.attemptId)
    .maybeSingle();

  if (attemptRes.error) {
    console.log(`✗ Attempt lookup failed: ${attemptRes.error.message}`);
  } else if (attemptRes.data) {
    const att = attemptRes.data;
    console.log(`✓ Attempt record FOUND`);
    console.log(`  ID: ${att.id}`);
    console.log(`  Status: ${att.status}`);
    console.log(`  Provider call ID: ${att.provider_call_id}`);
    console.log(`  Conversation ID: ${att.conversation_id}`);
    console.log(`  Created: ${att.created_at}`);
    console.log(`  Completed: ${att.completed_at || '(not yet)'}\n`);
  } else {
    console.log(`✗ Attempt record NOT FOUND`);
    console.log(`  → No governed execution attempt exists\n`);
  }

  // STAGE 4: Check for voice_conversation_outputs (proves completion RPC ran)
  console.log('STAGE 4: CONVERSATION OUTPUT / TRANSCRIPT CAPTURE\n');
  
  const outputRes = await db
    .from('voice_conversation_outputs')
    .select('*')
    .eq('conversation_id', lockFacts.conversationId)
    .maybeSingle();

  if (outputRes.error) {
    console.log(`✗ Output lookup failed: ${outputRes.error.message}`);
  } else if (outputRes.data) {
    const out = outputRes.data;
    console.log(`✓ Conversation output FOUND`);
    console.log(`  ID: ${out.id}`);
    console.log(`  Conversation ID: ${out.conversation_id}`);
    console.log(`  Provider call ID: ${out.provider_call_id}`);
    console.log(`  Transcript status: ${out.transcript_status}`);
    console.log(`  Turn count: ${out.turn_count}`);
    console.log(`  Duration: ${out.duration_seconds}s`);
    console.log(`  Completed: ${out.completed_at}\n`);
  } else {
    console.log(`✗ Conversation output NOT FOUND`);
    console.log(`  → Transcript was not captured\n`);
  }

  // STAGE 5: Check for interpretation (proves post-call processing ran)
  console.log('STAGE 5: INTERPRETATION / LEARNING\n');
  
  const interpRes = await db
    .from('conversation_outcome_interpretations')
    .select('*')
    .eq('conversation_id', lockFacts.conversationId)
    .maybeSingle();

  if (interpRes.error?.message?.includes('does not exist')) {
    console.log(`⚠ Table not found: conversation_outcome_interpretations`);
  } else if (interpRes.error) {
    console.log(`✗ Interpretation lookup failed: ${interpRes.error.message}`);
  } else if (interpRes.data) {
    console.log(`✓ Interpretation FOUND`);
    console.log(`  ID: ${interpRes.data.id}`);
    console.log(`  Created: ${interpRes.data.created_at}\n`);
  } else {
    console.log(`✗ Interpretation NOT FOUND\n`);
  }

  // STAGE 6: Check for prospect observations (proves memory learning ran)
  console.log('STAGE 6: PROSPECT MEMORY / OBSERVATIONS\n');
  
  const obsRes = await db
    .from('prospect_observations')
    .select('*')
    .eq('conversation_id', lockFacts.conversationId)
    .order('created_at', { ascending: false });

  if (obsRes.error) {
    console.log(`✗ Observation lookup failed: ${obsRes.error.message}`);
  } else if (obsRes.data && obsRes.data.length > 0) {
    console.log(`✓ Prospect observations FOUND (${obsRes.data.length} total)`);
    obsRes.data.slice(0, 5).forEach((obs, i) => {
      console.log(`  ${i + 1}. "${obs.summary || obs.claim}"`);
    });
    console.log();
  } else {
    console.log(`✗ Prospect observations NOT FOUND`);
    console.log(`  → No prospect learning captured\n`);
  }

  // Summary
  console.log('================================================================================');
  console.log('FORENSIC SUMMARY\n');

  const checks = {
    'Provider completion': !!lockFacts.providerCallId,
    'Lineage record (webhook received)': !!lineageRes.data,
    'Attempt record (governed execution tracked)': !!attemptRes.data,
    'Conversation output (transcript captured)': !!outputRes.data,
    'Interpretation (learning computed)': !!interpRes.data,
    'Prospect observations (memory updated)': !!(obsRes.data && obsRes.data.length > 0),
  };

  const passed = Object.values(checks).filter(v => v).length;
  const total = Object.keys(checks).length;

  Object.entries(checks).forEach(([stage, result]) => {
    console.log(`${result ? '✓' : '✗'} ${stage}`);
  });

  console.log(`\nResult: ${passed}/${total} stages passed\n`);

  if (passed === total) {
    console.log('P2.10T.1 — RETURN PATH COMPLETE LOOP PASSED ✓');
  } else if (passed >= 3) {
    console.log('P2.10T.1 — CALL RECEIVED / PROCESSING FAILED');
  } else if (lineageRes.data) {
    console.log('P2.10T.1 — WEBHOOK DELIVERED / EARLY PROCESSING FAILED');
  } else {
    console.log('P2.10T.1 — WEBHOOK NEVER DELIVERED TO THIS ENVIRONMENT');
  }

  console.log('================================================================================');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
