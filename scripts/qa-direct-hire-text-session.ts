// Manual Preview QA only. This script is not run by tests and never completes the Formation.
// Required env: PREVIEW_BASE_URL, NEXT_PUBLIC_SUPABASE_URL,
// NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, and QA_PASSWORD.
import { createClient } from '@supabase/supabase-js';

const baseUrl = process.env.PREVIEW_BASE_URL;
const email = process.env.QA_EMAIL ?? 'mdubreu@gmail.com';
const password = process.env.QA_PASSWORD;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!baseUrl || !password || !supabaseUrl || !publishableKey) throw new Error('Preview URL, Supabase public credentials, and QA_PASSWORD are required');

type ApiCallResult = {
  httpStatus: number;
  responseOk: boolean;
  body: unknown;
  apiError: string | null;
};

async function apiCall(url: string, init?: RequestInit): Promise<ApiCallResult> {
  const response = await fetch(url, init);
  const responseText = await response.text();
  let body: unknown;
  try {
    body = responseText ? JSON.parse(responseText) : null;
  } catch {
    body = { parseError: 'response_body_not_json', responseText };
  }
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : null;
  return {
    httpStatus: response.status,
    responseOk: response.ok,
    body,
    apiError: record?.success === false && typeof record.error === 'string' ? record.error : null,
  };
}

function reportFailure(label: string, result: ApiCallResult): boolean {
  if (result.responseOk && result.apiError === null) return false;
  console.error(JSON.stringify({ call: label, ...result }, null, 2));
  process.exitCode = 1;
  return true;
}

async function main() {
  const auth = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } });
  const signedIn = await auth.auth.signInWithPassword({ email, password: password! });
  const token = signedIn.data.session?.access_token;
  if (signedIn.error || !token) throw new Error('authentication failed');
  const authorization = { Authorization: `Bearer ${token}` };
  const status = await apiCall(`${baseUrl}/api/owner/status`, { headers: authorization });
  if (reportFailure('owner_status', status)) return;
  const statusBody = status.body as { data?: { formationSessionId?: string } };
  const formationSessionId = statusBody?.data?.formationSessionId;
  if (!formationSessionId) throw new Error('current Formation session was not discovered');
  const call = (body: object) => apiCall(`${baseUrl}/api/formation/sessions/${formationSessionId}/conversation`, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const first = await call({ action: 'start' });
  if (reportFailure('start', first)) return;
  const firstBody = first.body as { data?: { message?: string; currentTopic?: string } };
  console.log(JSON.stringify({ httpStatus: first.httpStatus, responseOk: first.responseOk, firstQuestion: firstBody?.data?.message, topic: firstBody?.data?.currentTopic }, null, 2));
  const controlledAnswer = process.argv.slice(2).join(' ').trim();
  if (!controlledAnswer) throw new Error('pass one controlled owner answer as the command argument');
  const idempotencyKey = process.env.QA_IDEMPOTENCY_KEY ?? crypto.randomUUID();
  console.log(JSON.stringify({ idempotencyKey }, null, 2));
  const answered = await call({ action: 'answer', answer: controlledAnswer, idempotencyKey });
  if (reportFailure('answer', answered)) return;
  const answeredBody = answered.body as { data?: { answerClassification?: string; message?: string; currentTopic?: string; complete?: boolean } };
  console.log(JSON.stringify({ httpStatus: answered.httpStatus, responseOk: answered.responseOk, classification: answeredBody?.data?.answerClassification, nextQuestion: answeredBody?.data?.message, topic: answeredBody?.data?.currentTopic, complete: answeredBody?.data?.complete }, null, 2));
  const paused = await call({ action: 'pause' });
  if (reportFailure('pause', paused)) return;
  console.log(JSON.stringify({ httpStatus: paused.httpStatus, responseOk: paused.responseOk, paused: true }, null, 2));
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
