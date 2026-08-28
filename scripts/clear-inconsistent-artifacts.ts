#!/usr/bin/env npx tsx
/**
 * P2.10D REPAIR — CLEAR INCONSISTENT ARTIFACTS
 * 
 * The old dispatch/brief are in inconsistent state:
 * - source='experience_conversation' (not governed)
 * - but execution_context_id IS SET (marked as governed)
 * - this blocks creation of correct V3 dispatch/brief
 * 
 * Solution: Clear execution_context_id to un-govern them, then delete,
 * then create correct V3 dispatch/brief with full P2.9D semantics.
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const OLD_BRIEF_ID = 'p25_brief_95ff78b981714a69aa4aeccfe355e931';
const OLD_DISPATCH_ID = 'p25_dispatch_a7250686c6d74ee2ba7761dc0a5bb992';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== CLEAR INCONSISTENT ARTIFACTS ===\n');

  try {
    // Step 1: Clear execution_context_id on brief to un-govern it
    console.log('Step 1: Un-governing old brief...');
    const briefUpdate = await db
      .from('worker_briefs')
      .update({ execution_context_id: null, representation_version_id: null, mandate_outcome_package_id: null, lead_id: null, channel: null, worker_role: null })
      .eq('id', OLD_BRIEF_ID)
      .eq('owner_id', QA_OWNER_ID);

    if (briefUpdate.error) {
      console.error('  ✗ Failed:', briefUpdate.error.message);
    } else {
      console.log('  ✓ Brief un-governed');
    }

    // Step 2: Clear execution_context_id on dispatch to un-govern it
    console.log('Step 2: Un-governing old dispatch...');
    const dispatchUpdate = await db
      .from('dispatches')
      .update({ execution_context_id: null, representation_version_id: null, mandate_outcome_package_id: null, lead_id: null, channel: null, worker_role: null })
      .eq('dispatch_id', OLD_DISPATCH_ID)
      .eq('owner_id', QA_OWNER_ID);

    if (dispatchUpdate.error) {
      console.error('  ✗ Failed:', dispatchUpdate.error.message);
    } else {
      console.log('  ✓ Dispatch un-governed');
    }

    // Step 3: Delete old brief (should now be allowed)
    console.log('Step 3: Deleting old brief...');
    const briefDelete = await db
      .from('worker_briefs')
      .delete()
      .eq('id', OLD_BRIEF_ID)
      .eq('owner_id', QA_OWNER_ID);

    if (briefDelete.error) {
      console.error('  ✗ Failed:', briefDelete.error.message);
    } else {
      console.log('  ✓ Brief deleted');
    }

    // Step 4: Delete old dispatch (should now be allowed)
    console.log('Step 4: Deleting old dispatch...');
    const dispatchDelete = await db
      .from('dispatches')
      .delete()
      .eq('dispatch_id', OLD_DISPATCH_ID)
      .eq('owner_id', QA_OWNER_ID);

    if (dispatchDelete.error) {
      console.error('  ✗ Failed:', dispatchDelete.error.message);
    } else {
      console.log('  ✓ Dispatch deleted');
    }

    console.log('\n✓ Inconsistent artifacts cleared. Ready for V3 dispatch creation.\n');

  } catch (err) {
    console.error('❌ Cleanup failed:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  }
}

run();
