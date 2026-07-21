import { NextRequest,NextResponse } from "next/server";
import { createExperienceServiceClient,findExperienceSession,isPlausibleExperienceToken } from "@/lib/experience/public-session-server";
import { derivePublicExperienceCallOutcome } from "@/lib/experience/public-call-outcome";
import { generateRepresentationBrief } from "@/lib/experience/representation-brief-generator";
import type { RepresentationBrief } from "@/types/experience";

type Turn={role?:unknown;text?:unknown;id?:unknown};
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

    // Fetch Veya conversation
    const veyaOutput=await db.from("voice_conversation_outputs").select("transcript,provider_attested,transcript_status").eq("id",session.veya_conversation_output_id).eq("voice_context_id",session.veya_voice_context_id).single();
    if(veyaOutput.error||!veyaOutput.data?.provider_attested||veyaOutput.data.transcript_status!=="finalized")return NextResponse.json({error:"The reflection is not ready yet."},{status:409});

    const veyaTurns=Array.isArray(veyaOutput.data.transcript)?veyaOutput.data.transcript as Turn[]:[];
    const outcome=derivePublicExperienceCallOutcome(veyaTurns,(value)=>safeText(value));

    // Fetch Zeya conversation for representation brief
    let zeyaTurns: Turn[]=[];
    let visitorName: string|null=null;
    let businessOffer: string|null=null;
    let targetCustomer: string|null=null;

    if(session.zeya_conversation_output_id){
      const zeyaOutput=await db.from("voice_conversation_outputs").select("transcript").eq("id",session.zeya_conversation_output_id).single();
      if(!zeyaOutput.error&&zeyaOutput.data){
        zeyaTurns=Array.isArray(zeyaOutput.data.transcript)?zeyaOutput.data.transcript as Turn[]:[];
      }
    }

    // Try to extract identity from session metadata or conversation
    // For now, use placeholder values - in production, these would come from session handoff
    visitorName=null;
    businessOffer=null;
    targetCustomer=null;

    // Generate representation brief
    let brief: RepresentationBrief|null=null;
    const briefResult=generateRepresentationBrief({
      visitorName,
      businessOffer,
      targetCustomer,
      zeyaTranscript:zeyaTurns.map(t=>({role:String(t.role??"user"),text:String(t.text??""),id:String(t.id??"") })),
      veyaTranscript:veyaTurns.map(t=>({role:String(t.role??"user"),text:String(t.text??""),id:String(t.id??"") })),
    });

    if("error" in briefResult){
      // Brief generation failed, but reflection still returns outcome
      brief=null;
    }else{
      brief=briefResult;
    }

    const observations=veyaTurns.filter(turn=>turn.role==="customer").map(turn=>safeText(turn.text)).filter(Boolean).slice(0,2);
    const candidates=await db.from("voice_conversation_candidates").select("candidate_type,content").eq("conversation_output_id",session.veya_conversation_output_id).eq("review_status","pending_review").order("extraction_ordinal").limit(2);
    const noticed=(candidates.data??[]).map(row=>{
      const content=row.content&&typeof row.content==="object"?row.content as Record<string,unknown>:{};
      return safeText(content.summary??content.statement??content.text);
    }).filter(Boolean).slice(0,2);

    return NextResponse.json({
      status:"reflection_ready",
      outcome,
      reflection:{
        summary:"Zeya preserved the business context that was carried into Veya’s real call.",
        observations:noticed.length?noticed:observations,
        reviewNotice:"Zeya may have learned something from this conversation. It would be reviewed before becoming part of the business Representation.",
      },
      brief:brief||undefined,
    });
  }catch{return NextResponse.json({error:"The reflection is unavailable."},{status:503});}
}
