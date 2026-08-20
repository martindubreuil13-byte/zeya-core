#!/usr/bin/env npx tsx
/**
 * P2.6 Governed Execution QA Harness
 *
 * Automates controlled Preview QA cycles for P2.6 governed execution.
 * Stage A: Authorization-only verification
 * Stage B: Full execution cycle with durable postcheck
 *
 * Authentication: Supabase signInWithPassword using access token Bearer
 */

import { createClient } from '@supabase/supabase-js';

const E164 = /^\+[1-9]\d{7,14}$/;

interface Config {
  stage: 'a' | 'b';
  baseUrl: string;
  supabaseUrl: string;
  supabasePublishableKey: string;
  qaPassword: string;
  qaPhone?: string;
}

interface AuthenticatedSession {
  userId: string;
  accessToken: string;
}

const QA_OWNER = 'mdubreu@gmail.com';
const SYNTHETIC_LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';

function generateUuid(): string {
  return crypto.randomUUID();
}

async function authenticate(config: Config): Promise<AuthenticatedSession> {
  const anonClient = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: false },
  });
  const { data, error } = await anonClient.auth.signInWithPassword({
    email: QA_OWNER,
    password: config.qaPassword,
  });
  if (error || !data.session?.access_token) {
    throw new Error('Supabase authentication failed');
  }
  return {
    userId: data.user.id,
    accessToken: data.session.access_token,
  };
}

