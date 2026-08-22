import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isUuid } from '@/lib/work/operating-spine';
import { prepareMissionErrorResponse } from '@/lib/work/prepare-mission-error';
import { getProspectContext,ProspectMemoryError } from '@/lib/work/prospect-memory';

export async function POST(request:NextRequest,{params}:{params:Promise<{missionId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {missionId}=await params;if(!isUuid(missionId))return NextResponse.json({success:false,error:'invalid_mission_id'},{status:400});
  const db=createExperienceServiceClient();
  const mission=await db.from('operating_missions').select('lead_id').eq('id',missionId).eq('owner_id',auth.user.id).maybeSingle();
  if(mission.error)return NextResponse.json({success:false,error:'preparation_failed'},{status:500});
  if(!mission.data)return NextResponse.json({success:false,error:'mission_not_found'},{status:404});
  let prospectContext;
  try{prospectContext=await getProspectContext(db,auth.user.id,String(mission.data.lead_id));}
  catch(error){const code=error instanceof ProspectMemoryError?error.code:'read_failed';return NextResponse.json({success:false,error:code==='not_found'?'mission_not_found':'preparation_failed'},{status:code==='not_found'?404:500});}
  const result=await db.rpc('zeya_prepare_operating_mission_v2',{p_owner_id:auth.user.id,p_mission_id:missionId,p_prospect_context:prospectContext,p_prospect_source_fingerprint:prospectContext.provenance.sourceFingerprint});
  if(result.error){const response=prepareMissionErrorResponse(result.error);return NextResponse.json(response.body,{status:response.status});}
  const row=result.data?.[0];if(!row)return NextResponse.json({success:false,error:'preparation_failed'},{status:500});
  return NextResponse.json({success:true,data:{missionId:row.mission_id,status:row.status,replayed:row.replayed,executionContext:row.execution_context}},{status:row.replayed?200:201});
}
