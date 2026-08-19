import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';
import { executeGovernedVoice } from '@/lib/work/governed-voice-execution';
const E164=/^\+[1-9]\d{7,14}$/;const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});
export async function POST(request:NextRequest,{params}:{params:Promise<{dispatchId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {dispatchId}=await params;let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!dispatchId.startsWith('p25_dispatch_')||!isUuid(body.authorizationId)||!isUuid(body.operationId)||typeof body.qaPhone!=='string'||!E164.test(body.qaPhone))return fail('invalid_execution',400);
  try{const data=await executeGovernedVoice({db:createExperienceServiceClient(),ownerId:auth.user.id,dispatchId,authorizationId:body.authorizationId,operationId:body.operationId,qaPhone:body.qaPhone});
    return NextResponse.json({success:true,data},{status:data.replayed?200:202});
  }catch{return fail('execution_not_authorized',409);}
}
