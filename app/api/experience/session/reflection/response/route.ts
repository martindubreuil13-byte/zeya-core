import {NextRequest,NextResponse} from "next/server";
import {createExperienceServiceClient,hashExperienceToken,isPlausibleExperienceToken} from "@/lib/experience/public-session-server";
import type {RepresentationBriefResponseType} from "@/types/experience";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES=new Set<RepresentationBriefResponseType>(["confirm","refine","redirect","continue"]);
function text(value:unknown,limit:number){return typeof value==="string"?value.replace(/\s+/g," ").trim().slice(0,limit):""}
export async function POST(req:NextRequest){
  const auth=req.headers.get("authorization"),token=auth?.startsWith("Bearer ")?auth.slice(7).trim():null;
  if(!isPlausibleExperienceToken(token))return NextResponse.json({error:"Experience session not found."},{status:404});
  try{
    const body=await req.json() as {briefId?:unknown;requestKey?:unknown;responseType?:unknown;responseText?:unknown};
    if(typeof body.briefId!=="string"||!UUID.test(body.briefId)||typeof body.requestKey!=="string"||!UUID.test(body.requestKey)||typeof body.responseType!=="string"||!TYPES.has(body.responseType as RepresentationBriefResponseType))return NextResponse.json({error:"Invalid response."},{status:400});
    const responseText=text(body.responseText,1200);
    if((body.responseType==="refine"||body.responseType==="redirect")&&!responseText)return NextResponse.json({error:"Please add a correction."},{status:400});
    const result=await createExperienceServiceClient().rpc("zeya_record_public_experience_brief_response",{p_token_hash:hashExperienceToken(token),p_brief_id:body.briefId,p_request_key:body.requestKey,p_response_type:body.responseType,p_response_text:responseText});
    if(result.error||typeof result.data!=="string")return NextResponse.json({error:"Experience session not found."},{status:404});
    return NextResponse.json({status:"recorded",responseId:result.data});
  }catch{return NextResponse.json({error:"The response could not be recorded."},{status:503});}
}
