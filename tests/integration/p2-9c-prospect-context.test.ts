import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {buildSpeechSafeProspectContext,projectProspectContextV1,type ProspectMemoryV1,type ProspectObservationV1} from "../../lib/work/prospect-memory";

const observation=(id:string,slot:string,claim:string,uncertain=false):ProspectObservationV1=>({schemaVersion:"prospect-observation-v1",id,ownerId:"owner",businessId:"business",representationId:"representation",leadId:"lead",sourceInterpretationId:"interpretation",sourceConversationOutputId:"output",sourceMissionId:"mission",sourceKey:id,kind:slot==="pain"?"pain":slot==="channel"?"channel":"clarification",slot,claim,value:null,polarity:uncertain?"unknown":"affirmed",basis:uncertain?"supported_inference":"explicit_statement",confidence:uncertain?.5:.95,uncertainty:uncertain?{kind:"asr",explanation:"unclear audio"}:null,observedAt:"2026-08-20T00:00:00Z",createdAt:"2026-08-20T00:00:00Z"});
const pain=observation("pain","pain","The prospect reported difficulty getting investor attention.");
const channel=observation("channel","channel","The prospect reported using LinkedIn and cold outreach.");
const unclear=observation("unclear","clarification","The service description was unclear.",true);
const memory:ProspectMemoryV1={schemaVersion:"prospect-memory-v1",leadId:"lead",ownerId:"owner",businessId:"business",representationId:"representation",observations:[unclear,channel,pain],currentState:{schemaVersion:"current-prospect-state-v1",leadId:"lead",generatedFromInterpretationIds:["interpretation"],facts:[{slot:"pain",status:"current",values:[],supportingObservationIds:[pain.id],conflictingObservationIds:[],unresolvedReason:null,observedAt:pain.observedAt},{slot:"channel",status:"current",values:[],supportingObservationIds:[channel.id],conflictingObservationIds:[],unresolvedReason:null,observedAt:channel.observedAt},{slot:"clarification",status:"uncertain",values:[],supportingObservationIds:[unclear.id],conflictingObservationIds:[],unresolvedReason:"unclear",observedAt:unclear.observedAt}],historySummary:{interactionCount:1,firstInteractionAt:pain.observedAt,latestInteractionAt:pain.observedAt},obligations:[]},unresolvedUncertainties:[{observationIds:[unclear.id],summary:"unclear",clarificationNeeded:true}],obligations:[{sourceMissionOutcomeId:"outcome",sourceInterpretationId:"interpretation",kind:"callback",status:"outstanding",requestedByProspect:true,scheduled:false,dueAt:null,reason:"A callback was requested but not scheduled."}]};

describe("P2.9C governed prospect context",()=>{
  it("projects the August semantics deterministically from governed memory",()=>{
    const input={leadId:"lead",memory,previousInteraction:{missionOutcomeId:"outcome",interpretationId:"interpretation",contacted:true,qualification:"unknown" as const,meetingBooked:false},sourceFingerprint:"a".repeat(64)};
    const first=projectProspectContextV1(input),second=projectProspectContextV1({...input,memory:{...memory,observations:[pain,unclear,channel]}});
    expect(second).toEqual(first);expect(first).toMatchObject({schemaVersion:"prospect-context-v1",relationshipState:"follow_up",previousInteraction:{contacted:true,qualification:"unknown",meetingBooked:false}});
    expect(first.currentFacts.map(f=>f.summary)).toEqual(expect.arrayContaining([pain.claim,channel.claim,unclear.claim]));
    expect(first.unresolvedQuestions).toEqual([{slot:"clarification",summary:unclear.claim,reason:"uncertain"}]);
    expect(first.obligations[0]).toMatchObject({kind:"callback",status:"outstanding",requestedByProspect:true,scheduled:false,dueAt:null});
  });
  it("represents first contact explicitly without inventing history",()=>{
    expect(projectProspectContextV1({leadId:"lead",memory:null,previousInteraction:null,sourceFingerprint:"b".repeat(64)})).toMatchObject({relationshipState:"first_contact",currentFacts:[],unresolvedQuestions:[],obligations:[],previousInteraction:null});
  });
  it("keeps uncertainty attributed and removes provenance from speech-safe guidance",()=>{
    const context=projectProspectContextV1({leadId:"lead",memory,previousInteraction:null,sourceFingerprint:"c".repeat(64)}),speech=buildSpeechSafeProspectContext(context);
    expect(speech).toContain("Needs clarification (clarification, uncertain)");expect(speech).toContain("not business truth or authority");
    expect(speech).not.toContain("interpretation");expect(speech).not.toContain("c".repeat(64));expect(speech).not.toContain("observationIds");
  });
  it("freezes context V2 and validates freshness before dispatch and authorization",()=>{
    const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260824000000_p29c_prospect_context_consumption.sql"),"utf8");
    expect(sql).toContain("'operating-execution-context-v2'");expect(sql).toContain("'governed-worker-brief-v2'");expect(sql).toContain("'prospectContext',p_prospect_context");
    expect(sql.match(/zeya_p29c_context_memory_is_current/g)?.length).toBeGreaterThanOrEqual(3);expect(sql).toContain("prospect context is stale");
    expect(sql).not.toMatch(/INSERT INTO public\.(?:prospect_observations|prospect_observation_relations|representation_versions|evidence|observations|representation_proposals)/i);
  });
  it("accepts no client prospect JSON and keeps provider adapters unchanged",()=>{
    const prepare=readFileSync(resolve(process.cwd(),"app/api/work/missions/[missionId]/prepare/route.ts"),"utf8"),execute=readFileSync(resolve(process.cwd(),"lib/work/governed-voice-execution.ts"),"utf8"),provider=readFileSync(resolve(process.cwd(),"lib/providers/elevenlabs-provider.ts"),"utf8");
    expect(prepare).not.toContain("request.json");expect(prepare).toContain("getProspectContext");expect(prepare).toContain("zeya_prepare_operating_mission_v2");
    expect(execute).toContain("buildSpeechSafeProspectContext");expect(execute).not.toContain("getProspectMemory");expect(provider).not.toContain("prospect-context-v1");
  });
  it("fully qualifies the mission status update against the RETURNS TABLE status output",()=>{
    const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260825010000_p210_prepare_v2_status_ambiguity_fix.sql"),"utf8");
    expect(sql).toContain("UPDATE public.operating_missions AS mission SET status='ready'");
    expect(sql).toContain("mission.id=v_mission.id AND mission.status='draft'");
    expect(sql).not.toContain("WHERE id=v_mission.id AND status='draft'");
  });
});
