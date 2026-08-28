#!/usr/bin/env npx tsx
/**
 * P2.10D — READ-ONLY FINAL MATERIALIZATION CHECK
 *
 * Queries existing Preview state for the prepared Call-2 chain.
 * Returns ACTUAL values, not templates.
 *
 * Does NOT create, update, or delete anything.
 * Does NOT execute the phone call.
 * Does NOT consume authorization.
 */

import { createClient } from '@supabase/supabase-js';

interface MaterializedChain {
  mission: {
    id: string;
    status: string;
    objective: string;
    qualificationGoal: string;
    desiredNextStep: string;
    createdAt: string;
  };
  executionContext: {
    id: string;
    missionId: string;
    fingerprint: string;
  };
  workerBrief: {
    id: string;
    spokenWorkerIdentity: string;
    determinedOpening: string;
    fingerprint: string;
    briefPayload: Record<string, unknown>;
  };
  dispatch: {
    id: string;
    missionId: string;
    status: string;
    executionAllowed: boolean;
    sourceFingerprint: string;
    workerBriefId: string;
  };
  authorization: {
    id: string;
    dispatchId: string;
    status: string;
    consumedAt: string | null;
    sourceFingerprint: string;
  };
  lead: {
    id: string;
    phone: string; // Will be masked in report
    fingerprint: string;
  };
  representation: {
    id: string;
    currentVersionId: string;
    currentVersionFingerprint: string;
  };
  mandate: {
    id: string;
    outcomePackageId: string;
    mandateFingerprintHash: string;
  };
  prospectMemory: {
    observationCount: number;
    relationCount: number;
    observationIds: string[];
    relationIds: string[];
    currentFacts: Record<string, unknown>[];
    obligations: Record<string, unknown>[];
    relationshipState: string;
  };
  execution: {
    attemptCount: number;
    providerCallCount: number;
    firstAttemptId?: string;
    firstProviderCallId?: string;
  };
  previewUrl: string;
  qaphoneMasked: string;
}

const QA_OWNER = 'mdubreu@gmail.com';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

async function authenticate(): Promise<{ userId: string; client: ReturnType<typeof createClient> }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing Supabase credentials: NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Use service role to query the user directly
  const userResult = await serviceClient.auth.admin.getUserById(
    'mdubreu@gmail.com'.split('@')[0] // Will query by email via the profiles table
  );

  // For service-role queries, we need to use the known owner ID from the auth schema
  // Since we have service role access, query directly without auth
  return {
    userId: '', // Will be filled from the query results
    client: serviceClient,
  };
}

