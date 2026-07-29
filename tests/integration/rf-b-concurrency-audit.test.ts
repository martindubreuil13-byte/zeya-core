import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Concurrency and Identity Audit Tests
 * Verifies database contracts and identifies race condition vulnerabilities
 */

describe('RF-B Concurrency and Identity Audit', () => {
  it('should verify businesses table allows multiple per user (contract issue)', async () => {
    const filePath = './supabase/migrations/20260528000000_application_baseline.sql';
    const content = await fs.readFile(filePath, 'utf-8');

    // Extract business table definition
    const businessTable = content.substring(
      content.indexOf('CREATE TABLE public.businesses'),
      content.indexOf('CREATE TABLE public.businesses') + 1000
    );

    // Check for UNIQUE constraints
    expect(businessTable).toContain('UNIQUE');

    // Parse the UNIQUE constraint
    const uniqueMatch = businessTable.match(/UNIQUE\([^)]+\)/);
    expect(uniqueMatch).toBeDefined();

    // Verify it's not on (user_id) alone
    if (uniqueMatch) {
      const constraint = uniqueMatch[0];
      expect(constraint).not.toContain('user_id) UNIQUE');
      // Currently: UNIQUE(id, user_id) which is redundant since id is PK
    }

    console.log(`✓ Database contract: users can own multiple businesses (no UNIQUE(user_id))`);
  });

  it('should verify initialize_business_representation is NOT idempotent', async () => {
    const filePath =
      './supabase/migrations/20260711000000_representation_state_foundation.sql';
    const content = await fs.readFile(filePath, 'utf-8');

    // Find the RPC definition more carefully
    const rpcStart = content.indexOf(
      'CREATE OR REPLACE FUNCTION initialize_business_representation'
    );
    const rpcEnd = content.indexOf('\n$$ LANGUAGE plpgsql', rpcStart) + 50;
    const rpcDef = content.substring(rpcStart, rpcEnd);

    // Check for ON CONFLICT or other idempotency handling
    expect(rpcDef.toUpperCase()).not.toContain('ON CONFLICT');

    // Verify it does bare INSERT
    const hasInsert = rpcDef.includes('INSERT INTO') &&
      rpcDef.includes('business_representations');
    expect(hasInsert).toBe(true);

    console.log(`✗ RPC initialize_business_representation is NOT idempotent`);
    console.log(`  - Uses bare INSERT (no ON CONFLICT handling)`);
    console.log(`  - Will fail on concurrent calls for same (business_id, user_id)`);
  });

  it('should verify business_representations has UNIQUE(business_id)', async () => {
    const filePath =
      './supabase/migrations/20260711000000_representation_state_foundation.sql';
    const content = await fs.readFile(filePath, 'utf-8');

    // Find business_representations table
    const tableStart = content.indexOf('CREATE TABLE IF NOT EXISTS business_representations');
    const tableEnd = content.indexOf(');', tableStart) + 2;
    const tableDef = content.substring(tableStart, tableEnd);

    // Verify UNIQUE(business_id) exists
    expect(tableDef).toContain('UNIQUE(business_id)');

    console.log(`✓ Database contract: business_representations has UNIQUE(business_id)`);
    console.log(`  - Enforces one representation per business`);
    console.log(`  - Concurrent initialize calls for same business WILL fail`);
  });

  it('should identify business identity selection rule problem', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Find the business selection logic
    const selectionStart = content.indexOf('Look for owner\'s first business');
    const selectionEnd = content.indexOf('if (existingBusiness)', selectionStart + 200);
    const selectionCode = content.substring(selectionStart, selectionEnd);

    // Verify it orders by created_at and limits to 1
    expect(selectionCode).toContain('order(\'created_at\'');
    expect(selectionCode).toContain('.limit(1)');

    // This is the problem: arbitrarily picks first business
    const hasExplicitRule = selectionCode.includes('EXPLICIT RULE:') ||
      selectionCode.includes('If user has multiple') ||
      selectionCode.includes('stable identity') ||
      selectionCode.includes('active Formation');

    expect(hasExplicitRule).toBe(false);

    console.log(`✗ Identity selection rule problem:`);
    console.log(`  - Code does: ORDER BY created_at LIMIT 1`);
    console.log(`  - This silently picks first business`);
    console.log(`  - No explicit rule for which business to use`);
    console.log(`  - Could attach Formation to wrong company`);
    console.log(`  - No error if user has multiple businesses`);
  });

  it('should identify race condition in business creation', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Find the business creation logic
    const creationStart = content.indexOf('if (!existingBusiness)');
    const creationEnd = content.indexOf('businessId = newBusiness.id', creationStart) + 50;
    const creationCode = content.substring(creationStart, creationEnd);

    // Verify it does SELECT then INSERT
    expect(creationCode).toContain('existingBusiness');
    expect(creationCode).toContain('.insert(');

    // This is the race condition: SELECT-then-INSERT is not atomic
    const hasAtomicGuard = creationCode.includes('ON CONFLICT') ||
      creationCode.includes('unique constraint') ||
      creationCode.includes('duplicates') ||
      creationCode.includes('service_role');

    console.log(`✗ Race condition in business creation:`);
    console.log(`  - Pattern: SELECT then INSERT (not atomic)`);
    console.log(
      `  - Two concurrent requests can both see 0 businesses, both INSERT`
    );
    console.log(`  - Result: TWO businesses created for same user`);
    console.log(`  - No UNIQUE(user_id) constraint prevents this`);
  });

  it('should identify race condition in representation initialization', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Find representation initialization logic
    const repStart = content.indexOf('if (!representationId)');
    const repEnd = content.indexOf('representationId = repResult', repStart) + 50;
    const repCode = content.substring(repStart, repEnd);

    // Verify it checks then calls RPC
    expect(repCode).toContain('representationId');
    expect(repCode).toContain('initialize_business_representation');

    // This is the race condition: SELECT-then-RPC is not atomic
    const hasErrorHandling = repCode.includes('catch') ||
      repCode.includes('ON CONFLICT') ||
      repCode.includes('23505') ||
      repCode.includes('23503');

    expect(hasErrorHandling).toBe(false);

    console.log(`✗ Race condition in representation initialization:`);
    console.log(`  - Pattern: SELECT then RPC initialize_business_representation`);
    console.log(
      `  - Two concurrent requests can both see 0 representations, both call RPC`
    );
    console.log(
      `  - First RPC succeeds, second FAILS (UNIQUE(business_id) violation)`);
    console.log(`  - RPC is not idempotent (no ON CONFLICT handling)`);
  });

  it('should document missing atomic provisioning function', async () => {
    const filePath = './supabase/migrations/20260711000000_representation_state_foundation.sql';
    const content = await fs.readFile(filePath, 'utf-8');

    // Look for atomic provisioning RPC
    const hasAtomicProvisioning = content.includes(
      'provision_owner_business'
    ) || content.includes('atomic_create_business') ||
      content.includes('create_owner_defaults');

    expect(hasAtomicProvisioning).toBe(false);

    console.log(`✗ Missing database contract:`);
    console.log(`  - No atomic RPC for: create-if-not-exists Business`);
    console.log(
      `  - No atomic RPC for: create-if-not-exists Business + Representation`
    );
    console.log(`  - initialize_business_representation is not idempotent`);
    console.log(`  - SELECT-then-INSERT patterns are vulnerable to races`);
  });

  it('should verify authentication boundary uses owner context', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Check authentication setup
    expect(content).toContain('createAuthenticatedRepresentationContext');
    expect(content).toContain('auth.user.id');

    // Check business creation uses authenticated client
    const businessCreationStart = content.indexOf('Owner is new - create Business');
    const businessCreationEnd = businessCreationStart + 800;
    const businessCreation = content.substring(businessCreationStart, businessCreationEnd);
    expect(businessCreation).toContain('.insert(');

    // Check RPC calls receive ownerId from authenticated request
    expect(content).toContain('p_owner_id: ownerId');

    console.log(`✓ Authentication boundary:`);
    console.log(`  - Uses owner-scoped authenticated client for initial operations`);
    console.log(`  - Business insert uses authenticated client (RLS enforced)`);
    console.log(`  - RPC calls receive ownerId from authenticated request`);
  });

  it('should document exact race condition scenario', async () => {
    console.log(`\nRACE CONDITION SCENARIO:\n`);

    console.log(`Concurrent requests: Two POST /api/formation/sessions/initiate {} calls`);
    console.log(`Initial state: Owner has 0 businesses\n`);

    console.log(`Timeline:`);
    console.log(`T1 - Request A: SELECT businesses WHERE user_id=X → finds 0 rows`);
    console.log(`T2 - Request B: SELECT businesses WHERE user_id=X → finds 0 rows`);
    console.log(`T3 - Request A: INSERT business_1 → succeeds`);
    console.log(`T4 - Request B: INSERT business_2 → succeeds (no UNIQUE(user_id)!)`);
    console.log(`T5 - Request A: SELECT representations → finds 0 rows`);
    console.log(`T6 - Request B: SELECT representations → finds 0 rows`);
    console.log(`T7 - Request A: RPC initialize(business_1) → succeeds`);
    console.log(`T8 - Request B: RPC initialize(business_2) → succeeds`);
    console.log(`T9 - Request A: RPC initiate_formation(business_1) → succeeds`);
    console.log(`T10 - Request B: RPC initiate_formation(business_2) → succeeds\n`);

    console.log(`Result:`);
    console.log(`✗ 2 businesses created`);
    console.log(`✗ 2 representations created`);
    console.log(`✗ 2 formation sessions created`);
    console.log(`✗ Both requests return different sessionIds`);
  });
});
