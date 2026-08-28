import { createClient } from '@supabase/supabase-js';

async function getSchema(url: string, key: string, label: string) {
  const db = createClient(url, key, { auth: { persistSession: false } });
  
  console.log(`\n=== ${label} ===`);
  
  // Key tables from code
  const tables = [
    'governed_execution_attempts',
    'voice_representation_lineage',
    'voice_conversation_outputs',
    'prospect_observations',
    'mission_execution_outcomes',
    'businesses',
    'representation_versions',
  ];
  
  console.log('Schema verification:');
  for (const table of tables) {
    const { error, count } = await db.from(table).select('*', { count: 'exact', head: true });
    const status = error ? `❌ ${error.message.substring(0, 40)}` : `✓ exists`;
    console.log(`  ${table}: ${status}`);
  }
}

async function main() {
  const prodUrl = 'https://eqdhftogzzlkpjebgbue.supabase.co';
  const prevUrl = 'https://hdjojgvvlojbhgidirht.supabase.co';
  const prodKey = process.env.PROD_KEY!;
  const prevKey = process.env.PREV_KEY!;

  await getSchema(prodUrl, prodKey, 'PRODUCTION (eqdhftogzzlkpjebgbue)');
  await getSchema(prevUrl, prevKey, 'PREVIEW (hdjojgvvlojbhgidirht)');
  
  console.log('\n✓ Schema verification complete');
}

main().catch(err => console.error('ERROR:', err.message));
