#!/usr/bin/env npx tsx
/**
 * P2.10F STEP 1: INVESTIGATE EXECUTION_ALLOWED SEMANTICS
 * 
 * Trace history and semantics of the execution_allowed boolean
 * across P2.5, P2.6, P2.9C, P2.9D
 */

import { createClient } from '@supabase/supabase-js';

async function run() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║  P2.10F STEP 1: INVESTIGATE EXECUTION_ALLOWED SEMANTICS        ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  console.log('INVESTIGATION QUESTIONS:\n');

  console.log('1. WHAT DOES execution_allowed ACTUALLY CONTROL?\n');

  console.log('   Found in P2.5 (20260820_p25_governed_dispatch_preparation.sql):');
  console.log('   - Computed from mission constraint: NOT coalesce(doNotExecute, false)');
  console.log('   - Set on worker_briefs INSERT and dispatches INSERT');
  console.log('   - Immutable once set (protected by triggers)\n');

  console.log('   Found in P2.6 (20260821_p26_governed_execution_authorization.sql):');
  console.log('   - zeya_p26_dispatch_is_current() REJECTS if:');
  console.log('     execution_allowed IS DISTINCT FROM false');
  console.log('   - Translation: REQUIRES execution_allowed = false\n');

  console.log('   Found in P2.9C (20260824_p29c_prospect_context_consumption.sql):');
  console.log('   - SAME zeya_p26_dispatch_is_current() used\n');

  console.log('   Found in P2.9D (20260825_p29d_commercial_conversation_policy.sql):');
  console.log('   - SAME zeya_p26_dispatch_is_current() used\n');

  console.log('2. WHICH PATH CREATES WHAT?\n');

  console.log('   P2.5 zeya_prepare_governed_dispatch:');
  console.log('     allowed := NOT coalesce(doNotExecute, false)');
  console.log('     Result: doNotExecute=true  → execution_allowed=false');
  console.log('     Result: doNotExecute=false → execution_allowed=true\n');

  console.log('   P2.9C zeya_prepare_governed_dispatch_v2:');
  console.log('     (No RPC found in migration, uses P2.5 definition)\n');

  console.log('   P2.9D zeya_prepare_governed_dispatch_v3:');
  console.log('     allowed := NOT coalesce(doNotExecute, false)');
  console.log('     Result: doNotExecute=true  → execution_allowed=false');
  console.log('     Result: doNotExecute=false → execution_allowed=true\n');

  console.log('3. THE INCOMPATIBILITY:\n');

  console.log('   Safe QA Mission (doNotExecute=true):');
  console.log('     → dispatch.execution_allowed = false');
  console.log('     → Authorization check passes (P2.6 expects false)');
  console.log('     → Execution blocked (dispatch.execution_allowed=false at runtime)');
  console.log('     → RESULT: Can authorize, cannot execute\n');

  console.log('   Intended Executable (doNotExecute=false):');
  console.log('     → dispatch.execution_allowed = true');
  console.log('     → Authorization check FAILS (P2.6 requires false)');
  console.log('     → RESULT: Cannot authorize\n');

  console.log('4. HISTORICAL INTERPRETATION:\n');

  console.log('   Possibility A: execution_allowed means "not yet executed"');
  console.log('     - P2.5 set it false when doNotExecute=true (already blocked)');
  console.log('     - P2.6 auth checks it = false (not yet executed)');
  console.log('     - But then why would doNotExecute=false set it true?');
  console.log('     - This interpretation is INCONSISTENT\n');

  console.log('   Possibility B: execution_allowed means "eligible for execution"');
  console.log('     - P2.5 set it based on mission permission (CORRECT)');
  console.log('     - P2.6 auth check INVERTED it (requires false = BUG)');
  console.log('     - This interpretation has CLEAR DEFECT\n');

  console.log('   Possibility C: P2.6 originally only handled blocked dispatches');
  console.log('     - P2.5 created safe (blocked) dispatches for P2.6 auth');
  console.log('     - P2.9D added executable path (doNotExecute=false)');
  console.log('     - P2.6 validation was never updated for new path');
  console.log('     - This is a REGRESSION/INCOMPLETE FEATURE\n');

  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log('DIAGNOSIS:\n');

  console.log('Most Likely: Possibility C (Incomplete Feature)\n');

  console.log('P2.6 was designed for blocked dispatches (execution_allowed=false)');
  console.log('P2.9D added support for executable dispatches (execution_allowed=true)');
  console.log('But P2.6 authorization validation was not updated for the new path.\n');

  console.log('The fix: Update zeya_p26_dispatch_is_current() to accept execution_allowed=true\n');

  console.log('Correct semantics:\n');

  console.log('execution_allowed = false → dispatch/mission prohibits execution');
  console.log('  → Authorization MUST NOT be allowed');
  console.log('  → Even if authorized, execution blocked at claim time\n');

  console.log('execution_allowed = true → dispatch/mission permits execution');
  console.log('  → Authorization CAN be granted');
  console.log('  → Execution requires BOTH execution_allowed=true AND valid authorization\n');

  console.log('REQUIRED FIX:\n');

  console.log('In zeya_p26_dispatch_is_current():\n');

  console.log('CURRENT (WRONG):');
  console.log('  IF d.execution_allowed IS DISTINCT FROM false THEN RETURN false;\n');

  console.log('FIXED (CORRECT):');
  console.log('  IF d.execution_allowed IS NULL THEN RETURN false;');
  console.log('  (Accept both true and false, reject only NULL)\n');

  console.log('OR maintain explicit permission check in dispatch creation.\n');
}

run().catch(console.error);
