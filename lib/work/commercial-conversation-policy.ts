export const COMMERCIAL_CONVERSATION_POLICY_V1="commercial-conversation-policy-v1" as const;
export const GOVERNED_COMMERCIAL_OPENING_V1="governed-commercial-opening-v1" as const;
export const GOVERNED_PROSPECT_CONVERSATION_MODE="governed_prospect_commercial" as const;

export type DispatchedWorkerIdentityV1={
  schemaVersion:"dispatched-worker-identity-v1";
  workerRole:"outbound_business_development_caller";
  spokenName:string;
  provider:"elevenlabs";
  providerAgentIdentity:string;
  providerBranchIdentity:string;
};
export type CommercialConversationPolicyV1={
  schemaVersion:typeof COMMERCIAL_CONVERSATION_POLICY_V1;role:"business_representative";
  opening:{owner:"provider_first_message";introductionAlreadySpoken:true;stateRelevantReasonForCall:true};
  interaction:{demonstratePreparation:true;prohibitOwnerOnboardingQuestions:true;interpretBeforeNextQuestion:true;avoidQuestionnairePattern:true;qualifySelectively:true};
  epistemics:{prospectClaimsRemainAttributed:true;uncertainSpeechRemainsUncertain:true;agentRepetitionIsNotConfirmation:true};
  actions:{claimOnlyCompletedToolActions:true};
  progression:["relevance","diagnosis","interpretation","qualification","next_step"];
};
export type GovernedCommercialCapabilitiesV1={schemaVersion:"governed-commercial-capabilities-v1";scheduling:false;email:false;reminders:false};
export type GovernedCommercialOpeningContractV1={schemaVersion:typeof GOVERNED_COMMERCIAL_OPENING_V1;owner:"provider_first_message";variable:"opening";introductionAlreadySpoken:true};

export const COMMERCIAL_CONVERSATION_POLICY:CommercialConversationPolicyV1={schemaVersion:COMMERCIAL_CONVERSATION_POLICY_V1,role:"business_representative",opening:{owner:"provider_first_message",introductionAlreadySpoken:true,stateRelevantReasonForCall:true},interaction:{demonstratePreparation:true,prohibitOwnerOnboardingQuestions:true,interpretBeforeNextQuestion:true,avoidQuestionnairePattern:true,qualifySelectively:true},epistemics:{prospectClaimsRemainAttributed:true,uncertainSpeechRemainsUncertain:true,agentRepetitionIsNotConfirmation:true},actions:{claimOnlyCompletedToolActions:true},progression:["relevance","diagnosis","interpretation","qualification","next_step"]};
export const GOVERNED_COMMERCIAL_CAPABILITIES:GovernedCommercialCapabilitiesV1={schemaVersion:"governed-commercial-capabilities-v1",scheduling:false,email:false,reminders:false};
export const GOVERNED_COMMERCIAL_OPENING_CONTRACT:GovernedCommercialOpeningContractV1={schemaVersion:GOVERNED_COMMERCIAL_OPENING_V1,owner:"provider_first_message",variable:"opening",introductionAlreadySpoken:true};

