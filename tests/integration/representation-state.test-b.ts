import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadEnvConfig } from '@next/env';
import { startTestServer } from './representation-state-test-server';
import { FixtureRegistry } from './representation-state-test-fixtures';
import { cleanupFixtures } from './representation-state-test-cleanup';
import { jsonRequest } from './representation-state-test-client';

type ApiData = { data: { businessRepresentationId: string; evidenceId: string; observationId: string; proposalId: string } };
type Tenant = { id: string; token: string; client: SupabaseClient; businessId: string; representationId: string; evidenceId: string; observationId: string; proposalId: string; elementId: string };
const assert = (value: unknown, message: string): void => { if (!value) throw new Error(`Test B: ${message}`); };

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const server = await startTestServer();
  const registry = new FixtureRegistry();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  let cleanup: Awaited<ReturnType<typeof cleanupFixtures>> | undefined;
  try {
    const createTenant = async (label: 'a' | 'b'): Promise<Tenant> => {
      const email = `representation-b-${label}-${registry.runId}@zeya.test`;
      const password = `T-${crypto.randomUUID()}!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      const id = created.data.user.id;
      registry.registerAuthUser(id, email);
      const auth = createClient(url, key);
      const signed = await auth.auth.signInWithPassword({ email, password });
      if (signed.error || !signed.data.session) throw signed.error ?? new Error('Authentication failed');
      const token = signed.data.session.access_token;
      const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } } });
      const business = await client.from('businesses').insert({ business_name: `Tenant ${label} ${registry.runId}`, user_id: id }).select().single();
      if (business.error) throw business.error;
      registry.registerBusiness(business.data.id, id);
      const initialized = await jsonRequest<ApiData>(server.baseUrl, '/api/representation/evidence', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ businessId: business.data.id, statement: `Tenant ${label} evidence` }) });
      assert(initialized.status === 201, `${label} initialization`);
      const data = initialized.body.data;
      registry.registerBusinessRepresentation(data.businessRepresentationId, business.data.id);
      registry.registerEvidence(data.evidenceId); registry.registerObservation(data.observationId); registry.registerProposal(data.proposalId);
      const domain = await client.from('representation_domains').select('id').eq('business_representation_id', data.businessRepresentationId).eq('domain_name', 'customer').single();
      if (domain.error) throw domain.error;
      registry.registerDomain(domain.data.id);
      const canonical = await jsonRequest<{ data: { versionId: string; confidenceAssessmentId: string } }>(server.baseUrl, '/api/representation/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ businessRepresentationId: data.businessRepresentationId, proposalId: data.proposalId, elementValues: { [`tenant_${label}_claim`]: { value: `User ${label.toUpperCase()} private representation value` } }, confidenceScore: 80 }),
      });
      assert(canonical.status === 201, `${label} canonical fixture`);
      registry.registerVersion(canonical.body.data.versionId);
      registry.registerConfidenceAssessment(canonical.body.data.confidenceAssessmentId);
      const element = await client.from('representation_elements').insert({ business_representation_id: data.businessRepresentationId, representation_domain_id: domain.data.id, element_key: `tenant_${label}_claim`, element_type: 'fact', current_value_version_id: canonical.body.data.versionId, is_disputed: false, claim_eligibility: 'approved_for_external_use', field_sensitivity: 'operational' }).select().single();
      if (element.error) throw element.error;
      registry.registerElement(element.data.id);
      return { id, token, client, businessId: business.data.id, representationId: data.businessRepresentationId, evidenceId: data.evidenceId, observationId: data.observationId, proposalId: data.proposalId, elementId: element.data.id };
    };
    const A = await createTenant('a'); const B = await createTenant('b');
    const context = (tenant: Tenant, representationId: string) => jsonRequest<{ success: boolean; error?: string; data?: { businessRepresentationId: string; elements: Array<{ elementKey: string }> } }>(server.baseUrl, `/api/representation/agent-context?businessRepresentationId=${representationId}`, { headers: { Authorization: `Bearer ${tenant.token}` } });
    const ownA = await context(A, A.representationId), ownB = await context(B, B.representationId);
    assert(ownA.status === 200 && ownA.body.data?.elements.some(x => x.elementKey === 'tenant_a_claim'), 'User A own access');
    assert(ownB.status === 200 && ownB.body.data?.elements.some(x => x.elementKey === 'tenant_b_claim'), 'User B own access');
    const foreignAB = await context(A, B.representationId), foreignBA = await context(B, A.representationId);
    assert(foreignAB.status === 404 && foreignBA.status === 404 && JSON.stringify(foreignAB.body) === JSON.stringify({ success: false, error: 'Representation not found' }), 'foreign contexts');
    const foreignEvidence = async (tenant: Tenant, businessId: string) => jsonRequest<{ success: boolean; error?: string }>(server.baseUrl, '/api/representation/evidence', { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${tenant.token}` }, body: JSON.stringify({ businessId, statement: 'foreign' }) });
    assert((await foreignEvidence(A, B.businessId)).status === 404 && (await foreignEvidence(B, A.businessId)).status === 404, 'foreign Evidence');
    const foreignProposalA = await A.client.from('representation_proposals').insert({ business_representation_id: B.representationId, proposed_changes: { x: { after: 1 } }, requires_approval: false, status: 'draft', proposed_by_actor: A.id });
    const foreignProposalB = await B.client.from('representation_proposals').insert({ business_representation_id: A.representationId, proposed_changes: { x: { after: 1 } }, requires_approval: false, status: 'draft', proposed_by_actor: B.id });
    assert(foreignProposalA.error && foreignProposalB.error, 'foreign Proposal creation');
    const linkCases = [
      A.client.from('proposal_evidence').insert({ proposal_id: A.proposalId, evidence_id: B.evidenceId, business_representation_id: A.representationId }), B.client.from('proposal_evidence').insert({ proposal_id: B.proposalId, evidence_id: A.evidenceId, business_representation_id: B.representationId }),
      A.client.from('proposal_observations').insert({ proposal_id: A.proposalId, observation_id: B.observationId, business_representation_id: A.representationId }), B.client.from('proposal_observations').insert({ proposal_id: B.proposalId, observation_id: A.observationId, business_representation_id: B.representationId }),
      A.client.from('proposal_elements').insert({ proposal_id: A.proposalId, element_id: B.elementId, business_representation_id: A.representationId }), B.client.from('proposal_elements').insert({ proposal_id: B.proposalId, element_id: A.elementId, business_representation_id: B.representationId }),
    ];
    const links = await Promise.all(linkCases); assert(links.every(x => x.error), 'foreign Proposal links');
    const highA = await A.client.from('representation_proposals').insert({ business_representation_id: A.representationId, proposed_changes: { pricing: { after: 1 } }, risk_tier: 'high', highest_sensitivity_class: 'pricing', requires_approval: true, status: 'pending_approval', proposed_by_actor: A.id }).select().single();
    const highB = await B.client.from('representation_proposals').insert({ business_representation_id: B.representationId, proposed_changes: { pricing: { after: 1 } }, risk_tier: 'high', highest_sensitivity_class: 'pricing', requires_approval: true, status: 'pending_approval', proposed_by_actor: B.id }).select().single();
    if (highA.error || highB.error) throw highA.error ?? highB.error; registry.registerProposal(highA.data.id); registry.registerProposal(highB.data.id);
    const approvals = await Promise.all([B.client.from('approval_decisions').insert({ business_representation_id: A.representationId, representation_proposal_id: highA.data.id, decision: 'approved', approver_user_id: B.id }), A.client.from('approval_decisions').insert({ business_representation_id: B.representationId, representation_proposal_id: highB.data.id, decision: 'approved', approver_user_id: A.id })]);
    assert(approvals.every(x => x.error), 'foreign Approvals');
    const before = await admin.from('representation_elements').select().in('id', [A.elementId, B.elementId]);
    const updates = await Promise.all([A.client.from('representation_elements').update({ claim_eligibility: 'prohibited', is_disputed: true }).eq('id', B.elementId).select(), B.client.from('representation_elements').update({ claim_eligibility: 'prohibited', is_disputed: true }).eq('id', A.elementId).select()]);
    assert(updates.every(x => !x.error && x.data?.length === 0), 'foreign Element updates');
    const after = await admin.from('representation_elements').select().in('id', [A.elementId, B.elementId]); assert(JSON.stringify(before.data) === JSON.stringify(after.data), 'Elements unchanged');
    const rpc = async (actor: Tenant, foreign: Tenant) => actor.client.rpc('zeya_create_canonical_version', { p_business_representation_id: foreign.representationId, p_source_proposal_id: foreign.proposalId, p_element_values: { x: 1 }, p_overall_confidence_score: 50, p_actor_user_id: actor.id, p_rollback_of_version_id: null });
    const rpcResults = await Promise.all([rpc(A, B), rpc(B, A)]); assert(rpcResults.every(x => x.error), 'foreign canonical RPC');
    assert((await context(A, A.representationId)).status === 200 && (await context(B, B.representationId)).status === 200, 'own state after foreign attempts');
    console.log('Representation State Integration\n\nInfrastructure — PASS\nTest B — PASS\nOwn-tenant access — PASS\nCross-tenant context — PASS\nCross-tenant writes — PASS\nCross-tenant links — PASS\nCross-tenant approval — PASS\nCross-tenant canonical version — PASS');
  } finally {
    cleanup = await cleanupFixtures(admin, registry);
    console.log(`Representation cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}\nBusiness cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}\nAuth cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}`);
    await server.stop(); console.log('Server cleanup — PASS');
  }
  if (!cleanup?.success) throw new Error(cleanup?.failures.join(', '));
}
const keepAlive = setInterval(() => {}, 1_000);
main().catch(error => { console.error(error instanceof Error ? error.message : 'Test B failed'); process.exitCode = 1; }).finally(() => clearInterval(keepAlive));
