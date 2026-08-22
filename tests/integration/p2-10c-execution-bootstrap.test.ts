import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const { upsert, from, createClient } = vi.hoisted(() => {
  const upsert = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ upsert }));
  const createClient = vi.fn(() => ({ from }));
  return { upsert, from, createClient };
});

vi.mock("@supabase/supabase-js", () => ({ createClient }));

// Deliberately import before each test supplies runtime configuration.
import { saveBriefConversationMapping } from "../../lib/voice/persistence/brief-conversation-mapping-repository";
import {
  buildElevenLabsDispatchPayload,
  resolveElevenLabsDispatchConfiguration,
} from "../../lib/providers/elevenlabs-provider";

const root = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
const savedEnv = { ...process.env };

describe("P2.10C pre-provider execution bootstrap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("does not permanently capture missing Supabase configuration at import time", async () => {
    const unavailable = await saveBriefConversationMapping("brief", "mission", "business");
    expect(unavailable).toMatchObject({ success: false, error: { code: "SUPABASE_NOT_CONFIGURED" } });
    expect(createClient).not.toHaveBeenCalled();

    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://preview.example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test-value";
    const available = await saveBriefConversationMapping("brief", "mission", "business");

    expect(available).toEqual({ success: true });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledTimes(1);
  });

  it("resolves provider configuration at operation time and constructs the speech-safe payload without a network request", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ELEVENLABS_API_KEY: "present",
      NEXT_PUBLIC_ELEVENLABS_AGENT_ID: "agent-current",
      ELEVENLABS_PHONE_NUMBER_ID: "phone-current",
      ELEVENLABS_AGENT_BRANCH_ID: "branch-current",
      ELEVENLABS_WEBHOOK_URL: "https://preview.example/api/webhooks/elevenlabs",
    };
    const config = resolveElevenLabsDispatchConfiguration(env);
    expect(config).not.toBeNull();

    const result = buildElevenLabsDispatchPayload({
      workerBriefId: "p25_brief_fixture",
      missionId: "mission-fixture",
      targetName: "QA Prospect",
      targetPhone: "+66000000000",
      objective: "private objective",
      dynamicVariables: {
        missionObjective: "Clarify the current situation",
        opening: "Hello from the current worker",
        spokenWorkerIdentity: "Current Worker",
        relationshipState: "follow_up",
        prospectContext: "Prior callback requested; timing remains unknown.",
        authorizedBusinessContext: "Approved business context",
      },
    }, config!);

    expect(result.payload.agent_id).toBe("agent-current");
    expect(result.payload.conversation_initiation_client_data.branch_id).toBe("branch-current");
    expect(result.dynamicVariables).toMatchObject({
      spokenWorkerIdentity: "Current Worker",
      relationshipState: "follow_up",
      prospectContext: "Prior callback requested; timing remains unknown.",
      opening: "Hello from the current worker",
    });
    expect(result.dynamicVariables).not.toHaveProperty("sourceFingerprint");
    expect(result.dynamicVariables).not.toHaveProperty("observationIds");
    expect(result.dynamicVariables).not.toHaveProperty("interpretationIds");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("keeps provider configuration absent until every required runtime value is present", () => {
    expect(resolveElevenLabsDispatchConfiguration({ ...process.env, ELEVENLABS_API_KEY: "present", NEXT_PUBLIC_ELEVENLABS_AGENT_ID: undefined, ELEVENLABS_PHONE_NUMBER_ID: undefined, ELEVENLABS_AGENT_BRANCH_ID: undefined })).toBeNull();
  });

  it("uses the authenticated deployed route as the authoritative governed execution path", () => {
    const route = root("app/api/work/dispatches/[dispatchId]/execute/route.ts");
    const execution = root("lib/work/governed-voice-execution.ts");
    const dispatcher = root("lib/workers/worker-dispatcher.ts");

    expect(route).toContain("createAuthenticatedRepresentationContext(request)");
    expect(route).toContain("executeGovernedVoice");
    expect(execution.indexOf("dispatchedWorkerIdentityMatches")).toBeLessThan(execution.indexOf("zeya_claim_governed_execution"));
    expect(execution).toContain("dispatchWorkerBrief(workerBrief,'ELEVENLABS'");
    expect(dispatcher.indexOf("mapping_start")).toBeLessThan(dispatcher.indexOf("lineage_start"));
    expect(dispatcher.indexOf("lineage_start")).toBeLessThan(dispatcher.indexOf("provider_boundary"));
  });

  it("stops a mapping failure before lineage/provider and emits no fake provider identifier", () => {
    const dispatcher = root("lib/workers/worker-dispatcher.ts");
    const mappingFailure = dispatcher.slice(
      dispatcher.indexOf("if (!mappingResult.success)"),
      dispatcher.indexOf("mapping_ready"),
    );
    expect(mappingFailure).toContain('"mapping_failed"');
    expect(mappingFailure).not.toContain("provider.dispatch");
    expect(mappingFailure).not.toContain("saveVoiceRepresentationLineage");
    const failureFactory = dispatcher.slice(dispatcher.indexOf("function failureResult"), dispatcher.indexOf("export async function dispatchWorkerBrief"));
    expect(failureFactory).not.toContain("providerCallId");
  });
});