export class WorkerIdentityUnavailableError extends Error{constructor(){super("governed worker identity unavailable");}}
export function resolveDispatchedWorkerIdentity(env:NodeJS.ProcessEnv=process.env):DispatchedWorkerIdentityV1{
  const spokenName=env.GOVERNED_OUTBOUND_WORKER_SPOKEN_NAME?.trim(),agent=env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID?.trim(),branch=env.ELEVENLABS_AGENT_BRANCH_ID?.trim();
  if(!spokenName||spokenName.length>60||!/^[\p{L}][\p{L}\p{M}' .-]*$/u.test(spokenName)||!agent||!branch)throw new WorkerIdentityUnavailableError();
  return {schemaVersion:"dispatched-worker-identity-v1",workerRole:"outbound_business_development_caller",spokenName,provider:"elevenlabs",providerAgentIdentity:agent,providerBranchIdentity:branch};
}

export function parseDispatchedWorkerIdentity(value:unknown):DispatchedWorkerIdentityV1|null{
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const worker=value as Record<string,unknown>;
  if(worker.schemaVersion!=="dispatched-worker-identity-v1"||worker.workerRole!=="outbound_business_development_caller"||worker.provider!=="elevenlabs"
    ||typeof worker.spokenName!=="string"||typeof worker.providerAgentIdentity!=="string"||typeof worker.providerBranchIdentity!=="string")return null;
  return worker as DispatchedWorkerIdentityV1;
}

export function dispatchedWorkerIdentityMatches(left:DispatchedWorkerIdentityV1,right:DispatchedWorkerIdentityV1):boolean{
  return left.schemaVersion===right.schemaVersion&&left.workerRole===right.workerRole&&left.spokenName===right.spokenName&&left.provider===right.provider
    &&left.providerAgentIdentity===right.providerAgentIdentity&&left.providerBranchIdentity===right.providerBranchIdentity;
}

type OpeningInput={spokenName:string;prospectName:string;offer:string;audience:string;relationshipState:"first_contact"|"follow_up";priorPain:string|null;callbackRequested:boolean};
export function buildGovernedCommercialOpening(input:OpeningInput):string{
  const greeting=`Hi ${input.prospectName||"there"}, this is ${input.spokenName}.`;
  if(input.relationshipState==="follow_up"){
    const history=input.priorPain?` Last time we spoke, you mentioned ${input.priorPain.replace(/[.\s]+$/g,"").replace(/^the prospect (?:reported|said) /i,"")}.`:" We spoke previously.";
    const callback=input.callbackRequested?" You had asked us to reconnect.":"";
    return `${greeting}${history}${callback}`;
  }
  return `${greeting} I'm calling because we work with ${input.audience.replace(/[.\s]+$/g,"")} through ${input.offer.replace(/[.\s]+$/g,"")}, and I wanted to see whether that could be relevant to your current priorities.`;
}

export function commercialConversationPolicyGuidance():string{return [
  "Act as the dispatched business representative speaking with an external prospect, never as an owner-onboarding interviewer.",
  "The configured first message is the complete opening. Do not introduce yourself again; continue from the prospect's response.",
  "Demonstrate preparation using only the approved business context. Never ask the prospect to reconstruct what the represented business sells, serves, offers, or wants to accomplish.",
  "Every diagnostic question must serve the mission or resolve material uncertainty. Acknowledge or interpret a substantive answer before another diagnostic question. Never use a generic questionnaire pattern or mechanically end every response with a question.",
  "Qualify selectively: form a tentative relevance hypothesis, ask one discriminating question when needed, then progress toward or away from the desired next step.",
  "Prospect statements remain attributed. Unclear speech remains uncertain: clarify once only if material, never elaborate it, never build later reasoning on it, and never treat your repetition as confirmation. If clarification fails, move on and leave it unresolved.",
  "If the prospect signals time pressure, stop discovery. Never claim scheduling, email, reminders, or follow-up happened unless a governed tool actually completed that action.",
].join("\n")}

export function buildSpeechSafeAuthorityGuidance(authority:Record<string,unknown>):string{
  const disposition=(key:string)=>{
    const value=authority[key];
    return value&&typeof value==="object"&&!Array.isArray(value)&&typeof (value as Record<string,unknown>).disposition==="string"
      ?(value as Record<string,unknown>).disposition as string:"unresolved";
  };
  const guidance=[
    disposition("pricing")==="owner_approval_required"?"Do not quote or change pricing; say that pricing needs confirmation.":null,
    disposition("discounts")==="owner_approval_required"?"Do not offer discounts; say that any discount needs confirmation.":null,
    disposition("negotiation")==="prohibited"?"Do not negotiate commercial terms.":null,
    disposition("commitments")==="prohibited"?"Do not make binding commitments or promises.":null,
    disposition("meetingBooking")==="allowed_within_bounds"?"You may discuss a meeting as a next step, but do not say it is booked unless scheduling actually completes.":null,
    "If permission is unclear, do not take or claim the action; offer to have the appropriate person follow up.",
  ];
  return guidance.filter((value):value is string=>Boolean(value)).join(" ");
}

const GOVERNED_PROVIDER_VARIABLE_ALLOWLIST=["spokenWorkerIdentity","conversationMode","opening","missionObjective","qualificationGoal","desiredNextStep","relationshipState","prospectContext","authority","capabilities","conversationPolicy"] as const;
export function projectGovernedProviderVariables(values:Record<string,string|number|boolean|null>):Record<string,string|number|boolean|null>{
  return Object.fromEntries(GOVERNED_PROVIDER_VARIABLE_ALLOWLIST.flatMap(key=>key in values?[[key,values[key]]]:[]));
}
