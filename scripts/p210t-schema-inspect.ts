import { createClient } from '@supabase/supabase-js';

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  );

  const tables = [
    'voice_conversation_outputs',
    'prospect_observations',
    'prospect_observation_relations',
    'mission_execution_outcomes',
    'conversation_outcome_interpretations',
    'conversation_reviews'
  ];

  console.log('Inspecting table schemas in Preview Supabase:\n');

  for (const table of tables) {
    const { data, error } = await db
      .from(table)
      .select('*', { count: 'exact', head: true });

    if (error?.message?.includes('Could not find')) {
      console.log(`✗ ${table} — TABLE DOES NOT EXIST`);
    } else if (error?.message?.includes('does not exist')) {
      console.log(`✗ ${table} — SCHEMA ERROR: ${error.message}`);
    } else if (error) {
      console.log(`? ${table} — ${error.message}`);
    } else {
      console.log(`✓ ${table} — EXISTS`);
    }
  }

  console.log('\n\nAttempting to query attempt record for column inspection:\n');
  
  const att = await db.from('governed_execution_attempts').select('*').limit(1);
  if (!att.error && att.data && att.data.length > 0) {
    console.log('Columns in governed_execution_attempts:');
    Object.keys(att.data[0]).forEach(col => console.log(`  - ${col}`));
  }

  console.log('\n\nAttempting to query lineage record for column inspection:\n');
  
  const lin = await db.from('voice_representation_lineage').select('*').limit(1);
  if (!lin.error && lin.data && lin.data.length > 0) {
    console.log('Columns in voice_representation_lineage:');
    Object.keys(lin.data[0]).forEach(col => console.log(`  - ${col}`));
  }
}

main().catch(err => console.error('Error:', err));
