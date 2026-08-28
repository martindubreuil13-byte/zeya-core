#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, serviceRoleKey);

const CONVERSATION_ID = 'conv_5701m11vt5zff5s8p5m9mk41ba6g';
const ATTEMPT_ID = 'c57f0773-148e-4517-bb91-eb5c61231bbf';
const BRIEF_ID = 'p25_brief_a83e4f05e2b9406db494e14981c727f0';
const MISSION_ID = 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd';
const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function main() {
  console.log('================================================================================');
  console.log('P2.10Q — POST-CALL LEARNING LOOP FORENSIC');
  console.log('================================================================================\n');

  // PART A: Raw Conversation Ingestion
  console.log('PART A — RAW CONVERSATION INGESTION\n');

  // Check if conversation exists and is linked
  const convRes = await db
    .from('conversations')
    .select('*')
    .eq('id', CONVERSATION_ID)
    .single();

  if (convRes.error) {
    console.log(`1. Conversation record: NOT FOUND`);
    console.log(`   Error: ${convRes.error.message}\n`);
  } else {
    const conv = convRes.data;
    console.log(`1. Conversation record: FOUND`);
    console.log(`   ID: ${conv.id}`);
    console.log(`   Status: ${conv.status}`);
    console.log(`   Created: ${conv.created_at}`);
    console.log(`   Updated: ${conv.updated_at}`);
    console.log(`   Provider call ID: ${conv.provider_call_id}`);
    console.log(`   Transcript available: ${conv.transcript ? 'YES' : 'NO'}\n`);
  }

  // PART B: Interpretation
  console.log('PART B — INTERPRETATION\n');

  const interpRes = await db
    .from('conversation_interpretations')
    .select('*')
    .eq('conversation_id', CONVERSATION_ID)
    .single();

  if (interpRes.error) {
    console.log(`1. Interpretation record: NOT FOUND`);
    console.log(`   Error: ${interpRes.error.message}`);
    console.log(`   → Post-call interpretation pipeline may not have run yet\n`);
  } else {
    const interp = interpRes.data;
    console.log(`1. Interpretation record: FOUND`);
    console.log(`   ID: ${interp.id}`);
    console.log(`   Schema: ${interp.interpretation?.schemaVersion || '(unknown)'}`);
    console.log(`   Created: ${interp.created_at}`);
    console.log(`   Interpretation keys: ${interp.interpretation ? Object.keys(interp.interpretation).join(', ') : '(none)'}\n`);

    if (interp.interpretation && typeof interp.interpretation === 'object') {
      const keys = Object.keys(interp.interpretation);
      console.log(`2. Interpretation content (${keys.length} fields):`);
      
      const keywordFields = ['pain', 'difficulty', 'prospect', 'contact', 'follow_up', 'interest', 'request', 'email', 'text'];
      keys.forEach(key => {
        const value = (interp.interpretation as Record<string, any>)[key];
        if (keywordFields.some(kw => key.toLowerCase().includes(kw))) {
          console.log(`   ${key}: ${JSON.stringify(value).substring(0, 150)}`);
        }
      });
    }
  }

  // PART C: Prospect Memory
  console.log('\nPART C — PROSPECT MEMORY\n');

  const obsRes = await db
    .from('prospect_observations')
    .select('*')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .gte('created_at', '2026-08-27T00:00:00Z')
    .order('created_at', { ascending: false });

  console.log(`Observations created after P2.10P (${obsRes.data?.length || 0} total):\n`);

  const keyMemories = [
    'finding contacts',
    'reaching contacts',
    'cold calling',
    'sales',
    'salesperson',
    'practice',
    'time',
    'written',
    'email',
    'text',
    'follow-up',
    'curious',
    'interest',
  ];

  obsRes.data?.forEach((obs, i) => {
    const isKeyMemory = keyMemories.some(kw => 
      obs.summary?.toLowerCase().includes(kw) ||
      obs.claim?.toLowerCase().includes(kw)
    );
    
    if (isKeyMemory || i < 10) {
      console.log(`${i + 1}. [${obs.kind}] "${obs.summary || obs.claim}"`);
      console.log(`   ID: ${obs.id}`);
      console.log(`   Confidence: ${obs.confidence || 'unset'}`);
      console.log(`   Polarity: ${obs.polarity || 'neutral'}`);
      console.log(`   Basis: ${obs.basis || 'unset'}`);
      console.log(`   Created: ${obs.created_at}\n`);
    }
  });

  // Check for specific expected memory items
  console.log('Key prospect statements capture status:');
  const expectations = [
    { text: 'finding contacts', should: 'CAPTURED' },
    { text: 'reaching contacts', should: 'CAPTURED' },
    { text: 'no reply', should: 'CAPTURED' },
    { text: 'time', should: 'CAPTURED' },
    { text: 'not a good salesperson', should: 'CAPTURED' },
    { text: 'written information', should: 'CAPTURED' },
    { text: 'email', should: 'CAPTURED' },
    { text: 'talk later', should: 'CAPTURED' },
  ];

  expectations.forEach(exp => {
    const found = obsRes.data?.some(obs =>
      (obs.summary?.toLowerCase() || '').includes(exp.text.toLowerCase()) ||
      (obs.claim?.toLowerCase() || '').includes(exp.text.toLowerCase())
    );
    console.log(`  ${found ? '✓' : '✗'} ${exp.text}: ${found ? 'FOUND' : 'MISSING'}`);
  });

  // PART D: Memory Correction
  console.log('\n\nPART D — MEMORY CORRECTION ("People Economics")\n');

  const peopleObs = await db
    .from('prospect_observations')
    .select('*')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .ilike('summary', '%people%')
    .order('created_at', { ascending: false });

  if (peopleObs.data?.length) {
    console.log(`Found ${peopleObs.data.length} observations mentioning "people":`);
    peopleObs.data.forEach((obs, i) => {
      console.log(`${i + 1}. "${obs.summary}"`);
      console.log(`   Created: ${obs.created_at}`);
      console.log(`   Confidence: ${obs.confidence || 'unset'}`);
      console.log(`   Basis: ${obs.basis || '(stale/uncertain)'}\n`);
    });
  } else {
    console.log('(No observations with "people" found)');
  }

  // PART E: Mission Outcome
  console.log('\nPART E — MISSION OUTCOME\n');

  const outcomeRes = await db
    .from('mission_execution_outcomes')
    .select('*')
    .eq('mission_id', MISSION_ID)
    .order('created_at', { ascending: false });

  if (outcomeRes.data?.length) {
    const outcome = outcomeRes.data[0];
    console.log(`1. Mission Outcome FOUND`);
    console.log(`   ID: ${outcome.id}`);
    console.log(`   Status: ${outcome.outcome?.status || '(unset)'}`);
    console.log(`   Prospect disposition: ${outcome.outcome?.contactResult || '(unset)'}`);
    console.log(`   Qualification: ${outcome.outcome?.qualificationResult || '(unset)'}`);
    console.log(`   Meeting: ${outcome.outcome?.meetingResult || '(unset)'}`);
    console.log(`   Follow-up required: ${outcome.outcome?.followUpRequired}`);
    console.log(`   Next action: ${outcome.outcome?.nextAction || '(unset)'}\n`);

    if (outcome.outcome?.contactResult === 'contacted' && outcome.outcome?.qualificationResult) {
      console.log(`✓ Prospect disposition captured as contacted`);
    } else {
      console.log(`⚠ Disposition may not be recorded correctly`);
    }
  } else {
    console.log(`No mission outcome found\n`);
  }

  // PART F: Veya Commitments
  console.log('\nPART F — UNSUPPORTED VEYA COMMITMENTS\n');

  const escalationRes = await db
    .from('prospect_observation_relations')
    .select('*')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .in('kind', ['escalation', 'follow_up_action', 'owner_action'])
    .gte('created_at', '2026-08-27T00:00:00Z')
    .order('created_at', { ascending: false });

  if (escalationRes.data?.length) {
    console.log(`Found ${escalationRes.data.length} escalations/follow-ups:`);
    escalationRes.data.forEach((rel, i) => {
      console.log(`${i + 1}. [${rel.kind}] "${rel.summary}"`);
      console.log(`   Status: ${rel.status}`);
      console.log(`   Created: ${rel.created_at}\n`);
    });
  } else {
    console.log(`⚠ No escalations/follow-ups recorded`);
    console.log(`   Prospect request "send written information" may not have been captured\n`);
  }

  // PART G: Learning Loop Lifecycle
  console.log('\nPART G — LEARNING LOOP LIFECYCLE\n');

  const stages = [
    { stage: 'Conversation ingestion', result: convRes.error ? 'FAIL' : 'PASS' },
    { stage: 'Interpretation', result: interpRes.error ? 'FAIL' : 'PASS' },
    { stage: 'Prospect observations', result: obsRes.data?.length ? 'PASS' : 'PARTIAL' },
    { stage: 'Memory corrections', result: peopleObs.data?.length ? 'PASS' : 'FAIL' },
    { stage: 'Mission outcome', result: outcomeRes.data?.length ? 'PASS' : 'FAIL' },
    { stage: 'Escalation capture', result: escalationRes.data?.length ? 'PASS' : 'PARTIAL' },
  ];

  stages.forEach(s => {
    console.log(`${s.result === 'PASS' ? '✓' : s.result === 'PARTIAL' ? '~' : '✗'} ${s.stage}: ${s.result}`);
  });

  // Final verdict
  console.log('\n================================================================================');
  const allPass = stages.every(s => s.result === 'PASS');
  const allPassOrPartial = stages.every(s => s.result !== 'FAIL');

  if (allPass) {
    console.log('P2.10Q — POST-CALL LEARNING LOOP LIVE PASSED');
  } else if (allPassOrPartial) {
    console.log('P2.10Q — POST-CALL LEARNING LOOP PARTIAL / REPAIR REQUIRED');
  } else {
    console.log('HOLD — POST-CALL LEARNING PIPELINE FAILED');
  }
  console.log('================================================================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
