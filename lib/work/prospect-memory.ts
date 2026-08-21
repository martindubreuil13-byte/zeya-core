import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConversationInterpretationV1, ProspectInsight } from "@/lib/work/conversation-interpretation";

export const PROSPECT_OBSERVATION_V1 = "prospect-observation-v1" as const;
export const CURRENT_PROSPECT_STATE_V1 = "current-prospect-state-v1" as const;
export const PROSPECT_MEMORY_V1 = "prospect-memory-v1" as const;
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProspectObservationKind = "need"|"pain"|"interest"|"objection"|"qualification"|"authority"|"budget"|"timing"|"channel"|"preference"|"follow_up_request"|"clarification"|"other";
export type ProspectObservationV1 = {
  schemaVersion: typeof PROSPECT_OBSERVATION_V1; id: string; ownerId: string; businessId: string; representationId: string; leadId: string;
  sourceInterpretationId: string; sourceConversationOutputId: string; sourceMissionId: string; sourceKey: string;
  kind: ProspectObservationKind; slot: string; claim: string; value: JsonValue; polarity: "affirmed"|"denied"|"unknown";
  basis: "explicit_statement"|"supported_inference"; confidence: number;
  uncertainty: { kind: "asr"|"ambiguous"|"incomplete"|"inference"; explanation: string } | null;
  observedAt: string; createdAt: string;
};
export type ProspectObservationRelationV1 = { id:string; ownerId:string; businessId:string; representationId:string; leadId:string; subjectObservationId:string; objectObservationId:string; relation:"supersedes"|"contradicts"|"resolves_uncertainty"|"invalidates"; rationale:string; sourceInterpretationId:string|null; createdAt:string };
export type ProspectOperationalObligationV1 = { sourceMissionOutcomeId:string; sourceInterpretationId:string; kind:"callback"|"send_information"|"clarification"|"owner_answer"|"other"; status:"outstanding"|"completed"|"cancelled"|"unknown"; requestedByProspect:boolean; scheduled:boolean; dueAt:string|null; reason:string };
export type CurrentProspectStateV1 = { schemaVersion:typeof CURRENT_PROSPECT_STATE_V1; leadId:string; generatedFromInterpretationIds:string[]; facts:Array<{slot:string;status:"current"|"uncertain"|"conflicted"|"stale";values:JsonValue[];supportingObservationIds:string[];conflictingObservationIds:string[];unresolvedReason:string|null;observedAt:string}>; historySummary:{interactionCount:number;firstInteractionAt:string|null;latestInteractionAt:string|null};obligations:ProspectOperationalObligationV1[] };
export type ProspectMemoryV1 = { schemaVersion:typeof PROSPECT_MEMORY_V1;leadId:string;ownerId:string;businessId:string;representationId:string;currentState:CurrentProspectStateV1;observations:ProspectObservationV1[];unresolvedUncertainties:Array<{observationIds:string[];summary:string;clarificationNeeded:boolean}>;obligations:ProspectOperationalObligationV1[] };

export class ProspectMemoryError extends Error { constructor(public readonly code:"not_found"|"not_ready"|"conflict"|"read_failed"|"persistence_failed"){super(code);} }

type ProjectedObservation = Omit<ProspectObservationV1,"id"|"ownerId"|"businessId"|"representationId"|"leadId"|"sourceInterpretationId"|"sourceConversationOutputId"|"sourceMissionId"|"observedAt"|"createdAt">;
const kindMap: Record<ProspectInsight["kind"],{kind:ProspectObservationKind;slot:string}> = {
  need:{kind:"need",slot:"need"},pain:{kind:"pain",slot:"pain"},objection:{kind:"objection",slot:"objection"},interest:{kind:"interest",slot:"current_interest"},buying_signal:{kind:"interest",slot:"current_interest"},timing:{kind:"timing",slot:"timing"},qualification:{kind:"qualification",slot:"qualification_evidence"},decision_authority:{kind:"authority",slot:"decision_authority"},budget:{kind:"budget",slot:"budget"},channel:{kind:"channel",slot:"channel"},follow_up_request:{kind:"follow_up_request",slot:"follow_up_request"},misunderstanding:{kind:"clarification",slot:"clarification"},
};
const uncertaintyKind = (kind:string): "asr"|"ambiguous"|"incomplete"|"inference" => kind === "asr" || kind === "incomplete" || kind === "inference" ? kind : "ambiguous";
const safeClaim=(value:string)=>value.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[contact detail omitted]").replace(/(?:\+?\d[\s().-]*){7,}/g,"[contact detail omitted]");

