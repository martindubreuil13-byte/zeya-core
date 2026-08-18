import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext, isUuid } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isInitialCanonicalizationDecision, ownerSafeInitialCanonicalization } from '@/lib/formation/direct-hire-initial-canonicalization';

const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});

export async function POST(request:NextRequest,{params}:{params:Promise<{sessionId:string;proposalId:string}>}) {
  const auth=await createAuthenticatedRepresentationContext(request); if(auth instanceof NextResponse)return auth;
  const {sessionId,proposalId}=await params;
  if(!isUuid(sessionId)||!isUuid(proposalId))return fail('invalid_resource_id',400);
  let body:unknown; try{body=await request.json();}catch{return fail('invalid_request',400);}
  const input=body as {operationId?:unknown;decision?:unknown};
  if(typeof input.operationId!=='string'||!isUuid(input.operationId)||!isInitialCanonicalizationDecision(input.decision))return fail('invalid_decision',400);
  const result=await createExperienceServiceClient().rpc('zeya_decide_direct_hire_initial_canonicalization',{
    p_owner_id:auth.user.id,p_formation_session_id:sessionId,p_proposal_id:proposalId,p_operation_id:input.operationId,p_decision:input.decision,
  });
  if(result.error){
    const status=result.error.code==='PZ404'?404:result.error.code==='42501'?403:409;
    return fail(status===404?'proposal_not_found':'proposal_not_eligible',status);
  }
  const row=result.data?.[0]; if(!row)return fail('decision_persistence_failed',500);
  return NextResponse.json({success:true,data:ownerSafeInitialCanonicalization(row)},{status:row.replayed?200:201});
}
