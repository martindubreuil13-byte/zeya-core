import {describe,expect,it} from "vitest";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {
  buildGovernedCommercialOpening,buildSpeechSafeAuthorityGuidance,commercialConversationPolicyGuidance,
  COMMERCIAL_CONVERSATION_POLICY,dispatchedWorkerIdentityMatches,GOVERNED_COMMERCIAL_CAPABILITIES,
  GOVERNED_PROSPECT_CONVERSATION_MODE,projectGovernedProviderVariables,resolveDispatchedWorkerIdentity,
} from "../../lib/work/commercial-conversation-policy";

const root=(path:string)=>readFileSync(resolve(process.cwd(),path),"utf8");
const env=(name:string):NodeJS.ProcessEnv=>({NODE_ENV:"test",GOVERNED_OUTBOUND_WORKER_SPOKEN_NAME:name,NEXT_PUBLIC_ELEVENLABS_AGENT_ID:"agent-1",ELEVENLABS_AGENT_BRANCH_ID:"branch-1"});

describe("P2.9D governed commercial conversation policy",()=>{
  it("resolves the spoken worker identity from trusted deployment configuration",()=>{
    expect(resolveDispatchedWorkerIdentity(env("Mara"))).toEqual({schemaVersion:"dispatched-worker-identity-v1",workerRole:"outbound_business_development_caller",spokenName:"Mara",provider:"elevenlabs",providerAgentIdentity:"agent-1",providerBranchIdentity:"branch-1"});
    expect(resolveDispatchedWorkerIdentity(env("Nina")).spokenName).toBe("Nina");
  });
  it("fails closed when any identity source is missing or the spoken name is unsafe",()=>{
    expect(()=>resolveDispatchedWorkerIdentity({NODE_ENV:"test"})).toThrow("governed worker identity unavailable");
    expect(()=>resolveDispatchedWorkerIdentity(env("{{opening}}"))).toThrow();
  });
  it("compares the complete frozen provider identity, not only its spoken name",()=>{
    const frozen=resolveDispatchedWorkerIdentity(env("Mara"));
    expect(dispatchedWorkerIdentityMatches(frozen,{...frozen,providerBranchIdentity:"branch-2"})).toBe(false);
  });
  it("builds one cold opening from approved business and target context",()=>{
    const opening=buildGovernedCommercialOpening({spokenName:"Mara",prospectName:"Alex",offer:"business coaching.",audience:"startups.",relationshipState:"first_contact",priorPain:null,callbackRequested:false});
    expect(opening).toContain("this is Mara");expect(opening).toContain("business coaching");expect(opening).toContain("startups");expect(opening.match(/this is/gi)).toHaveLength(1);
  });
  it("builds a follow-up opening that demonstrates preparation without claiming scheduling",()=>{
    const opening=buildGovernedCommercialOpening({spokenName:"Mara",prospectName:"Alex",offer:"coaching",audience:"startups",relationshipState:"follow_up",priorPain:"The prospect reported difficulty getting investor attention.",callbackRequested:true});
    expect(opening).toContain("difficulty getting investor attention");expect(opening).toContain("asked us to reconnect");expect(opening).not.toMatch(/booked|scheduled|calendar/i);
  });
  it("keeps qualification instructions private from the opening",()=>{
    const opening=buildGovernedCommercialOpening({spokenName:"Mara",prospectName:"Alex",offer:"coaching",audience:"startups",relationshipState:"first_contact",priorPain:null,callbackRequested:false});
    expect(opening).not.toMatch(/qualif|threshold|authority|mandate/i);
  });
  it("defines commercial role and disciplined progression deterministically",()=>{
    expect(COMMERCIAL_CONVERSATION_POLICY).toMatchObject({schemaVersion:"commercial-conversation-policy-v1",role:"business_representative",progression:["relevance","diagnosis","interpretation","qualification","next_step"]});
    const guidance=commercialConversationPolicyGuidance();expect(guidance).toContain("external prospect");expect(guidance).toContain("never as an owner-onboarding interviewer");expect(guidance).toContain("Do not introduce yourself again");
  });
  it("requires interpretation before another diagnostic question and prohibits questionnaires",()=>{
    const guidance=commercialConversationPolicyGuidance();expect(guidance).toContain("Acknowledge or interpret");expect(guidance).toContain("Never use a generic questionnaire");expect(guidance).toContain("one discriminating question");
  });
  it("makes uncertainty dominant and repetition non-confirming",()=>{
    const guidance=commercialConversationPolicyGuidance();expect(guidance).toContain("Unclear speech remains uncertain");expect(guidance).toContain("never treat your repetition as confirmation");expect(guidance).toContain("clarify once only if material");
  });
  it("forbids false action claims and stops discovery under time pressure",()=>{
    const guidance=commercialConversationPolicyGuidance();expect(guidance).toContain("signals time pressure, stop discovery");expect(guidance).toContain("unless a governed tool actually completed");
    expect(GOVERNED_COMMERCIAL_CAPABILITIES).toEqual(expect.objectContaining({scheduling:false,email:false,reminders:false}));
  });
  it("projects a strict provider-safe allowlist",()=>{
    const projected=projectGovernedProviderVariables({spokenWorkerIdentity:"Mara",conversationMode:GOVERNED_PROSPECT_CONVERSATION_MODE,opening:"hello",missionObjective:"objective",qualificationGoal:"goal",desiredNextStep:"step",relationshipState:"follow_up",prospectContext:"context",authority:"safe",capabilities:"none",conversationPolicy:"policy",businessRepresentationId:"secret",canonicalVersionId:"secret",rawProspectMemory:"secret",providerAgentIdentity:"secret"});
    expect(Object.keys(projected)).toEqual(["spokenWorkerIdentity","conversationMode","opening","missionObjective","qualificationGoal","desiredNextStep","relationshipState","prospectContext","authority","capabilities","conversationPolicy"]);
    expect(JSON.stringify(projected)).not.toContain("secret");
  });
  it("turns authority into prospect-safe behavioral guidance",()=>{
    const guidance=buildSpeechSafeAuthorityGuidance({pricing:{disposition:"owner_approval_required"},discounts:{disposition:"owner_approval_required"},negotiation:{disposition:"prohibited"},commitments:{disposition:"prohibited"},meetingBooking:{disposition:"allowed_within_bounds"}});
    expect(guidance).toContain("Do not quote or change pricing");expect(guidance).toContain("Do not negotiate");expect(guidance).not.toMatch(/disposition|mandate|owner_approval_required/);
  });
  it("freezes V3 identity, policy, capabilities, and opening contract into immutable lineage",()=>{
    const sql=root("supabase/migrations/20260825000000_p29d_commercial_conversation_policy.sql");
    for(const marker of ["zeya_prepare_governed_dispatch_v3","'governed-worker-brief-v3'","'worker',p_worker","'conversationPolicy',p_conversation_policy","'capabilities',p_capabilities","'openingContract',p_opening_contract","'worker',p_worker,'conversationPolicy'"])expect(sql).toContain(marker);
    expect(sql).toContain("'prospect',jsonb_build_object('identity',c.context->'target','context',c.context->'prospectContext')");
  });
  it("retains V1/V2 functions and adds no new durable entity",()=>{
    const sql=root("supabase/migrations/20260825000000_p29d_commercial_conversation_policy.sql");
    expect(sql).not.toMatch(/DROP FUNCTION|CREATE TABLE|ALTER TABLE|UPDATE public\.|DELETE FROM public\./i);
    expect(root("supabase/migrations/20260820000000_p25_governed_dispatch_preparation.sql")).toContain("zeya_prepare_governed_dispatch");
    expect(root("supabase/migrations/20260824000000_p29c_prospect_context_consumption.sql")).toContain("zeya_prepare_governed_dispatch_v2");
  });
  it("derives V3 configuration server-side and accepts no client override",()=>{
    const route=root("app/api/work/missions/[missionId]/dispatch/route.ts");
    expect(route).toContain("resolveDispatchedWorkerIdentity()");expect(route).toContain("zeya_prepare_governed_dispatch_v3");expect(route).not.toMatch(/body\.(?:worker|spokenName|conversationPolicy|capabilities|opening)/);
  });
  it("checks identity freshness before authorization and before claim consumption",()=>{
    const authorize=root("app/api/work/dispatches/[dispatchId]/authorize/route.ts"),execute=root("lib/work/governed-voice-execution.ts");
    expect(authorize.indexOf("dispatchedWorkerIdentityMatches")).toBeLessThan(authorize.indexOf("zeya_authorize_governed_execution"));
    expect(execute.indexOf("dispatchedWorkerIdentityMatches(frozenWorker")).toBeLessThan(execute.indexOf("zeya_claim_governed_execution"));
  });
  it("uses the frozen spoken identity and has no governed hardcoded persona",()=>{
    const execute=root("lib/work/governed-voice-execution.ts");
    expect(execute).toContain("workerName:frozenWorker?.spokenName");expect(execute).not.toMatch(/workerName:\s*['\"](?:Veya|Zeya|Mara|Nina)['\"]/);
  });
  it("projects P2.9C memory as prospect context without changing source hierarchy",()=>{
    const execute=root("lib/work/governed-voice-execution.ts"),dispatcher=root("lib/workers/worker-dispatcher.ts");
    expect(execute).toContain("buildSpeechSafeProspectContext");expect(dispatcher).toContain("authorizedBusinessContext");expect(execute).not.toContain("getProspectMemory");
  });
  it("keeps internal lineage identifiers out of the governed provider boundary",()=>{
    const dispatcher=root("lib/workers/worker-dispatcher.ts");
    const block=dispatcher.slice(dispatcher.indexOf("const providerVariables"),dispatcher.indexOf("if (voiceContext && voiceContextId"));
    expect(block).toContain("projectGovernedProviderVariables");expect(block).not.toContain("businessRepresentationId");expect(block).not.toContain("canonicalVersionId");
  });
  it("uses a single provider-owned opening variable with a Public Experience fallback",()=>{
    const provider=root("lib/providers/elevenlabs-provider.ts");
    expect(provider).toContain("opening: request.dynamicVariables.opening ?? request.dynamicVariables.missionObjective");expect(provider).not.toContain("objective: request.objective");
  });
  it("does not add model, provider-call, canonical, authority, or learning mutations",()=>{
    const sources=[root("lib/work/commercial-conversation-policy.ts"),root("supabase/migrations/20260825000000_p29d_commercial_conversation_policy.sql")].join("\n");
    expect(sources).not.toMatch(/OpenAI|chat\.completions|responses\.create|outbound-call|INSERT INTO public\.(?:evidence|observations|representation_versions|conversation_learning|prospect_observations)/i);
  });
  it("resolves the currently configured worker name without embedding it in policy",()=>{
    expect(resolveDispatchedWorkerIdentity(env("Veya")).spokenName).toBe("Veya");
    expect(commercialConversationPolicyGuidance()).not.toContain("Veya");
  });
  it("does not make the orchestrator the worker unless configuration selects it",()=>{
    expect(resolveDispatchedWorkerIdentity(env("Mara")).spokenName).not.toBe("Zeya");
  });
  it("keeps internal orchestration hierarchy out of spoken fields",()=>{
    const opening=buildGovernedCommercialOpening({spokenName:"Mara",prospectName:"Alex",offer:"coaching",audience:"startups",relationshipState:"follow_up",priorPain:"investor access was difficult",callbackRequested:true});
    expect(opening).not.toMatch(/orchestrat|worker brief|dispatch|provider|agent id/i);
  });
  it("keeps representation, mission, prospect, authority, capability, and policy as separate V3 sections",()=>{
    const sql=root("supabase/migrations/20260825000000_p29d_commercial_conversation_policy.sql");
    for(const section of ["'business'","'prospect'","'mission'","'authority'","'capabilities'","'conversationPolicy'"])expect(sql).toContain(section);
  });
  it("keeps uncertain prospect state as private clarification guidance",()=>{
    const execution=root("lib/work/governed-voice-execution.ts"),policy=commercialConversationPolicyGuidance();
    expect(execution).toContain("buildSpeechSafeProspectContext");expect(policy).toContain("clarify once");expect(policy).toContain("leave it unresolved");
  });
  it("keeps the provider adapter transport-only",()=>{
    const provider=root("lib/providers/elevenlabs-provider.ts");
    expect(provider).not.toMatch(/qualification|prospectContext|questionnaire|owner-onboarding|pricing|discount|negotiate/i);
  });
  it("gives Public Experience an explicit non-commercial mode without changing its plan",()=>{
    const route=root("app/api/experience/delegate-call/route.ts"),plan=root("lib/experience/public-veya-brief.ts");
    expect(route).toContain('conversationMode: "public_experience_owner_interview"');expect(route).toContain("opening: conversationPlan.opening");
    expect(plan).toContain("planPublicExperienceVeyaConversation");expect(plan).not.toContain(GOVERNED_PROSPECT_CONVERSATION_MODE);
  });
  it("preserves configured first-message ownership for both isolated modes",()=>{
    const provider=root("lib/providers/elevenlabs-provider.ts"),dispatcher=root("lib/workers/worker-dispatcher.ts");
    expect(provider).toContain("opening:");expect(dispatcher).toContain("projectGovernedProviderVariables");expect(dispatcher).toContain("brief.dynamicVariables.conversationMode");
  });
  it("contains no test path capable of calling OpenAI or ElevenLabs",()=>{
    const test=root("tests/integration/p2-9d-commercial-conversation-policy.test.ts"),imports=test.slice(0,test.indexOf('describe('));
    expect(imports).not.toContain('from "../../lib/providers');expect(imports).not.toContain('from "openai"');expect(imports).not.toContain("ELEVENLABS_API_KEY");
  });
});
