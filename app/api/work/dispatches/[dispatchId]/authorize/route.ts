import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';
const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});
export async function POST(request:NextRequest,{params}:{params:Promise<{dispatchId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {dispatchId}=await params;let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!dispatchId.startsWith('p25_dispatch_')||!isUuid(body.operationId)||body.purpose!=='controlled_preview_voice_qa')return fail('invalid_authorization',400);
  const result=await createExperienceServiceClient().rpc('zeya_authorize_governed_execution',{p_owner_id:auth.user.id,p_dispatch_id:dispatchId,p_operation_id:body.operationId,p_purpose:body.purpose});
  if(result.error)return fail(result.error.code==='PZ404'?'dispatch_not_found':'dispatch_not_authorizable',result.error.code==='PZ404'?404:409);
  const row=result.data?.[0];if(!row)return fail('authorization_failed',500);
  return NextResponse.json({success:true,data:{authorizationId:row.authorization_id,status:row.status,replayed:row.replayed}},{status:row.replayed?200:201});
}