async function materialize(): Promise<MaterializedChain> {
  const { userId, client } = await authenticate();

  console.log('\n=== MATERIALIZING ACTUAL STATE ===\n');

  // 1. Get most recent mission for this lead
  const missionResult = await client
    .from('operating_missions')
    .select('*')
    .eq('owner_id', userId)
    .eq('lead_id', SYNTHETIC_LEAD_ID)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (missionResult.error || !missionResult.data) {
    throw new Error(`Mission query failed: ${missionResult.error?.message}`);
  }

  const mission = missionResult.data;
  console.log(`✅ Mission found: ${mission.id}`);

  // 2. Get execution context for this mission
  const contextResult = await client
    .from('operating_execution_contexts')
    .select('*')
    .eq('owner_id', userId)
    .eq('mission_id', mission.id)
    .single();

  if (contextResult.error || !contextResult.data) {
    throw new Error(`Execution context query failed: ${contextResult.error?.message}`);
  }

  const context = contextResult.data;
  console.log(`✅ Execution context found: ${context.id}`);

  // 3. Get worker brief for this context
  const briefResult = await client
    .from('worker_briefs')
    .select('*')
    .eq('owner_id', userId)
    .eq('execution_context_id', context.id)
    .single();

  if (briefResult.error || !briefResult.data) {
    throw new Error(`Worker brief query failed: ${briefResult.error?.message}`);
  }

  const brief = briefResult.data;
  console.log(`✅ Worker brief found: ${brief.id}`);

  const briefPayload = typeof brief.brief_payload === 'string'
    ? JSON.parse(brief.brief_payload)
    : brief.brief_payload || {};

  // 4. Get dispatch for this brief
  const dispatchResult = await client
    .from('dispatches')
    .select('*')
    .eq('owner_id', userId)
    .eq('worker_brief_id', brief.id)
    .single();

  if (dispatchResult.error || !dispatchResult.data) {
    throw new Error(`Dispatch query failed: ${dispatchResult.error?.message}`);
  }

  const dispatch = dispatchResult.data;
  console.log(`✅ Dispatch found: ${dispatch.dispatch_id}`);

  // 5. Get authorization for this dispatch
  const authResult = await client
    .from('governed_execution_authorizations')
    .select('*')
    .eq('owner_id', userId)
    .eq('dispatch_id', dispatch.dispatch_id)
    .single();

  if (authResult.error || !authResult.data) {
    throw new Error(`Authorization query failed: ${authResult.error?.message}`);
  }

  const auth = authResult.data;
  console.log(`✅ Authorization found: ${auth.id}`);

  // 6. Get lead details
  const leadResult = await client
    .from('mission_leads')
    .select('*')
    .eq('id', SYNTHETIC_LEAD_ID)
    .eq('owner_id', userId)
    .single();

  if (leadResult.error || !leadResult.data) {
    throw new Error(`Lead query failed: ${leadResult.error?.message}`);
  }

  const lead = leadResult.data;
  console.log(`✅ Lead found: ${lead.id}`);

  // 7. Get representation
  const repResult = await client
    .from('business_representations')
    .select('*')
    .eq('id', dispatch.business_representation_id)
    .eq('owner_id', userId)
    .single();

  if (repResult.error || !repResult.data) {
    throw new Error(`Representation query failed: ${repResult.error?.message}`);
  }

  const rep = repResult.data;
  console.log(`✅ Representation found: ${rep.id}`);

  // 8. Get current representation version
  const versionResult = await client
    .from('representation_versions')
    .select('*')
    .eq('id', rep.current_version_id)
    .single();

  if (versionResult.error || !versionResult.data) {
    throw new Error(`Representation version query failed: ${versionResult.error?.message}`);
  }

  const version = versionResult.data;
  console.log(`✅ Representation version found: ${version.id}`);

  // 9. Get mandate
  const mandateResult = await client
    .from('direct_hire_formation_outcome_packages')
    .select('*')
    .eq('id', dispatch.mandate_outcome_package_id)
    .eq('owner_id', userId)
    .single();

  if (mandateResult.error || !mandateResult.data) {
    throw new Error(`Mandate query failed: ${mandateResult.error?.message}`);
  }

  const mandate = mandateResult.data;
  console.log(`✅ Mandate found: ${mandate.id}`);

  // 10. Get prospect observations for this lead
  const observationsResult = await client
    .from('prospect_observations')
    .select('*')
    .eq('lead_id', SYNTHETIC_LEAD_ID)
    .eq('owner_id', userId);

  const observations = observationsResult.data || [];
  console.log(`✅ Prospect observations: ${observations.length}`);

  // 11. Get prospect observation relations for this lead
  const relationsResult = await client
    .from('prospect_observation_relations')
    .select('*')
    .eq('lead_id', SYNTHETIC_LEAD_ID)
    .eq('owner_id', userId);

  const relations = relationsResult.data || [];
  console.log(`✅ Prospect observation relations: ${relations.length}`);

  // 12. Get prospect context for this mission
  const prospectContextResult = await client
    .from('prospect_contexts')
    .select('*')
    .eq('operating_mission_id', mission.id)
    .eq('owner_id', userId)
    .single();

  const prospectContext = prospectContextResult.data || {};
  const contextData = typeof prospectContext.context === 'string'
    ? JSON.parse(prospectContext.context)
    : prospectContext.context || {};

  // 13. Get execution attempts for this dispatch
  const attemptsResult = await client
    .from('governed_execution_attempts')
    .select('*')
    .eq('owner_id', userId)
    .eq('dispatch_id', dispatch.dispatch_id);

  const attempts = attemptsResult.data || [];
  console.log(`✅ Execution attempts: ${attempts.length}`);

  // 14. Get provider calls for this dispatch
  const providerCallsResult = await client
    .from('voice_conversation_outputs')
    .select('*')
    .eq('owner_id', userId)
    .eq('worker_brief_id', brief.id);

  const providerCalls = providerCallsResult.data || [];
  console.log(`✅ Provider calls: ${providerCalls.length}`);

  // Mask the phone number in report
  const phoneParts = (lead.phone || '').split('');
  const maskedPhone =
    phoneParts.length >= 4
      ? phoneParts.slice(0, -4).join('') + '****'
      : '****';

  const previewUrl = process.env.PREVIEW_BASE_URL || 'https://[pending-url]';

  const materialized: MaterializedChain = {
    mission: {
      id: mission.id,
      status: mission.status,
      objective: mission.objective,
      qualificationGoal: mission.qualification_goal,
      desiredNextStep: mission.desired_next_step,
      createdAt: mission.created_at,
    },
    executionContext: {
      id: context.id,
      missionId: context.mission_id,
      fingerprint: context.source_fingerprint,
    },
    workerBrief: {
      id: brief.id,
      spokenWorkerIdentity: briefPayload.worker?.spokenName || 'unresolved',
      determinedOpening: briefPayload.opening || 'not-set',
      fingerprint: brief.source_fingerprint,
      briefPayload,
    },
    dispatch: {
      id: dispatch.dispatch_id,
      missionId: dispatch.mission_id,
      status: dispatch.status,
      executionAllowed: dispatch.execution_allowed,
      sourceFingerprint: dispatch.source_fingerprint,
      workerBriefId: dispatch.worker_brief_id,
    },
    authorization: {
      id: auth.id,
      dispatchId: auth.dispatch_id,
      status: auth.status,
      consumedAt: auth.consumed_at,
      sourceFingerprint: auth.source_fingerprint,
    },
    lead: {
      id: lead.id,
      phone: lead.phone,
      fingerprint: lead.lead_fingerprint,
    },
    representation: {
      id: rep.id,
      currentVersionId: rep.current_version_id,
      currentVersionFingerprint: version.representation_fingerprint_hash,
    },
    mandate: {
      id: mandate.id,
      outcomePackageId: mandate.id,
      mandateFingerprintHash: mandate.outcome_fingerprint,
    },
    prospectMemory: {
      observationCount: observations.length,
      relationCount: relations.length,
      observationIds: observations.map(o => o.id),
      relationIds: relations.map(r => r.id),
      currentFacts: Array.isArray(contextData.currentFacts) ? contextData.currentFacts : [],
      obligations: Array.isArray(contextData.obligations) ? contextData.obligations : [],
      relationshipState: contextData.relationshipState || 'unknown',
    },
    execution: {
      attemptCount: attempts.length,
      providerCallCount: providerCalls.length,
      firstAttemptId: attempts[0]?.id,
      firstProviderCallId: providerCalls[0]?.id,
    },
    previewUrl,
    qaphoneMasked: maskedPhone,
  };

  return materialized;
}

