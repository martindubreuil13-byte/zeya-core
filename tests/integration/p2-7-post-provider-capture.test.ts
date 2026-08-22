import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureAndExtractConversationOutput } from "../../lib/voice/conversation-output/service";
import { decideGovernedOutcome } from "../../lib/voice/events/elevenlabs-event-processor";

const identity = {
  attemptProviderCallId: "provider-call-1",
  attemptConversationId: "conversation-1",
  eventProviderCallId: "provider-call-1",
  eventConversationId: "conversation-1",
};
const output = {
  provider_call_id: "provider-call-1",
  conversation_id: "conversation-1",
  transcript_status: "finalized",
};

describe("P2.7 post-provider capture semantics", () => {
  it("verifies immutable capture but skips extraction for a completed exact replay", async () => {
    let extractionCalls = 0;
    const rpcCalls: string[] = [];
    const db = {
      from(table: string) {
        const result = table === "voice_representation_lineage"
          ? { data: { canonical_version_id: "version-1", representation_context_mode: "canonical", authorized_element_keys: [], agent_type: "CALLER" }, error: null }
          : { data: { id: "output-1", transcript_status: "finalized", transcript: [{ role: "customer", text: "Hello" }], processing_status: "completed", extracted_candidate_count: 7 }, error: null };
        const builder = {
          select: () => builder,
          eq: () => builder,
          single: async () => result,
          maybeSingle: async () => result,
        };
        return builder;
      },
      async rpc(name: string) {
        rpcCalls.push(name);
        return { data: "output-1", error: null };
      },
    } as unknown as SupabaseClient;

    const result = await captureAndExtractConversationOutput({
      db,
      capture: {
        voiceContextId: "voice-1",
        conversationId: "conversation-1",
        providerCallId: "provider-call-1",
        provider: "elevenlabs",
        channel: "veya_outbound",
        captureSource: "provider_callback",
        transcriptTrustLevel: "provider_attested",
        providerAttested: true,
        transcript: [{ role: "customer", text: "Hello" }],
        transcriptStatus: "finalized",
        conversationStatus: "done",
      },
      extractionModel: async () => {
        extractionCalls += 1;
        return [];
      },
    });

    expect(result).toEqual({ conversationOutputId: "output-1", candidateCount: 7 });
    expect(extractionCalls).toBe(0);
    expect(rpcCalls).toEqual(["zeya_capture_voice_conversation_output"]);
  });

  it("accepts delayed completion for a dispatched attempt with no output", () => {
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed",
      existingOutput: null,
    })).toBe("capture");
  });

  it("sends an exact durable output replay through immutable verification", () => {
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed",
      existingOutput: output,
    })).toBe("verify_capture_replay");
  });

  it("records genuine failure while an attempt is claimed or dispatched", () => {
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "claimed",
      eventOutcome: "failed",
      existingOutput: null,
    })).toBe("record_failure");
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "failed",
      existingOutput: null,
    })).toBe("record_failure");
  });

  it("rejects conflicting provider identity without selecting a mutation", () => {
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed",
      eventConversationId: "different-conversation",
      existingOutput: null,
    })).toBe("conflict");
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed",
      existingOutput: { ...output, provider_call_id: "different-call" },
    })).toBe("conflict");
  });

  it.each(["claimed", "dispatched"] as const)(
    "%s + completed_without_transcript accepts provider success without recording failure",
    (attemptStatus) => {
      expect(decideGovernedOutcome({
        ...identity,
        attemptStatus,
        eventOutcome: "completed_without_transcript",
        existingOutput: null,
      })).toBe("capture");
    },
  );

  it.each(["failed", "unanswered", "rejected"] as const)(
    "exact existing output + %s rejects the contradictory late event",
    (eventOutcome) => {
      expect(decideGovernedOutcome({
        ...identity,
        attemptStatus: "dispatched",
        eventOutcome,
        existingOutput: output,
      })).toBe("conflict");
    },
  );

  it.each(["failed", "unanswered", "rejected"] as const)(
    "claimed + %s retains genuine provider non-success semantics",
    (eventOutcome) => {
      expect(decideGovernedOutcome({
        ...identity,
        attemptStatus: "claimed",
        eventOutcome,
        existingOutput: null,
      })).toBe("record_failure");
    },
  );

  it("uses status-only unavailable capture for provider completion without transcript", async () => {
    const source = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    expect(source).toContain('captureSource: transcriptAvailable ? "provider_callback" : "status_only"');
    expect(source).toContain('transcriptTrustLevel: transcriptAvailable ? "provider_attested" : "status_only"');
    expect(source).toContain('transcriptStatus: transcriptAvailable ? "finalized" : "unavailable"');
    expect(source).toContain('completionReason: transcriptAvailable ? "provider_completed" : "provider_completed_without_transcript"');
  });

  it("replays status-only completion idempotently and permits delayed transcript finalization", () => {
    const statusOnlyOutput = { ...output, transcript_status: "unavailable" };
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed_without_transcript",
      existingOutput: statusOnlyOutput,
    })).toBe("verify_capture_replay");
    expect(decideGovernedOutcome({
      ...identity,
      attemptStatus: "dispatched",
      eventOutcome: "completed",
      existingOutput: statusOnlyOutput,
    })).toBe("capture");
  });

  it("rejects identity conflicts before any governed execution mutation", async () => {
    const source = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    const start = source.indexOf("async function processGovernedExecutionOutcome");
    const end = source.indexOf("export async function processElevenLabsWebhook", start);
    const governed = source.slice(start, end);
    expect(governed.indexOf('decision==="conflict"')).toBeLessThan(
      governed.indexOf('db.rpc("zeya_complete_governed_execution"'),
    );
  });

  it("capture failure cannot set a successful execution to failed", async () => {
    const source = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    const start = source.indexOf("async function processGovernedExecutionOutcome");
    const end = source.indexOf("export async function processElevenLabsWebhook", start);
    const governed = source.slice(start, end);
    const successPersistence = governed.indexOf('p_status: "dispatched"');
    const capture = governed.indexOf("await captureAndExtractConversationOutput");

    expect(successPersistence).toBeGreaterThan(-1);
    expect(capture).toBeGreaterThan(successPersistence);
    expect(governed).not.toContain("webhook_processing_failed");
    expect(governed.match(/p_status: "failed"/g)).toHaveLength(1);
  });

  it("extraction failure stays in conversation processing and cannot set execution to failed", async () => {
    const [processor, service] = await Promise.all([
      readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8"),
      readFile("lib/voice/conversation-output/service.ts", "utf8"),
    ]);
    const start = processor.indexOf("async function processGovernedExecutionOutcome");
    const end = processor.indexOf("export async function processElevenLabsWebhook", start);
    const governed = processor.slice(start, end);

    expect(service).toContain('new ConversationOutputProcessingError("extraction", error)');
    expect(governed).not.toContain("ConversationOutputProcessingError");
    expect(governed).not.toContain("webhook_processing_failed");
  });

  it("preserves the existing Public Experience path", async () => {
    const source = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    expect(source).toContain("public_experience_sessions");
    expect(source).toContain("zeya_begin_voice_webhook_receipt");
    expect(source).toContain("zeya_complete_public_experience_call");
  });

  it("has no canonical Representation, mandate, or mission mutation", async () => {
    const source = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    const start = source.indexOf("async function processGovernedExecutionOutcome");
    const end = source.indexOf("export async function processElevenLabsWebhook", start);
    const governed = source.slice(start, end);
    expect(governed).not.toMatch(/(?:update|insert|delete).*representation_versions/i);
    expect(governed).not.toMatch(/(?:update|insert|delete).*mandate/i);
    expect(governed).not.toMatch(/(?:update|insert|delete).*mission/i);
  });
});
