import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';

const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});

export async function POST(request:NextRequest,{params}:{params:Promise<{missionId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {missionId}=await params;if(!isUuid(missionId))return fail('invalid_mission_id',400);
  let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!isUuid(body.operationId))return fail('invalid_dispatch',400);
  const result=await createExperienceServiceClient().rpc('zeya_prepare_governed_dispatch_v2',{
    p_owner_id:auth.user.id,p_mission_id:missionId,p_operation_id:body.operationId,
  });
  if(result.error)return fail(result.error.code==='PZ404'?'mission_not_found':'mission_not_dispatchable',result.error.code==='PZ404'?404:409);
  const row=result.data?.[0];if(!row)return fail('dispatch_preparation_failed',500);
  return NextResponse.json({success:true,data:{dispatchId:row.dispatch_id,workerBriefId:row.worker_brief_id,status:row.status,executionAllowed:row.execution_allowed,replayed:row.replayed}},{status:row.replayed?200:201});
}
