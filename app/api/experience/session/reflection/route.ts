import {NextRequest,NextResponse} from "next/server";
import {createExperienceServiceClient,findExperienceSession,isExpired,isPlausibleExperienceToken} from "@/lib/experience/public-session-server";
import {derivePublicExperienceCallOutcome} from "@/lib/experience/public-call-outcome";
import {generateRepresentationBrief,REPRESENTATION_BRIEF_GENERATOR_VERSION} from "@/lib/experience/representation-brief-generator";
import type {RepresentationBrief} from "@/types/experience";

type Turn={role?:unknown;text?:unknown;id?:unknown};
type StoredBrief={id:string;status:"valid"|"requires_clarification"|"failed";structured_brief:RepresentationBrief|null;spoken_brief:string|null;confidence_level:string;evidence_references:unknown;validation_outcome:unknown;generator_version:string;provider:string;model:string;created_at:string};
function safeText(value:unknown,limit=240){return typeof value==="string"?value.replace(/https?:\/\/\S+/gi,"[link]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[contact detail]").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g,"[contact detail]").replace(/\s+/g," ").trim().slice(0,limit):""}
function publicBrief(record:StoredBrief){
  if(record.status==="valid"&&record.structured_brief)return{brief:{...record.structured_brief,id:record.id},spokenBrief:record.spoken_brief,briefState:"valid",briefMetadata:{generatorVersion:record.generator_version,provider:record.provider,model:record.model,createdAt:record.created_at}};
  if(record.status==="requires_clarification")return{briefState:"requires_clarification",clarification:{message:"I understand the outline, but I do not yet have enough evidence to offer a useful representation direction.",question:"What is the most important result your business creates for the people it serves?"}};
  return{briefState:"unavailable"};
}

export async function GET(req:NextRequest){
  const auth=req.headers.get("authorization"),token=auth?.startsWith("Bearer ")?auth.slice(7).trim():null;
  if(!isPlausibleExperienceToken(token))return NextResponse.json({error:"Experience session not found."},{status:404});
  try{
    const db=createExperienceServiceClient(),session=await findExperienceSession(db,token);
    if(!session||isExpired(session))return NextResponse.json({error:"Experience session not found."},{status:404});
    if(session.state!=="reflection_ready"||!session.veya_conversation_output_id)return NextResponse.json({error:"The reflection is not ready yet."},{status:409});
    const veyaOutput=await db.from("voice_conversation_outputs").select("transcript,provider_attested,transcript_status").eq("id",session.veya_conversation_output_id).eq("voice_context_id",session.veya_voice_context_id).single();
    if(veyaOutput.error||!veyaOutput.data?.provider_attested||veyaOutput.data.transcript_status!=="finalized")return NextResponse.json({error:"The reflection is not ready yet."},{status:409});
    const veyaTurns=Array.isArray(veyaOutput.data.transcript)?veyaOutput.data.transcript as Turn[]:[];
    const outcome=derivePublicExperienceCallOutcome(veyaTurns,value=>safeText(value));
    let stored=(await db.from("public_experience_representation_briefs").select("id,status,structured_brief,spoken_brief,confidence_level,evidence_references,validation_outcome,generator_version,provider,model,created_at").eq("public_experience_session_id",session.id).maybeSingle()).data as StoredBrief|null;
    if(!stored){
      let zeyaTurns:Turn[]=[];
      if(session.zeya_conversation_output_id){const output=await db.from("voice_conversation_outputs").select("transcript").eq("id",session.zeya_conversation_output_id).eq("voice_context_id",session.zeya_voice_context_id).single();if(!output.error&&Array.isArray(output.data?.transcript))zeyaTurns=output.data.transcript as Turn[];}
      const map=(turns:Turn[])=>turns.map((turn,index)=>({role:String(turn.role??""),text:String(turn.text??""),id:typeof turn.id==="string"?turn.id:`turn_${index}`}));
      const generated=generateRepresentationBrief({visitorName:null,businessOffer:null,targetCustomer:null,zeyaTranscript:map(zeyaTurns),veyaTranscript:map(veyaTurns)});
      const valid=generated.status==="valid";
      const status=generated.status==="valid"?"valid":generated.status;
      const confidence=valid?generated.brief.confidenceLevel:"requires_clarification";
      const validation=valid?generated.brief.validation:generated.validation;
      const persisted=await db.rpc("zeya_persist_public_experience_representation_brief",{
        p_session_id:session.id,p_status:status,p_structured_brief:valid?generated.brief:null,p_spoken_brief:valid?generated.spokenBrief:null,
        p_confidence_level:confidence,p_evidence_references:valid?generated.brief.evidenceSources:[],p_validation_outcome:validation,
        p_generator_version:REPRESENTATION_BRIEF_GENERATOR_VERSION,p_provider:"deterministic",p_model:"text_evidence_rules_v1",
        p_internal_failure_reason:generated.status==="failed"?generated.internalReason:generated.status==="requires_clarification"?generated.validation.violations.join(","):null,
      });
      if(persisted.error)throw new Error("brief persistence failed");
      stored=(await db.from("public_experience_representation_briefs").select("id,status,structured_brief,spoken_brief,confidence_level,evidence_references,validation_outcome,generator_version,provider,model,created_at").eq("id",persisted.data).single()).data as StoredBrief;
    }
    const observations=veyaTurns.filter(turn=>turn.role==="customer").map(turn=>safeText(turn.text)).filter(Boolean).slice(0,2);
    return NextResponse.json({status:"reflection_ready",outcome,reflection:{summary:"Zeya preserved the business context that was carried into Veya’s real call.",observations,reviewNotice:"Anything learned here would be reviewed before becoming part of the business Representation. Nothing is approved automatically."},...publicBrief(stored)});
  }catch{return NextResponse.json({error:"The reflection is unavailable."},{status:503});}
}
