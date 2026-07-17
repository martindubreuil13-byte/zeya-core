import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURN_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURNS,
} from "../../lib/experience/public-session-contract";
import {
  normalizePublicExperienceTranscript,
  PublicExperienceTranscriptError,
} from "../../lib/experience/public-transcript";
import {
  acquirePublicExperienceAction,
  PublicExperienceHandoffError,
  releasePublicExperienceAction,
  submitPublicExperienceHandoff,
} from "../../lib/experience/public-handoff";
import type { VoiceTranscriptEntry } from "../../types/voice";

const entry = (
  id: string,
  role: VoiceTranscriptEntry["role"],
  text: string,
  isFinal = true,
): VoiceTranscriptEntry => ({ id, role, text, isFinal, createdAt: 1_700_000_000_000 });

const input = [
  entry("agent-1", "agent", "  Hello from Zeya.  "),
  entry("user-1", "user", "  I sell consulting.  "),
  entry("agent-partial", "agent", "Who usually", false),
  entry("empty", "user", "   "),
  entry("system", "system", "internal instruction"),
  entry("user-1", "user", "I sell consulting."),
  entry("agent-2", "agent", "Who usually buys it?"),
] satisfies VoiceTranscriptEntry[];
const before = structuredClone(input);
const normalized = normalizePublicExperienceTranscript(input);

assert.deepEqual(normalized, [
  { role: "assistant", text: "Hello from Zeya." },
  { role: "user", text: "I sell consulting." },
  { role: "assistant", text: "Who usually buys it?" },
]);
assert.deepEqual(input, before, "normalization does not mutate inputs");
assert(normalized.every((turn) => Object.keys(turn).sort().join(",") === "role,text"));
assert(!JSON.stringify(normalized).includes("internal instruction"));

assert.throws(
  () => normalizePublicExperienceTranscript([
    entry("long", "user", "x".repeat(PUBLIC_EXPERIENCE_MAX_TURN_CHARS + 1)),
  ]),
  (error) => error instanceof PublicExperienceTranscriptError && error.code === "turn_too_long",
);
assert.throws(
  () => normalizePublicExperienceTranscript(Array.from(
    { length: PUBLIC_EXPERIENCE_MAX_TURNS + 1 },
    (_, index) => entry(`turn-${index}`, "user", "bounded"),
  )),
  (error) => error instanceof PublicExperienceTranscriptError && error.code === "too_many_turns",
);
const totalTurns = Array.from(
  { length: Math.ceil((PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS + 1) / PUBLIC_EXPERIENCE_MAX_TURN_CHARS) },
  (_, index) => entry(`total-${index}`, "user", "x".repeat(PUBLIC_EXPERIENCE_MAX_TURN_CHARS)),
);
assert.throws(
  () => normalizePublicExperienceTranscript(totalTurns),
  (error) => error instanceof PublicExperienceTranscriptError && error.code === "transcript_too_long",
);

const baseHandoff = {
  experienceToken: "opaque-test-token",
  transcriptEntries: [entry("a", "agent", "Question"), entry("u", "user", "Answer")],
  phone: "+15550001111",
  name: "Visitor",
  business: "Consulting",
  customer: "Founders",
};

async function runHandoffContractTests() {
const guard = { current: false };
assert.equal(acquirePublicExperienceAction(guard), true, "first action acquires synchronously");
assert.equal(acquirePublicExperienceAction(guard), false, "rapid duplicate action is rejected");
releasePublicExperienceAction(guard);
assert.equal(acquirePublicExperienceAction(guard), true, "recoverable failure can release the guard");

for (const status of [400, 404, 409, 413, 500]) {
  const calls: string[] = [];
  await assert.rejects(
    submitPublicExperienceHandoff(baseHandoff, async (url) => {
      calls.push(String(url));
      return new Response(JSON.stringify({ error: "safe" }), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
    (error) => error instanceof PublicExperienceHandoffError
      && error.stage === "finalization"
      && error.status === status,
  );
  assert.deepEqual(calls, ["/api/experience/session/finalize-zeya"]);
}

const successfulCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
const mutableInput = { ...baseHandoff, transcriptEntries: [...baseHandoff.transcriptEntries] };
const result = await submitPublicExperienceHandoff(mutableInput, async (url, init) => {
  successfulCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  mutableInput.phone = "+15559999999";
  mutableInput.transcriptEntries.push(entry("late", "user", "Late mutation"));
  return new Response(
    JSON.stringify(String(url).includes("finalize-zeya") ? { status: "ready_for_phone" } : { success: true, status: "call_dispatched" }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
});
assert.equal(successfulCalls.length, 2, "exact replay success proceeds to one dispatch");
assert.deepEqual(successfulCalls.map((call) => call.url), [
  "/api/experience/session/finalize-zeya",
  "/api/experience/delegate-call",
]);
assert.equal(successfulCalls[1]?.body.phone, "+15550001111", "dispatch uses stable phone snapshot");
assert(!JSON.stringify(result.snapshot.transcript).includes("Late mutation"), "transcript snapshot is stable");
assert.equal(result.dispatchStatus, "call_dispatched");

const pending = await submitPublicExperienceHandoff(baseHandoff, async (url) => new Response(
  JSON.stringify(String(url).includes("finalize-zeya")
    ? { status: "ready_for_phone" }
    : { success: false, status: "correlation_pending" }),
  { status: String(url).includes("finalize-zeya") ? 200 : 202, headers: { "content-type": "application/json" } },
));
assert.equal(pending.dispatchStatus, "correlation_pending", "accepted-but-pending is not reported as failure or ordinary dispatch success");

const resolutionPending = await submitPublicExperienceHandoff(baseHandoff, async (url) => new Response(
  JSON.stringify(String(url).includes("finalize-zeya")
    ? { status: "ready_for_phone" }
    : { success: false, status: "dispatch_resolution_pending" }),
  { status: String(url).includes("finalize-zeya") ? 200 : 202, headers: { "content-type": "application/json" } },
));
assert.equal(resolutionPending.dispatchStatus, "dispatch_resolution_pending", "rejected reset failure never claims provider acceptance");

const page = readFileSync(resolve(process.cwd(), "app/experience/page.tsx"), "utf8");
const handoff = readFileSync(resolve(process.cwd(), "lib/experience/public-handoff.ts"), "utf8");
assert.equal((page.match(/handlePhoneSubmitContinued/g) ?? []).length, 0, "duplicate continuation removed");
assert.equal((handoff.match(/\/api\/experience\/session\/finalize-zeya/g) ?? []).length, 1);
assert.equal((handoff.match(/\/api\/experience\/delegate-call/g) ?? []).length, 1);
assert(page.indexOf("acquirePublicExperienceAction(handoffInFlightRef)") < page.indexOf("await submitPublicExperienceHandoff"));
assert(page.includes("if (handoffInFlightRef.current || handoffCompletedRef.current) return"));
assert(page.includes("acquirePublicExperienceAction(startInFlightRef)"));
assert(!handoff.includes("console."), "handoff module logs no token, phone, or transcript data");

console.log("Public Experience browser contract — PASS");
}

runHandoffContractTests().catch((error) => {
  console.error(error instanceof Error ? error.message : "Browser contract test failed");
  process.exitCode = 1;
});
