#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, serviceRoleKey);

const CONVERSATION_ID = 'conv_5701m11vt5zff5s8p5m9mk41ba6g';
const BRIEF_ID = 'p25_brief_a83e4f05e2b9406db494e14981c727f0';
const MISSION_ID = 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd';
const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function main() {
  console.log('================================================================================');
  console.log('P2.10Q — POST-CALL BEHAVIORAL GOVERNANCE DIAGNOSIS');
  console.log('================================================================================\n');

  // [1] Load frozen brief and constraints
  console.log('[1] FROZEN GOVERNANCE CONSTRAINTS\n');
  const briefRes = await db
    .from('worker_briefs')
    .select('brief_payload')
    .eq('id', BRIEF_ID)
    .single();

  if (briefRes.error) {
    console.error(`Error: ${briefRes.error.message}`);
    process.exit(1);
  }

  const payload = briefRes.data.brief_payload as Record<string, any>;
  const capabilities = payload.capabilities || {};
  const authority = payload.authority || {};
  const conversationPolicy = payload.conversationPolicy || {};

  console.log('Capabilities (frozen):');
  console.log(`  scheduling:  ${capabilities.scheduling}`);
  console.log(`  email:       ${capabilities.email}`);
  console.log(`  reminders:   ${capabilities.reminders}`);

  console.log('\nAuthority (frozen):');
  console.log(`  commitments: ${authority.commitments?.disposition || 'unknown'}`);
  console.log(`  pricing:     ${authority.pricing?.disposition || 'unknown'}`);
  console.log(`  meetingBooking: ${authority.meetingBooking?.disposition || 'unknown'}`);

  console.log('\nOpening Contract (frozen):');
  console.log(`  introductionAlreadySpoken: ${payload.openingContract?.introductionAlreadySpoken}`);
  console.log(`  relationshipState: ${payload.prospect?.context?.relationshipState}`);

  // [2] Load prospect memory to check "People economics" source
  console.log('\n[2] PROSPECT MEMORY - "PEOPLE ECONOMICS" SOURCE\n');

  const obsRes = await db
    .from('prospect_observations')
    .select('id, kind, summary, basis, confidence, uncertainty, polarity, created_at')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .order('created_at', { ascending: false })
    .limit(20);

  if (obsRes.data?.length) {
    const peopleEconomicsObs = obsRes.data.find(o => 
      o.summary?.toLowerCase().includes('people economics') ||
      o.summary?.toLowerCase().includes('people') ||
      o.kind === 'qualification_evidence'
    );

    if (peopleEconomicsObs) {
      console.log(`Found observation: "${peopleEconomicsObs.summary}"`);
      console.log(`  Kind:         ${peopleEconomicsObs.kind}`);
      console.log(`  Basis:        ${peopleEconomicsObs.basis || '(not specified)'}`);
      console.log(`  Confidence:   ${peopleEconomicsObs.confidence || '(not specified)'}`);
      console.log(`  Uncertainty:  ${peopleEconomicsObs.uncertainty || '(not specified)'}`);
      console.log(`  Polarity:     ${peopleEconomicsObs.polarity || '(not specified)'}`);
      console.log(`  Created:      ${peopleEconomicsObs.created_at}`);
    } else {
      console.log('(No "People economics" observation found in recent memory)');
    }

    console.log('\nAll recent qualification observations:');
    obsRes.data
      .filter(o => o.kind === 'qualification_evidence' || o.kind === 'clarification')
      .slice(0, 5)
      .forEach((obs, i) => {
        console.log(`  ${i + 1}. [${obs.kind}] "${obs.summary.substring(0, 70)}..."`);
      });
  }

  // [3] Load post-call artifacts
  console.log('\n[3] POST-CALL ARTIFACTS\n');

  const outcomeRes = await db
    .from('mission_execution_outcomes')
    .select('id, result, mission_id, created_at')
    .eq('mission_id', MISSION_ID)
    .order('created_at', { ascending: false })
    .limit(1);

  if (outcomeRes.data?.length) {
    const outcome = outcomeRes.data[0];
    console.log(`Mission Outcome:     ${outcome.id}`);
    console.log(`Result: ${JSON.stringify(outcome.result).substring(0, 200)}...`);
    console.log(`Created: ${outcome.created_at}`);
  }

  const interpRes = await db
    .from('conversation_interpretations')
    .select('id, interpretation, created_at')
    .eq('conversation_id', CONVERSATION_ID)
    .limit(1);

  if (interpRes.data?.length) {
    const interp = interpRes.data[0];
    console.log(`\nConversation Interpretation: ${interp.id}`);
    console.log(`Interpretation: ${JSON.stringify(interp.interpretation).substring(0, 200)}...`);
  }

  // [4] Check for escalations/follow-up requests
  console.log('\n[4] PROSPECT REQUESTS / ESCALATIONS\n');

  const followUpObs = await db
    .from('prospect_observations')
    .select('id, kind, summary, polarity')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .in('kind', ['follow_up_request', 'escalation', 'action_required'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (followUpObs.data?.length) {
    console.log(`Found ${followUpObs.data.length} follow-up/escalation observations:`);
    followUpObs.data.forEach((obs, i) => {
      console.log(`  ${i + 1}. [${obs.kind}] "${obs.summary}"`);
      console.log(`     Polarity: ${obs.polarity || 'neutral'}`);
    });
  } else {
    console.log('(No follow-up requests recorded)');
  }

  // Check if "written information" request was captured
  const writeReqObs = await db
    .from('prospect_observations')
    .select('id, summary')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .ilike('summary', '%written%')
    .limit(5);

  if (writeReqObs.data?.length) {
    console.log('\nWritten information request captured:');
    writeReqObs.data.forEach(obs => {
      console.log(`  "${obs.summary}"`);
    });
  } else {
    console.log('\n⚠ No observation capturing "written information" request found');
  }

  // [5] Relations for colleague/follow-up commitment
  console.log('\n[5] PROSPECT RELATIONS / COMMITMENTS\n');

  const relRes = await db
    .from('prospect_observation_relations')
    .select('id, kind, summary, status')
    .eq('lead_id', LEAD_ID)
    .eq('owner_id', QA_OWNER_ID)
    .in('kind', ['escalation', 'callback', 'follow_up_action'])
    .order('created_at', { ascending: false })
    .limit(10);

  if (relRes.data?.length) {
    console.log(`Found ${relRes.data.length} relations:`);
    relRes.data.forEach((rel, i) => {
      console.log(`  ${i + 1}. [${rel.kind}] "${rel.summary}"`);
      console.log(`     Status: ${rel.status || 'unknown'}`);
    });
  } else {
    console.log('(No escalation/follow-up relations recorded)');
  }

  console.log('\n================================================================================');
  console.log('P2.10Q — BEHAVIORAL ANALYSIS READY');
  console.log('================================================================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
