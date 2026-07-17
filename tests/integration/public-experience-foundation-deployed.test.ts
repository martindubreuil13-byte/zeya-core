import { loadEnvConfig } from "@next/env";
import { createServer } from "node:http";
import { inspect } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { startTestServer } from "./representation-state-test-server";
import { FixtureRegistry } from "./representation-state-test-fixtures";
import { cleanupFixtures } from "./representation-state-test-cleanup";
import { captureAndExtractConversationOutput } from "../../lib/voice/conversation-output/service";
import {
  createExperienceToken,
  hashExperienceToken,
  PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURN_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURNS,
} from "../../lib/experience/public-session-server";

loadEnvConfig(process.cwd());
function assert(value:unknown,message:string):asserts value{if(!value)throw new Error(message);}
async function json(base:string,path:string,init:RequestInit={}){const response=await fetch(base+path,init),raw=await response.text();let body:Record<string,unknown>={};try{body=JSON.parse(raw) as Record<string,unknown>;}catch{}return{status:response.status,body,raw};}
async function createUser(admin:SupabaseClient,registry:FixtureRegistry){const email=`public-experience-${registry.runId}@zeya.test`,password=`T-${crypto.randomUUID()}!`;const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;registry.registerAuthUser(created.data.user.id,email);const browser=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{auth:{persistSession:false}});const signed=await browser.auth.signInWithPassword({email,password});if(signed.error)throw signed.error;return{id:created.data.user.id,token:signed.data.session!.access_token,client:createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${signed.data.session!.access_token}`}},auth:{persistSession:false}})};}

async function main(){
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;assert(url&&key,"Supabase test configuration missing");
  const admin=createClient(url,key,{auth:{persistSession:false}}),registry=new FixtureRegistry();let server:Awaited<ReturnType<typeof startTestServer>>|null=null;let stubFail=false;
  const stub=createServer((_req,res)=>{if(stubFail){res.writeHead(502,{"content-type":"application/json"});res.end('{"error":"stub_failure"}');}else{res.writeHead(200,{"content-type":"application/json"});res.end('{"value":"test_ephemeral_secret","model":"gpt-realtime"}');}});
  await new Promise<void>((resolve,reject)=>{stub.once("error",reject);stub.listen(0,"127.0.0.1",()=>resolve());});const address=stub.address();assert(address&&typeof address!=="string","stub port unavailable");
  try{
    const owner=await createUser(admin,registry);const business=await owner.client.from("businesses").insert({business_name:`Public Experience ${registry.runId}`,user_id:owner.id}).select("id").single();if(business.error)throw business.error;registry.registerBusiness(business.data.id,owner.id);
    process.env.ZEYA_EXPERIENCE_BUSINESS_ID=business.data.id;process.env.OPENAI_REALTIME_SESSION_URL=`http://127.0.0.1:${address.port}`;process.env.PUBLIC_EXPERIENCE_PROVIDER="MOCK";process.env.PUBLIC_EXPERIENCE_TEST_MODE="true";
    server=await startTestServer();
    const evidence=await json(server.baseUrl,"/api/representation/evidence",{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${owner.token}`},body:JSON.stringify({businessId:business.data.id,statement:"Zeya demonstrates a concise business conversation.",sourceDescription:"Phase 4A deployed test"})});assert(evidence.status===201,"canonical fixture Evidence failed");const ed=evidence.body.data as Record<string,unknown>,representationId=String(ed.businessRepresentationId),proposalId=String(ed.proposalId);registry.registerBusinessRepresentation(representationId,business.data.id);registry.registerEvidence(String(ed.evidenceId));registry.registerObservation(String(ed.observationId));registry.registerProposal(proposalId);
    if(ed.requiresApproval===true){const approval=await owner.client.from("approval_decisions").insert({business_representation_id:representationId,representation_proposal_id:proposalId,decision:"approved",approver_user_id:owner.id}).select("id").single();if(approval.error)throw approval.error;registry.registerApproval(approval.data.id);}
    const version=await json(server.baseUrl,"/api/representation/versions",{method:"POST",headers:{"content-type":"application/json",Authorization:`Bearer ${owner.token}`},body:JSON.stringify({businessRepresentationId:representationId,proposalId,elementValues:{offer:"A concise Zeya business-growth demonstration.",target_audience:"Visitors exploring Zeya."},confidenceScore:80})});assert(version.status===201,"canonical fixture Version failed");const vd=version.body.data as Record<string,unknown>,versionId=String(vd.versionId);registry.registerVersion(versionId);registry.registerConfidenceAssessment(String(vd.confidenceAssessmentId));


      const domains = await owner.client
        .from("representation_domains")
        .select("id,domain_name")
        .eq("business_representation_id", representationId)
        .eq("domain_name", "offer");

      if (domains.error) throw domains.error;

      const domainRows = domains.data ?? [];

      assert(
        domainRows.length === 1,
        "canonical fixture offer Domain missing or duplicated"
      );

      const offerDomainId = domainRows[0].id;
      registry.registerDomain(offerDomainId);

      const elements = await owner.client
        .from("representation_elements")
        .insert(
          ["offer", "target_audience"].map(element_key => ({
            business_representation_id: representationId,
            representation_domain_id: offerDomainId,
            element_key,
            element_type: "fact",
            field_sensitivity: "operational",
            claim_eligibility: "approved_for_external_use",
            is_disputed: false,
            current_value_version_id: versionId,
          }))
        )
        .select("id,element_key,current_value_version_id");

      if (elements.error) throw elements.error;

      const elementRows = elements.data ?? [];
      const elementKeys = new Set(
        elementRows.map(row => row.element_key)
      );

      assert(
        elementRows.length === 2
          && elementKeys.has("offer")
          && elementKeys.has("target_audience"),
        "canonical fixture Elements missing"
      );

      assert(
        elementRows.every(
          row => row.current_value_version_id === versionId
        ),
        "canonical fixture Element pointers not advanced"
      );

      elementRows.forEach(
        row => registry.registerElement(row.id)
      );


    const canonicalBefore=await admin.from("business_representations").select("current_version_id").eq("id",representationId).single();

    const created=await json(
        server.baseUrl,
        "/api/experience/session",
        { method: "POST" }
      );

      assert(
        created.status === 200,
        `public session creation failed: status=${created.status} response=${created.raw}`
      );const token=String(created.body.experience_token),expires=String(created.body.expires_at);assert(token.length>=43&&Date.parse(expires)>Date.now(),"token entropy or expiry invalid");const forbidden=[business.data.id,representationId,versionId,"voice_context_id","business_id","token_hash","phone_hash"];assert(forbidden.every(value=>!created.raw.includes(value)),"session response leaked internal identity");
    const session=await admin.from("public_experience_sessions").select("*").eq("token_hash",hashExperienceToken(token)).single();assert(!session.error&&session.data,"only token hash persistence missing");assert(!JSON.stringify(session.data).includes(token),"plaintext token persisted");registry.registerVoiceLineage(session.data.zeya_voice_context_id,representationId);const lineage=await admin.from("voice_representation_lineage").select("business_id,business_representation_id,canonical_version_id").eq("voice_context_id",session.data.zeya_voice_context_id).single();assert(!lineage.error&&lineage.data,"Zeya lineage missing");assert(lineage.data.business_id===business.data.id&&lineage.data.business_representation_id===representationId&&lineage.data.canonical_version_id===versionId,"Zeya lineage mismatch");
    const statusHeaders={Authorization:`Bearer ${token}`};const initialStatus=await json(server.baseUrl,"/api/experience/session/status",{headers:statusHeaders});assert(initialStatus.status===200&&initialStatus.body.status==="waiting_for_zeya","initial safe status mismatch");assert(Object.keys(initialStatus.body).sort().join(",")==="expiresAt,status","status exposed extra fields");assert((await json(server.baseUrl,"/api/experience/session/status")).status===404,"status bearer token required");assert((await json(server.baseUrl,"/api/experience/session/status",{headers:{Authorization:"Bearer unknown"}})).status===404,"unknown token not hidden");
    const secondCreated=await json(server.baseUrl,"/api/experience/session",{method:"POST"});assert(secondCreated.status===200,"second isolated session creation failed");const secondToken=String(secondCreated.body.experience_token);const secondSession=await admin.from("public_experience_sessions").select("id,zeya_voice_context_id").eq("token_hash",hashExperienceToken(secondToken)).single();assert(!secondSession.error&&secondSession.data&&secondSession.data.id!==session.data.id,"cross-session identity isolation failed");registry.registerVoiceLineage(secondSession.data.zeya_voice_context_id,representationId);const secondStatus=await json(server.baseUrl,"/api/experience/session/status",{headers:{Authorization:`Bearer ${secondToken}`}});assert(secondStatus.status===200&&secondStatus.body.status==="waiting_for_zeya"&&!secondStatus.raw.includes(session.data.id),"cross-session status isolation failed");
    const expiredToken=createExperienceToken(),expiredVoiceContextId=crypto.randomUUID();const expiredCreate=await admin.rpc("zeya_create_public_experience_session",{p_token_hash:hashExperienceToken(expiredToken),p_expires_at:new Date(Date.now()+1000).toISOString(),p_voice_context_id:expiredVoiceContextId,p_worker_brief_id:`expired_${expiredVoiceContextId}`,p_conversation_id:`expired_${expiredVoiceContextId}`,p_tenant_user_id:owner.id,p_business_id:business.data.id,p_business_representation_id:representationId,p_canonical_version_id:versionId,p_context_generated_at:new Date().toISOString(),p_authorized_element_keys:["offer","target_audience"],p_agent_id:"zeya-public-experience",p_context_schema_version:"1.0",p_prompt_assembly_version:"1.0"});assert(!expiredCreate.error,"expired-session fixture creation failed");registry.registerVoiceLineage(expiredVoiceContextId,representationId);await new Promise(resolve=>setTimeout(resolve,1100));assert((await json(server.baseUrl,"/api/experience/session/finalize-zeya",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:expiredToken,transcript:[{role:"user",text:"expired"}]})})).status===404,"expired token not hidden");
    const transcript=[{role:"assistant",text:"What are you selling?"},{role:"user",text:"A concise consulting service."}];
    const finalizePath="/api/experience/session/finalize-zeya";
    const finalize=()=>json(server!.baseUrl,finalizePath,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token,transcript})});
    const invalidFinalize=(candidateToken:string,candidateTranscript:unknown)=>json(server!.baseUrl,finalizePath,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:candidateToken,transcript:candidateTranscript})});
    assert((await invalidFinalize(token,Array.from({length:PUBLIC_EXPERIENCE_MAX_TURNS+1},()=>({role:"user",text:"bounded"})))).status===400,"turn limit not enforced");
    assert((await invalidFinalize(token,[{role:"user",text:"x".repeat(PUBLIC_EXPERIENCE_MAX_TURN_CHARS+1)}])).status===400,"per-turn limit not enforced");
    const totalTurns=Array.from({length:Math.min(PUBLIC_EXPERIENCE_MAX_TURNS,Math.ceil((PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS+1)/PUBLIC_EXPERIENCE_MAX_TURN_CHARS))},()=>({role:"user",text:"x".repeat(PUBLIC_EXPERIENCE_MAX_TURN_CHARS)}));
    assert((await invalidFinalize(token,totalTurns)).status===413,"total transcript limit not enforced");
    assert((await invalidFinalize(createExperienceToken(),transcript)).status===404,"unknown token not hidden");
    const firstFinalize = await finalize();
      assert(
        firstFinalize.status === 200,
        `Zeya finalization failed: status=${firstFinalize.status} response=${firstFinalize.raw}`
      );assert((await finalize()).status===200,"exact Zeya replay not idempotent");assert((await invalidFinalize(token,[...transcript,{role:"user",text:"conflict"}])).status===409,"conflicting replay not rejected");assert((await invalidFinalize(token,[{role:"system",text:"invalid"}])).status===400,"invalid role not rejected");
    const finalizedSession=await admin.from("public_experience_sessions").select("zeya_conversation_output_id,state").eq("id",session.data.id).single();assert(finalizedSession.data?.state==="zeya_finalized","Zeya state not finalized");const zeyaOutputId=finalizedSession.data!.zeya_conversation_output_id;registry.registerVoiceOutput(zeyaOutputId,representationId);const zeyaOutput=await admin.from("voice_conversation_outputs").select("transcript_trust_level,provider_attested,extracted_candidate_count,transcript_status").eq("id",zeyaOutputId).single();assert(zeyaOutput.data?.transcript_trust_level==="authenticated_client_relay"&&zeyaOutput.data.provider_attested===false&&zeyaOutput.data.extracted_candidate_count===0&&zeyaOutput.data.transcript_status==="finalized","Zeya output trust or zero-candidate identity invalid");const zeroCandidates=await admin.from("voice_conversation_candidates").select("id").eq("conversation_output_id",zeyaOutputId);assert(!zeroCandidates.error&&zeroCandidates.data.length===0,"zero-candidate extraction identity failed");assert((await owner.client.from("voice_conversation_outputs").update({conversation_status:"mutated"}).eq("id",zeyaOutputId)).error,"output update not blocked");assert((await owner.client.from("voice_conversation_outputs").delete().eq("id",zeyaOutputId)).error,"output delete not blocked");const immutableOutput=await admin.from("voice_conversation_outputs").select("id,conversation_status").eq("id",zeyaOutputId).single();assert(!immutableOutput.error&&immutableOutput.data.id===zeyaOutputId,"immutable output was removed");
    const premature=await json(server.baseUrl,"/api/experience/session/status",{headers:statusHeaders});assert(premature.body.status==="ready_for_phone","premature completion exposed");const phone="+15550001111";const dispatched=await json(server.baseUrl,"/api/experience/delegate-call",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({experienceToken:token,phone,name:"Test",business:"Consulting",customer:"Businesses",businessId:crypto.randomUUID(),voiceContextId:crypto.randomUUID()})});assert(dispatched.status===200,"deterministic Veya dispatch failed");const replay=await json(server.baseUrl,"/api/experience/delegate-call",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({experienceToken:token,phone})});assert(replay.status===200,"dispatch replay not idempotent");const conflictPhone=await json(server.baseUrl,"/api/experience/delegate-call",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({experienceToken:token,phone:"+15550002222"})});assert(conflictPhone.status===409,"conflicting phone replay not rejected");
    const correlated=await admin.from("public_experience_sessions").select("veya_voice_context_id,state,phone_hash").eq("id",session.data.id).single();assert(correlated.data?.veya_voice_context_id&&correlated.data.state==="call_dispatched"&&correlated.data.phone_hash&&!JSON.stringify(correlated.data).includes(phone),"Veya correlation or phone privacy failed");registry.registerVoiceLineage(correlated.data.veya_voice_context_id,representationId);const veyaLineage=await admin.from("voice_representation_lineage").select("business_representation_id,canonical_version_id,conversation_id").eq("voice_context_id",correlated.data.veya_voice_context_id).single();assert(veyaLineage.data?.business_representation_id===representationId&&veyaLineage.data.canonical_version_id===versionId&&correlated.data.veya_voice_context_id!==session.data.zeya_voice_context_id,"Veya lineage isolation mismatch");
    const callInProgress=await json(server.baseUrl,"/api/experience/session/status",{headers:statusHeaders});assert(callInProgress.body.status==="call_in_progress","call dispatch exposed premature reflection");
    assert((await owner.client.rpc("zeya_complete_public_experience_call",{p_veya_voice_context_id:correlated.data.veya_voice_context_id,p_conversation_output_id:crypto.randomUUID()})).error,"browser could complete provider call");
    const completion=await captureAndExtractConversationOutput({db:admin,capture:{voiceContextId:correlated.data.veya_voice_context_id,conversationId:veyaLineage.data!.conversation_id,provider:"elevenlabs",channel:"veya_outbound",captureSource:"provider_callback",transcriptTrustLevel:"provider_attested",providerAttested:true,completedAt:new Date().toISOString(),transcript:[{role:"agent",text:"Hello from Veya."},{role:"customer",text:"I need a concise follow-up."}],transcriptStatus:"finalized",conversationStatus:"done",completionReason:"provider_completed"},extractionModel:async()=>[{candidateType:"customer_need",content:{summary:"Customer needs a concise follow-up."},speakerRole:"customer",statementKind:"assertion",sourceReference:{turnIndexes:[1]},relevantElementKeys:[],confidence:0.9,rationale:"Explicit provider-attested customer statement."}]});registry.registerVoiceOutput(completion.conversationOutputId,representationId);const candidates=await admin.from("voice_conversation_candidates").select("id").eq("conversation_output_id",completion.conversationOutputId);assert(!candidates.error&&candidates.data.length===1,"provider candidate extraction failed");candidates.data.forEach(row=>registry.registerVoiceCandidate(row.id,representationId));const completeRpc=await admin.rpc("zeya_complete_public_experience_call",{p_veya_voice_context_id:correlated.data.veya_voice_context_id,p_conversation_output_id:completion.conversationOutputId});assert(!completeRpc.error&&completeRpc.data==="reflection_ready","provider completion failed");const replayRpc=await admin.rpc("zeya_complete_public_experience_call",{p_veya_voice_context_id:correlated.data.veya_voice_context_id,p_conversation_output_id:completion.conversationOutputId});assert(!replayRpc.error&&replayRpc.data==="reflection_ready","provider replay failed");const unrelated=await admin.rpc("zeya_complete_public_experience_call",{p_veya_voice_context_id:crypto.randomUUID(),p_conversation_output_id:crypto.randomUUID()});assert(unrelated.error||unrelated.data!=="reflection_ready","unrelated call affected Experience state");const finalStatus=await json(server.baseUrl,"/api/experience/session/status",{headers:statusHeaders});assert(finalStatus.body.status==="reflection_ready"&&Object.keys(finalStatus.body).sort().join(",")==="expiresAt,status","final status unsafe");
    const canonicalAfter=await admin.from("business_representations").select("current_version_id").eq("id",representationId).single();assert(canonicalAfter.data?.current_version_id===canonicalBefore.data?.current_version_id,"conversation mutated canonical Version");
    stubFail=true;const failed=await json(server.baseUrl,"/api/experience/session",{method:"POST"});assert(failed.status===503&&!failed.raw.includes("stub_failure"),"credential failure not sanitized");const failedRow=await admin.from("public_experience_sessions").select("state,zeya_voice_context_id").eq("business_representation_id",representationId).eq("state","failed").order("created_at",{ascending:false}).limit(1).maybeSingle();assert(failedRow.data?.state==="failed","credential failure not compensated");if(failedRow.data)registry.registerVoiceLineage(failedRow.data.zeya_voice_context_id,representationId);
    await server.stop();server=null;stubFail=false;delete process.env.ZEYA_EXPERIENCE_BUSINESS_ID;const invalidConfigServer=await startTestServer();server=invalidConfigServer;const invalidConfig=await json(server.baseUrl,"/api/experience/session",{method:"POST"});assert(invalidConfig.status===503&&Object.keys(invalidConfig.body).join(",")==="error","missing configuration did not fail safely");await server.stop();server=null;
    process.env.ZEYA_EXPERIENCE_BUSINESS_ID=business.data.id;process.env.PUBLIC_EXPERIENCE_TEST_FORCE_COMPENSATION_FAILURE="true";stubFail=true;const compensationServer=await startTestServer();server=compensationServer;const compensationFailure=await json(server.baseUrl,"/api/experience/session",{method:"POST"});assert(compensationFailure.status===503&&!compensationFailure.raw.includes("test_compensation_failure"),"compensation failure response unsafe");const uncompensated=await admin.from("public_experience_sessions").select("state,zeya_voice_context_id").eq("business_representation_id",representationId).eq("state","zeya_active").order("created_at",{ascending:false}).limit(1).maybeSingle();assert(uncompensated.data?.state==="zeya_active","compensation failure was not detectable");if(uncompensated.data)registry.registerVoiceLineage(uncompensated.data.zeya_voice_context_id,representationId);delete process.env.PUBLIC_EXPERIENCE_TEST_FORCE_COMPENSATION_FAILURE;
    console.log("Public Experience deployed behavioral matrix — PASS");
  }finally{
    if(server)await server.stop();await new Promise<void>(resolve=>stub.close(()=>resolve()));
    const dispatchIds=registry.voiceLineages.length?await admin.from("public_experience_sessions").select("dispatch_id").in("zeya_voice_context_id",registry.voiceLineages.map(v=>v.id)):null;
    const ids=(dispatchIds?.data??[]).map(row=>row.dispatch_id).filter((id):id is string=>Boolean(id));
    if(ids.length){
      const workerBriefs=await admin.from("worker_briefs").select("id").in("mission_id",ids);
      const workerBriefIds=(workerBriefs.data??[]).map(row=>row.id);
      if(workerBriefIds.length)await admin.from("brief_conversation_mappings").delete().in("worker_brief_id",workerBriefIds);
      await admin.from("worker_briefs").delete().in("mission_id",ids);
    }
    const cleanup=await cleanupFixtures(admin,registry);if(!cleanup.success)throw new Error(`cleanup failed: ${cleanup.failures.join(", ")}`);
  }
}
main().catch((error: unknown) => {
  console.error("Public Experience deployed test failed");

  if (error instanceof Error) {
    console.error(error.stack ?? `${error.name}: ${error.message}`);

    if (error.cause) {
      console.error("Cause:");
      console.error(inspect(error.cause, { depth: null }));
    }
  } else {
    console.error("Non-Error rejection:");
    console.error(inspect(error, { depth: null }));
  }

  process.exitCode = 1;
});
