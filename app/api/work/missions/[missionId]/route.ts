import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid,ownerSafeMission } from '@/lib/work/operating-spine';

export async function GET(request:NextRequest,{params}:{params:Promise<{missionId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {missionId}=await params;if(!isUuid(missionId))return NextResponse.json({success:false,error:'invalid_mission_id'},{status:400});
  const db=createExperienceServiceClient();
  const [mission,prepared]=await Promise.all([
    db.from('operating_missions').select('*').eq('id',missionId).eq('owner_id',auth.user.id).maybeSingle(),
    db.from('mission_execution_contexts').select('context,context_fingerprint,created_at').eq('mission_id',missionId).eq('owner_id',auth.user.id).maybeSingle(),
  ]);
  if(mission.error||!mission.data)return NextResponse.json({success:false,error:'mission_not_found'},{status:404});
  return NextResponse.json({success:true,data:{...ownerSafeMission(mission.data),executionContext:prepared.data?.context??null,preparedAt:prepared.data?.created_at??null}});
}
