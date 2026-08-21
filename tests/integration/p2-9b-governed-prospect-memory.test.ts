import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {augustSemantics,augustTranscript,trustedIdentity} from "../fixtures/p2-8-august-conversation";
import {validateConversationInterpretationV1} from "../../lib/work/conversation-interpretation";
import {deriveProspectObligations,projectInterpretationToProspectObservations,reduceCurrentProspectState,type ProspectObservationRelationV1,type ProspectObservationV1} from "../../lib/work/prospect-memory";

const interpretation=validateConversationInterpretationV1(augustSemantics,trustedIdentity,augustTranscript);
const base=(id:string,slot:string,value:any,at:string,uncertainty:ProspectObservationV1["uncertainty"]=null):ProspectObservationV1=>({schemaVersion:"prospect-observation-v1",id,ownerId:"owner",businessId:"business",representationId:"representation",leadId:"lead",sourceInterpretationId:`interpretation-${id}`,sourceConversationOutputId:`output-${id}`,sourceMissionId:`mission-${id}`,sourceKey:`insight.${id}`,kind:slot==="pain"?"pain":slot.startsWith("qualification")?"qualification":slot.startsWith("budget")?"budget":"timing",slot,claim:`claim ${id}`,value,polarity:uncertainty?"unknown":"affirmed",basis:uncertainty?"supported_inference":"explicit_statement",confidence:uncertainty?.kind?0.5:0.95,uncertainty,observedAt:at,createdAt:at});
const relation=(subject:string,object:string,type:ProspectObservationRelationV1["relation"]):ProspectObservationRelationV1=>({id:`${subject}-${type}-${object}`,ownerId:"owner",businessId:"business",representationId:"representation",leadId:"lead",subjectObservationId:subject,objectObservationId:object,relation:type,rationale:"fixture",sourceInterpretationId:null,createdAt:"2026-08-21T00:00:00Z"});

