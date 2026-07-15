// Canonical Representation State Integration Tests
// Tests the complete vertical slice against deployed Supabase

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';
const API_BASE = process.env.API_BASE_URL || 'http://localhost:3000';

interface TestUser {
  email: string;
  password: string;
  id?: string;
  accessToken?: string;
  client?: SupabaseClient;
}

interface TestBusiness {
  name: string;
  id?: string;
  representationId?: string;
}

interface TestContext {
  tenantA: {
    user: TestUser;
    business: TestBusiness;
    records: Record<string, any>;
  };
  tenantB: {
    user: TestUser;
    business: TestBusiness;
    records: Record<string, any>;
  };
}

const context: TestContext = {
  tenantA: {
    user: { email: `test-a-${Date.now()}@zeya.test`, password: 'TestPassword123!' },
    business: { name: `Business A - ${Date.now()}` },
    records: {},
  },
  tenantB: {
    user: { email: `test-b-${Date.now()}@zeya.test`, password: 'TestPassword123!' },
    business: { name: `Business B - ${Date.now()}` },
    records: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function setupTestUser(user: TestUser): Promise<void> {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  // Check if user exists
  const { data: existing } = await admin.auth.admin.listUsers();
  const foundUser = existing?.users?.find((u) => u.email === user.email);

  if (foundUser) {
    user.id = foundUser.id;
  } else {
    // Create new user
    const { data: newUser, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });

    if (error) throw new Error(`Failed to create user: ${error.message}`);
    user.id = newUser.user.id;
  }

  // Sign in to get access token
  const { data: authData, error: authError } = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY).auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });

  if (authError) throw new Error(`Failed to sign in: ${authError.message}`);
  user.accessToken = authData.session?.access_token;
  user.client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${user.accessToken}` } },
  });
}

async function setupTestBusiness(tenant: TestContext['tenantA']): Promise<void> {
  const { data: business, error } = await tenant.user.client!.from('businesses').insert({
    business_name: tenant.business.name,
    user_id: tenant.user.id,
  }).select().single();

  if (error) throw new Error(`Failed to create business: ${error.message}`);
  tenant.business.id = business.id;
}

async function callAPI(method: string, path: string, body?: any, userToken?: string): Promise<any> {
  const url = `${API_BASE}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (userToken) {
    headers['Authorization'] = `Bearer ${userToken}`;
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const responseBody = await response.json();

  return {
    status: response.status,
    ok: response.ok,
    body: responseBody,
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST PHASES
// ─────────────────────────────────────────────────────────────────────────────

async function phase1SetupAuth(): Promise<void> {
  console.log('\n=== PHASE 1: Setup Authentication ===');

  console.log('Setting up Tenant A user...');
  await setupTestUser(context.tenantA.user);
  console.log(`✓ User A created: ${context.tenantA.user.email}`);

  console.log('Setting up Tenant B user...');
  await setupTestUser(context.tenantB.user);
  console.log(`✓ User B created: ${context.tenantB.user.email}`);

  console.log('Setting up Tenant A business...');
  await setupTestBusiness(context.tenantA);
  console.log(`✓ Business A created: ${context.tenantA.business.id}`);

  console.log('Setting up Tenant B business...');
  await setupTestBusiness(context.tenantB);
  console.log(`✓ Business B created: ${context.tenantB.business.id}`);
}

async function phase2FounderStatement(): Promise<void> {
  console.log('\n=== PHASE 2: Submit Founder Statement ===');

  const statement =
    'Zeya helps small businesses acquire customers by representing their business accurately and consistently across conversations and channels.';

  console.log(`Submitting evidence for Business A as User A...`);
  const result = await callAPI(
    'POST',
    '/api/representation/evidence',
    {
      businessId: context.tenantA.business.id,
      statement,
      sourceDescription: 'Founder statement during integration test',
      affectedDomains: ['business_identity', 'offer'],
    },
    context.tenantA.user.accessToken
  );

  assert(result.status === 201, `Evidence creation should return 201, got ${result.status}`);
  assert(result.body.success, `Evidence creation should succeed`);
  assert(result.body.data.evidenceId, 'Evidence ID should be present');
  assert(result.body.data.observationId, 'Observation ID should be present');
  assert(result.body.data.proposalId, 'Proposal ID should be present');

  context.tenantA.records.evidenceId = result.body.data.evidenceId;
  context.tenantA.records.observationId = result.body.data.observationId;
  context.tenantA.records.proposalId = result.body.data.proposalId;
  context.tenantA.records.businessRepresentationId = result.body.data.businessRepresentationId;
  context.tenantA.records.riskTier = result.body.data.riskTier;
  context.tenantA.records.requiresApproval = result.body.data.requiresApproval;

  console.log(`✓ Evidence created: ${context.tenantA.records.evidenceId}`);
  console.log(`✓ Observation created: ${context.tenantA.records.observationId}`);
  console.log(`✓ Proposal created: ${context.tenantA.records.proposalId}`);
  console.log(`✓ Risk tier: ${context.tenantA.records.riskTier}`);
  console.log(`✓ Requires approval: ${context.tenantA.records.requiresApproval}`);

  // Verify data in database
  console.log('\nVerifying database state...');

  const { data: evidence, error: evError } = await context.tenantA.user.client!
    .from('evidence')
    .select()
    .eq('id', context.tenantA.records.evidenceId)
    .single();

  assert(!evError, `Evidence should be readable: ${evError?.message}`);
  assert(evidence.raw_statement === statement, 'Statement should match');
  console.log(`✓ Evidence verified in database`);

  const { data: observation, error: obsError } = await context.tenantA.user.client!
    .from('observations')
    .select()
    .eq('id', context.tenantA.records.observationId)
    .single();

  assert(!obsError, `Observation should be readable`);
  assert(observation.evidence_id === context.tenantA.records.evidenceId, 'Observation should link to evidence');
  console.log(`✓ Observation verified in database`);

  const { data: proposal, error: propError } = await context.tenantA.user.client!
    .from('representation_proposals')
    .select()
    .eq('id', context.tenantA.records.proposalId)
    .single();

  assert(!propError, `Proposal should be readable`);
  assert(proposal.status === 'draft', 'Proposal should start as draft');
  console.log(`✓ Proposal verified in database`);
}

async function phase3ApprovalWorkflow(): Promise<void> {
  console.log('\n=== PHASE 3: Approval Workflow ===');

  // Get current proposal status
  const { data: proposal } = await context.tenantA.user.client!
    .from('representation_proposals')
    .select()
    .eq('id', context.tenantA.records.proposalId)
    .single();

  console.log(`Proposal risk tier: ${proposal.risk_tier}, requires_approval: ${proposal.requires_approval}`);

  if (!proposal.requires_approval) {
    console.log('✓ Low-risk proposal: no approval required');
  } else {
    console.log('High-risk proposal: approval required');

    // Create approval
    const { data: approval, error: appError } = await context.tenantA.user.client!
      .from('approval_decisions')
      .insert({
        business_representation_id: context.tenantA.records.businessRepresentationId,
        representation_proposal_id: context.tenantA.records.proposalId,
        decision: 'approved',
        approver_user_id: context.tenantA.user.id,
        approval_reason: 'Approved for testing',
      })
      .select()
      .single();

    assert(!appError, `Approval creation should succeed: ${appError?.message}`);
    context.tenantA.records.approvalId = approval.id;
    console.log(`✓ Approval created: ${approval.id}`);
  }
}

async function phase4CanonicalVersion(): Promise<void> {
  console.log('\n=== PHASE 4: Create Canonical Version ===');

  // Mark proposal as approved first
  const { error: updateError } = await context.tenantA.user.client!
    .from('representation_proposals')
    .update({ status: 'approved' })
    .eq('id', context.tenantA.records.proposalId);

  assert(!updateError, 'Proposal status update should succeed');

  console.log('Creating canonical version...');
  const result = await callAPI(
    'POST',
    '/api/representation/versions',
    {
      businessRepresentationId: context.tenantA.records.businessRepresentationId,
      proposalId: context.tenantA.records.proposalId,
      elementValues: {
        founder_statement: {
          value: 'Zeya helps small businesses acquire customers...',
          confidence: 85,
        },
      },
      confidenceScore: 85,
    },
    context.tenantA.user.accessToken
  );

  assert(result.status === 201, `Version creation should return 201, got ${result.status}`);
  assert(result.body.success, 'Version creation should succeed');
  assert(result.body.data.versionId, 'Version ID should be present');

  context.tenantA.records.versionId = result.body.data.versionId;
  context.tenantA.records.versionNumber = result.body.data.versionNumber;
  context.tenantA.records.confidenceAssessmentId = result.body.data.confidenceAssessmentId;

  console.log(`✓ Version created: ${context.tenantA.records.versionId}`);
  console.log(`✓ Version number: ${context.tenantA.records.versionNumber}`);
  console.log(`✓ Confidence assessment: ${context.tenantA.records.confidenceAssessmentId}`);

  // Verify immutability
  console.log('\nTesting version immutability...');
  const { error: updateError2 } = await context.tenantA.user.client!
    .from('representation_versions')
    .update({ overall_confidence_score: 50 })
    .eq('id', context.tenantA.records.versionId);

  assert(Boolean(updateError2), 'Version update should fail (immutable)');
  console.log(`✓ Version update blocked (immutable)`);
}

async function phase5Confidence(): Promise<void> {
  console.log('\n=== PHASE 5: Confidence Assessment ===');

  const { data: confidence, error } = await context.tenantA.user.client!
    .from('confidence_assessments')
    .select()
    .eq('id', context.tenantA.records.confidenceAssessmentId)
    .single();

  assert(!error, 'Confidence should be readable');
  assert(confidence.confidence_score >= 0 && confidence.confidence_score <= 100, 'Score should be 0-100');
  assert(confidence.confidence_band, 'Band should be present');
  assert(confidence.rationale, 'Rationale should be present');
  assert(confidence.factors, 'Factors should be present');

  console.log(`✓ Confidence score: ${confidence.confidence_score}`);
  console.log(`✓ Confidence band: ${confidence.confidence_band}`);
  console.log(`✓ Evidence count: ${confidence.evidence_count}`);
  console.log(`✓ Rationale: ${confidence.rationale}`);
}

async function phase6VersionRetrieval(): Promise<void> {
  console.log('\n=== PHASE 6: Version Retrieval ===');

  const result = await callAPI(
    'GET',
    `/api/representation/versions?businessRepresentationId=${context.tenantA.records.businessRepresentationId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result.status === 200, `Version retrieval should return 200`);
  assert(result.body.success, 'Version retrieval should succeed');
  assert(result.body.data.currentVersion, 'Current version should be present');
  assert(result.body.data.confidenceAssessment, 'Confidence assessment should be present');

  console.log(`✓ Current version: ${result.body.data.currentVersion.id}`);
  console.log(`✓ Version number: ${result.body.data.currentVersion.version_number}`);
}

async function phase7AgentContext(): Promise<void> {
  console.log('\n=== PHASE 7: Agent Context Retrieval ===');

  const result = await callAPI(
    'GET',
    `/api/representation/agent-context?businessRepresentationId=${context.tenantA.records.businessRepresentationId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result.status === 200, 'Agent context retrieval should return 200');
  assert(result.body.success, 'Agent context retrieval should succeed');
  assert(Array.isArray(result.body.data.elements), 'Elements should be an array');

  console.log(`✓ Agent context retrieved`);
  console.log(`✓ Element count: ${result.body.data.elements.length}`);
}

async function phase8TenantIsolation(): Promise<void> {
  console.log('\n=== PHASE 8: Tenant Isolation ===');

  // User B tries to access User A's representation
  console.log('Testing User B cannot access User A data...');

  const result = await callAPI(
    'GET',
    `/api/representation/versions?businessRepresentationId=${context.tenantA.records.businessRepresentationId}`,
    undefined,
    context.tenantB.user.accessToken
  );

  // Should either fail auth or return empty
  if (result.status === 401 || result.status === 403) {
    console.log(`✓ User B unauthorized (status ${result.status})`);
  } else if (!result.body.data?.currentVersion) {
    console.log(`✓ User B cannot see User A's data`);
  } else {
    throw new Error('User B should not be able to access User A data');
  }

  // Verify User A can still access their own data
  const result2 = await callAPI(
    'GET',
    `/api/representation/versions?businessRepresentationId=${context.tenantA.records.businessRepresentationId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result2.status === 200, 'User A should access their own data');
  console.log(`✓ User A can access their own data`);
}

async function phase9AuditTrail(): Promise<void> {
  console.log('\n=== PHASE 9: Audit Trail ===');

  const { data: auditEvents, error } = await context.tenantA.user.client!
    .from('audit_events')
    .select()
    .eq('business_representation_id', context.tenantA.records.businessRepresentationId)
    .order('created_at', { ascending: true });

  assert(!error, 'Audit events should be readable');
  const auditEventsList = auditEvents ?? [];
  assert(auditEventsList.length > 0, 'Audit events should exist');

  console.log(`✓ ${auditEventsList.length} audit events recorded`);

  const eventTypes = [...new Set(auditEventsList.map((e) => e.event_type))];
  console.log(`✓ Event types: ${eventTypes.join(', ')}`);
}

async function phase10Unauthorized(): Promise<void> {
  console.log('\n=== PHASE 10: Unauthorized Access ===');

  // Try without auth token
  const result = await callAPI('POST', '/api/representation/evidence', {
    businessId: context.tenantA.business.id,
    statement: 'Test',
  });

  assert(result.status === 401, `Unauthenticated request should fail with 401, got ${result.status}`);
  console.log(`✓ Unauthenticated request rejected`);

  // Try to directly insert into versions (should fail via RLS)
  console.log('Testing direct version insertion...');
  const { error } = await context.tenantA.user.client!
    .from('representation_versions')
    .insert({
      business_representation_id: context.tenantA.records.businessRepresentationId,
      source_proposal_id: context.tenantA.records.proposalId,
      element_values: {},
      version_number: 999,
      overall_confidence_score: 50,
      created_by_actor: context.tenantA.user.id,
    });

  assert(Boolean(error), 'Direct version insertion should fail via RLS');
  console.log(`✓ Direct version insertion blocked by RLS`);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST RUNNER
// ─────────────────────────────────────────────────────────────────────────────

async function runAllTests(): Promise<void> {
  const results = {
    passed: 0,
    failed: 0,
    errors: [] as string[],
  };

  const phases = [
    { name: 'Phase 1: Setup Auth', fn: phase1SetupAuth },
    { name: 'Phase 2: Founder Statement', fn: phase2FounderStatement },
    { name: 'Phase 3: Approval Workflow', fn: phase3ApprovalWorkflow },
    { name: 'Phase 4: Canonical Version', fn: phase4CanonicalVersion },
    { name: 'Phase 5: Confidence', fn: phase5Confidence },
    { name: 'Phase 6: Version Retrieval', fn: phase6VersionRetrieval },
    { name: 'Phase 7: Agent Context', fn: phase7AgentContext },
    { name: 'Phase 8: Tenant Isolation', fn: phase8TenantIsolation },
    { name: 'Phase 9: Audit Trail', fn: phase9AuditTrail },
    { name: 'Phase 10: Unauthorized', fn: phase10Unauthorized },
  ];

  for (const phase of phases) {
    try {
      await phase.fn();
      results.passed++;
    } catch (error) {
      results.failed++;
      const message = error instanceof Error ? error.message : String(error);
      results.errors.push(`${phase.name}: ${message}`);
      console.error(`✗ ${phase.name}: ${message}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('TEST RESULTS');
  console.log('='.repeat(80));
  console.log(`Passed: ${results.passed}`);
  console.log(`Failed: ${results.failed}`);

  if (results.errors.length > 0) {
    console.log('\nFailures:');
    results.errors.forEach((error) => console.log(`  - ${error}`));
  }

  console.log('='.repeat(80));

  process.exit(results.failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch((error) => {
  console.error('Test suite error:', error);
  process.exit(1);
});
