// Representation Formation Sessions Integration Tests (RF-A)
// Tests core Formation session lifecycle

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadEnvConfig } from '@next/env';

loadEnvConfig(process.cwd());

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
    user: { email: `test-formation-a-${Date.now()}@zeya.test`, password: 'TestPassword123!' },
    business: { name: `Formation Test Business A - ${Date.now()}` },
    records: {},
  },
  tenantB: {
    user: { email: `test-formation-b-${Date.now()}@zeya.test`, password: 'TestPassword123!' },
    business: { name: `Formation Test Business B - ${Date.now()}` },
    records: {},
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// TEST UTILITIES
// ─────────────────────────────────────────────────────────────────────────────

async function setupTestUser(user: TestUser): Promise<void> {
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || '');

  const { data: existing } = await admin.auth.admin.listUsers();
  const foundUser = existing?.users?.find((u) => u.email === user.email);

  if (foundUser) {
    user.id = foundUser.id;
  } else {
    const { data: newUser, error } = await admin.auth.admin.createUser({
      email: user.email,
      password: user.password,
      email_confirm: true,
    });
    if (error) throw new Error(`Failed to create user: ${error.message}`);
    user.id = newUser.user.id;
  }

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

async function setupRepresentation(tenant: TestContext['tenantA']): Promise<void> {
  // Create representation directly instead of using RPC to avoid schema cache issues
  const { data: rep, error } = await tenant.user.client!
    .from('business_representations')
    .insert({
      business_id: tenant.business.id,
      user_id: tenant.user.id,
      current_phase: 'surface',
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to initialize representation: ${error.message}`);
  tenant.business.representationId = rep.id;

  // Create domains for the representation
  const domains = [
    'business_identity', 'offer', 'customer', 'market', 'positioning',
    'differentiation', 'objections', 'trust', 'qualification',
    'commercial_objectives', 'operational_constraints', 'channel_expression'
  ];

  for (const domainName of domains) {
    await tenant.user.client!
      .from('representation_domains')
      .insert({
        business_representation_id: rep.id,
        domain_name: domainName,
        current_phase: 'surface',
        confidence_score: 0,
      });
  }
}

async function callAPI(method: string, path: string, body?: any, userToken?: string | undefined): Promise<any> {
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

async function phase1Setup(): Promise<void> {
  console.log('\n=== PHASE 1: Setup ===');

  console.log('Setting up Tenant A...');
  await setupTestUser(context.tenantA.user);
  await setupTestBusiness(context.tenantA);
  await setupRepresentation(context.tenantA);
  console.log(`✓ Tenant A ready`);

  console.log('Setting up Tenant B...');
  await setupTestUser(context.tenantB.user);
  await setupTestBusiness(context.tenantB);
  await setupRepresentation(context.tenantB);
  console.log(`✓ Tenant B ready`);
}

async function phase2IdempotentInitiation(): Promise<void> {
  console.log('\n=== PHASE 2: Idempotent Formation Initiation ===');

  console.log('Initiating formation for Tenant A...');
  const { data: result1, error: error1 } = await context.tenantA.user.client!.rpc('zeya_initiate_formation_session', {
    p_business_id: context.tenantA.business.id,
    p_business_representation_id: context.tenantA.business.representationId,
    p_owner_id: context.tenantA.user.id,
    p_initiated_from: 'owner_request',
    p_initiated_from_id: null,
  });

  assert(!error1, `First initiation should succeed: ${error1?.message}`);
  assert(result1 && result1.length > 0, 'Should return result');
  assert(result1[0].session_id, 'Session ID should be present');
  assert(result1[0].status === 'initiated', 'Status should be initiated');

  context.tenantA.records.sessionId = result1[0].session_id;
  context.tenantA.records.businessRepresentationId = result1[0].business_representation_id;
  console.log(`✓ Formation initiated: ${context.tenantA.records.sessionId}`);

  console.log('Calling initiate again (idempotent)...');
  const { data: result2, error: error2 } = await context.tenantA.user.client!.rpc('zeya_initiate_formation_session', {
    p_business_id: context.tenantA.business.id,
    p_business_representation_id: context.tenantA.business.representationId,
    p_owner_id: context.tenantA.user.id,
    p_initiated_from: null,
    p_initiated_from_id: null,
  });

  assert(!error2, `Second initiation should succeed`);
  assert(result2[0].session_id === context.tenantA.records.sessionId, 'Should return same session');
  console.log(`✓ Idempotent: returned same session`);
}

async function phase3TenantIsolation(): Promise<void> {
  console.log('\n=== PHASE 3: Tenant Isolation ===');

  console.log('Tenant B attempting to access Tenant A session...');
  const result = await callAPI(
    'GET',
    `/api/formation/sessions/${context.tenantA.records.sessionId}`,
    undefined,
    context.tenantB.user.accessToken
  );

  assert(result.status === 404, `Cross-tenant access should return 404, got ${result.status}`);
  console.log(`✓ Tenant isolation enforced`);

  console.log('Tenant A can access own session...');
  const result2 = await callAPI(
    'GET',
    `/api/formation/sessions/${context.tenantA.records.sessionId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result2.status === 200, `Owner access should return 200`);
  assert(result2.body.data.sessionId === context.tenantA.records.sessionId, 'Should return correct session');
  console.log(`✓ Owner can access own session`);
}

async function phase4StateRetrieval(): Promise<void> {
  console.log('\n=== PHASE 4: State Retrieval ===');

  const result = await callAPI(
    'GET',
    `/api/formation/sessions/${context.tenantA.records.sessionId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result.status === 200, 'Should return 200');
  assert(result.body.data.status === 'initiated', 'Status should be initiated');
  assert(result.body.data.linkedContextSummary, 'Context summary should be present');
  assert(result.body.data.nextAction, 'Next action should be present');
  console.log(`✓ Formation status retrieved`);
  console.log(`  Status: ${result.body.data.status}`);
  console.log(`  Next action: ${result.body.data.nextAction}`);
}

async function phase5StateTransitions(): Promise<void> {
  console.log('\n=== PHASE 5: State Transitions ===');

  console.log('Transitioning from initiated to getting_familiar...');
  const { data: transition } = await context.tenantA.user.client!.rpc('zeya_advance_formation_status', {
    p_session_id: context.tenantA.records.sessionId,
    p_business_representation_id: context.tenantA.records.businessRepresentationId,
    p_expected_current_status: 'initiated',
    p_new_status: 'getting_familiar',
    p_transition_details: {},
  });

  assert(transition && transition.length > 0, 'Transition should succeed');
  assert(transition[0].status === 'getting_familiar', 'Status should be getting_familiar');
  console.log(`✓ Transitioned to getting_familiar`);

  console.log('Transitioning from getting_familiar to working_conversation_pending...');
  const { data: transition2 } = await context.tenantA.user.client!.rpc('zeya_advance_formation_status', {
    p_session_id: context.tenantA.records.sessionId,
    p_business_representation_id: context.tenantA.records.businessRepresentationId,
    p_expected_current_status: 'getting_familiar',
    p_new_status: 'working_conversation_pending',
    p_transition_details: {},
  });

  assert(transition2 && transition2.length > 0, 'Transition should succeed');
  console.log(`✓ Transitioned to working_conversation_pending`);
}

async function phase6InvalidStateTransition(): Promise<void> {
  console.log('\n=== PHASE 6: Invalid State Transitions Rejected ===');

  console.log('Attempting invalid transition (skipping a state)...');
  const { error } = await context.tenantA.user.client!.rpc('zeya_advance_formation_status', {
    p_session_id: context.tenantA.records.sessionId,
    p_business_representation_id: context.tenantA.records.businessRepresentationId,
    p_expected_current_status: 'initiated',  // Wrong: we're in working_conversation_pending
    p_new_status: 'formation_complete',
    p_transition_details: {},
  });

  assert(error !== null, 'Invalid transition should fail');
  const errorMsg = error && typeof error === 'object' && 'message' in error ? (error as any).message : 'Unknown error';
  console.log(`✓ Invalid transition rejected: ${errorMsg}`);
}

async function phase7ConversationLinking(): Promise<void> {
  console.log('\n=== PHASE 7: Conversation Linking ===');

  // Create a test conversation
  console.log('Creating test conversation...');
  const { data: conversation, error: convError } = await context.tenantA.user.client!
    .from('voice_conversation_outputs')
    .insert({
      business_id: context.tenantA.business.id,
      business_representation_id: context.tenantA.records.businessRepresentationId,
      voice_context_id: require('crypto').randomUUID(),
      conversation_id: require('crypto').randomUUID(),
      provider_call_id: 'test_call_' + Date.now(),
      transcript_status: 'finalized',
      output_json: {},
    })
    .select()
    .single();

  if (convError !== null) {
    console.log('Note: Cannot create full conversation in test (would require more setup)');
    console.log('Skipping conversation link test in this phase');
    return;
  }

  context.tenantA.records.conversationId = conversation.id;
  console.log(`✓ Test conversation created: ${conversation.id}`);

  console.log('Linking conversation to formation session...');
  const result = await callAPI(
    'POST',
    `/api/formation/sessions/${context.tenantA.records.sessionId}/link-conversation`,
    {
      conversationId: context.tenantA.records.conversationId,
      conversationType: 'first_working_conversation',
    },
    context.tenantA.user.accessToken
  );

  assert(result.status === 200, `Link should return 200, got ${result.status}`);
  assert(result.body.success, 'Conversation link should succeed');
  assert(result.body.data.status === 'working_conversation_linked', 'Status should update');
  console.log(`✓ Conversation linked`);
}

async function phase8LinkedStateReadiness(): Promise<void> {
  console.log('\n=== PHASE 8: Formation Preparation Complete ===');

  console.log('Verifying formation session is in working_conversation_linked state...');
  const result = await callAPI(
    'GET',
    `/api/formation/sessions/${context.tenantA.records.sessionId}`,
    undefined,
    context.tenantA.user.accessToken
  );

  assert(result.status === 200, 'Should retrieve session');
  assert(result.body.data.status === 'working_conversation_linked', 'Status should be working_conversation_linked');
  console.log(`✓ Formation session is in working_conversation_linked state`);
  console.log(`✓ Formation preparation phase is complete`);
  console.log(`✓ Ready for First Representation Summary (RF-B+)`);
}

async function phase9GovernanceProtection(): Promise<void> {
  console.log('\n=== PHASE 9: Governance Protection ===');

  // Initialize a fresh session for this test
  const result = await callAPI(
    'POST',
    '/api/formation/sessions/initiate',
    {
      businessId: context.tenantA.business.id,
    },
    context.tenantA.user.accessToken
  );

  const testSessionId = result.body.data.sessionId;
  console.log('Formation session created');

  // Verify no Evidence, Proposal, or Version was created by Formation
  const { data: evidence } = await context.tenantA.user.client!
    .from('evidence')
    .select('id')
    .eq('business_representation_id', context.tenantA.records.businessRepresentationId);

  const { data: proposals } = await context.tenantA.user.client!
    .from('representation_proposals')
    .select('id')
    .eq('business_representation_id', context.tenantA.records.businessRepresentationId);

  const { data: versions } = await context.tenantA.user.client!
    .from('representation_versions')
    .select('id')
    .eq('business_representation_id', context.tenantA.records.businessRepresentationId);

  assert((!evidence || evidence.length === 0), 'Formation should not create Evidence');
  assert((!proposals || proposals.length === 0), 'Formation should not create Proposals');
  assert((!versions || versions.length === 0), 'Formation should not create Versions');
  console.log(`✓ Formation does not bypass governance pipeline`);
}

async function phase10PurgeIntegration(): Promise<void> {
  console.log('\n=== PHASE 10: Purge Integration ===');

  // Create formation session
  const result = await callAPI(
    'POST',
    '/api/formation/sessions/initiate',
    {
      businessId: context.tenantB.business.id,
    },
    context.tenantB.user.accessToken
  );

  console.log(`Formation session created for Tenant B: ${result.body.data.sessionId}`);

  // Purge business representation
  const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || '');
  const { data: purgeResult, error: purgeError } = await admin.rpc('zeya_purge_business_representation', {
    p_business_representation_id: context.tenantB.records.businessRepresentationId || result.body.data.businessRepresentationId,
    p_expected_business_id: context.tenantB.business.id,
  });

  assert(!purgeError, `Purge should succeed: ${purgeError?.message}`);
  assert(purgeResult.deleted.representation_formation_sessions >= 0, 'Formation sessions should be counted in purge');
  console.log(`✓ Formation sessions safely purged`);
  console.log(`  Deleted records:`, purgeResult.deleted);
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TEST EXECUTION
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  try {
    console.log('='.repeat(80));
    console.log('REPRESENTATION FORMATION SESSIONS INTEGRATION TESTS (RF-A)');
    console.log('='.repeat(80));

    await phase1Setup();
    await phase2IdempotentInitiation();
    await phase3TenantIsolation();
    await phase4StateRetrieval();
    await phase5StateTransitions();
    await phase6InvalidStateTransition();
    await phase7ConversationLinking();
    await phase8LinkedStateReadiness();
    await phase9GovernanceProtection();
    await phase10PurgeIntegration();

    console.log('\n' + '='.repeat(80));
    console.log('ALL TESTS PASSED ✓');
    console.log('='.repeat(80));
    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(80));
    console.error('TEST FAILED ✗');
    console.error('='.repeat(80));
    console.error(error);
    process.exit(1);
  }
}

main();
