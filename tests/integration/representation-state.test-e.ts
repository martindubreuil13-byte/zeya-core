import { loadEnvConfig } from '@next/env';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { cleanupFixtures } from './representation-state-test-cleanup';
import { jsonRequest } from './representation-state-test-client';
import { FixtureRegistry } from './representation-state-test-fixtures';
import { startTestServer } from './representation-state-test-server';

type AuthenticatedUser = {
  id: string;
  token: string;
  client: SupabaseClient;
};

type EvidenceResponse = {
  success: boolean;
  data?: {
    evidenceId: string;
    observationId: string;
    proposalId: string;
    businessRepresentationId: string;
    contradictionDetected: boolean;
    representationRestricted: boolean;
    confidenceReduced: boolean;
    reviewRequired: boolean;
  };
  error?: string;
};

type VersionResponse = {
  success: boolean;
  data?: {
    versionId: string;
    versionNumber: number;
    approvalId: string | null;
    confidenceAssessmentId: string;
  };
  error?: string;
};

type ConfidenceRow = {
  id: string;
  business_representation_id: string;
  representation_version_id: string;
  confidence_score: number;
  confidence_band: string;
  evidence_count: number;
  source_diversity_score: number | null;
  source_quality_score: number | null;
  recency_score: number | null;
  contradiction_penalty: number;
  calculation_method: string;
  calculation_version: string;
  calculation_timestamp: string;
  rationale: string;
  factors: Record<string, unknown>;
  created_at: string;
};

type ElementRow = {
  id: string;
  business_representation_id: string;
  element_key: string;
  current_value_version_id: string | null;
  is_disputed: boolean;
  claim_eligibility: string;
  updated_at: string;
};

