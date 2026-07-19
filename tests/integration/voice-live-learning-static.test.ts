import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");
const repository = read("lib/voice/conversation-review/repository.ts");
const route = read("app/api/voice/conversation-review/route.ts");
const panel = read("components/briefing-room/ConversationReviewPanel.tsx");
const experience = read("app/api/experience/session/route.ts");
const env = read(".env.example");

assert(repository.includes("canonicalizeConversationCandidate"), "server wrapper missing");
assert(repository.includes('db.rpc("zeya_promote_voice_candidate_to_canonical"'), "atomic RPC name changed");
assert(repository.indexOf("function createConversationReviewServiceClient") < repository.indexOf("createClient(url, key"), "service client must remain lazy");
assert(!repository.slice(0, repository.indexOf("export async function canonicalizeConversationCandidate")).includes("createConversationReviewServiceClient();"), "service client initialized during import");
assert(route.includes('body.action === "canonicalize"'), "canonicalize action missing");
assert(route.indexOf("createAuthenticatedRepresentationContext(request)") < route.indexOf('body.action === "canonicalize"'), "authentication must precede canonicalization");
assert(route.includes("actorUserId: auth.user.id"), "actor must come from authenticated context");
assert(!route.includes("body.actorUserId"), "client actor identity accepted");
assert(route.includes('process.env.ZEYA_VOICE_LEARNING_ENABLED === "true"'), "default-off feature flag missing");
assert(route.includes("ZEYA_EXPERIENCE_BUSINESS_ID"), "configured Business scope missing");
for (const legacy of ['body.action === "review"', 'body.action === "promote"']) assert(route.includes(legacy), `legacy action missing: ${legacy}`);
assert(panel.includes("Approve and teach Zeya"), "founder action missing");
assert(panel.includes("canonicalizationEnabled"), "server-enabled UI contract missing");
assert(panel.includes("canonicalRequestKey"), "logical retry request key missing");
assert(experience.includes("instructions: buildPublicExperienceInstructions(voiceContext.systemContext)"), "public realtime governed instructions missing");
assert(experience.includes("--- GOVERNED REPRESENTATION CONTEXT ---"), "governed context separator missing");
assert(env.includes("ZEYA_VOICE_LEARNING_ENABLED=false"), "environment example must default disabled");

console.log("Voice live learning static — PASS");
