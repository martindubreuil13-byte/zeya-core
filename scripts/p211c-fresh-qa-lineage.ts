import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

async function createFreshQALineage() {
  console.log('=== P2.11C PHASE 2: FRESH QA LINEAGE ===\n');

  // Known QA fixture
  const qaOwnerId = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
  const qaLeadId = '16c2ab57-64a7-4339-a843-4411732221ce';

  // Fresh UUIDs for this call chain
  const missionId = randomUUID();
  const executionContextId = randomUUID();
  const dispatchId = `p25_dispatch_${randomUUID().replace(/-/g, '').substring(0, 32)}`;
  const briefId = `p25_brief_${randomUUID().replace(/-/g, '').substring(0, 32)}`;
  const authId = randomUUID();
  const operationId = randomUUID();

  console.log('Fresh QA Lineage IDs:\n');
  console.log(`  Mission ID:           ${missionId}`);
  console.log(`  Execution Context ID: ${executionContextId}`);
  console.log(`  Worker Brief ID:      ${briefId}`);
  console.log(`  Dispatch ID:          ${dispatchId}`);
  console.log(`  Authorization ID:     ${authId}`);
  console.log(`  Operation ID:         ${operationId}`);

  console.log(`\n  QA Owner:  ${qaOwnerId}`);
  console.log(`  QA Lead:   ${qaLeadId}`);

  console.log('\n✓ Fresh lineage ready for Phase 3 provider execution');
  console.log('✓ No database mutations performed (fresh IDs only)');
  console.log('\n=== PHASE 2 RESULT ===');
  console.log('✅ STOP HERE — Awaiting user authorization for Phase 3');

  return {
    missionId,
    executionContextId,
    briefId,
    dispatchId,
    authId,
    operationId,
    qaOwnerId,
    qaLeadId,
  };
}

createFreshQALineage().catch(err => console.error('ERROR:', err.message));
