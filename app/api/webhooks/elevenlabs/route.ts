import { createHash } from "node:crypto";
import { NextRequest,NextResponse } from "next/server";
import { getWebhookSecret,mayBypassElevenLabsSignature,verifyElevenLabsSignature } from "@/lib/voice/events/elevenlabs-signature-verifier";
import { normalizeElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-validator";
import { processElevenLabsWebhook } from "@/lib/voice/events/elevenlabs-event-processor";

const MAX_BODY_BYTES=1_000_000;
const safe=(error:string,status:number)=>NextResponse.json({success:false,error},{status});

export async function POST(req:NextRequest){
  const raw=await req.text();
  if(Buffer.byteLength(raw,"utf8")>MAX_BODY_BYTES)return safe("Webhook payload is too large.",413);
  const secret=getWebhookSecret(),bypass=mayBypassElevenLabsSignature();
  if(!bypass){
    if(!secret)return safe("Webhook authentication is unavailable.",503);
    const signature=req.headers.get("elevenlabs-signature");
    if(!signature||!verifyElevenLabsSignature(raw,signature,secret))return safe("Webhook authentication failed.",401);
  }
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return safe("Webhook payload is invalid.",400);}
  const event=normalizeElevenLabsWebhook(parsed);
  if(!event)return safe("Webhook payload is invalid.",400);
  const result=await processElevenLabsWebhook(event,createHash("sha256").update(raw).digest("hex"));
  return NextResponse.json({success:result.success,duplicate:result.duplicate===true,pending:result.pending===true,message:result.message},{status:result.success?200:503});
}