export function projectInterpretationToProspectObservations(interpretation:ConversationInterpretationV1):ProjectedObservation[] {
  const insights = interpretation.prospectIntelligence.map((insight,index):ProjectedObservation => ({
    schemaVersion:PROSPECT_OBSERVATION_V1,sourceKey:`insight.${index}`,kind:kindMap[insight.kind].kind,slot:kindMap[insight.kind].slot,
    claim:safeClaim(insight.summary),value:null,polarity:"affirmed",basis:insight.basis === "explicit_statement" ? "explicit_statement" : "supported_inference",confidence:insight.confidence,
    uncertainty:insight.uncertainty ? {kind:uncertaintyKind(insight.uncertainty.kind),explanation:insight.uncertainty.explanation} : null,
  }));
  const uncertainties = interpretation.uncertainties.map((uncertainty,index):ProjectedObservation => ({
    schemaVersion:PROSPECT_OBSERVATION_V1,sourceKey:`uncertainty.${index}`,kind:"clarification",slot:"clarification",claim:safeClaim(uncertainty.summary),value:null,polarity:"unknown",basis:"supported_inference",confidence:0,
    uncertainty:{kind:uncertaintyKind(uncertainty.kind),explanation:uncertainty.impact},
  }));
  const missionQualification:ProjectedObservation = { schemaVersion:PROSPECT_OBSERVATION_V1,sourceKey:"mission.qualification",kind:"qualification",slot:`mission_qualification:${interpretation.missionId}`,claim:interpretation.qualification.result === "unknown" ? "Qualification was not established for this mission." : `This mission concluded the prospect was ${interpretation.qualification.result.replace("_"," ")}.`,value:null,polarity:interpretation.qualification.result === "unknown" ? "unknown" : "affirmed",basis:"supported_inference",confidence:interpretation.qualification.confidence,uncertainty:interpretation.qualification.result === "unknown" ? {kind:"incomplete",explanation:interpretation.qualification.reasons.join(" ")} : null };
  return [...insights,...uncertainties,missionQualification];
}

export function reduceCurrentProspectState(input:{leadId:string;observations:ProspectObservationV1[];relations:ProspectObservationRelationV1[];obligations?:ProspectOperationalObligationV1[]}):CurrentProspectStateV1 {
  const invalid = new Set(input.relations.filter(r=>r.relation === "invalidates" || r.relation === "supersedes" || r.relation === "resolves_uncertainty").map(r=>r.objectObservationId));
  const contradictions = new Map<string,Set<string>>();
  for(const r of input.relations.filter(r=>r.relation === "contradicts")){ const a=contradictions.get(r.subjectObservationId)??new Set<string>();a.add(r.objectObservationId);contradictions.set(r.subjectObservationId,a);const b=contradictions.get(r.objectObservationId)??new Set<string>();b.add(r.subjectObservationId);contradictions.set(r.objectObservationId,b); }
  const active=input.observations.filter(o=>!invalid.has(o.id)).sort((a,b)=>a.observedAt.localeCompare(b.observedAt)||a.sourceInterpretationId.localeCompare(b.sourceInterpretationId)||a.sourceKey.localeCompare(b.sourceKey)||a.id.localeCompare(b.id)); const slots=new Map<string,ProspectObservationV1[]>();
  const singleCurrentSlots=new Set(["timing","budget_approval","decision_authority","current_interest"]);
  for(const observation of active){const rows=slots.get(observation.slot)??[];rows.push(observation);slots.set(observation.slot,rows);}
  const facts=[...slots.entries()].map(([slot,rows])=>{
    const distinctValues=new Set(rows.filter(row=>row.value!==null).map(row=>JSON.stringify(row.value)));
    const implicitConflict=singleCurrentSlots.has(slot)&&distinctValues.size>1?rows.map(row=>row.id):[];
    const conflictIds=[...new Set([...implicitConflict,...rows.flatMap(row=>[...(contradictions.get(row.id)??[])].filter(id=>active.some(o=>o.id===id)))])];
    const uncertain=rows.some(row=>row.uncertainty!==null || row.polarity==="unknown");
    return {slot,status:conflictIds.length?"conflicted" as const:uncertain?"uncertain" as const:"current" as const,values:rows.map(row=>row.value).filter((value):value is Exclude<JsonValue,null>=>value!==null),supportingObservationIds:rows.map(row=>row.id),conflictingObservationIds:conflictIds,unresolvedReason:conflictIds.length?"Supported observations conflict and require clarification.":uncertain?"The available observation remains materially uncertain.":null,observedAt:rows.map(row=>row.observedAt).sort().at(-1)!};
  }).sort((a,b)=>a.slot.localeCompare(b.slot));
  const dates=input.observations.map(o=>o.observedAt).sort(); const interpretationIds=[...new Set(input.observations.map(o=>o.sourceInterpretationId))].sort();
  return {schemaVersion:CURRENT_PROSPECT_STATE_V1,leadId:input.leadId,generatedFromInterpretationIds:interpretationIds,facts,historySummary:{interactionCount:interpretationIds.length,firstInteractionAt:dates[0]??null,latestInteractionAt:dates.at(-1)??null},obligations:input.obligations??[]};
}

