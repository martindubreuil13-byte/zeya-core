import { createClient } from '@supabase/supabase-js';

export async function governedWorkerBriefExecutionProhibited(workerBriefId:string){
  if(!workerBriefId.startsWith('p25_brief_'))return false;
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return true;
  const result=await createClient(url,key,{auth:{persistSession:false}}).from('worker_briefs')
    .select('execution_context_id,execution_allowed').eq('id',workerBriefId).maybeSingle();
  return Boolean(result.error||!result.data?.execution_context_id||result.data.execution_allowed!==true);
}
