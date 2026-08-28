#!/usr/bin/env npx tsx

/**
 * P2.10N — CONTINUE FROM PREPARED MISSION
 *
 * Existing prepared mission:
 * e1a542a2-87ff-4963-9c30-8dc4fbddfacd
 *
 * Continues from:
 * - Prepared ProspectContextV1 (callback obligations verified)
 * - Fresh Worker Brief V3 + Dispatch (via application route)
 * - Fresh Authorization (via application route)
 * - STOPS before /execute
 */

import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';
const QA_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const PREPARED_MISSION_ID = 'e1a542a2-87ff-4963-9c30-8dc4fbddfacd';

interface Config {
  sessionToken: string;
  appUrl: string;
}

const log = {
  section: (title: string) => console.log(`\n${'='.repeat(80)}\n${title}\n${'='.repeat(80)}`),
  step: (n: number, title: string) => console.log(`\n[Step ${n}] ${title}`),
  check: (label: string, value: unknown) => console.log(`  ✓ ${label}: ${JSON.stringify(value)}`),
  assert: (label: string, condition: boolean, details?: string) => {
    if (!condition) {
      console.error(`  ❌ ASSERTION FAILED: ${label}`);
      if (details) console.error(`     ${details}`);
      throw new Error(`Assertion failed: ${label}`);
    }
    console.log(`  ✓ ${label}`);
  },
  error: (msg: string) => console.error(`\n❌ ERROR: ${msg}`),
};

async function apiCall<T>(
  token: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
  appUrl?: string
): Promise<T> {
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
    const errorData = await response.json().catch(() => ({ error: 'unknown' }));
    throw new Error(
      `API call failed: ${method} ${path}\nStatus: ${response.status}\nError: ${JSON.stringify(errorData)}`
    );
  }

  return response.json();
}

async function getProspectContextFromPreparedMission(
  config: Config,
): Promise<Record<string, unknown>> {
  log.step(1, 'Loading prepared ProspectContextV1 from mission');

  // Call prepare route again to get the frozen context
  const result = await apiCall<{
    success: boolean;
    data: {
      missionId: string;
      status: string;
      replayed: boolean;
      executionContext: Record<string, unknown>;
    };
  }>(
    config.sessionToken,
    'POST',
    `/api/work/missions/${PREPARED_MISSION_ID}/prepare`,
    {},
    config.appUrl
  );

  log.assert('Mission prepare succeeded', result.success);
  log.check('Status', result.data.status);
  log.check('Replayed', result.data.replayed);

  const fullContext = result.data.executionContext as Record<string, unknown>;
  const prospectContext = fullContext['prospectContext'] as Record<string, unknown>;

  log.assert('ProspectContextV1 extracted', !!prospectContext);
  log.check('SchemaVersion', prospectContext['schemaVersion']);
  log.check('RelationshipState', prospectContext['relationshipState']);

  const obligations = (prospectContext['obligations'] as Record<string, unknown>[]) || [];
  const callbacks = obligations.filter((o) => o.kind === 'callback');
  log.check('Callback obligations found', callbacks.length);
  callbacks.forEach((cb, i) => {
    console.log(`    ${i + 1}. "${cb.summary}"`);
  });

  return prospectContext;
}

async function createDispatch(config: Config): Promise<{
  dispatchId: string;
  workerBriefId: string;
  executionAllowed: boolean;
}> {
  log.step(2, 'Creating dispatch via POST /api/work/missions/{missionId}/dispatch');

  const result = await apiCall<{
    success: boolean;
    data: {
      dispatchId: string;
      workerBriefId: string;
      status: string;
      executionAllowed: boolean;
      replayed: boolean;
    };
  }>(
    config.sessionToken,
    'POST',
    `/api/work/missions/${PREPARED_MISSION_ID}/dispatch`,
    {
      operationId: randomUUID(),
    },
    config.appUrl
  );

  log.assert('Dispatch creation succeeded', result.success);
  log.check('Dispatch ID', result.data.dispatchId);
  log.check('Worker Brief ID', result.data.workerBriefId);
  log.check('Execution Allowed', result.data.executionAllowed);
  log.assert('execution_allowed = true', result.data.executionAllowed === true);

  return {
    dispatchId: result.data.dispatchId,
    workerBriefId: result.data.workerBriefId,
    executionAllowed: result.data.executionAllowed,
  };
}

