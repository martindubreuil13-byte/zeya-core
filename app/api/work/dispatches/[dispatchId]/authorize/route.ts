import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';
import { dispatchedWorkerIdentityMatches,parseDispatchedWorkerIdentity,resolveDispatchedWorkerIdentity,WorkerIdentityUnavailableError } from '@/lib/work/commercial-conversation-policy';
const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});
export async function POST(request:NextRequest,{params}:{params:Promise<{dispatchId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {dispatchId}=await params;let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!dispatchId.startsWith('p25_dispatch_')||!isUuid(body.operationId)||body.purpose!=='controlled_preview_voice_qa')return fail('invalid_authorization',400);
  const db=createExperienceServiceClient();
  const source=await db.from('dispatches').select('worker_brief_id,worker_briefs!inner(brief_payload)').eq('dispatch_id',dispatchId).eq('owner_id',auth.user.id).maybeSingle();
  if(source.error)return fail('dispatch_not_authorizable',409);
  if(source.data){
    const joined=Array.isArray(source.data.worker_briefs)?source.data.worker_briefs[0]:source.data.worker_briefs;
    const payload=joined&&typeof joined==='object'?'brief_payload' in joined?joined.brief_payload:null:null;
    const record=payload&&typeof payload==='object'&&!Array.isArray(payload)?payload as Record<string,unknown>:null;
    if(record?.contractVersion==='governed-worker-brief-v3'){
      const frozen=parseDispatchedWorkerIdentity(record.worker);let current;
      try{current=resolveDispatchedWorkerIdentity();}catch(error){if(error instanceof WorkerIdentityUnavailableError)return fail('worker_configuration_unavailable',409);throw error;}
      if(!frozen||!dispatchedWorkerIdentityMatches(frozen,current))return fail('worker_configuration_stale',409);
    }
  }
  const result=await db.rpc('zeya_authorize_governed_execution',{p_owner_id:auth.user.id,p_dispatch_id:dispatchId,p_operation_id:body.operationId,p_purpose:body.purpose});
  if(result.error)return fail(result.error.code==='PZ404'?'dispatch_not_found':'dispatch_not_authorizable',result.error.code==='PZ404'?404:409);
  const row=result.data?.[0];if(!row)return fail('authorization_failed',500);
  return NextResponse.json({success:true,data:{authorizationId:row.authorization_id,status:row.status,replayed:row.replayed}},{status:row.replayed?200:201});
}
