import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractConversationCandidates } from "../../lib/voice/conversation-output/extractor";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const route = read("app/api/experience/session/finalize-zeya/route.ts");
const page = read("app/experience/page.tsx");
const handoff = read("lib/experience/public-handoff.ts");
const service = read("lib/voice/conversation-output/service.ts");

assert(route.includes('error: "incomplete_handoff"') && route.includes("phoneCaptured !== true"));
assert(route.includes("ConversationOutputProcessingError"));
assert(route.includes('stage: error.stage') && route.includes('operation: "finalize_zeya"'));
assert(route.includes('"conversation_extraction_failed"') && route.includes("{ status: error.stage === \"extraction\" ? 502 : 500 }"));
assert(handoff.includes("phoneCaptured: true"));
assert(!handoff.includes("transcript: snapshot.transcript, phone:"), "phone leaked into governed transcript request");
assert(page.indexOf('setDelegationStatus("dispatching_call")') > page.indexOf("await submitPublicExperienceHandoff"), "progress UI advances before handoff invocation");
assert(service.includes('ConversationOutputProcessingError("extraction"'));
assert(service.includes('ConversationOutputProcessingError("candidate_storage"'));

async function main() {
const extractionInput = {
  transcript: [{ role: "customer" as const, text: "A valid completed answer" }],
  channel: "zeya_realtime" as const,
  agentType: "ZEYA",
  canonicalVersionId: "00000000-0000-4000-8000-000000000001",
  authorizedElementKeys: ["offer"],
  transcriptTrustLevel: "authenticated_client_relay" as const,
};
assert.deepEqual(await extractConversationCandidates(extractionInput, async () => []), [], "zero candidates are valid");
await assert.rejects(extractConversationCandidates(extractionInput, async () => ({ malformed: true })), /Extraction response must be an array/);

console.log("Public Experience finalization safety — PASS");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Public Experience finalization safety failed");
  process.exitCode = 1;
});
