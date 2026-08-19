import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';
import { prepareMissionErrorResponse } from '@/lib/work/prepare-mission-error';

export async function POST(request:NextRequest,{params}:{params:Promise<{missionId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {missionId}=await params;if(!isUuid(missionId))return NextResponse.json({success:false,error:'invalid_mission_id'},{status:400});
  const result=await createExperienceServiceClient().rpc('zeya_prepare_operating_mission',{p_owner_id:auth.user.id,p_mission_id:missionId});
  if(result.error){const response=prepareMissionErrorResponse(result.error);return NextResponse.json(response.body,{status:response.status});}
  const row=result.data?.[0];if(!row)return NextResponse.json({success:false,error:'preparation_failed'},{status:500});
  return NextResponse.json({success:true,data:{missionId:row.mission_id,status:row.status,replayed:row.replayed,executionContext:row.execution_context}},{status:row.replayed?200:201});
}
