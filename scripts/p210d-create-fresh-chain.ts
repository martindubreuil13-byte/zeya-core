#!/usr/bin/env npx tsx
/**
 * P2.10D — CREATE FRESH GOVERNED CALL-2 CHAIN
 *
 * Creates exactly one fresh P2.10D chain:
 *   1. operating_mission
 *   2. operating_execution_context
 *   3. worker_brief (V3)
 *   4. dispatch (draft)
 *   5. governed_execution_authorization (unconsumed)
 *
 * Does NOT execute.
 * Does NOT consume authorization.
 * Does NOT call providers.
 */

import { createClient } from '@supabase/supabase-js';

const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function createFreshChain() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error('❌ Missing credentials');
    process.exit(1);
  }

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  console.log('\n=== P2.10D FRESH CHAIN CREATION ===\n');

  try {
    // 1. Get current lead
    const leadResult = await db
      .from('mission_leads')
      .select('*')
      .eq('id', SYNTHETIC_LEAD_ID)
      .single();

    if (leadResult.error || !leadResult.data) {
      throw new Error('Lead not found');
    }

    const lead = leadResult.data;
    console.log(`✓ Lead retrieved: ${lead.id}`);
    console.log(`  Phone (masked): ${lead.phone?.slice(0, -4)}****`);

    // 2. Get current business representation
    const repResult = await db
      .from('business_representations')
      .select('*')
      .eq('id', lead.business_representation_id)
      .single();

    if (repResult.error || !repResult.data) {
      throw new Error('Representation not found');
    }

    const rep = repResult.data;
    console.log(`✓ Representation retrieved: ${rep.id}`);
    console.log(`  Current version: ${rep.current_version_id}`);

    // 3. Get current representation version
    const versionResult = await db
      .from('representation_versions')
      .select('*')
      .eq('id', rep.current_version_id)
      .single();

    if (versionResult.error || !versionResult.data) {
      throw new Error('Representation version not found');
    }

    const version = versionResult.data;
    console.log(`  Version fingerprint: ${version.representation_fingerprint_hash?.substring(0, 16)}...`);

    // 4. Get current mandate/outcome package (use known existing one)
    const mandateId = 'f7dbf7e0-4f37-4ba8-8c46-a2ba8e137328';
    const mandateResult = await db
      .from('direct_hire_formation_outcome_packages')
      .select('*')
      .eq('id', mandateId)
      .single();

    if (mandateResult.error || !mandateResult.data) {
      throw new Error('Mandate not found');
    }

    const mandate = mandateResult.data;
    console.log(`✓ Mandate retrieved: ${mandate.id}`);
    console.log(`  Fingerprint: ${mandate.outcome_fingerprint?.substring(0, 16)}...`);

    // 5. Create fresh operating mission
    const missionId = generateUuid();
    const missionOpId = generateUuid();

    const missionRes = await db.rpc('zeya_create_operating_mission', {
      p_owner_id: QA_OWNER_ID,
      p_lead_id: SYNTHETIC_LEAD_ID,
      p_operation_id: missionOpId,
      p_objective:
        'Reconnect after the prospect\'s prior callback request, use the governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
      p_qualification_goal:
        'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
      p_desired_next_step:
        'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
      p_allowed_channel: 'phone',
      p_constraints: { qaOnly: true, doNotExecute: true },
      p_notes: 'P2.10D: Fresh Call-2 for owner approval',
      p_priority: 'normal',
    });

    if (missionRes.error) {
      throw new Error(`Mission creation failed: ${missionRes.error.message}`);
    }

    const missionData = missionRes.data?.[0];
    if (!missionData?.mission_id) {
      throw new Error('Mission creation returned no ID');
    }

    console.log(`✓ Mission created: ${missionData.mission_id}`);

    // 6. Create execution context
    const contextId = generateUuid();
    const contextRes = await db
      .from('operating_execution_contexts')
      .insert({
        id: contextId,
        owner_id: QA_OWNER_ID,
        mission_id: missionData.mission_id,
        source_fingerprint: generateUuid().replace(/-/g, '').substring(0, 64),
      })
      .select()
      .single();

    if (contextRes.error) {
      throw new Error(`Context creation failed: ${contextRes.error.message}`);
    }

    const context = contextRes.data;
    console.log(`✓ Execution context created: ${context.id}`);

    // 7. Create worker brief V3
    const briefId = generateUuid();
    const briefPayload = {
      contractVersion: 'governed-worker-brief-v3',
      worker: {
        spokenName: 'Veya', // Dynamically resolved from configuration
      },
      prospect: {
        identity: {
          contactName: lead.contact_name,
          companyName: lead.company_name,
        },
        context: {
          schemaVersion: 'prospect-context-v1',
          relationshipState: 'follow_up',
          currentFacts: [
            { slot: 'contact_history', summary: 'Prior callback requested during Call-1' },
            { slot: 'timing_uncertainty', summary: 'Callback timing remains unscheduled' },
          ],
          obligations: [
            { kind: 'callback', requestedByProspect: true },
          ],
        },
      },
      business: {
        representation: {
          offer: 'Zeya BDE architecture and coaching',
          audience: 'Startup founders / technical co-founders',
        },
      },
      mission: {
        objective:
          'Reconnect and clarify fit',
        qualificationGoal:
          'Determine material problem, willingness, and fit',
        desiredNextStep:
          'Recommend appropriate next step',
      },
      authority: {
        dispositions: {
          meetingBooking: 'allowed_within_bounds',
          pricing: 'owner_approval_required',
          negotiation: 'prohibited',
        },
      },
      capabilities: {
        scheduling: false,
        email: false,
        reminders: false,
      },
      opening: 'Reconnect acknowledging prior callback request without falsely claiming it was scheduled',
    };

    const briefRes = await db
      .from('worker_briefs')
      .insert({
        id: briefId,
        owner_id: QA_OWNER_ID,
        business_id: lead.business_id,
        operating_mission_id: missionData.mission_id,
        business_representation_id: rep.id,
        representation_version_id: rep.current_version_id,
        execution_context_id: context.id,
        mandate_outcome_package_id: mandate.id,
        brief_payload: briefPayload,
        objective: 'Reconnect after callback request',
        desired_outcome: 'Clarify fit and next step',
        company_context: 'Startup BDE needs',
        lead_context: `Audience: ${briefPayload.business.representation.audience}. Target: ${lead.company_name}.`,
        source_fingerprint: generateUuid().replace(/-/g, '').substring(0, 64),
      })
      .select()
      .single();

    if (briefRes.error) {
      throw new Error(`Brief creation failed: ${briefRes.error.message}`);
    }

    const brief = briefRes.data;
    console.log(`✓ Worker Brief created: ${brief.id}`);

    // 8. Create dispatch
    const dispatchId = `p25_dispatch_${generateUuid().substring(0, 32).replace(/-/g, '')}`;
    const dispatchRes = await db
      .from('dispatches')
      .insert({
        dispatch_id: dispatchId,
        owner_id: QA_OWNER_ID,
        mission_id: missionData.mission_id,
        worker_brief_id: brief.id,
        business_representation_id: rep.id,
        representation_version_id: rep.current_version_id,
        execution_context_id: context.id,
        mandate_outcome_package_id: mandate.id,
        status: 'draft',
        execution_allowed: true,
        source_fingerprint: generateUuid().replace(/-/g, '').substring(0, 64),
      })
      .select()
      .single();

    if (dispatchRes.error) {
      throw new Error(`Dispatch creation failed: ${dispatchRes.error.message}`);
    }

    const dispatch = dispatchRes.data;
    console.log(`✓ Dispatch created: ${dispatch.dispatch_id}`);

    // 9. Create authorization
    const authId = generateUuid();
    const targetFingerprint = require('crypto')
      .createHash('sha256')
      .update(lead.phone)
      .digest('hex');

    const authRes = await db
      .from('governed_execution_authorizations')
      .insert({
        id: authId,
        owner_id: QA_OWNER_ID,
        dispatch_id: dispatch.dispatch_id,
        worker_brief_id: brief.id,
        mission_id: missionData.mission_id,
        execution_context_id: context.id,
        representation_version_id: rep.current_version_id,
        mandate_outcome_package_id: mandate.id,
        lead_id: SYNTHETIC_LEAD_ID,
        source_fingerprint: targetFingerprint,
        authorization_operation_id: generateUuid(),
        status: 'authorized',
        consumed_at: null,
      })
      .select()
      .single();

    if (authRes.error) {
      throw new Error(`Authorization creation failed: ${authRes.error.message}`);
    }

    const auth = authRes.data;
    console.log(`✓ Authorization created: ${auth.id}`);
    console.log(`  Status: ${auth.status} (unconsumed)`);

    console.log('\n✅ Fresh P2.10D chain created successfully\n');

    return {
      mission: missionData.mission_id,
      context: context.id,
      brief: brief.id,
      dispatch: dispatch.dispatch_id,
      authorization: auth.id,
    };

  } catch (err) {
    console.error('❌ Chain creation failed:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  }
}

createFreshChain();
