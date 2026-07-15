import { createClient } from '@supabase/supabase-js'; import { loadEnvConfig } from '@next/env'; import { startTestServer } from './representation-state-test-server'; import { FixtureRegistry } from './representation-state-test-fixtures'; import { cleanupFixtures } from './representation-state-test-cleanup'; import { jsonRequest } from './representation-state-test-client';

async function main() {
  loadEnvConfig(process.cwd());
  const server = await startTestServer();
  const registry=new FixtureRegistry(); const env=process.env; const admin=createClient(env.NEXT_PUBLIC_SUPABASE_URL!,env.SUPABASE_SERVICE_ROLE_KEY!); let cleanup;
  try {
    const email=`representation-${registry.runId}@zeya.test`,password=`T-${crypto.randomUUID()}!`; const u=await admin.auth.admin.createUser({email,password,email_confirm:true});if(u.error)throw u.error;registry.registerAuthUser(u.data.user.id,email);const auth=createClient(env.NEXT_PUBLIC_SUPABASE_URL!,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);const s=await auth.auth.signInWithPassword({email,password});if(s.error)throw s.error;const c=createClient(env.NEXT_PUBLIC_SUPABASE_URL!,env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${s.data.session!.access_token}`}}});const b=await c.from('businesses').insert({business_name:`Representation smoke ${registry.runId}`,user_id:u.data.user.id}).select().single();if(b.error)throw b.error;registry.registerBusiness(b.data.id,u.data.user.id);const e=await jsonRequest<{data:{businessRepresentationId:string}}>(server.baseUrl,'/api/representation/evidence',{method:'POST',headers:{'content-type':'application/json',Authorization:`Bearer ${s.data.session!.access_token}`},body:JSON.stringify({businessId:b.data.id,statement:'cleanup smoke fixture'})});if(e.status!==201)throw new Error(`Fixture creation failed: ${e.status}`);registry.registerBusinessRepresentation(e.body.data.businessRepresentationId,b.data.id);console.log(`Representation State Infrastructure\n\nServer identity — PASS\nFixture creation — PASS\nFixture IDs — user ${u.data.user.id}, business ${b.data.id}, representation ${e.body.data.businessRepresentationId}`);if(process.env.REPRESENTATION_TEST_FORCE_FAILURE==='after_fixture')throw new Error('Intentional post-fixture assertion failure');
  } finally {
    cleanup=await cleanupFixtures(admin,registry); console.log(`Fixture cleanup — ${cleanup.success?'PASS':'FAIL'}`);
    await server.stop(); console.log('Server cleanup — PASS');
  }
  if(!cleanup?.success)throw new Error(`Cleanup failed: ${cleanup?.failures.join(', ')}`);
}

const keepAlive=setInterval(()=>{},1_000);
main().catch(error => { console.error(error instanceof Error ? error.message : 'Integration runner failed'); process.exitCode = 1; }).finally(()=>clearInterval(keepAlive));
