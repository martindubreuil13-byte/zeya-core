import { NextRequest,NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext,isUuid } from "@/lib/representation/api-auth";
import { createExperienceServiceClient } from "@/lib/experience/public-session-server";
import { ProspectMemoryError,projectProspectObservationsFromInterpretation } from "@/lib/work/prospect-memory";

export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{interpretationId:string}>}){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  const {interpretationId}=await params;if(!isUuid(interpretationId))return NextResponse.json({success:false,error:"interpretation_not_found"},{status:404});
  try{return NextResponse.json({success:true,...await projectProspectObservationsFromInterpretation(createExperienceServiceClient(),auth.user.id,interpretationId)});}
  catch(error){const code=error instanceof ProspectMemoryError?error.code:"persistence_failed";return NextResponse.json({success:false,error:code==="not_found"?"interpretation_not_found":code==="conflict"?"prospect_memory_conflict":"prospect_memory_persistence_failed"},{status:code==="not_found"?404:code==="conflict"?409:500});}
}
