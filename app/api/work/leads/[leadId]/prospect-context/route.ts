import { NextRequest,NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext,isUuid } from "@/lib/representation/api-auth";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";
import { getProspectContext,ProspectMemoryError } from "@/lib/work/prospect-memory";

export async function GET(request:NextRequest,{params}:{params:Promise<{leadId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {leadId}=await params;if(!isUuid(leadId))return NextResponse.json({success:false,error:"lead_not_found"},{status:404});
  try{return NextResponse.json({success:true,data:await getProspectContext(createExperienceServiceClient(),auth.user.id,leadId)});}
  catch(error){const code=error instanceof ProspectMemoryError?error.code:"read_failed";return NextResponse.json({success:false,error:code==="not_found"?"lead_not_found":"prospect_context_unavailable"},{status:code==="not_found"?404:500});}
}
