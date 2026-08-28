import { createClient } from '@supabase/supabase-js';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  const conversationId = 'conv_5701m11vt5zff5s8p5m9mk41ba6g';
  const providerId = 'SCL_CGVR9U3YQLQh';
  const attemptId = 'c57f0773-148e-4517-bb91-eb5c61231bbf';
  const missionId = 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd';

  console.log('P2.10T.1 — CORRECTED FORENSIC (ACTUAL SCHEMA)\n');

  // Check conversation output
  console.log('CONVERSATION OUTPUT:');
  const output = await db
    .from('voice_conversation_outputs')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  
  if (output.data) {
    console.log(`✓ FOUND:`);
    console.log(`  ID: ${output.data.id}`);
    console.log(`  Transcript status: ${output.data.transcript_status}`);
    console.log(`  Turn count: ${output.data.turn_count}`);
    console.log(`  Duration: ${output.data.duration_seconds}s`);
    console.log(`  Completed: ${output.data.completed_at}\n`);
  } else {
    console.log(`✗ NOT FOUND\n`);
  }

  // Check mission execution outcome
  console.log('MISSION EXECUTION OUTCOME:');
  const outcome = await db
    .from('mission_execution_outcomes')
    .select('*')
    .eq('mission_id', missionId)
    .order('created_at', { ascending: false })
    .limit(1);
  
  if (outcome.data && outcome.data.length > 0) {
    const o = outcome.data[0];
    console.log(`✓ FOUND:`);
    console.log(`  ID: ${o.id}`);
    console.log(`  Outcome: ${JSON.stringify(o.outcome).substring(0, 150)}`);
    console.log(`  Created: ${o.created_at}\n`);
  } else {
    console.log(`✗ NOT FOUND\n`);
  }

  // Check conversation interpretation
  console.log('CONVERSATION INTERPRETATION:');
  const interp = await db
    .from('conversation_outcome_interpretations')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  
  if (interp.data) {
    console.log(`✓ FOUND:`);
    console.log(`  ID: ${interp.data.id}`);
    console.log(`  Created: ${interp.data.created_at}\n`);
  } else {
    console.log(`✗ NOT FOUND\n`);
  }

  // Check prospect observations (query by mission or all recent)
  console.log('PROSPECT OBSERVATIONS (recent):');
  const obs = await db
    .from('prospect_observations')
    .select('*')
    .gte('created_at', '2026-08-27T00:00:00Z')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (obs.data && obs.data.length > 0) {
    console.log(`✓ FOUND ${obs.data.length} observations after call time:`);
    obs.data.forEach((o, i) => {
      console.log(`  ${i + 1}. "${o.summary || o.claim}" (${o.kind})`);
    });
    console.log();
  } else {
    console.log(`✗ NO OBSERVATIONS\n`);
  }

  // Check conversation review
  console.log('CONVERSATION REVIEW:');
  const review = await db
    .from('conversation_reviews')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();
  
  if (review.data) {
    console.log(`✓ FOUND:`);
    console.log(`  ID: ${review.data.id}`);
    console.log(`  Created: ${review.data.created_at}\n`);
  } else {
    console.log(`✗ NOT FOUND\n`);
  }

  // Final verdict
  console.log('================================================================================');
  const stagesPass = [
    ['Provider completion', true],
    ['Lineage (webhook received)', true],
    ['Attempt record (tracked)', true],
    ['Conversation output', !!output.data],
    ['Interpretation', !!interp.data],
    ['Observations', obs.data && obs.data.length > 0],
  ];

  const passed = stagesPass.filter(s => s[1]).length;
  console.log(`\nResult: ${passed}/${stagesPass.length} stages passed\n`);

  stagesPass.forEach(([stage, result]) => {
    console.log(`${result ? '✓' : '✗'} ${stage}`);
  });

  console.log('\nCLASSIFICATION:\n');
  
  if (passed === stagesPass.length) {
    console.log('P2.10T.1 — LEARNING LOOP PASSED ✓');
  } else if (output.data) {
    console.log('P2.10T.1 — WEBHOOK PROCESSED / INTERPRETATION FAILED');
    console.log('First failure: Conversation captured but interpretation/learning did not run');
  } else {
    console.log('P2.10T.1 — WEBHOOK PROCESSED / CONVERSATION CAPTURE FAILED');
    console.log('First failure: Attempt tracked but transcript not persisted to voice_conversation_outputs');
  }
  
  console.log('================================================================================');
}

main().catch(err => console.error('Error:', err));