type AuditRow = {
  id: string;
  business_representation_id: string;
  event_type: string;
  evidence_id: string | null;
  observation_id: string | null;
  proposal_id: string | null;
  version_id: string | null;
  actor_user_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

type ContextBody = {
  success: boolean;
  data?: {
    elements: Array<{
      elementId: string;
      elementKey: string;
      currentValue: { value: string };
    }>;
  };
  error?: string;
};

const canonicalValues = {
  strong_claim: { value: 'verified enterprise onboarding capability' },
  weak_claim: { value: 'possible international expansion' },
  target_customer: { value: 'independent consultants' },
  unaffected_claim: { value: '24-hour response commitment' },
};

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Test E: ${message}`);
}

function assertConfidenceStructure(row: ConfidenceRow, label: string): void {
  assert(Number.isFinite(row.confidence_score), `${label} score`);
  assert(row.confidence_band, `${label} band`);
  assert(Number.isInteger(row.evidence_count) && row.evidence_count > 0, `${label} evidence count`);
  assert(row.source_diversity_score !== null, `${label} source diversity`);
  assert(row.source_quality_score !== null, `${label} source quality`);
  assert(row.recency_score !== null, `${label} recency`);
  assert(Number.isFinite(row.contradiction_penalty), `${label} contradiction penalty`);
  assert(row.calculation_method, `${label} calculation method`);
  assert(row.calculation_version, `${label} calculation version`);
  assert(row.calculation_timestamp, `${label} calculation timestamp`);
  assert(row.rationale, `${label} rationale`);
  assert(row.factors && Object.keys(row.factors).length > 0, `${label} factors`);
}

function contextValue(body: ContextBody, elementKey: string): string | undefined {
  return body.data?.elements.find((element) => element.elementKey === elementKey)?.currentValue.value;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const server = await startTestServer();
  const registry = new FixtureRegistry();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  let cleanup: Awaited<ReturnType<typeof cleanupFixtures>> | undefined;

  try {
    async function createUser(label: string): Promise<AuthenticatedUser> {
      const email = `representation-e-${label}-${registry.runId}@zeya.test`;
      const password = `T-${crypto.randomUUID()}!`;
      const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (created.error) throw created.error;
      registry.registerAuthUser(created.data.user.id, email);

      const auth = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      );
      const signedIn = await auth.auth.signInWithPassword({ email, password });
      if (signedIn.error || !signedIn.data.session) {
        throw signedIn.error ?? new Error('Authentication failed');
      }
      const token = signedIn.data.session.access_token;
      return {
        id: created.data.user.id,
        token,
        client: createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
          { global: { headers: { Authorization: `Bearer ${token}` } } },
        ),
      };
    }

    const owner = await createUser('owner');
    const foreign = await createUser('foreign');
    const businessResult = await owner.client
      .from('businesses')
      .insert({ business_name: `Test E ${registry.runId}`, user_id: owner.id })
      .select()
      .single();
    if (businessResult.error) throw businessResult.error;
    const businessId = businessResult.data.id as string;
    registry.registerBusiness(businessId, owner.id);

    async function ingest(
      statement: string,
      options: {
        sourceDescription: string;
        targetElementId?: string;
        affectedElementValues?: Record<string, unknown>;
      },
      actor: AuthenticatedUser = owner,
    ) {
      return jsonRequest<EvidenceResponse>(server.baseUrl, '/api/representation/evidence', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${actor.token}` },
        body: JSON.stringify({ businessId, statement, ...options }),
      });
    }

    const initial = await ingest('possible international expansion', {
      sourceDescription: 'Single older uncorroborated planning note',
    });
    assert(initial.status === 201 && initial.body.data, 'initial Evidence ingestion');
    const representationId = initial.body.data.businessRepresentationId;
    registry.registerBusinessRepresentation(representationId, businessId);
    registry.registerEvidence(initial.body.data.evidenceId);
    registry.registerObservation(initial.body.data.observationId);
    registry.registerProposal(initial.body.data.proposalId);

    async function createVersion(
      proposalId: string,
      elementValues: Record<string, { value: string }>,
      confidenceScore: number,
    ): Promise<{ versionId: string; confidence: ConfidenceRow }> {
      const response = await jsonRequest<VersionResponse>(server.baseUrl, '/api/representation/versions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: `Bearer ${owner.token}` },
        body: JSON.stringify({ businessRepresentationId: representationId, proposalId, elementValues, confidenceScore }),
      });
      assert(response.status === 201 && response.body.data, 'canonical Version creation');
      registry.registerVersion(response.body.data.versionId);
      registry.registerConfidenceAssessment(response.body.data.confidenceAssessmentId);
      const confidenceResult = await admin
        .from('confidence_assessments')
        .select()
        .eq('id', response.body.data.confidenceAssessmentId)
        .single();
      if (confidenceResult.error) throw confidenceResult.error;
      return { versionId: response.body.data.versionId, confidence: confidenceResult.data as ConfidenceRow };
    }

    const weakVersion = await createVersion(
      initial.body.data.proposalId,
      { weak_claim: canonicalValues.weak_claim },
      30,
    );
    assertConfidenceStructure(weakVersion.confidence, 'weak Confidence Assessment');
    assert(weakVersion.confidence.contradiction_penalty === 0, 'weak contradiction penalty is zero');

    const strongEvidence = await ingest('verified enterprise onboarding capability', {
      sourceDescription: 'Direct founder confirmation for strong claim',
    });
    assert(strongEvidence.status === 201 && strongEvidence.body.data, 'strong Evidence ingestion');
    registry.registerEvidence(strongEvidence.body.data.evidenceId);
    registry.registerObservation(strongEvidence.body.data.observationId);
    registry.registerProposal(strongEvidence.body.data.proposalId);
    const corroborating = await ingest('verified enterprise onboarding capability', {
      sourceDescription: 'Independent recent customer implementation record',
    });
    assert(corroborating.status === 201 && corroborating.body.data, 'corroborating Evidence');
    registry.registerEvidence(corroborating.body.data.evidenceId);
    registry.registerObservation(corroborating.body.data.observationId);
    registry.registerProposal(corroborating.body.data.proposalId);

    const strongVersion = await createVersion(
      strongEvidence.body.data.proposalId,
      { weak_claim: canonicalValues.weak_claim, strong_claim: canonicalValues.strong_claim },
      85,
    );
    assertConfidenceStructure(strongVersion.confidence, 'strong Confidence Assessment');
    assert(strongVersion.confidence.contradiction_penalty === 0, 'strong contradiction penalty is zero');
    assert(/founder|confirm|support|consistent/i.test(strongVersion.confidence.rationale), 'strong rationale');
    const strongEvidenceRows = await admin
      .from('evidence')
      .select('id')
      .eq('business_representation_id', representationId)
      .in('id', [strongEvidence.body.data.evidenceId, corroborating.body.data.evidenceId]);
    if (strongEvidenceRows.error) throw strongEvidenceRows.error;
    assert(strongEvidenceRows.data.length === 2, 'both corroborating Evidence records exist');
    assert(strongVersion.confidence.evidence_count >= strongEvidenceRows.data.length, 'strong assessment reflects corroborating Evidence count');
    assert(strongVersion.confidence.confidence_score > weakVersion.confidence.confidence_score, 'strong score exceeds weak score');
    assert(strongVersion.confidence.evidence_count >= weakVersion.confidence.evidence_count, 'strong evidence count ordering');

    const targetEvidence = await ingest('independent consultants', {
      sourceDescription: 'Current confirmed target-customer statement',
    });
    assert(targetEvidence.status === 201 && targetEvidence.body.data, 'target Evidence ingestion');
    registry.registerEvidence(targetEvidence.body.data.evidenceId);
    registry.registerObservation(targetEvidence.body.data.observationId);
    registry.registerProposal(targetEvidence.body.data.proposalId);
    const canonical = await createVersion(targetEvidence.body.data.proposalId, canonicalValues, 85);

    const domainResult = await owner.client
      .from('representation_domains')
      .select('id')
      .eq('business_representation_id', representationId)
      .eq('domain_name', 'customer')
      .single();
    if (domainResult.error) throw domainResult.error;
    registry.registerDomain(domainResult.data.id);

    const elementInsert = await owner.client
      .from('representation_elements')
      .insert(Object.keys(canonicalValues).map((elementKey) => ({
        business_representation_id: representationId,
        representation_domain_id: domainResult.data.id,
        element_key: elementKey,
        element_type: 'fact',
        current_value_version_id: canonical.versionId,
        is_disputed: false,
        claim_eligibility: 'approved_for_external_use',
        field_sensitivity: 'operational',
      })))
      .select();
    if (elementInsert.error) throw elementInsert.error;
    elementInsert.data.forEach((element) => registry.registerElement(element.id));
    const elements = new Map(
      (elementInsert.data as ElementRow[]).map((element) => [element.element_key, element]),
    );
    const target = elements.get('target_customer');
    const unaffected = elements.get('unaffected_claim');
    assert(target && unaffected, 'target and unaffected Elements');

    const targetSupport = await ingest('independent consultants', {
      sourceDescription: 'Element-targeted confirmation of the active customer claim',
      targetElementId: target.id,
      affectedElementValues: { [target.id]: canonicalValues.target_customer },
    });
    assert(targetSupport.status === 201 && targetSupport.body.data, 'targeted supporting Evidence');
    registry.registerEvidence(targetSupport.body.data.evidenceId);
    registry.registerObservation(targetSupport.body.data.observationId);
    registry.registerProposal(targetSupport.body.data.proposalId);
    assert(targetSupport.body.data.contradictionDetected === false, 'target support is non-contradictory');

    const context = (actor: AuthenticatedUser, provisional = false) =>
      jsonRequest<ContextBody>(
        server.baseUrl,
        `/api/representation/agent-context?businessRepresentationId=${representationId}${provisional ? '&includeProvisional=true' : ''}`,
        { headers: { Authorization: `Bearer ${actor.token}` } },
      );
    const beforeContext = await context(owner);
    assert(beforeContext.status === 200, 'pre-contradiction context status');
    assert(contextValue(beforeContext.body, 'target_customer') === 'independent consultants', 'pre-contradiction target visible');
    assert(contextValue(beforeContext.body, 'unaffected_claim') === '24-hour response commitment', 'pre-contradiction unaffected visible');

    const targetBefore = { ...target };
    const unaffectedBefore = { ...unaffected };
    const confidenceBefore = canonical.confidence;
    assertConfidenceStructure(confidenceBefore, 'pre-contradiction Confidence Assessment');
    const auditsBeforeResult = await admin
      .from('audit_events')
      .select('id')
      .eq('business_representation_id', representationId)
      .eq('event_type', 'contradiction_detected');
    if (auditsBeforeResult.error) throw auditsBeforeResult.error;
    assert(auditsBeforeResult.data.length === 0, 'no prior contradiction Audit Event');

    const contradictory = await ingest(
      'The current target is not independent consultants; it is mid-sized retail chains instead',
      {
        sourceDescription: 'Current direct correction to target customer',
        targetElementId: target.id,
        affectedElementValues: { [target.id]: { value: 'mid-sized retail chains' } },
      },
    );
    assert(contradictory.status === 201 && contradictory.body.data, 'contradictory Evidence accepted');
    registry.registerEvidence(contradictory.body.data.evidenceId);
    registry.registerObservation(contradictory.body.data.observationId);
    registry.registerProposal(contradictory.body.data.proposalId);
    assert(contradictory.body.data.contradictionDetected === true, 'contradictionDetected');
    assert(contradictory.body.data.representationRestricted === true, 'representationRestricted');
    assert(contradictory.body.data.confidenceReduced === true, 'confidenceReduced');
    assert(contradictory.body.data.reviewRequired === true, 'reviewRequired');
    const publicContradictionBody = JSON.stringify(contradictory.body);
    for (const forbidden of ['constraint', 'stack', 'postgres', 'SUPABASE_', 'filesystem']) {
      assert(!publicContradictionBody.toLowerCase().includes(forbidden.toLowerCase()), `safe contradiction response: ${forbidden}`);
    }

    const evidenceAfter = await admin
      .from('evidence')
      .select('id,business_representation_id,raw_statement')
      .eq('business_representation_id', representationId)
      .in('id', [targetSupport.body.data.evidenceId, contradictory.body.data.evidenceId]);
    if (evidenceAfter.error) throw evidenceAfter.error;
    assert(evidenceAfter.data.length >= 2, 'original and contradictory Evidence preserved');
    assert(evidenceAfter.data.some((row) => row.id === targetSupport.body.data?.evidenceId), 'original target Evidence remains');
    assert(evidenceAfter.data.some((row) => row.id === contradictory.body.data?.evidenceId), 'contradictory Evidence remains');

    const observationsAfter = await admin
      .from('observations')
      .select('id,evidence_id,business_representation_id,affected_elements')
      .eq('business_representation_id', representationId)
      .contains('affected_elements', [target.id]);
    if (observationsAfter.error) throw observationsAfter.error;
    assert(observationsAfter.data.length >= 2, 'original and contradictory Observations preserved');
    assert(observationsAfter.data.some((row) => row.id === targetSupport.body.data?.observationId), 'original Observation remains');
    assert(observationsAfter.data.some((row) => row.id === contradictory.body.data?.observationId), 'contradictory Observation remains');

    const targetAfterResult = await admin.from('representation_elements').select().eq('id', target.id).single();
    const unaffectedAfterResult = await admin.from('representation_elements').select().eq('id', unaffected.id).single();
    if (targetAfterResult.error) throw targetAfterResult.error;
    if (unaffectedAfterResult.error) throw unaffectedAfterResult.error;
    const targetAfter = targetAfterResult.data as ElementRow;
    const unaffectedAfter = unaffectedAfterResult.data as ElementRow;
    assert(targetAfter.is_disputed === true, 'target Element disputed');
    assert(targetAfter.claim_eligibility === 'disputed', 'target eligibility disputed');
    assert(targetAfter.current_value_version_id === targetBefore.current_value_version_id, 'no automatic target canonical replacement');
    assert(targetAfter.element_key === targetBefore.element_key, 'target key preserved');
    assert(unaffectedAfter.element_key === unaffectedBefore.element_key, 'unaffected key unchanged');
    assert(unaffectedAfter.claim_eligibility === unaffectedBefore.claim_eligibility, 'unaffected eligibility unchanged');
    assert(unaffectedAfter.is_disputed === unaffectedBefore.is_disputed, 'unaffected dispute state unchanged');
    assert(unaffectedAfter.current_value_version_id === unaffectedBefore.current_value_version_id, 'unaffected pointer unchanged');

    const confidenceHistoryResult = await admin
      .from('confidence_assessments')
      .select()
      .eq('representation_version_id', canonical.versionId)
      .order('created_at');
    if (confidenceHistoryResult.error) throw confidenceHistoryResult.error;
    const confidenceHistory = confidenceHistoryResult.data as ConfidenceRow[];
    assert(confidenceHistory.length === 2, 'one new contradiction Confidence Assessment');
    const preservedConfidence = confidenceHistory.find((row) => row.id === confidenceBefore.id);
    const reducedConfidence = confidenceHistory.find((row) => row.id !== confidenceBefore.id);
    assert(preservedConfidence && reducedConfidence, 'prior and new Confidence Assessments exist');
    registry.registerConfidenceAssessment(reducedConfidence.id);
    assert(JSON.stringify(preservedConfidence) === JSON.stringify(confidenceBefore), 'prior Confidence Assessment unchanged');
    assertConfidenceStructure(reducedConfidence, 'contradiction Confidence Assessment');
    assert(reducedConfidence.confidence_score < confidenceBefore.confidence_score, 'confidence decreased');
    assert(reducedConfidence.contradiction_penalty > 0, 'contradiction penalty applied');
    assert(reducedConfidence.evidence_count >= 2, 'conflicting Evidence included in count');
    assert(/conflict|contradict|incompatible/i.test(reducedConfidence.rationale), 'contradiction rationale');
    assert(new Date(reducedConfidence.calculation_timestamp) >= new Date(confidenceBefore.calculation_timestamp), 'confidence chronology');

    const auditResult = await admin
      .from('audit_events')
      .select()
      .eq('business_representation_id', representationId)
      .eq('event_type', 'contradiction_detected')
      .eq('evidence_id', contradictory.body.data.evidenceId);
    if (auditResult.error) throw auditResult.error;
    assert(auditResult.data.length === 1, 'exact contradiction Audit Event');
    const audit = auditResult.data[0] as AuditRow;
    registry.registerAuditEvent(audit.id);
    assert(audit.business_representation_id === representationId, 'Audit Business Representation');
    assert(audit.evidence_id === contradictory.body.data.evidenceId, 'Audit Evidence');
    assert(audit.observation_id === contradictory.body.data.observationId, 'Audit Observation');
    assert(audit.actor_user_id === owner.id, 'Audit actor');
    assert(audit.version_id === canonical.versionId, 'Audit Version');
    const auditDetails = JSON.stringify(audit.details);
    for (const required of [target.id, 'target_customer', 'independent consultants', 'mid-sized retail chains', confidenceBefore.confidence_score, reducedConfidence.confidence_score, 'approved_for_external_use', 'disputed', 'reviewRequired']) {
      assert(auditDetails.includes(String(required)), `Audit before-and-after detail ${required}`);
    }
    assert(auditDetails.includes('true'), 'Audit disputed/review state');

    const afterDefault = await context(owner);
    const afterProvisional = await context(owner, true);
    assert(afterDefault.status === 200 && afterProvisional.status === 200, 'post-contradiction contexts');
    for (const body of [afterDefault.body, afterProvisional.body]) {
      const serialized = JSON.stringify(body);
      assert(contextValue(body, 'target_customer') === undefined, 'disputed target excluded');
      assert(!serialized.includes('independent consultants'), 'old target value excluded');
      assert(!serialized.includes('mid-sized retail chains'), 'contradictory target value excluded');
      assert(contextValue(body, 'unaffected_claim') === '24-hour response commitment', 'unaffected claim remains');
      assert(!serialized.includes('contradiction_penalty') && !serialized.includes('is_disputed'), 'no dispute metadata leak');
    }

    const currentRepresentation = await admin
      .from('business_representations')
      .select('current_version_id')
      .eq('id', representationId)
      .single();
    if (currentRepresentation.error) throw currentRepresentation.error;
    assert(currentRepresentation.data.current_version_id === canonical.versionId, 'contradiction did not advance current Version');
    const replacementVersion = await admin
      .from('representation_versions')
      .select('id')
      .eq('business_representation_id', representationId)
      .contains('element_values', { target_customer: { value: 'mid-sized retail chains' } });
    if (replacementVersion.error) throw replacementVersion.error;
    assert(replacementVersion.data.length === 0, 'no automatic contradictory canonical Version');

    const foreignContext = await context(foreign);
    assert(foreignContext.status === 404, 'foreign context status');
    const foreignBody = JSON.stringify(foreignContext.body);
    for (const hidden of [representationId, 'target_customer', 'unaffected_claim', 'confidence', 'evidence', 'observation']) {
      assert(!foreignBody.toLowerCase().includes(hidden.toLowerCase()), `foreign context hides ${hidden}`);
    }
    const countsBeforeForeign = await Promise.all([
      admin.from('evidence').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('observations').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('confidence_assessments').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('audit_events').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId).eq('event_type', 'contradiction_detected'),
    ]);
    const foreignEvidence = await ingest('Contradictory foreign attempt', {
      sourceDescription: 'Foreign tenant attempt',
      targetElementId: target.id,
      affectedElementValues: { [target.id]: { value: 'foreign replacement' } },
    }, foreign);
    assert(foreignEvidence.status === 404, 'foreign Evidence blocked');
    const countsAfterForeign = await Promise.all([
      admin.from('evidence').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('observations').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('confidence_assessments').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId),
      admin.from('audit_events').select('*', { count: 'exact', head: true }).eq('business_representation_id', representationId).eq('event_type', 'contradiction_detected'),
    ]);
    assert(countsBeforeForeign.every((result, index) => result.count === countsAfterForeign[index].count), 'foreign attempt has no side effects');

    const priorConfidenceMutation = await owner.client
      .from('confidence_assessments')
      .update({ confidence_score: 0 })
      .eq('id', confidenceBefore.id)
      .select('id');
    assert(priorConfidenceMutation.error || priorConfidenceMutation.data.length === 0, 'Confidence update blocked');
    const priorConfidenceDelete = await owner.client
      .from('confidence_assessments')
      .delete()
      .eq('id', confidenceBefore.id)
      .select('id');
    assert(priorConfidenceDelete.error || priorConfidenceDelete.data.length === 0, 'Confidence delete blocked');
    const reducedConfidenceSnapshot = JSON.stringify(reducedConfidence);
    const reducedConfidenceMutation = await owner.client
      .from('confidence_assessments')
      .update({ confidence_score: 0 })
      .eq('id', reducedConfidence.id)
      .select('id');
    assert(reducedConfidenceMutation.error || reducedConfidenceMutation.data.length === 0, 'new Confidence update blocked');
    const reducedConfidenceDelete = await owner.client
      .from('confidence_assessments')
      .delete()
      .eq('id', reducedConfidence.id)
      .select('id');
    assert(reducedConfidenceDelete.error || reducedConfidenceDelete.data.length === 0, 'new Confidence delete blocked');
    const confidenceUnchangedResult = await admin.from('confidence_assessments').select().eq('id', confidenceBefore.id).single();
    if (confidenceUnchangedResult.error) throw confidenceUnchangedResult.error;
    assert(JSON.stringify(confidenceUnchangedResult.data) === JSON.stringify(confidenceBefore), 'Confidence history immutable');
    const reducedConfidenceUnchangedResult = await admin.from('confidence_assessments').select().eq('id', reducedConfidence.id).single();
    if (reducedConfidenceUnchangedResult.error) throw reducedConfidenceUnchangedResult.error;
    assert(JSON.stringify(reducedConfidenceUnchangedResult.data) === reducedConfidenceSnapshot, 'new Confidence immutable');

    const auditSnapshot = JSON.stringify(audit);
    const auditUpdate = await owner.client.from('audit_events').update({ details: {} }).eq('id', audit.id);
    const auditDelete = await owner.client.from('audit_events').delete().eq('id', audit.id);
    assert(auditUpdate.error && auditDelete.error, 'Audit mutations blocked');
    const auditUnchangedResult = await admin.from('audit_events').select().eq('id', audit.id).single();
    if (auditUnchangedResult.error) throw auditUnchangedResult.error;
    assert(JSON.stringify(auditUnchangedResult.data) === auditSnapshot, 'Audit history immutable');

    const supporting = await ingest('24-hour response commitment', {
      sourceDescription: 'Fresh supporting operational record',
      targetElementId: unaffected.id,
      affectedElementValues: { [unaffected.id]: canonicalValues.unaffected_claim },
    });
    assert(supporting.status === 201 && supporting.body.data, 'supporting Evidence accepted');
    registry.registerEvidence(supporting.body.data.evidenceId);
    registry.registerObservation(supporting.body.data.observationId);
    registry.registerProposal(supporting.body.data.proposalId);
    assert(supporting.body.data.contradictionDetected === false, 'no false contradiction');
    assert(supporting.body.data.representationRestricted === false, 'unaffected claim not restricted');
    assert(supporting.body.data.confidenceReduced === false, 'unaffected confidence not reduced');
    assert(supporting.body.data.reviewRequired === false, 'supporting Evidence needs no review');
    const unaffectedFinal = await admin.from('representation_elements').select().eq('id', unaffected.id).single();
    if (unaffectedFinal.error) throw unaffectedFinal.error;
    assert(unaffectedFinal.data.is_disputed === false, 'unaffected claim remains undisputed');
    assert(unaffectedFinal.data.claim_eligibility === 'approved_for_external_use', 'unaffected claim remains eligible');
    const falseAudit = await admin
      .from('audit_events')
      .select('id')
      .eq('business_representation_id', representationId)
      .eq('event_type', 'contradiction_detected')
      .eq('evidence_id', supporting.body.data.evidenceId);
    if (falseAudit.error) throw falseAudit.error;
    assert(falseAudit.data.length === 0, 'no false contradiction Audit Event');
    const finalContext = await context(owner);
    assert(contextValue(finalContext.body, 'unaffected_claim') === '24-hour response commitment', 'unaffected claim retained');

    console.log(
      'Representation State Integration\n\n' +
      'Infrastructure — PASS\n' +
      'Test E — PASS\n' +
      'Strong confidence — PASS\n' +
      'Weak confidence — PASS\n' +
      'Confidence ordering — PASS\n' +
      'Contradictory Evidence preservation — PASS\n' +
      'Element restriction — PASS\n' +
      'Confidence reduction — PASS\n' +
      'Contradiction penalty — PASS\n' +
      'Contradiction audit — PASS\n' +
      'Review required — PASS\n' +
      'Agent-context exclusion — PASS\n' +
      'Unaffected claim retained — PASS\n' +
      'Tenant restriction — PASS\n' +
      'False-positive protection — PASS',
    );
  } finally {
    cleanup = await cleanupFixtures(admin, registry);
    console.log(
      `Representation cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}\n` +
      `Business cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}\n` +
      `Auth cleanup — ${cleanup.success ? 'PASS' : 'FAIL'}`,
    );
    await server.stop();
    console.log('Server cleanup — PASS');
  }

  if (!cleanup?.success) throw new Error(cleanup?.failures.join(', '));
}

const keepAlive = setInterval(() => undefined, 1000);
main()
  .catch((error: unknown) => {
    if (error instanceof Error) console.error(error.message);
    else if (error && typeof error === 'object' && 'code' in error) {
      console.error(`Test E database assertion failed: ${String(error.code)}`);
    } else console.error('Test E failed');
    process.exitCode = 1;
  })
  .finally(() => clearInterval(keepAlive));
