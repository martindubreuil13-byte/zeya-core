import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { inspectRepresentationBriefInput } from "../../lib/experience/representation-brief-generator";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const debug = read("lib/experience/experience-debug.ts");
const realtime = read("lib/realtime/openai-realtime-client.ts");
const reflection = read("app/api/experience/session/reflection/route.ts");
const page = read("app/experience/page.tsx");

assert(debug.includes('process.env.NODE_ENV === "development"') && debug.includes('process.env.NEXT_PUBLIC_EXPERIENCE_DEBUG === "true"'), "debug mode is not development-only and flag-gated");
for (const stage of ["session_started", "microphone_opened", "user_speech_started", "vad_speech_ended", "transcript_finalized", "transcript_sent_to_llm", "llm_response_received", "tts_request_started", "first_audio_byte_received", "speech_playback_started", "speech_playback_finished", "next_listening_entered"]) {
  assert(realtime.includes(`"${stage}"`), `missing realtime debug stage ${stage}`);
}
for (const stage of ["loadVeyaConversationMs", "loadZeyaConversationMs", "evidenceExtractionMs", "briefGenerationMs", "validationMs", "persistenceMs", "reflectionTotalMs"]) {
  assert(reflection.includes(stage), `missing reflection timing ${stage}`);
}
for (const diagnostic of ["visitorUtterances", "zeyaUtterances", "veyaUtterances", "contrastsFound", "repeatedThemes", "generatorConfidence", "minimumEvidenceItems", "minimumEvidenceWords", "persistenceFailed", "generatorReturnedNull", "fallbackPath"]) {
  assert(reflection.includes(diagnostic), `missing brief diagnostic ${diagnostic}`);
}
assert(reflection.includes("[Experience Debug][Visitor Evidence]") && !reflection.includes("systemPrompt") && !reflection.includes("privateContext"), "evidence diagnostics are unsafe");
assert(page.includes('...(EXPERIENCE_DEBUG_ENABLED?{"x-experience-debug":"1"}:{})'), "browser sends debug header when disabled");
assert(page.includes('phase!=="completed"') && page.includes('"UI render"'), "UI-render timing is missing");

const inspection = inspectRepresentationBriefInput({
  visitorName: "Test",
  businessOffer: null,
  targetCustomer: null,
  zeyaTranscript: [
    { id: "u1", role: "user", text: "I help dentists, but referrals remain inconsistent." },
    { id: "a1", role: "assistant", text: "Hidden assistant wording must not become evidence." },
    { id: "u2", role: "user", text: "Dentists need a reliable way to explain their value." },
  ],
  veyaTranscript: [{ id: "v1", role: "customer", text: "Reliable referrals would make planning easier." }],
});
assert.equal(inspection.conversationLength, 4);
assert.equal(inspection.visitorUtterances, 3);
assert.equal(inspection.zeyaUtterances, 3);
assert.equal(inspection.veyaUtterances, 1);
assert.equal(inspection.evidenceItems.length, 3);
assert.equal(inspection.contrastsFound, 1);
assert(!inspection.evidenceItems.some((item) => item.includes("Hidden assistant")));
assert(inspection.repeatedThemes.includes("dentists") || inspection.repeatedThemes.includes("reliable"));

console.log("Temporary Experience Debug Instrumentation — PASS");