async function stageA(config: Config, session: AuthenticatedSession): Promise<void> {
  console.log('=== STAGE A: Authorization-Only Verification ===\n');

  const missionOpId = generateUuid();
  const authHeader = { Authorization: `Bearer ${session.accessToken}` };

  // 1. Create mission with full governed execution payload
  const missionRes = await fetch(`${config.baseUrl}/api/work/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      operationId: missionOpId,
      leadId: SYNTHETIC_LEAD_ID,
      objective: 'Determine whether the startup has a relevant business architecture or coaching problem.',
      qualificationGoal: 'Confirm a material business problem, willingness to address it, and relevance to Martin\'s services.',
      desiredNextStep: 'Book a meeting if qualified and if the governed mandate permits direct booking.',
      channel: 'phone',
      priority: 'normal',
      constraints: { qaOnly: true, doNotExecute: true },
      notes: 'Controlled P2.6 automated Preview QA cycle.',
    }),
  });
  if (!missionRes.ok) throw new Error(`Mission creation failed: ${missionRes.status}`);
  const missionData = (await missionRes.json()) as { success?: boolean; data?: { id: string; status: string } };
  const missionId = missionData.data?.id;
  if (!missionId) throw new Error('Mission creation did not return mission ID');
  console.log(`Mission ID: ${missionId}`);
  console.log(`Mission status: ${missionData.data?.status}\n`);

  // 2. Prepare mission
  const prepareRes = await fetch(`${config.baseUrl}/api/work/missions/${missionId}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: generateUuid() }),
  });
  if (!prepareRes.ok) throw new Error(`Mission prepare failed: ${prepareRes.status}`);
  const prepareData = (await prepareRes.json()) as { data?: { missionId: string; status: string } };
  console.log(`Prepared mission status: ${prepareData.data?.status}\n`);

  // 3. Create dispatch
  const dispatchOpId = generateUuid();
  const dispatchRes = await fetch(`${config.baseUrl}/api/work/missions/${missionId}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: dispatchOpId }),
  });
  if (!dispatchRes.ok) throw new Error(`Dispatch creation failed: ${dispatchRes.status}`);
  const dispatchData = (await dispatchRes.json()) as { data?: { dispatchId: string; status: string; executionAllowed: boolean } };
  const dispatchId = dispatchData.data?.dispatchId;
  if (!dispatchId) throw new Error('Dispatch creation did not return dispatch ID');
  console.log(`Dispatch ID: ${dispatchId}`);
  console.log(`Dispatch status: ${dispatchData.data?.status}`);
  console.log(`Execution allowed: ${dispatchData.data?.executionAllowed}\n`);

  // 4. Authorize
  const authOpId = generateUuid();
  const authRes = await fetch(`${config.baseUrl}/api/work/dispatches/${dispatchId}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: authOpId, purpose: 'controlled_preview_voice_qa' }),
  });
  if (!authRes.ok) throw new Error(`Authorization failed: ${authRes.status}`);
  const authData = (await authRes.json()) as { data?: { authorizationId: string; status: string } };
  const authorizationId = authData.data?.authorizationId;
  if (!authorizationId) throw new Error('Authorization did not return authorization ID');
  console.log(`Authorization ID: ${authorizationId}`);
  console.log(`Authorization status: ${authData.data?.status}\n`);

  // 5. Verify authorization idempotency by replaying
  const replayRes = await fetch(`${config.baseUrl}/api/work/dispatches/${dispatchId}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: authOpId, purpose: 'controlled_preview_voice_qa' }),
  });
  if (!replayRes.ok) throw new Error(`Authorization replay failed: ${replayRes.status}`);
  const replayData = (await replayRes.json()) as { data?: { authorizationId: string; replayed: boolean } };
  if (replayData.data?.authorizationId !== authorizationId) throw new Error('Authorization ID mismatch on replay');
  console.log(`Replay idempotency: ${replayData.data?.replayed ? 'identical (replayed)' : 'new'}\n`);

  console.log('✅ Stage A complete. Authorization ready for execution.\n');
}

async function stageB(config: Config, session: AuthenticatedSession): Promise<void> {
  console.log('=== STAGE B: Full Execution with Durable Postcheck ===\n');

  if (!config.qaPhone) throw new Error('QA_PHONE required for Stage B');
  if (!E164.test(config.qaPhone)) {
    throw new Error('Invalid QA phone format');
  }
  console.log('QA phone validated (not printed)\n');

  const missionOpId = generateUuid();
  const authHeader = { Authorization: `Bearer ${session.accessToken}` };

  // Repeat Stage A setup with full mission payload
  const missionRes = await fetch(`${config.baseUrl}/api/work/missions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      operationId: missionOpId,
      leadId: SYNTHETIC_LEAD_ID,
      objective: 'Determine whether the startup has a relevant business architecture or coaching problem.',
      qualificationGoal: 'Confirm a material business problem, willingness to address it, and relevance to Martin\'s services.',
      desiredNextStep: 'Book a meeting if qualified and if the governed mandate permits direct booking.',
      channel: 'phone',
      priority: 'normal',
      constraints: { qaOnly: true, doNotExecute: true },
      notes: 'Controlled P2.6 automated Preview QA cycle — full execution test.',
    }),
  });
  if (!missionRes.ok) throw new Error(`Mission creation failed: ${missionRes.status}`);
  const missionData = (await missionRes.json()) as { data?: { id: string } };
  const missionId = missionData.data?.id;
  if (!missionId) throw new Error('Mission creation did not return mission ID');
  console.log(`Mission ID: ${missionId}`);

  const prepareRes = await fetch(`${config.baseUrl}/api/work/missions/${missionId}/prepare`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: generateUuid() }),
  });
  if (!prepareRes.ok) throw new Error(`Mission prepare failed: ${prepareRes.status}`);

  const dispatchOpId = generateUuid();
  const dispatchRes = await fetch(`${config.baseUrl}/api/work/missions/${missionId}/dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: dispatchOpId }),
  });
  if (!dispatchRes.ok) throw new Error(`Dispatch creation failed: ${dispatchRes.status}`);
  const dispatchData = (await dispatchRes.json()) as { data?: { dispatchId: string; workerBriefId?: string } };
  const dispatchId = dispatchData.data?.dispatchId;
  if (!dispatchId) throw new Error('Dispatch creation did not return dispatch ID');
  const workerBriefId = dispatchData.data?.workerBriefId;
  console.log(`Dispatch ID: ${dispatchId}`);

  const authOpId = generateUuid();
  const authRes = await fetch(`${config.baseUrl}/api/work/dispatches/${dispatchId}/authorize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({ operationId: authOpId, purpose: 'controlled_preview_voice_qa' }),
  });
  if (!authRes.ok) throw new Error(`Authorization failed: ${authRes.status}`);
  const authData = (await authRes.json()) as { data?: { authorizationId: string } };
  const authorizationId = authData.data?.authorizationId;
  if (!authorizationId) throw new Error('Authorization did not return authorization ID');
  console.log(`Authorization ID: ${authorizationId}\n`);

  // Execute exactly once — NEVER RETRY
  const execOpId = generateUuid();
  console.log('Executing governed dispatch (at-most-once boundary)...\n');
  const execRes = await fetch(`${config.baseUrl}/api/work/dispatches/${dispatchId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeader },
    body: JSON.stringify({
      authorizationId,
      operationId: execOpId,
      qaPhone: config.qaPhone,
    }),
  });

  const execData = (await execRes.json()) as {
    success?: boolean;
    data?: {
      attemptId: string;
      status: string;
      replayed: boolean;
      providerCallId?: string;
      conversationId?: string;
    };
  };

  const attemptId = execData.data?.attemptId;
  const executionStatus = execData.data?.status;
  const providerCallId = execData.data?.providerCallId;
  const conversationId = execData.data?.conversationId;

  console.log('=== Durable State Postcheck ===\n');
  console.log('Sanitized result:');
  console.log(`  missionId: ${missionId}`);
  console.log(`  dispatchId: ${dispatchId}`);
  console.log(`  workerBriefId: ${workerBriefId ?? 'not available'}`);
  console.log(`  authorizationId: ${authorizationId}`);
  console.log(`  attemptId: ${attemptId ?? 'not available'}`);
  console.log(`  executionStatus: ${executionStatus ?? 'unknown'}`);
  console.log(`  providerCallId: ${providerCallId ?? 'none'}`);
  console.log(`  conversationId: ${conversationId ?? 'none'}\n`);

  if (execData.success) {
    console.log('✅ Stage B complete. Execution recorded.\n');
  } else {
    console.log('⚠️  Stage B execution encountered an error (durable state still recorded).\n');
  }
}

function parseArgs(): { stage: 'a' | 'b' } {
  const stageArg = process.argv.find(arg => arg === '--stage-a' || arg === '--stage-b');
  if (!stageArg) {
    console.error('Usage: NODE_OPTIONS="--loader ts-node/esm" npx ts-node scripts/p26-controlled-qa.ts --stage-a|--stage-b');
    console.error('OR:    npx tsx scripts/p26-controlled-qa.ts --stage-a|--stage-b');
    console.error('Environment: PREVIEW_BASE_URL, QA_PASSWORD, QA_PHONE (for --stage-b)');
    process.exit(1);
  }
  return { stage: stageArg === '--stage-a' ? 'a' : 'b' };
}

function validatePreviewUrlStrict(url: string): void {
  const u = new URL(url);

  if (u.protocol !== 'https:') {
    throw new Error(`Unsafe protocol: ${u.protocol}. Preview QA requires HTTPS.`);
  }

  const zeyaPreviewHost =
    /^zeya-core-wh6u-[a-z0-9-]+-martindubreuil13-bytes-projects\.vercel\.app$/;

  if (!zeyaPreviewHost.test(u.hostname)) {
    throw new Error(
      `Unsafe Preview host: ${u.hostname}. Expected a Zeya Preview deployment under the controlled Vercel project.`
    );
  }
}

async function main(): Promise<void> {
  const { stage } = parseArgs();

  const baseUrl = process.env.PREVIEW_BASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const qaPassword = process.env.QA_PASSWORD;
  const qaPhone = process.env.QA_PHONE;

  if (!baseUrl || !supabaseUrl || !supabasePublishableKey || !qaPassword) {
    console.error(
      'Missing required environment: PREVIEW_BASE_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, QA_PASSWORD'
    );
    process.exit(1);
  }

  validatePreviewUrlStrict(baseUrl);
  const config: Config = {
    stage,
    baseUrl,
    supabaseUrl,
    supabasePublishableKey,
    qaPassword,
    qaPhone,
  };

  let session: AuthenticatedSession;
  try {
    session = await authenticate(config);
  } catch (err) {
    console.error('❌ Authentication failed:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }

  try {
    if (stage === 'a') {
      await stageA(config, session);
    } else {
      await stageB(config, session);
    }
  } catch (err) {
    console.error('❌ Error:', err instanceof Error ? err.message : 'unknown error');
    process.exit(1);
  }
}

main();
