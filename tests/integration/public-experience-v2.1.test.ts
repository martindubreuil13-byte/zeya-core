import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildPublicExperienceVeyaObjective, planPublicExperienceVeyaConversation, VEYA_COMPLETION_CLOSE } from "../../lib/experience/public-veya-brief";
import { normalizeTranscriptText } from "../../lib/experience/transcript-normalization";
import { buildExperienceTestRecord, experienceTestRecordHtml } from "../../lib/experience/test-record";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const fixture = JSON.parse(read("tests/fixtures/public-experience-v2.1-real-call.json"));
const input = { name: "Martin", conversationSummary: "Martin provides business coaching.", offer: "business coaching", customer: "entrepreneurs", relevantDetail: "consistent prospect conversations" };
const plan = planPublicExperienceVeyaConversation(input);
const objective = buildPublicExperienceVeyaObjective(input);

assert.equal((plan.opening.match(/This is Veya/g) ?? []).length, 1, "opening must introduce Veya once");
assert.equal(plan.coreQuestions.length, 3);
assert(objective.includes("at most one meaningful adaptive follow-up"));
assert.equal(plan.closing, VEYA_COMPLETION_CLOSE);
assert(!plan.closing.includes("?"));
for (const forbidden of ["Can I help you with anything else", "Is there anything more", "Do you have any questions", "Have a great day"]) {
  assert(!objective.slice(objective.indexOf("COMPLETION STATE")).includes(`Say: ${forbidden}`));
  assert(!plan.closing.includes(forbidden));
}
assert(objective.includes("Immediately end the call") && objective.includes("Do not use tools"));

const malformed = fixture.turns[1].message;
const normalized = normalizeTranscriptText(malformed);
assert.equal(normalized.raw, malformed);
assert.equal(normalized.normalized, "That I suggest probably increase my business. Definitely more clients.");
assert(normalized.ambiguous, "uncertain ASR meaning must be flagged");
for (const [before, after] of [
  ["I, I help um founders", "I help founders."],
  ["we we make teams faster", "We make teams faster."],
  ["probably something for clients", "Probably something for clients."],
  ["That that works", "That works."]
]) assert.equal(normalizeTranscriptText(before).normalized, after);

const record = buildExperienceTestRecord({
  session: { id: "00000000-0000-4000-8000-000000000001", tenant_user_id: "owner", canonical_version_id: "v1", state: "reflection_ready", created_at: "2026-07-23T00:00:00Z", call_completed_at: "2026-07-23T00:01:36Z", provider_conversation_id: "fixture" },
  zeyaOutput: { transcript: [] },
  veyaOutput: { completed_at: "2026-07-23T00:01:36Z", transcript: fixture.turns.map((turn: { role: string; message: string; timeInCallSeconds: number; llmLatencyMs?: number }) => ({ role: turn.role === "user" ? "customer" : "agent", text: turn.message, startedAtMs: turn.timeInCallSeconds * 1000, metrics: { llmLatencyMs: turn.llmLatencyMs } })), safe_metadata: { durationSeconds: 96, turnCount: 13, providerCredits: 966, providerLlmCredits: 141, providerReportedCost: 0.0237, providerEvaluation: 100 } },
  brief: null, candidates: [],
});
const serialized = JSON.stringify(record);
assert(serialized.includes("unifiedTimeline") && serialized.includes("rawTranscript") && serialized.includes("normalizedTranscript"));
assert(serialized.includes("966") && serialized.includes("141"));
assert(!serialized.match(/api[_-]?key|system[_-]?prompt|private[_-]?instruction/i));
assert(experienceTestRecordHtml(record).includes("Unified timeline"));

const downloadRoute = read("app/api/internal/experience-tests/[sessionId]/route.ts");
assert(downloadRoute.includes("createAuthenticatedRepresentationContext"));
assert(downloadRoute.includes('eq("tenant_user_id", auth.user.id)'));
assert(!downloadRoute.includes("experienceToken"));
const migration = read("supabase/migrations/20260723120000_public_experience_test_records.sql");
assert(migration.includes("ENABLE ROW LEVEL SECURITY") && migration.includes("REVOKE ALL"));
const page = read("app/experience/page.tsx");
assert(page.includes('setDurableCallStatus("reviewing_what_was_learned")'));
assert(page.indexOf('setDurableCallStatus("reviewing_what_was_learned")') < page.indexOf('fetch("/api/experience/session/reflection"'));

console.log("Public Experience V2.1 regression fixture — PASS");