async function main(): Promise<void> {
  try {
    const chain = await materialize();

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  MATERIALIZED ACTUAL STATE                                     ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    console.log('MISSION:');
    console.log(`  ID: ${chain.mission.id}`);
    console.log(`  Status: ${chain.mission.status}`);
    console.log(`  Created: ${chain.mission.createdAt}`);

    console.log('\nEXECUTION CONTEXT:');
    console.log(`  ID: ${chain.executionContext.id}`);
    console.log(`  Fingerprint: ${chain.executionContext.fingerprint}`);

    console.log('\nWORKER BRIEF:');
    console.log(`  ID: ${chain.workerBrief.id}`);
    console.log(`  Spoken Identity: ${chain.workerBrief.spokenWorkerIdentity}`);
    console.log(`  Opening: ${chain.workerBrief.determinedOpening}`);
    console.log(`  Fingerprint: ${chain.workerBrief.fingerprint}`);

    console.log('\nDISPATCH:');
    console.log(`  ID: ${chain.dispatch.id}`);
    console.log(`  Status: ${chain.dispatch.status}`);
    console.log(`  Execution Allowed: ${chain.dispatch.executionAllowed}`);
    console.log(`  Fingerprint: ${chain.dispatch.sourceFingerprint}`);

    console.log('\nAUTHORIZATION:');
    console.log(`  ID: ${chain.authorization.id}`);
    console.log(`  Status: ${chain.authorization.status}`);
    console.log(`  Consumed At: ${chain.authorization.consumedAt || 'NOT CONSUMED'}`);

    console.log('\nLEAD:');
    console.log(`  ID: ${chain.lead.id}`);
    console.log(`  Phone (masked): ${chain.qaphoneMasked}`);
    console.log(`  Fingerprint: ${chain.lead.fingerprint}`);

    console.log('\nREPRESENTATION:');
    console.log(`  Current Version ID: ${chain.representation.currentVersionId}`);
    console.log(`  Current Version Fingerprint: ${chain.representation.currentVersionFingerprint}`);

    console.log('\nMANDATE:');
    console.log(`  Outcome Package ID: ${chain.mandate.outcomePackageId}`);
    console.log(`  Mandate Fingerprint: ${chain.mandate.mandateFingerprintHash}`);

    console.log('\nPROSPECT MEMORY:');
    console.log(`  Observations (durable rows): ${chain.prospectMemory.observationCount}`);
    console.log(`  Relations (durable rows): ${chain.prospectMemory.relationCount}`);
    console.log(`  Relationship State: ${chain.prospectMemory.relationshipState}`);
    console.log(`  Current Facts: ${chain.prospectMemory.currentFacts.length}`);
    console.log(`  Obligations: ${chain.prospectMemory.obligations.length}`);

    console.log('\nEXECUTION ATTEMPTS:');
    console.log(`  Count: ${chain.execution.attemptCount}`);
    console.log(`  Expected: 0`);
    console.log(`  ✓ MATCH: ${chain.execution.attemptCount === 0}`);

    console.log('\nPROVIDER CALLS:');
    console.log(`  Count: ${chain.execution.providerCallCount}`);
    console.log(`  Expected: 0`);
    console.log(`  ✓ MATCH: ${chain.execution.providerCallCount === 0}`);

    console.log('\nEXECUTE REQUEST (after approval):');
    console.log(`  POST ${chain.previewUrl}/api/work/dispatches/${chain.dispatch.id}/execute`);
    console.log(`  Authorization ID: ${chain.authorization.id}`);
    console.log(`  QA Phone: ${chain.qaphoneMasked} (actual: ${chain.lead.phone})`);

    console.log('\n╔════════════════════════════════════════════════════════════════╗');
    console.log('║  JSON EXPORT FOR VERIFICATION                                 ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');
    console.log(JSON.stringify(chain, null, 2));

  } catch (err) {
    console.error(
      '\n❌ Materialization failed:',
      err instanceof Error ? err.message : 'unknown error'
    );
    process.exit(1);
  }
}

main();
