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

async function main() {
  const auth = createClient(supabaseUrl!, publishableKey!, { auth: { persistSession: false } });
  const signedIn = await auth.auth.signInWithPassword({ email, password: password! });
  const token = signedIn.data.session?.access_token;
  if (signedIn.error || !token) throw new Error('authentication failed');
  const authorization = { Authorization: `Bearer ${token}` };
  const status = await fetch(`${baseUrl}/api/owner/status`, { headers: authorization }).then((response) => response.json());
  const formationSessionId = status?.data?.formationSessionId;
  if (!formationSessionId) throw new Error('current Formation session was not discovered');
  const call = (body: object) => fetch(`${baseUrl}/api/formation/sessions/${formationSessionId}/conversation`, { method: 'POST', headers: { ...authorization, 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((response) => response.json());
  const first = await call({ action: 'start' });
  console.log(JSON.stringify({ firstQuestion: first?.data?.message, topic: first?.data?.currentTopic }, null, 2));
  const controlledAnswer = process.argv.slice(2).join(' ').trim();
  if (!controlledAnswer) throw new Error('pass one controlled owner answer as the command argument');
  const answered = await call({ action: 'answer', answer: controlledAnswer, idempotencyKey: crypto.randomUUID() });
  console.log(JSON.stringify({ nextQuestion: answered?.data?.message, topic: answered?.data?.currentTopic, complete: answered?.data?.complete }, null, 2));
  await call({ action: 'pause' });
}
main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
