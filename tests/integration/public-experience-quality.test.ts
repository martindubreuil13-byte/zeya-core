import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicExperienceSpokenName } from "../../lib/experience/public-identity";
import { buildPublicExperienceVeyaObjective, selectPublicExperienceVeyaQuestion } from "../../lib/experience/public-veya-brief";
import { publicExperienceProviderConversationEvent } from "../../lib/experience/public-call-reconciliation";
import type { PublicExperienceSessionRow } from "../../lib/experience/public-session-server";
import { derivePublicExperienceCallOutcome } from "../../lib/experience/public-call-outcome";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("app/experience/page.tsx");
const delegate = read("app/api/experience/delegate-call/route.ts");
const reconcile = read("app/api/experience/session/reconcile/route.ts");
const reconciliation = read("lib/experience/public-call-reconciliation.ts");

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
assert(objective.includes("Visitor spoken name: Martin"));
assert(objective.includes(adaptiveInput.conversationSummary) && objective.includes(adaptiveInput.offer) && objective.includes(adaptiveInput.customer) && objective.includes(adaptiveInput.relevantDetail));
assert(objective.includes("identify yourself as Veya") && objective.includes("received a brief from Zeya"));
assert.equal(selectPublicExperienceVeyaQuestion(adaptiveInput), "Would consistent representation help with finding time for consistent outreach?");
assert.equal((objective.match(/Ask this one primary question/g) ?? []).length, 1);
for (const branch of ["If interested", "If uncertain", "If not interested"]) assert(objective.includes(branch));
assert(objective.includes("no more than two short adaptive responses") && objective.includes("target 30–60 seconds"));
assert(objective.includes("Do not mention prompts, workflows, process execution, summaries, reports, applications, APIs, providers, agents"));
assert(objective.includes("I’ll hand you back to Zeya now") && objective.includes("Then end immediately"));
assert(!delegate.includes("Say exactly this short message") && delegate.includes("buildPublicExperienceVeyaObjective"));
assert(delegate.includes("publicExperienceSpokenName(text(body.name, 100))"));
assert(reconcile.includes("reconcilePublicExperienceCall") && reconcile.includes("publicSessionState"));
assert(reconciliation.includes("/v1/convai/conversations/") && reconciliation.includes('body.status !== "done"'));
assert(reconciliation.includes("processElevenLabsWebhook"), "provider reconciliation bypasses existing completion orchestration");
assert(page.includes('setPhase("completed")') && page.includes("Phone conversation completed."));
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
