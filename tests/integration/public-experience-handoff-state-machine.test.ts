import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  acquirePublicExperienceAction,
  releasePublicExperienceAction,
  submitPublicExperienceHandoff,
  type PublicExperienceHandoffStage,
} from "../../lib/experience/public-handoff";
import { analyzePublicExperienceNameResponse, capturePublicExperienceIdentity, normalizeCorrectedPublicExperienceName, resolvePublicExperienceNameReply } from "../../lib/experience/public-identity";
import type { VoiceTranscriptEntry } from "../../types/voice";

const entry = (id: string, role: VoiceTranscriptEntry["role"], text: string): VoiceTranscriptEntry =>
  ({ id, role, text, isFinal: true, createdAt: Date.now() });
const transcriptEntries = [entry("a", "agent", "What is your name?"), entry("u", "user", "My name is Zephyria")];
const input = { experienceToken: "opaque-test-token", transcriptEntries, phone: "+15550001111", name: "Zephyria", business: "Consulting", customer: "Founders" };

async function guardedAttempts(events: string[]) {
  const guard = { current: false };
  let finalizeRequests = 0;
  let releaseDispatch!: () => void;
  const slowDispatch = new Promise<void>((resolve) => { releaseDispatch = resolve; });
  const submit = async () => {
    if (!acquirePublicExperienceAction(guard)) return;
    try {
      await submitPublicExperienceHandoff(input, async (url) => {
        if (String(url).includes("finalize-zeya")) {
          finalizeRequests += 1;
          return Response.json({ status: "ready_for_phone" });
        }
        await slowDispatch;
        return Response.json({ success: true, status: "call_dispatched" });
      }, (stage) => events.push(stage));
    } finally { releasePublicExperienceAction(guard); }
  };
  const first = submit();
  const second = submit(); // double click
  const third = submit(); // Enter plus click / repeated callback
  await Promise.resolve();
  assert.equal(finalizeRequests, 1);
  assert.equal(guard.current, true, "guard remains held through slow dispatch");
  assert.equal(events.at(-1), "dispatch_started", "slow dispatch never restores collecting_phone");
  releaseDispatch();
  await Promise.all([first, second, third]);
  return finalizeRequests;
}

async function main() {
const stages: string[] = [];
assert.equal(await guardedAttempts(stages), 1, "all duplicate UI actions produce one finalize request");

const recoveredFinalizeStages: PublicExperienceHandoffStage[] = [];
const recoveredFinalizeCalls: string[] = [];
const recoveredFinalize = await submitPublicExperienceHandoff(input, async (url) => {
  recoveredFinalizeCalls.push(String(url));
  if (String(url).includes("finalize-zeya")) return Response.json({ error: "conflict" }, { status: 409 });
  if (String(url).includes("session/status")) return Response.json({ status: "zeya_finalized" });
  return Response.json({ success: true, status: "call_dispatched" });
}, (stage) => recoveredFinalizeStages.push(stage));
assert.equal(recoveredFinalize.dispatchStatus, "call_dispatched");
assert.deepEqual(recoveredFinalizeCalls, ["/api/experience/session/finalize-zeya", "/api/experience/session/status", "/api/experience/delegate-call"]);
assert(recoveredFinalizeStages.includes("handoff_recovered"), "already-finalized conflict is recovered");

let dispatchRequests = 0;
const alreadyDispatched = await submitPublicExperienceHandoff(input, async (url) => {
  if (String(url).includes("finalize-zeya")) return Response.json({ error: "conflict" }, { status: 409 });
  if (String(url).includes("session/status")) return Response.json({ status: "call_dispatched" });
  dispatchRequests += 1;
  return Response.json({ success: false }, { status: 500 });
});
assert.equal(alreadyDispatched.dispatchStatus, "call_dispatched");
assert.equal(dispatchRequests, 0, "already-dispatched recovery does not dispatch twice");

const lowConfidence = capturePublicExperienceIdentity(transcriptEntries);
assert.equal(lowConfidence.name, "Zephyria");
assert.equal(lowConfidence.needsNameConfirmation, true, "unusual name asks for confirmation");
assert.equal(normalizeCorrectedPublicExperienceName("  zefira lee "), "Zefira Lee");
assert.deepEqual(analyzePublicExperienceNameResponse("My name is Zephyria"), { name: "Zephyria", needsConfirmation: true }, "unusual name pauses immediately after greeting");
assert.deepEqual(analyzePublicExperienceNameResponse("My name is Martin"), { name: "Martin", needsConfirmation: false }, "high-confidence common name proceeds directly");
assert.deepEqual(resolvePublicExperienceNameReply("No, my name is Zefira Lee", "Zephyria"), { resolvedName: "Zefira Lee", rejected: false });
const correctedName = normalizeCorrectedPublicExperienceName("zefira lee");
const dispatchedBody: Array<Record<string, unknown>> = [];
await submitPublicExperienceHandoff({ ...input, name: correctedName }, async (url, init) => {
  if (String(url).includes("delegate-call")) dispatchedBody.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
  return Response.json(String(url).includes("finalize-zeya") ? { status: "ready_for_phone" } : { success: true, status: "call_dispatched" });
});
assert.equal(dispatchedBody[0]?.name, "Zefira Lee", "corrected name is authoritative in call context");

const page = readFileSync(resolve(process.cwd(), "app/experience/page.tsx"), "utf8");
for (const phase of ["collecting_phone", "submitting_handoff", "finalizing", "dispatching_call", "waiting_for_call"]) assert(page.includes(`\"${phase}\"`));
assert(page.includes('setPhase("handoff_error")'), "unrecoverable errors preserve a stable error UI");
assert(!page.includes('handoffError?.restartRequired) {'), "handoff errors do not automatically reset transcript state");
assert(page.includes('event: "experience_reset"'), "explicit resets are observable");
assert.equal((page.match(/current === \"voice_active\" \? \"collecting_phone\" : current/g) ?? []).length, 2, "delayed voice callbacks cannot roll handoff phases back to Confirm");
const voiceUi = page.slice(page.indexOf('{phase === "voice_active"'), page.indexOf('{phase === "handoff"'));
const phoneUi = page.slice(page.indexOf('{phase === "collecting_phone"'), page.indexOf('{(phase === "submitting_handoff"'));
assert(voiceUi.includes("nameConfirmation.asking"), "identity confirmation is rendered during the live conversation");
assert(!phoneUi.includes("nameConfirmation.asking"), "phone collection never renders identity confirmation");
assert(page.indexOf("decision.needsConfirmation") < page.indexOf('controller.currentBeat === ExperienceBeat.PRODUCT'), "identity gate precedes the business beat");
assert(page.includes("if (!identityResolvedRef.current || !identityRef.current?.name)"), "handoff rejects unresolved identity locally without opening confirmation");

console.log("Public Experience handoff state machine — PASS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
