import type { RepresentationBrief,RepresentationBriefEvidenceSource,RepresentationBriefValidation } from "@/types/experience";

export const REPRESENTATION_BRIEF_GENERATOR_VERSION="representation_brief_v1.1";
export type BriefTurn={role:string;text:string;id?:string};
export interface RepresentationBriefInput{
  visitorName:string|null;businessOffer:string|null;targetCustomer:string|null;
  zeyaTranscript:BriefTurn[];veyaTranscript:BriefTurn[];
}
export type RepresentationBriefResult=
  |{status:"valid";brief:RepresentationBrief;spokenBrief:string}
  |{status:"requires_clarification";message:string;clarificationQuestion:string;confidenceLevel:"requires_clarification";validation:RepresentationBriefValidation}
  |{status:"failed";message:string;internalReason:string;confidenceLevel:"requires_clarification";validation:RepresentationBriefValidation};

const SUPPORTS=["what_i_heard","what_stood_out","what_that_may_mean","where_i_would_begin"] as const;
function safeText(value:unknown,limit=500){return typeof value==="string"?value.replace(/https?:\/\/\S+/gi,"[link]").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[contact detail]").replace(/(?:\+?\d[\d\s().-]{6,}\d)/g,"[contact detail]").replace(/\s+/g," ").trim().slice(0,limit):""}
function visitorEvidence(input:RepresentationBriefInput){
  const collect=(turns:BriefTurn[],sourceType:"zeya_conversation"|"veya_call")=>turns.flatMap((turn,index)=>{
    if(turn.role!=="user"&&turn.role!=="customer")return [];
    const excerpt=safeText(turn.text);if(!excerpt)return [];
    return [{sourceType,sourceId:turn.id?.trim()||`${sourceType}_visitor_${index}`,speaker:"visitor" as const,excerpt}];
  });
  return [...collect(input.zeyaTranscript,"zeya_conversation"),...collect(input.veyaTranscript,"veya_call")];
}
const trivial=/^(yes|no|yeah|nope|okay|ok|sure|maybe|i don'?t know)[.!]?$/i;
function words(value:string){return value.split(/\s+/).filter(Boolean)}
function clarification(reason:string):RepresentationBriefResult{return{status:"requires_clarification",message:"I understand the outline, but I do not yet have enough evidence to offer a useful representation direction.",clarificationQuestion:"What is the most important result your business creates for the people it serves?",confidenceLevel:"requires_clarification",validation:{evidence:"fail",interpretation:"fail",governance:"pass",violations:[reason]}}}
function evidenceRefs(items:ReturnType<typeof visitorEvidence>):RepresentationBriefEvidenceSource[]{return items.slice(0,3).map((item,index)=>({...item,supports:index===0?[...SUPPORTS]:index===1?["what_stood_out","what_that_may_mean","where_i_would_begin"]:["what_stood_out"]}))}
function numbers(value:string){return value.match(/\b\d+(?:\.\d+)?%?\b/g)??[]}

export function validateRepresentationBrief(brief:RepresentationBrief,visitorExcerpts:string[]):RepresentationBriefValidation{
  const violations:string[]=[];const publicText=[brief.whatIHeard,brief.whatStoodOut,brief.whatThatMayMean,brief.whereIWouldBegin].join(" ");
  const normalized=visitorExcerpts.map(x=>safeText(x));
  for(const source of brief.evidenceSources){if(source.speaker!=="visitor"||!normalized.includes(safeText(source.excerpt)))violations.push("non_visitor_or_missing_evidence");}
  for(const section of SUPPORTS){if(!brief.evidenceSources.some(s=>s.supports.includes(section)))violations.push(`missing_evidence:${section}`);}
  const evidenceNumbers=new Set(normalized.flatMap(numbers));for(const number of numbers(publicText)){if(!evidenceNumbers.has(number))violations.push("invented_number");}
  if(/industry average|market benchmark|competitors? (?:always|typically|usually)|prospects? (?:always|typically|usually)/i.test(publicText))violations.push("unsupported_market_claim");
  if(/you (?:are|seem|feel|became) (?:anxious|afraid|energized|excited|hesitant|confident)|deep down|subconscious/i.test(publicText))violations.push("psychological_claim");
  if(/because of this,? your|this is why your|causes? your/i.test(publicText))violations.push("unsupported_causal_claim");
  const evidencePass=!violations.some(v=>v.startsWith("missing_evidence")||["non_visitor_or_missing_evidence","invented_number","unsupported_market_claim","psychological_claim","unsupported_causal_claim"].includes(v));
  const interpretationPass=brief.whatThatMayMean.length>=20&&brief.whereIWouldBegin.length>=20&&!/improve your messaging|optimize your messaging|enhance your messaging/i.test(publicText)&&brief.whatThatMayMean!==brief.whatIHeard;
  if(!interpretationPass)violations.push("interpretation_is_recap_or_generic");
  const governancePass=!/(?:^|[.!?]\s*)(?:you need to|you must|you should|the solution is|i will represent you as)/i.test(publicText)&&/\?$/.test(brief.alignmentQuestion)&&/(aligned|right|correct)/i.test(brief.alignmentQuestion);
  if(!governancePass)violations.push("governance_or_alignment_failed");
  return{evidence:evidencePass?"pass":"fail",interpretation:interpretationPass?"pass":"fail",governance:governancePass?"pass":"fail",violations:[...new Set(violations)]};
}

export function buildSpeechSafeRepresentationBrief(brief:RepresentationBrief){
  let speech=`${brief.whatIHeard} ${brief.whatStoodOut} ${brief.whatThatMayMean} ${brief.whereIWouldBegin} ${brief.alignmentQuestion}`.replace(/\s+/g," ").trim();
  if(words(speech).length<70)speech=`${brief.whatIHeard} ${brief.whatStoodOut} ${brief.whatThatMayMean} This is a starting interpretation, not a decision about your business. ${brief.whereIWouldBegin} I would keep that direction grounded in what you have actually shared and refine it with you. ${brief.alignmentQuestion}`;
  return words(speech).slice(0,130).join(" ");
}

export function generateRepresentationBrief(input:RepresentationBriefInput):RepresentationBriefResult{
  const evidence=visitorEvidence(input),substantive=evidence.filter(e=>!trivial.test(e.excerpt)&&words(e.excerpt).length>=4);
  if(substantive.length<2||substantive.reduce((n,e)=>n+words(e.excerpt).length,0)<16)return clarification("insufficient_substantive_visitor_evidence");
  const primary=substantive[0],specific=[...substantive].sort((a,b)=>words(b.excerpt).length-words(a.excerpt).length)[0];
  const repeated=substantive.find((item,index)=>index>0&&words(item.excerpt.toLowerCase()).filter(w=>w.length>5).some(w=>primary.excerpt.toLowerCase().includes(w)));
  const whatIHeard=`I heard you describe your business this way: “${primary.excerpt}”`;
  const whatStoodOut=repeated?`You returned to the idea expressed here: “${repeated.excerpt}”`:`The most specific detail you gave was: “${specific.excerpt}”`;
  const whatThatMayMean=repeated?"That suggests this recurring point may be central to how the business should be understood.":"That suggests the specific result or audience you described may offer a clearer starting point than a broad description of the business.";
  const anchor=repeated?.excerpt??specific.excerpt;
  const whereIWouldBegin=`I would begin by making this idea easy to understand in the business representation: “${anchor}”`;
  const refs=evidenceRefs([primary,...(specific.sourceId===primary.sourceId?[]:[specific]),...(repeated&&repeated.sourceId!==specific.sourceId?[repeated]:[])]);
  const draft:RepresentationBrief={whatIHeard,whatStoodOut,whatThatMayMean,whereIWouldBegin,alignmentQuestion:"Is that aligned with how you want your business understood?",confidenceLevel:repeated?"high":"medium",totalWordCount:0,evidenceSources:refs,validation:{evidence:"fail",interpretation:"fail",governance:"fail",violations:[]}};
  draft.totalWordCount=words([whatIHeard,whatStoodOut,whatThatMayMean,whereIWouldBegin,draft.alignmentQuestion].join(" ")).length;
  draft.validation=validateRepresentationBrief(draft,evidence.map(e=>e.excerpt));
  if(Object.values(draft.validation).includes("fail"))return{status:"failed",message:"The interpretation could not be validated safely.",internalReason:draft.validation.violations.join(","),confidenceLevel:"requires_clarification",validation:draft.validation};
  const spokenBrief=buildSpeechSafeRepresentationBrief(draft);
  if(words(spokenBrief).length<70||words(spokenBrief).length>130)return{status:"failed",message:"The interpretation could not be narrated safely.",internalReason:"speech_length_invalid",confidenceLevel:"requires_clarification",validation:draft.validation};
  return{status:"valid",brief:draft,spokenBrief};
}
