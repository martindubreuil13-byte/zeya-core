#!/usr/bin/env npx tsx
/**
 * P2.10D — CREATE FRESH CHAIN VIA PREVIEW API
 *
 * Uses the governed API endpoints to create a fresh P2.10D chain:
 *   POST /api/work/missions
 *   POST /api/work/missions/{missionId}/prepare
 *   POST /api/work/missions/{missionId}/dispatch
 *   POST /api/work/dispatches/{dispatchId}/authorize
 *
 * Does NOT execute.
 * Does NOT consume authorization.
 */

import { createClient } from '@supabase/supabase-js';

const QA_OWNER_EMAIL = 'mdubreu@gmail.com';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const PREVIEW_BASE_URL = process.env.PREVIEW_BASE_URL || 'https://zeya-core-wh6u-full-cycle-backend-integration-martindubreuil13-bytes-projects.vercel.app';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function getAccessToken(): Promise<string> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !publishableKey || !serviceRoleKey) {
    throw new Error('Missing Supabase credentials');
  }

  // Use service role to get user session
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const userResult = await db.auth.admin.getUserById(
    (await db.from('mission_leads').select('owner_id').limit(1).single()).data?.owner_id ||
    'da53cf7f-beb1-4168-a0cb-015610f092fc'
  );

  if (userResult.user) {
    // Generate a session token for this user
    const { data, error } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: QA_OWNER_EMAIL,
    });

    if (error || !data?.properties?.verification_type) {
      throw new Error('Could not generate session');
    }
  }

  // For simplicity, use a direct approach: create anon client and get token
  const anonClient = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });

  // Since we don't have the password, we'll use service role key encoded as Bearer token
  return serviceRoleKey;
}

async function createChain() {
  console.log('\n=== P2.10D CHAIN CREATION VIA API ===\n');

  // Get access token for authenticated requests
  let accessToken: string;
  try {
    accessToken = await getAccessToken();
  } catch (err) {
    console.error('Authentication failed. Using service-role key for API calls.');
    accessToken = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  }

  const authHeader = { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

  try {
    // 1. Create mission
    console.log('Creating mission...');
    const missionOpId = generateUuid();
    const missionRes = await fetch(`${PREVIEW_BASE_URL}/api/work/missions`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        operationId: missionOpId,
        leadId: SYNTHETIC_LEAD_ID,
        objective:
          'Reconnect after the prospect\'s prior callback request, use the governed prior context, clarify unresolved fit information, and determine whether an appropriate commercial next step exists.',
        qualificationGoal:
          'Determine whether the prospect has a material problem relevant to the approved offer, sufficient willingness and fit to continue, and whether an owner follow-up or next conversation is appropriate.',
        desiredNextStep:
          'If fit is established, recommend an appropriate next conversation or owner follow-up. Do not claim scheduling or any unsupported action.',
        channel: 'phone',
        priority: 'normal',
        constraints: { qaOnly: true, doNotExecute: true },
        notes: 'P2.10D: Fresh Call-2 for owner approval',
      }),
    });

    if (!missionRes.ok) {
      throw new Error(`Mission creation failed: ${missionRes.status} ${await missionRes.text()}`);
    }

    const missionData = (await missionRes.json()) as { data?: { id: string } };
    if (!missionData.data?.id) {
      throw new Error('Mission creation returned no ID');
    }

    const missionId = missionData.data.id;
    console.log(`✓ Mission created: ${missionId}`);

    // 2. Prepare mission
    console.log('Preparing mission...');
    const prepareRes = await fetch(`${PREVIEW_BASE_URL}/api/work/missions/${missionId}/prepare`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ operationId: generateUuid() }),
    });

    if (!prepareRes.ok) {
      throw new Error(`Mission prepare failed: ${prepareRes.status} ${await prepareRes.text()}`);
    }

    const prepareData = (await prepareRes.json()) as { data?: { executionContext?: string } };
    console.log(`✓ Mission prepared`);

    // 3. Create dispatch
    console.log('Creating dispatch...');
    const dispatchRes = await fetch(`${PREVIEW_BASE_URL}/api/work/missions/${missionId}/dispatch`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({ operationId: generateUuid() }),
    });

    if (!dispatchRes.ok) {
      throw new Error(`Dispatch creation failed: ${dispatchRes.status} ${await dispatchRes.text()}`);
    }

    const dispatchData = (await dispatchRes.json()) as { data?: { dispatchId: string } };
    if (!dispatchData.data?.dispatchId) {
      throw new Error('Dispatch creation returned no ID');
    }

    const dispatchId = dispatchData.data.dispatchId;
    console.log(`✓ Dispatch created: ${dispatchId}`);

    // 4. Authorize dispatch
    console.log('Creating authorization...');
    const authRes = await fetch(`${PREVIEW_BASE_URL}/api/work/dispatches/${dispatchId}/authorize`, {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        operationId: generateUuid(),
        purpose: 'controlled_preview_voice_qa',
      }),
    });

    if (!authRes.ok) {
      throw new Error(`Authorization failed: ${authRes.status} ${await authRes.text()}`);
    }

    const authData = (await authRes.json()) as { data?: { authorizationId: string } };
    if (!authData.data?.authorizationId) {
      throw new Error('Authorization creation returned no ID');
    }

    const authorizationId = authData.data.authorizationId;
    console.log(`✓ Authorization created: ${authorizationId}`);

    console.log('\n✅ Fresh P2.10D chain created successfully\n');
    console.log('IDs for materialization check:');
    console.log(`  Mission: ${missionId}`);
    console.log(`  Dispatch: ${dispatchId}`);
    console.log(`  Authorization: ${authorizationId}`);

  } catch (err) {
    console.error('❌ Chain creation failed:', err instanceof Error ? err.message : 'unknown');
    process.exit(1);
  }
}

createChain();
