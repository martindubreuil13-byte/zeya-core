import { createClient } from '@supabase/supabase-js';

export async function governedWorkerBriefExecutionProhibited(workerBriefId:string,claim?:{authorizationId:string;attemptId:string}){
  if(!workerBriefId.startsWith('p25_brief_'))return false;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return true;
  const db=createClient(url,key,{auth:{persistSession:false}});
  const result=await db.from('worker_briefs').select('owner_id,execution_context_id').eq('id',workerBriefId).maybeSingle();
  if(result.error||!result.data?.owner_id||!result.data.execution_context_id||!claim)return true;
  const validation=await db.rpc('zeya_validate_governed_execution_claim',{
    p_owner_id:result.data.owner_id,p_worker_brief_id:workerBriefId,p_authorization_id:claim.authorizationId,p_attempt_id:claim.attemptId,
  });
  // PostgREST scalar boolean returns as { data: boolean }, not { data: [boolean] }
  const isValid=validation.data===true;
  return validation.error||!isValid;
}