export function deriveProspectObligations(rows:Array<{id:string;resultOperationId:string;followUpRequired:boolean;interpretation:ConversationInterpretationV1}>):ProspectOperationalObligationV1[]{
  const obligations:ProspectOperationalObligationV1[]=[];
  for(const row of rows){const interpretation=row.interpretation;if(row.followUpRequired)obligations.push({sourceMissionOutcomeId:row.id,sourceInterpretationId:row.resultOperationId,kind:"callback",status:"outstanding",requestedByProspect:interpretation.followUp.requestedBy==="prospect",scheduled:interpretation.followUp.scheduled,dueAt:interpretation.followUp.scheduledFor??interpretation.followUp.requestedTiming,reason:interpretation.followUp.scheduled?"Honor the scheduled callback.":"A callback was requested or committed but not scheduled."});
    for(const uncertainty of interpretation.uncertainties)obligations.push({sourceMissionOutcomeId:row.id,sourceInterpretationId:row.resultOperationId,kind:"clarification",status:"outstanding",requestedByProspect:false,scheduled:false,dueAt:null,reason:uncertainty.impact});}
  return obligations;
}

const mapObservation=(row:any):ProspectObservationV1=>({schemaVersion:PROSPECT_OBSERVATION_V1,id:String(row.id),ownerId:String(row.owner_id),businessId:String(row.business_id),representationId:String(row.business_representation_id),leadId:String(row.lead_id),sourceInterpretationId:String(row.source_interpretation_id),sourceConversationOutputId:String(row.source_conversation_output_id),sourceMissionId:String(row.source_mission_id),sourceKey:String(row.source_key),kind:row.kind,slot:String(row.slot),claim:String(row.claim),value:row.value??null,polarity:row.polarity,basis:row.basis,confidence:Number(row.confidence),uncertainty:row.uncertainty??null,observedAt:String(row.observed_at),createdAt:String(row.created_at)});
const mapRelation=(row:any):ProspectObservationRelationV1=>({id:String(row.id),ownerId:String(row.owner_id),businessId:String(row.business_id),representationId:String(row.business_representation_id),leadId:String(row.lead_id),subjectObservationId:String(row.subject_observation_id),objectObservationId:String(row.object_observation_id),relation:row.relation,rationale:String(row.rationale),sourceInterpretationId:row.source_interpretation_id?String(row.source_interpretation_id):null,createdAt:String(row.created_at)});

