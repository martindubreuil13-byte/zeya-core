import { NextRequest,NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext,isUuid } from "@/lib/representation/api-auth";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";

const E164=/^\+[1-9]\d{7,14}$/;
const SHA256=/^[0-9a-f]{64}$/;
const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});

export async function PATCH(request:NextRequest,{params}:{params:Promise<{leadId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {leadId}=await params;
  let body:Record<string,unknown>;try{body=await request.json();}catch{return fail("invalid_request",400);}
  if(!isUuid(leadId)||typeof body.phone!=="string"||!E164.test(body.phone)
    ||typeof body.expectedLeadFingerprint!=="string"||!SHA256.test(body.expectedLeadFingerprint))return fail("invalid_lead_phone_update",400);
  if(Object.keys(body).some(key=>!["phone","expectedLeadFingerprint"].includes(key)))return fail("invalid_lead_phone_update",400);
  const result=await createExperienceServiceClient().rpc("zeya_update_operating_lead_phone",{
    p_owner_id:auth.user.id,p_lead_id:leadId,p_expected_lead_fingerprint:body.expectedLeadFingerprint,p_phone:body.phone,
  });
  if(result.error)return fail(result.error.code==="PZ404"?"lead_not_found":result.error.code==="PZ409"?"lead_changed":"lead_phone_update_failed",result.error.code==="PZ404"?404:result.error.code==="PZ409"?409:500);
  const updated=result.data?.[0];if(!updated)return fail("lead_phone_update_failed",500);
  return NextResponse.json({success:true,data:{leadId:updated.lead_id,previousFingerprint:updated.previous_fingerprint,currentFingerprint:updated.current_fingerprint}});
}
