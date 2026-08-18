import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { CHANNELS,isNonEmpty,isUuid,ownerSafeMission,PRIORITIES } from '@/lib/work/operating-spine';

const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});
export async function POST(request:NextRequest){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!isUuid(body.leadId)||!isUuid(body.operationId)||!isNonEmpty(body.objective)||!isNonEmpty(body.qualificationGoal)||!isNonEmpty(body.desiredNextStep)
    ||typeof body.channel!=='string'||!CHANNELS.includes(body.channel as typeof CHANNELS[number])
    ||(body.priority!==undefined&&(typeof body.priority!=='string'||!PRIORITIES.includes(body.priority as typeof PRIORITIES[number])))
    ||(body.constraints!==undefined&&(!body.constraints||typeof body.constraints!=='object'||Array.isArray(body.constraints))))return fail('invalid_mission',400);
  const db=createExperienceServiceClient();
  const result=await db.rpc('zeya_create_operating_mission',{p_owner_id:auth.user.id,p_lead_id:body.leadId,p_operation_id:body.operationId,p_objective:body.objective,p_qualification_goal:body.qualificationGoal,p_desired_next_step:body.desiredNextStep,p_allowed_channel:body.channel,p_constraints:body.constraints??{},p_notes:body.notes??null,p_priority:body.priority??'normal'});
  if(result.error)return fail('mission_not_eligible',result.error.code==='PZ404'?404:409);
  const created=result.data?.[0];
  const mission=created&&await db.from('operating_missions').select('*').eq('id',created.mission_id).eq('owner_id',auth.user.id).maybeSingle();
  if(!mission||mission.error||!mission.data)return fail('mission_persistence_failed',500);
  return NextResponse.json({success:true,data:{...ownerSafeMission(mission.data),replayed:created.replayed}},{status:created.replayed?200:201});
}