export async function projectProspectObservationsFromInterpretation(db:SupabaseClient,ownerId:string,interpretationId:string){
  const loaded=await db.from("conversation_interpretations").select("id,tenant_user_id,interpretation").eq("id",interpretationId).eq("tenant_user_id",ownerId).maybeSingle();
  if(loaded.error)throw new ProspectMemoryError("persistence_failed");if(!loaded.data)throw new ProspectMemoryError("not_found");
  const observations=projectInterpretationToProspectObservations(loaded.data.interpretation as ConversationInterpretationV1);
  const result=await db.rpc("zeya_project_prospect_observations",{p_owner_id:ownerId,p_interpretation_id:interpretationId,p_observations:observations});
  if(result.error)throw new ProspectMemoryError(result.error.code==="PZ409"?"conflict":"persistence_failed");
  const row=Array.isArray(result.data)?result.data[0]:result.data;return {observationCount:Number(row.observation_count),insertedCount:Number(row.inserted_count),replayed:Boolean(row.replayed)};
}

export async function getProspectMemory(db:SupabaseClient,ownerId:string,leadId:string):Promise<ProspectMemoryV1>{
  const lead=await db.from("mission_leads").select("id,business_id,business_representation_id").eq("id",leadId).maybeSingle();
  if(lead.error)throw new ProspectMemoryError("read_failed");if(!lead.data)throw new ProspectMemoryError("not_found");
  const representation=await db.from("business_representations").select("id").eq("id",lead.data.business_representation_id).eq("business_id",lead.data.business_id).eq("user_id",ownerId).maybeSingle();
  if(representation.error)throw new ProspectMemoryError("read_failed");if(!representation.data)throw new ProspectMemoryError("not_found");
  const missionResult=await db.from("operating_missions").select("id").eq("lead_id",leadId).eq("owner_id",ownerId).eq("business_id",lead.data.business_id).eq("business_representation_id",lead.data.business_representation_id);
  if(missionResult.error)throw new ProspectMemoryError("read_failed");const missionIds=(missionResult.data??[]).map(row=>row.id);
  const [observationResult,relationResult,interpretationResult,outcomeResult]=await Promise.all([
    db.from("prospect_observations").select("*").eq("lead_id",leadId).eq("owner_id",ownerId).order("observed_at",{ascending:true}),
    db.from("prospect_observation_relations").select("*").eq("lead_id",leadId).eq("owner_id",ownerId).order("created_at",{ascending:true}),
    db.from("conversation_interpretations").select("id,interpretation,mission_id").eq("lead_id",leadId).eq("tenant_user_id",ownerId),
    missionIds.length ? db.from("mission_execution_outcomes").select("id,result_operation_id,follow_up_required").eq("owner_id",ownerId).in("mission_id",missionIds) : Promise.resolve({data:[],error:null}),
  ]);
  if(observationResult.error||relationResult.error||interpretationResult.error||outcomeResult.error)throw new ProspectMemoryError("read_failed");
  const observations=(observationResult.data??[]).map(mapObservation);if(!observations.length)throw new ProspectMemoryError("not_ready");
  const relations=(relationResult.data??[]).map(mapRelation);const interpretations=new Map((interpretationResult.data??[]).map((row:any)=>[String(row.id),row.interpretation as ConversationInterpretationV1]));
  const obligations=deriveProspectObligations((outcomeResult.data??[]).flatMap(outcome=>{const interpretation=interpretations.get(String(outcome.result_operation_id));return interpretation?[{id:String(outcome.id),resultOperationId:String(outcome.result_operation_id),followUpRequired:Boolean(outcome.follow_up_required),interpretation}]:[];}));
  const currentState=reduceCurrentProspectState({leadId,observations,relations,obligations});
  return {schemaVersion:PROSPECT_MEMORY_V1,leadId,ownerId,businessId:String(lead.data.business_id),representationId:String(lead.data.business_representation_id),currentState,observations,unresolvedUncertainties:observations.filter(o=>o.uncertainty&&!relations.some(r=>r.objectObservationId===o.id&&(r.relation==="resolves_uncertainty"||r.relation==="invalidates"))).map(o=>({observationIds:[o.id],summary:`${o.claim} ${o.uncertainty!.explanation}`,clarificationNeeded:true})),obligations};
}
