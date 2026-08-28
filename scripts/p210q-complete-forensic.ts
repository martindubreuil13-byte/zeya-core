#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl!, serviceRoleKey!);

const ATTEMPT_ID = 'c57f0773-148e-4517-bb91-eb5c61231bbf';
const CONVERSATION_ID = 'conv_5701m11vt5zff5s8p5m9mk41ba6g';
const MISSION_ID = 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd';
const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function main() {
  console.log('================================================================================');
  console.log('P2.10Q — COMPLETE LEARNING LOOP FORENSIC');
  console.log('================================================================================\n');

  // [1] Check attempt completion state
  console.log('[1] EXECUTION ATTEMPT STATE\n');
  const attemptRes = await db
    .from('governed_execution_attempts')
    .select('*')
    .eq('id', ATTEMPT_ID)
    .single();

  const attempt = attemptRes.data;
  console.log(`Status:              ${attempt.status}`);
  console.log(`Claimed:             ${attempt.claimed_at}`);
  console.log(`Started:             ${attempt.started_at}`);
  console.log(`Completed:           ${attempt.completed_at || '(NOT COMPLETED)'}`);
  console.log(`Provider Call ID:    ${attempt.provider_call_id}`);
  console.log(`Conversation ID:     ${attempt.conversation_id}\n`);

  // [2] Interpretation records
  console.log('[2] CONVERSATION INTERPRETATIONS\n');
  const interpRes = await db
    .from('conversation_interpretations')
    .select('*')
    .eq('conversation_id', CONVERSATION_ID);

  if (interpRes.data?.length) {
    console.log(`Found ${interpRes.data.length} interpretation(s):`);
    interpRes.data.forEach((interp: any, i) => {
      console.log(`\n${i + 1}. ID: ${interp.id}`);
      console.log(`   Created: ${interp.created_at}`);
      console.log(`   Columns: ${Object.keys(interp).join(', ')}`);
      if (interp.interpretation) {
        console.log(`   Interpretation payload: ${JSON.stringify(interp.interpretation).substring(0, 300)}...`);
      }
    });
  } else {
    console.log('✗ NO INTERPRETATIONS FOUND');
    console.log('  → Post-call interpretation pipeline has not run\n');
  }

  // [3] Prospect observations AFTER P2.10P
  console.log('\n[3] PROSPECT OBSERVATIONS (After P2.10P)\n');
  const obsRes = await db
    .from('prospect_observations')
    .select('*')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .gte('created_at', '2026-08-27T14:00:00Z')
    .order('created_at', { ascending: false });

  if (obsRes.data?.length) {
    console.log(`Found ${obsRes.data.length} new observations:`);
    obsRes.data.forEach((obs: any, i) => {
      console.log(`\n${i + 1}. [${obs.kind}] "${obs.summary || obs.claim}"`);
      console.log(`   Created: ${obs.created_at}`);
    });
  } else {
    console.log('✗ NO NEW OBSERVATIONS CREATED');
    console.log('  → Prospect memory was not updated from this call\n');
  }

  // [4] Mission outcome
  console.log('\n[4] MISSION EXECUTION OUTCOME\n');
  const outcomeRes = await db
    .from('mission_execution_outcomes')
    .select('*')
    .eq('mission_id', MISSION_ID)
    .gte('created_at', '2026-08-27T14:00:00Z');

  if (outcomeRes.data?.length) {
    const outcome = outcomeRes.data[0];
    console.log('✓ MISSION OUTCOME FOUND');
    console.log(`  ID: ${outcome.id}`);
    console.log(`  Created: ${outcome.created_at}`);
    console.log(`  Result: ${JSON.stringify(outcome.result).substring(0, 200)}...`);
  } else {
    console.log('✗ NO MISSION OUTCOME CREATED');
    console.log('  → Commercial result was not recorded\n');
  }

  // [5] Escalations/follow-ups
  console.log('\n[5] PROSPECT ESCALATIONS / FOLLOW-UPS\n');
  const escalRes = await db
    .from('prospect_observation_relations')
    .select('*')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .gte('created_at', '2026-08-27T14:00:00Z');

  if (escalRes.data?.length) {
    console.log(`Found ${escalRes.data.length} escalations:`);
    escalRes.data.forEach((rel: any, i) => {
      console.log(`${i + 1}. [${rel.kind}] "${rel.summary}"`);
    });
  } else {
    console.log('✗ NO ESCALATIONS CREATED');
    console.log('  → Prospect request for written information not captured\n');
  }

  // [6] Summary
  console.log('\n================================================================================');
  console.log('LEARNING LOOP STATUS\n');

  const stages = [
    { name: 'Attempt execution', pass: attempt.status === 'dispatched', status: attempt.status },
    { name: 'Provider call', pass: !!attempt.provider_call_id, status: attempt.provider_call_id ? 'live' : 'not invoked' },
    { name: 'Attempt completion', pass: !!attempt.completed_at, status: attempt.completed_at ? 'completed' : 'INCOMPLETE' },
    { name: 'Interpretation', pass: interpRes.data?.length > 0, status: interpRes.data?.length ? 'created' : 'MISSING' },
    { name: 'Prospect memory', pass: obsRes.data?.length > 0, status: obsRes.data?.length ? 'updated' : 'MISSING' },
    { name: 'Mission outcome', pass: outcomeRes.data?.length > 0, status: outcomeRes.data?.length ? 'created' : 'MISSING' },
  ];

  stages.forEach(s => {
    console.log(`${s.pass ? '✓' : '✗'} ${s.name}: ${s.status}`);
  });

  console.log('\n================================================================================');

  if (!attempt.completed_at) {
    console.log('HOLD — POST-CALL COMPLETION INCOMPLETE\n');
    console.log('The execution attempt shows:');
    console.log(`  - Started: ${attempt.started_at}`);
    console.log(`  - Completed: ${attempt.completed_at || '(NULL)'}`);
    console.log('  - Provider Call ID assigned: YES');
    console.log('\nThe call was initiated with ElevenLabs, but the post-call ingestion');
    console.log('has not completed. The learning loop is blocked until completion.\n');
    console.log('Next: Check whether the ElevenLabs provider callback has been received,');
    console.log('and whether the conversation-complete webhook is firing.\n');
  } else if (!interpRes.data?.length) {
    console.log('HOLD — POST-CALL INTERPRETATION MISSING\n');
    console.log('The execution completed, but no interpretation was created.');
    console.log('The learning loop is blocked at the interpretation stage.\n');
  } else if (!obsRes.data?.length) {
    console.log('HOLD — PROSPECT MEMORY NOT UPDATED\n');
    console.log('Interpretation exists, but prospect memory was not updated.');
    console.log('The system did not learn from the conversation.\n');
  } else {
    console.log('P2.10Q — POST-CALL LEARNING LOOP LIVE PASSED\n');
  }

  console.log('================================================================================');
}

main().catch(err => console.error('Error:', err));