async function createAuthorization(
  config: Config,
  dispatchId: string,
): Promise<{
  authorizationId: string;
  status: string;
}> {
  log.step(3, 'Creating authorization via POST /api/work/dispatches/{dispatchId}/authorize');

  const operationId = randomUUID();
  const result = await apiCall<{
    success: boolean;
    data: {
      authorizationId: string;
      status: string;
      replayed: boolean;
    };
  }>(
    config.sessionToken,
    'POST',
    `/api/work/dispatches/${dispatchId}/authorize`,
    {
      operationId,
      purpose: 'controlled_preview_voice_qa',
    },
    config.appUrl
  );

  log.assert('Authorization creation succeeded', result.success);
  log.check('Authorization ID', result.data.authorizationId);
  log.check('Status', result.data.status);
  log.assert('Status = authorized', result.data.status === 'authorized', `Got: ${result.data.status}`);

  return {
    authorizationId: result.data.authorizationId,
    status: result.data.status,
  };
}

async function main() {
  log.section('P2.10N — CONTINUE FROM PREPARED MISSION');

  // Get app URL
  const appUrl = process.env.P2_10N_APP_URL ||
    process.env.PREVIEW_BASE_URL ||
    'https://zeya-core-wh6u-full-cycle-backend-integration-martindubreuil13-bytes-projects.vercel.app';

  // Get session token
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const qaPassword = process.env.QA_PASSWORD;

  if (!supabaseUrl || !publishableKey || !qaPassword) {
    log.error('Required: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, QA_PASSWORD');
    process.exit(1);
  }

  const auth = createClient(supabaseUrl, publishableKey, {
    auth: { persistSession: false },
  });

  const { data, error } = await auth.auth.signInWithPassword({
    email: 'mdubreu@gmail.com',
    password: qaPassword,
  });

  if (error || !data?.session?.access_token) {
    log.error(`Authentication failed: ${error?.message || 'no session'}`);
    process.exit(1);
  }

  if (data.user?.id !== QA_OWNER_ID) {
    log.error(`User ID mismatch: ${data.user?.id} vs ${QA_OWNER_ID}`);
    process.exit(1);
  }

  const config: Config = {
    sessionToken: data.session.access_token,
    appUrl,
  };

  console.log(`\nApp URL: ${config.appUrl}`);
  console.log(`Prepared Mission: ${PREPARED_MISSION_ID}`);

  try {
    // Step 1: Verify prepared context
    const prospectContext = await getProspectContextFromPreparedMission(config);

    // Step 2: Create dispatch
    const dispatch = await createDispatch(config);

    // Step 3: Create authorization
    const authorization = await createAuthorization(config, dispatch.dispatchId);

    // Report
    log.section('P2.10N — EXECUTION STATE');

    console.log('\nChain IDs:');
    console.log(`  Mission:           ${PREPARED_MISSION_ID}`);
    console.log(`  Dispatch:          ${dispatch.dispatchId}`);
    console.log(`  Worker Brief:      ${dispatch.workerBriefId}`);
    console.log(`  Authorization:     ${authorization.authorizationId}`);

    console.log('\nCallbacks Verified:');
    const obligations = (prospectContext['obligations'] as Record<string, unknown>[]) || [];
    const callbacks = obligations.filter((o) => o.kind === 'callback');
    console.log(`  Count: ${callbacks.length}`);

    console.log('\nStatus:');
    console.log(`  Execution Allowed:    ${dispatch.executionAllowed}`);
    console.log(`  Authorization Status: ${authorization.status}`);

    console.log('\n✓ STOP BEFORE /execute');
    console.log('✓ Ready for owner approval and final voice call');

    log.section('P2.10N — EXISTING AUTHORITATIVE CHAIN CONTINUED / FINAL CALL READY');
  } catch (error) {
    log.error(error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
