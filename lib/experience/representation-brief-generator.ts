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
export type RepresentationBriefDebugInspection={
  conversationLength:number;visitorUtterances:number;zeyaUtterances:number;veyaUtterances:number;
  evidenceItems:string[];substantiveEvidenceItems:number;substantiveWordCount:number;
  contrastsFound:number;repeatedThemes:string[];
};
export type RepresentationBriefGenerationTiming={validationMs:number};

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

export function inspectRepresentationBriefInput(input:RepresentationBriefInput):RepresentationBriefDebugInspection{
  const evidence=visitorEvidence(input),substantive=evidence.filter(e=>!trivial.test(e.excerpt)&&words(e.excerpt).length>=4);
  const tokens=substantive.map(item=>new Set(words(item.excerpt.toLowerCase()).filter(word=>word.length>5)));
  const repeatedThemes=[...new Set(tokens.flatMap((current,index)=>index===0?[]:[...current].filter(word=>tokens.slice(0,index).some(previous=>previous.has(word)))))];
  const contrastsFound=evidence.filter(item=>/\b(?:but|however|instead|actually|rather|although|yet)\b/i.test(item.excerpt)).length;
  return{
    conversationLength:input.zeyaTranscript.length+input.veyaTranscript.length,
    visitorUtterances:evidence.length,
    zeyaUtterances:input.zeyaTranscript.length,
    veyaUtterances:input.veyaTranscript.length,
    evidenceItems:evidence.map(item=>item.excerpt),
    substantiveEvidenceItems:substantive.length,
    substantiveWordCount:substantive.reduce((total,item)=>total+words(item.excerpt).length,0),
    contrastsFound,repeatedThemes,
  };
}

export function validateRepresentationBrief(brief:RepresentationBrief,visitorExcerpts:string[]):RepresentationBriefValidation{
  const violations:string[]=[];const publicText=[brief.whatIHeard,brief.whatStoodOut,brief.whatThatMayMean,brief.whereIWouldBegin].join(" ");
  const normalized=visitorExcerpts.map(x=>safeText(x));
  for(const source of brief.evidenceSources){if(source.speaker!=="visitor"||!normalized.includes(safeText(source.excerpt)))violations.push("non_visitor_or_missing_evidence");}
  // Relaxed: only require evidence for the primary sections (not all four)
  const primarySections:typeof SUPPORTS[number][]=["what_i_heard","what_that_may_mean","where_i_would_begin"];
  for(const section of primarySections){if(!brief.evidenceSources.some(s=>s.supports.includes(section)))violations.push(`missing_evidence:${section}`);}
  const evidenceNumbers=new Set(normalized.flatMap(numbers));for(const number of numbers(publicText)){if(!evidenceNumbers.has(number))violations.push("invented_number");}
  if(/industry average|market benchmark|competitors? (?:always|typically|usually)|prospects? (?:always|typically|usually)/i.test(publicText))violations.push("unsupported_market_claim");
  if(/you (?:are|seem|feel|became) (?:anxious|afraid|energized|excited|hesitant|confident)|deep down|subconscious/i.test(publicText))violations.push("psychological_claim");
  if(/because of this,? your|this is why your|causes? your/i.test(publicText))violations.push("unsupported_causal_claim");
  const evidencePass=!violations.some(v=>v.startsWith("missing_evidence")||["non_visitor_or_missing_evidence","invented_number","unsupported_market_claim","psychological_claim","unsupported_causal_claim"].includes(v));
  // Relaxed: require 12+ characters instead of 20; sections must be distinct and not generic
  const interpretationPass=brief.whatThatMayMean.length>=12&&brief.whereIWouldBegin.length>=12&&!/improve your messaging|optimize your messaging|enhance your messaging/i.test(publicText)&&brief.whatThatMayMean!==brief.whatIHeard;
  if(!interpretationPass)violations.push("interpretation_is_recap_or_generic");
  const governancePass=!/(?:^|[.!?]\s*)(?:you need to|you must|you should|the solution is|i will represent you as)/i.test(publicText)&&/\?$/.test(brief.alignmentQuestion)&&/(aligned|right|correct)/i.test(brief.alignmentQuestion);
  if(!governancePass)violations.push("governance_or_alignment_failed");
  return{evidence:evidencePass?"pass":"fail",interpretation:interpretationPass?"pass":"fail",governance:governancePass?"pass":"fail",violations:[...new Set(violations)]};
}

export function buildSpeechSafeRepresentationBrief(brief:RepresentationBrief){
  let speech=`${brief.whatIHeard} ${brief.whatStoodOut} ${brief.whatThatMayMean} ${brief.whereIWouldBegin} ${brief.alignmentQuestion}`.replace(/\s+/g," ").trim();
  // Relaxed: only add expansion if significantly under 50 words (was 70)
  if(words(speech).length<50)speech=`${brief.whatIHeard} ${brief.whatStoodOut} ${brief.whatThatMayMean} This is a starting interpretation, not a decision about your business. ${brief.whereIWouldBegin} I would keep that direction grounded in what you have actually shared and refine it with you. ${brief.alignmentQuestion}`;
  // Relaxed: allow 50-140 word range (was 70-130)
  return words(speech).slice(0,140).join(" ");
}

export function generateRepresentationBrief(input:RepresentationBriefInput,onTiming?:(timing:RepresentationBriefGenerationTiming)=>void):RepresentationBriefResult{
  const evidence=visitorEvidence(input),substantive=evidence.filter(e=>!trivial.test(e.excerpt)&&words(e.excerpt).length>=4);
  // Require at least 1 substantive evidence item with 8+ words OR 2 items with 4+ words each.
  // This allows generating a brief from sparse but meaningful evidence.
  const sufficientEvidence=substantive.length>=1&&(substantive[0].excerpt.split(/\s+/).length>=8||substantive.length>=2);
  if(!sufficientEvidence){onTiming?.({validationMs:0});return clarification("insufficient_substantive_visitor_evidence");}
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
  const validationStarted=performance.now();
  draft.validation=validateRepresentationBrief(draft,evidence.map(e=>e.excerpt));
  onTiming?.({validationMs:Math.round((performance.now()-validationStarted)*1000)/1000});
  if(Object.values(draft.validation).includes("fail"))return{status:"failed",message:"The interpretation could not be validated safely.",internalReason:draft.validation.violations.join(","),confidenceLevel:"requires_clarification",validation:draft.validation};
  const spokenBrief=buildSpeechSafeRepresentationBrief(draft);
  if(words(spokenBrief).length<70||words(spokenBrief).length>130)return{status:"failed",message:"The interpretation could not be narrated safely.",internalReason:"speech_length_invalid",confidenceLevel:"requires_clarification",validation:draft.validation};
  return{status:"valid",brief:draft,spokenBrief};
}
