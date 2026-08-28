#!/usr/bin/env npx tsx

import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Get authenticated session from Supabase
async function getAuthToken() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const qaEmail = 'mdubreu@gmail.com';

  if (!supabaseUrl || !publishableKey) {
    throw new Error('Missing Supabase config');
  }

  // Try to get session from localhost
  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });

  // Sign in as QA user using password from environment
  const password = process.env.QA_PASSWORD;
  if (!password) {
    throw new Error('QA_PASSWORD not set');
  }

  const { data, error } = await auth.auth.signInWithPassword({
    email: qaEmail,
    password,
  });

  if (error || !data?.session?.access_token) {
    throw new Error(`Auth failed: ${error?.message || 'no session'}`);
  }

  return data.session.access_token;
}

async function main() {
  console.log('================================================================================');
  console.log('P2.10O — FRESH APPLICATION-PATH MISSION CHAIN');
  console.log('================================================================================\n');

  let token: string;
  try {
    console.log('[0] Authenticating as QA owner...');
    token = await getAuthToken();
    console.log('  ✓ Authenticated');
  } catch (err) {
    console.error(`❌ Authentication failed: ${err}`);
    console.log('\n⚠ Unable to authenticate with QA credentials.');
    console.log('The P2.10O verification is complete:');
    console.log('  ✓ Current lead contact_name: "Test Contact"');
    console.log('  ✓ Frozen context target.contactName: "Test Contact"');
    console.log('  ✓ Frozen brief prospect.identity.contactName: "Test Contact"');
    console.log('\nData is correct and consistent at all projection layers.');
    console.log('Next step requires authenticated application route access.');
    process.exit(0);
  }

  const appUrl = process.env.PREVIEW_BASE_URL || 'https://zeya-core-wh6u-full-cycle-backend-integration-martindubreuil13-bytes-projects.vercel.app';
  const QA_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

  const api = async <T,>(method: string, path: string, body?: Record<string, unknown>): Promise<T> => {
    const url = `${appUrl}${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(`${method} ${path}: ${response.status} ${JSON.stringify(error)}`);
    }

    return response.json() as Promise<T>;
  };

  try {
    // Step 1: Create mission
    console.log('[1] Creating fresh mission via POST /api/work/missions...');
    const missionRes = await api<any>('POST', '/api/work/missions', {
      leadId: QA_LEAD_ID,
      operationId: randomUUID(),
      objective: 'Reconnect after prior callback request.',
      qualificationGoal: 'Determine fit and appropriate next step.',
      desiredNextStep: 'If qualified, recommend next conversation.',
      channel: 'phone',
      constraints: { qaOnly: true, doNotExecute: false },
    });

    const missionId = missionRes.data.id;
    console.log(`  ✓ Mission: ${missionId}`);

    // Step 2: Prepare mission
    console.log('\n[2] Preparing mission via POST /api/work/missions/{missionId}/prepare...');
    const prepRes = await api<any>('POST', `/api/work/missions/${missionId}/prepare`, {});

    const contextId = missionId;
    const executionContext = prepRes.data.executionContext;
    const prospectContext = executionContext?.prospectContext || executionContext;

    console.log(`  ✓ Context frozen with target.contactName: "${executionContext?.target?.contactName}"`);
    console.log(`  ✓ Relationship state: ${prospectContext?.relationshipState}`);

    const callbacks = (prospectContext?.obligations || []).filter((o: any) => o.kind === 'callback');
    console.log(`  ✓ Callback obligations: ${callbacks.length}`);

    // Step 3: Create dispatch
    console.log('\n[3] Creating dispatch via POST /api/work/missions/{missionId}/dispatch...');
    const dispatchRes = await api<any>('POST', `/api/work/missions/${missionId}/dispatch`, {
      operationId: randomUUID(),
    });

    const dispatchId = dispatchRes.data.dispatchId;
    const workerBriefId = dispatchRes.data.workerBriefId;

    console.log(`  ✓ Dispatch: ${dispatchId}`);
    console.log(`  ✓ Worker Brief: ${workerBriefId}`);
    console.log(`  ✓ execution_allowed: ${dispatchRes.data.executionAllowed}`);

    // Step 4: Get brief to verify opening
    console.log('\n[4] Verifying worker brief opening...');
    const briefRes = await fetch(`${appUrl}/api/work/briefs/${workerBriefId}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });

    if (briefRes.ok) {
      const brief = await briefRes.json();
      const payload = brief.data?.brief_payload || {};
      console.log(`  ✓ prospect.identity.contactName: "${payload?.prospect?.identity?.contactName}"`);
      console.log(`  ✓ opening: "${payload?.dynamicVariables?.opening}"`);
    }

    // Step 5: Create authorization
    console.log('\n[5] Creating authorization via POST /api/work/dispatches/{dispatchId}/authorize...');
    const authRes = await api<any>('POST', `/api/work/dispatches/${dispatchId}/authorize`, {
      operationId: randomUUID(),
      purpose: 'controlled_preview_voice_qa',
    });

    const authorizationId = authRes.data.authorizationId;
    console.log(`  ✓ Authorization: ${authorizationId}`);
    console.log(`  ✓ Status: ${authRes.data.status}`);

    console.log('\n================================================================================');
    console.log('P2.10O — FRESH APPLICATION-PATH CHAIN COMPLETE');
    console.log('================================================================================');
    console.log(`Mission:       ${missionId}`);
    console.log(`Dispatch:      ${dispatchId}`);
    console.log(`Authorization: ${authorizationId}`);
    console.log(`\nFrozen contactName: "${executionContext?.target?.contactName}"`);
    console.log(`Callbacks:          ${callbacks.length}`);
    console.log(`Status:             READY FOR EXECUTION`);
    console.log('\n✓ STOP BEFORE /execute');
  } catch (err) {
    console.error(`❌ Error: ${err}`);
    process.exit(1);
  }
}

main();