describe("P2.9B governed prospect memory",()=>{
  it("projects the August interpretation without guessing structured values",()=>{
    const rows=projectInterpretationToProspectObservations(interpretation);
    expect(rows).toHaveLength(6);
    expect(rows.every(row=>row.value===null)).toBe(true);
    expect(rows.filter(row=>row.kind==="pain")).toHaveLength(1);
    expect(rows.some(row=>row.kind==="channel")).toBe(true);
    expect(rows.some(row=>row.kind==="follow_up_request")).toBe(true);
    expect(rows.find(row=>row.sourceKey==="mission.qualification")).toMatchObject({polarity:"unknown",value:null});
    const unclear=rows.filter(row=>row.uncertainty);
    expect(unclear.length).toBeGreaterThan(0);
    expect(unclear.every(row=>row.value===null)).toBe(true);
  });

  it("supersedes timing only through an explicit relation and retains history",()=>{
    const old=base("old","timing","next_quarter","2026-01-01T00:00:00Z"),current=base("new","timing","this_month","2026-02-01T00:00:00Z");
    const state=reduceCurrentProspectState({leadId:"lead",observations:[old,current],relations:[relation("new","old","supersedes")]});
    expect(state.facts.find(f=>f.slot==="timing")?.values).toEqual(["this_month"]);
    expect([old,current]).toHaveLength(2);
  });

  it("keeps multiple pains current",()=>{
    const state=reduceCurrentProspectState({leadId:"lead",observations:[base("a","pain","investor_access","2026-01-01T00:00:00Z"),base("b","pain","demo_conversion","2026-02-01T00:00:00Z")],relations:[]});
    expect(state.facts.find(f=>f.slot==="pain")?.values).toEqual(["investor_access","demo_conversion"]);
  });

  it("does not collapse budget amount and approval into a false contradiction",()=>{
    const state=reduceCurrentProspectState({leadId:"lead",observations:[base("amount","budget_amount",20000,"2026-01-01T00:00:00Z"),base("approval","budget_approval",false,"2026-02-01T00:00:00Z")],relations:[]});
    expect(state.facts).toHaveLength(2);expect(state.facts.every(f=>f.status==="current")).toBe(true);
  });

  it("surfaces an actual same-slot contradiction",()=>{
    const a=base("a","current_interest",true,"2026-01-01T00:00:00Z"),b=base("b","current_interest",false,"2026-02-01T00:00:00Z");
    const state=reduceCurrentProspectState({leadId:"lead",observations:[a,b],relations:[relation("b","a","contradicts")]});
    expect(state.facts[0]).toMatchObject({status:"conflicted",conflictingObservationIds:expect.arrayContaining(["a","b"])});
  });

  it("does not silently make two interpretation versions active for a single-current slot",()=>{
    const v1=base("v1","timing","next_quarter","2026-01-01T00:00:00Z"),v2=base("v2","timing","this_month","2026-02-01T00:00:00Z");
    const state=reduceCurrentProspectState({leadId:"lead",observations:[v1,v2],relations:[]});
    expect(state.facts[0].status).toBe("conflicted");expect(state.facts[0].supportingObservationIds).toEqual(["v1","v2"]);
  });

  it("retains uncertain history while explicit evidence resolves current state",()=>{
    const unclear=base("unclear","service_name",null,"2026-01-01T00:00:00Z",{kind:"asr",explanation:"unclear"}),confirmed=base("confirmed","service_name","People Economics","2026-02-01T00:00:00Z");
    const state=reduceCurrentProspectState({leadId:"lead",observations:[unclear,confirmed],relations:[relation("confirmed","unclear","resolves_uncertainty")]});
    expect(state.facts[0]).toMatchObject({status:"current",values:["People Economics"]});expect([unclear,confirmed]).toHaveLength(2);
  });

  it("invalidation removes known-bad active truth without deleting history",()=>{
    const bad=base("bad","timing","wrong","2026-01-01T00:00:00Z"),correction=base("correction","timing","correct","2026-02-01T00:00:00Z");
    const state=reduceCurrentProspectState({leadId:"lead",observations:[bad,correction],relations:[relation("correction","bad","invalidates")]});
    expect(state.facts[0].values).toEqual(["correct"]);expect([bad,correction]).toHaveLength(2);
  });

  it("keeps qualification mission-contextual rather than universally qualified",()=>{
    const rows=projectInterpretationToProspectObservations(interpretation);expect(rows.find(row=>row.kind==="qualification")?.slot).toContain(trustedIdentity.missionId);expect(rows.some(row=>row.slot==="qualified")).toBe(false);
  });

  it("retains old observations conservatively when no justified stale threshold exists",()=>{
    const old=base("old","pain","historic_pain","2020-01-01T00:00:00Z");const state=reduceCurrentProspectState({leadId:"lead",observations:[old],relations:[]});
    expect(state.facts[0]).toMatchObject({status:"current",supportingObservationIds:["old"]});
  });

  it("is deterministic when persisted observations share the same provider timestamp",()=>{
    const a=base("a","pain","a","2026-01-01T00:00:00Z"),b=base("b","pain","b","2026-01-01T00:00:00Z");
    const forward=reduceCurrentProspectState({leadId:"lead",observations:[a,b],relations:[]}),reverse=reduceCurrentProspectState({leadId:"lead",observations:[b,a],relations:[]});
    expect(reverse).toEqual(forward);
  });

  it("keeps callback request historical and derives only an outstanding unscheduled obligation",()=>{
    const obligations=deriveProspectObligations([{id:"outcome",resultOperationId:"interpretation",followUpRequired:true,interpretation}]);
    expect(obligations.find(item=>item.kind==="callback")).toMatchObject({status:"outstanding",requestedByProspect:true,scheduled:false,dueAt:null});
    expect(obligations.some(item=>item.status==="completed"||item.scheduled)).toBe(false);
  });

  it("migration enforces lineage, replay, immutability, RLS, relation safety, and purge order",()=>{
    const sql=readFileSync(resolve(process.cwd(),"supabase/migrations/20260823000000_p29b_governed_prospect_memory.sql"),"utf8");
    expect(sql).toContain("UNIQUE(lead_id,source_interpretation_id,source_key)");
    expect(sql).toContain("prospect observation projection conflicts");expect(sql).toContain("prospect observation projection is incomplete");
    expect(sql.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(2);expect(sql).toContain("owner_id=auth.uid()");
    expect(sql).toContain("prospect memory is immutable");expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain("s.slot<>o.slot");expect(sql).toContain("s.basis<>'explicit_statement'");expect(sql).toContain("s.uncertainty IS NOT NULL");
    const relationDelete=sql.indexOf("DELETE FROM public.prospect_observation_relations"),observationDelete=sql.indexOf("DELETE FROM public.prospect_observations"),outcomeDelete=sql.indexOf("DELETE FROM public.mission_execution_outcomes"),interpretationDelete=sql.indexOf("DELETE FROM public.conversation_interpretations");
    expect(relationDelete).toBeLessThan(observationDelete);expect(observationDelete).toBeLessThan(outcomeDelete);expect(outcomeDelete).toBeLessThan(interpretationDelete);
  });

  it("routes accept only trusted IDs and expose no model, provider, candidate, or Representation writes",()=>{
    const files=["lib/work/prospect-memory.ts","app/api/work/leads/[leadId]/memory/route.ts","app/api/work/conversation-interpretations/[interpretationId]/prospect-memory/route.ts"];
    const source=files.map(file=>readFileSync(resolve(process.cwd(),file),"utf8")).join("\n");
    expect(source).not.toMatch(/request\.json|OpenAI|responses\.create|ElevenLabs|voice_conversation_candidates|conversation_candidate_|representation_versions|\.from\(["'](?:evidence|observations|representation_proposals)["']\)/);
    expect(source).not.toMatch(/\.insert\(|\.update\(|\.delete\(/);
  });
});
