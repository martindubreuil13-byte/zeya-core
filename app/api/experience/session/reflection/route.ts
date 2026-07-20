import { NextRequest,NextResponse } from "next/server";
import { createExperienceServiceClient,findExperienceSession,isPlausibleExperienceToken } from "@/lib/experience/public-session-server";
import { derivePublicExperienceCallOutcome } from "@/lib/experience/public-call-outcome";

type Turn={role?:unknown;text?:unknown};
function safeText(value:unknown,limit=240){
  if(typeof value!=="string")return "";
  return value
    .replace(/https?:\/\/\S+/gi,"[link]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[contact detail]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g,"[contact detail]")
    .replace(/\s+/g," ")
    .trim()
    .slice(0,limit);
}

export async function GET(req:NextRequest){
  const auth=req.headers.get("authorization"),token=auth?.startsWith("Bearer ")?auth.slice(7).trim():null;
  if(!isPlausibleExperienceToken(token))return NextResponse.json({error:"Experience session not found."},{status:404});
  try{
    const db=createExperienceServiceClient(),session=await findExperienceSession(db,token);
    if(!session)return NextResponse.json({error:"Experience session not found."},{status:404});
    if(session.state!=="reflection_ready"||!session.veya_conversation_output_id)return NextResponse.json({error:"The reflection is not ready yet."},{status:409});
    const output=await db.from("voice_conversation_outputs").select("transcript,provider_attested,transcript_status").eq("id",session.veya_conversation_output_id).eq("voice_context_id",session.veya_voice_context_id).single();
    if(output.error||!output.data?.provider_attested||output.data.transcript_status!=="finalized")return NextResponse.json({error:"The reflection is not ready yet."},{status:409});
    const turns=Array.isArray(output.data.transcript)?output.data.transcript as Turn[]:[];
    const observations=turns.filter(turn=>turn.role==="customer").map(turn=>safeText(turn.text)).filter(Boolean).slice(0,2);
    const candidates=await db.from("voice_conversation_candidates").select("candidate_type,content").eq("conversation_output_id",session.veya_conversation_output_id).eq("review_status","pending_review").order("extraction_ordinal").limit(2);
    const noticed=(candidates.data??[]).map(row=>{
      const content=row.content&&typeof row.content==="object"?row.content as Record<string,unknown>:{};
      return safeText(content.summary??content.statement??content.text);
    }).filter(Boolean).slice(0,2);
    const outcome=derivePublicExperienceCallOutcome(turns,(value)=>safeText(value));
    return NextResponse.json({
      status:"reflection_ready",
      outcome,
      reflection:{
        summary:"Zeya preserved the business context that was carried into Veya’s real call.",
        observations:noticed.length?noticed:observations,
        reviewNotice:"Zeya may have learned something from this conversation. It would be reviewed before becoming part of the business Representation.",
      },
    });
  }catch{return NextResponse.json({error:"The reflection is unavailable."},{status:503});}
}
