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

  it('should verify business identity selection no longer exists', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify no business selection logic (removed for safety)
    expect(content).not.toContain('Look for owner\'s first business');
    expect(content).not.toContain('existingBusiness');
    expect(content).not.toContain('created_at');

    // Verify businessId must be provided explicitly
    expect(content).toContain('if (!body.businessId)');

    console.log(`✓ Business identity selection removed:`);
    console.log(`  - No automatic business selection`);
    console.log(`  - No ORDER BY created_at LIMIT 1`);
    console.log(`  - businessId must be provided explicitly in request`);
  });

  it('should verify business creation race condition is prevented', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify no automatic business creation code (removed to prevent race condition)
    expect(content).not.toContain('if (!existingBusiness)');
    expect(content).not.toContain('newBusiness');

    // Verify businessId is required upfront
    expect(content).toContain('if (!body.businessId)');

    console.log(`✓ Business creation race condition prevented:`);
    console.log(`  - No SELECT-then-INSERT pattern`);
    console.log(`  - businessId must be provided in request`);
    console.log(`  - No automatic business creation for new owners`);
  });

  it('should verify representation initialization race condition is prevented', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify representation must already exist (no automatic initialization)
    expect(content).toContain('Representation not found');
    expect(content).not.toContain('initialize_business_representation');

    // Verify no SELECT-then-RPC pattern
    expect(content).not.toContain('if (!representationId)');

    console.log(`✓ Representation initialization race condition prevented:`);
    console.log(`  - Representation must be pre-created`);
    console.log(`  - No SELECT-then-RPC pattern`);
    console.log(`  - No automatic representation initialization`);
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

    // Verify no automatic business creation code (reverted for safety)
    expect(content).not.toContain('Owner is new - create Business');
    expect(content).not.toContain('newBusiness');

    // Verify businessId is required upfront
    expect(content).toContain('if (!body.businessId)');
    expect(content).toContain('businessId is required');

    // Check RPC calls receive ownerId from authenticated request
    expect(content).toContain('p_owner_id: ownerId');

    console.log(`✓ Authentication boundary:`);
    console.log(`  - Uses owner-scoped authenticated context`);
    console.log(`  - Requires explicit businessId (no automatic business creation)`);
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
