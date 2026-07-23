import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicExperienceSpokenName } from "../../lib/experience/public-identity";
import { buildPublicExperienceVeyaObjective, planPublicExperienceVeyaConversation, selectPublicExperienceVeyaQuestion } from "../../lib/experience/public-veya-brief";
import { publicExperienceProviderConversationEvent } from "../../lib/experience/public-call-reconciliation";
import type { PublicExperienceSessionRow } from "../../lib/experience/public-session-server";
import { derivePublicExperienceCallOutcome } from "../../lib/experience/public-call-outcome";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("app/experience/page.tsx");
const delegate = read("app/api/experience/delegate-call/route.ts");
const reconcile = read("app/api/experience/session/reconcile/route.ts");
const reconciliation = read("lib/experience/public-call-reconciliation.ts");
const dispatcher = read("lib/workers/worker-dispatcher.ts");
const elevenLabsProvider = read("lib/providers/elevenlabs-provider.ts");

assert.equal(publicExperienceSpokenName("M-A-R-T-I-N"), "Martin");
assert.equal(publicExperienceSpokenName("M A R T I N"), "Martin");
assert.equal(publicExperienceSpokenName("Martin Lee"), "Martin Lee");
const adaptiveInput = {
  name: publicExperienceSpokenName("M-A-R-T-I-N"),
  conversationSummary: "Martin is building an operations service for restaurants.",
  offer: "an operations service",
  customer: "restaurant owners",
  relevantDetail: "finding time for consistent outreach",
};
const objective = buildPublicExperienceVeyaObjective(adaptiveInput);
const plan = planPublicExperienceVeyaConversation(adaptiveInput);
assert(objective.includes("concise commercial-evidence conversation with Martin"));
assert(objective.includes("Martin is building an operations service for restaurants") && objective.includes(adaptiveInput.offer) && objective.includes(adaptiveInput.customer) && objective.includes(adaptiveInput.relevantDetail));
for (const label of ["Visitor spoken name:", "Zeya conversation:", "Objective:", "Call shape:"]) assert(!objective.includes(label));
assert.equal(selectPublicExperienceVeyaQuestion(adaptiveInput), "Right now, how do restaurant owners typically find you or decide to work with you?");
assert.equal(plan.coreQuestions.length, 3);
assert(objective.includes("at most one meaningful adaptive follow-up") && objective.includes("45–90 seconds"));
assert(objective.includes("Never recite these directions") && objective.includes("prompts, workflows, process execution, summaries, reports, applications, APIs, providers, agents"));
assert(objective.includes("returning the conversation to Zeya") && objective.includes("end the call"));
assert.equal(plan.privateGuidance, objective);
assert.equal(plan.spokenHandoffContext, "the brief Zeya prepared after your conversation about an operations service");
for (const leaked of ["Visitor spoken name:", "Zeya conversation:", "Objective:", "Call shape:", "M-A-R-T-I-N", "Martin"]) {
  assert(!plan.spokenHandoffContext.includes(leaked), `speech-safe plan leaked ${leaked}`);
}
assert(!delegate.includes("Say exactly this short message") && delegate.includes("planPublicExperienceVeyaConversation"));
assert(delegate.includes("missionObjective: conversationPlan.opening"));
assert(dispatcher.includes("brief.dynamicVariables.missionObjective"), "planner opening is not carried to the provider boundary");
assert(elevenLabsProvider.includes("request.dynamicVariables.missionObjective ?? request.objective"), "provider overwrites the speech-safe first-message value");
assert(delegate.includes("publicExperienceSpokenName(text(body.name, 100))"));
assert(reconcile.includes("reconcilePublicExperienceCall") && reconcile.includes("publicSessionState"));
assert(reconciliation.includes("/v1/convai/conversations/") && reconciliation.includes('body.status !== "done"'));
assert(reconciliation.includes("processElevenLabsWebhook"), "provider reconciliation bypasses existing completion orchestration");
assert(reconciliation.includes("processElevenLabsWebhook(event)"), "reconciliation does not use the processor's valid SHA-256 hashing path");
assert(!reconciliation.includes("processElevenLabsWebhook(event, `provider_status_reconciliation"), "event key is incorrectly reused as a payload hash");
for (const diagnostic of ['"[reconcile]"', '"[completion]"', "providerStatus", "normalized", "processorSucceeded", "sessionUpdated"]) {
  assert(reconciliation.includes(diagnostic) || reconcile.includes(diagnostic), `missing safe completion diagnostic ${diagnostic}`);
}
assert(page.includes('setPhase("completed")') && page.includes("Phone conversation completed."));
assert(page.includes('"[browser]"') && page.includes('reflection_ready: true') && page.includes('transition: "brief_review"'));
assert(page.includes("One conversation became two.") && page.includes("Learn more"));
assert(page.includes('method:"POST"') && page.includes("window.setTimeout(poll,1500)"));
assert(!page.includes("My Call Is Complete"), "completion still requires visitor action");
const sanitize = (value: unknown) => typeof value === "string" ? value : "";
assert.equal(derivePublicExperienceCallOutcome([{ role: "customer", text: "Yes, that would be useful." }], sanitize).visitorInterest, "interested");
assert.equal(derivePublicExperienceCallOutcome([{ role: "customer", text: "I am not sure yet." }], sanitize).visitorInterest, "uncertain");
assert.equal(derivePublicExperienceCallOutcome([{ role: "customer", text: "No thanks, not interested." }], sanitize).visitorInterest, "not_interested");
assert(page.includes("callOutcome?.visitorInterest") && page.includes("relevantVisitorResponse"), "browser completion ignores structured call outcome");
const completionEvent = publicExperienceProviderConversationEvent({
  state: "call_active", provider_conversation_id: "conv_test", provider_call_id: "call_test",
} as PublicExperienceSessionRow, {
  status: "done", conversation_id: "conv_test", agent_id: "agent_test",
  metadata: { start_time_unix_secs: 100, call_duration_secs: 25 },
  transcript: [{ role: "agent", message: "Have a wonderful day.", time_in_call_secs: 24 }],
});
assert(completionEvent && completionEvent.outcome === "completed" && completionEvent.durationSeconds === 25);
assert.equal(completionEvent.transcript[0]?.timestamp, 24_000);
assert.equal(publicExperienceProviderConversationEvent({ state: "call_active", provider_conversation_id: "conv_test", provider_call_id: "call_test" } as PublicExperienceSessionRow, { status: "processing", conversation_id: "conv_test", agent_id: "agent_test" }), null);

console.log("Public Experience quality loop — PASS");
