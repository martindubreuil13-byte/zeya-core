import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { decideGovernedOutcome } from "../../lib/voice/events/elevenlabs-event-processor";

const migration = "supabase/migrations/20260825020000_p210a_terminal_provider_failure_reconciliation.sql";
const triggerFix = "supabase/migrations/20260825020100_p210a_attempt_trigger_schema_fix.sql";
const identity = {
  attemptProviderCallId: "conversation-1",
  attemptConversationId: "conversation-1",
  eventProviderCallId: "conversation-1",
  eventConversationId: "conversation-1",
  existingOutput: null,
};

describe("P2.10A terminal provider failure reconciliation", () => {
  it.each(["failed", "unanswered", "rejected"] as const)(
    "reconciles dispatched + %s with no output as terminal failure",
    (eventOutcome) => expect(decideGovernedOutcome({
      ...identity, attemptStatus: "dispatched", eventOutcome,
    })).toBe("record_failure"),
  );

  it.each(["failed", "unanswered", "rejected"] as const)(
    "accepts only an exact repeated %s terminal outcome as a duplicate",
    (eventOutcome) => {
      expect(decideGovernedOutcome({
        ...identity, attemptStatus: "failed", attemptErrorCode: `provider_${eventOutcome}`, eventOutcome,
      })).toBe("duplicate_failure");
      expect(decideGovernedOutcome({
        ...identity, attemptStatus: "failed", attemptErrorCode: "provider_failed", eventOutcome,
      })).toBe(eventOutcome === "failed" ? "duplicate_failure" : "conflict");
    },
  );

  it("rejects late success after terminal failure", () => {
    expect(decideGovernedOutcome({
      ...identity, attemptStatus: "failed", attemptErrorCode: "provider_failed", eventOutcome: "completed",
    })).toBe("conflict");
  });

  it("rejects terminal failure when successful output already exists", () => {
    expect(decideGovernedOutcome({
      ...identity, attemptStatus: "dispatched", eventOutcome: "failed",
      existingOutput: { provider_call_id: "conversation-1", conversation_id: "conversation-1", transcript_status: "finalized" },
    })).toBe("conflict");
  });

  it("rejects provider identity mismatch before mutation", () => {
    expect(decideGovernedOutcome({
      ...identity, attemptStatus: "dispatched", eventOutcome: "failed", eventConversationId: "other",
    })).toBe("conflict");
  });

  it("permits only the monotonic dispatched-to-failed database transition", async () => {
    const sql = await readFile(migration, "utf8");
    const fixedTrigger = await readFile(triggerFix, "utf8");
    expect(sql).toContain("x.status='dispatched' AND p_status='failed'");
    expect(sql).toContain("x.provider_call_id IS NOT DISTINCT FROM nullif(p_provider_call_id,'')");
    expect(sql).toContain("x.conversation_id IS NOT DISTINCT FROM nullif(p_conversation_id,'')");
    expect(fixedTrigger).toContain("NEW.provider_call_id IS DISTINCT FROM OLD.provider_call_id");
    expect(fixedTrigger).toContain("NEW.conversation_id IS DISTINCT FROM OLD.conversation_id");
    expect(fixedTrigger).toContain("NEW.started_at IS DISTINCT FROM OLD.started_at");
    expect(fixedTrigger).toContain("OLD.status='failed'");
    expect(fixedTrigger).not.toContain("NEW.created_at");
  });

  it("allows only safe terminal provider error codes for dispatched attempts", async () => {
    const sql = await readFile(migration, "utf8");
    for (const code of ["provider_failed", "provider_unanswered", "provider_rejected"]) expect(sql).toContain(code);
    expect(sql).not.toMatch(/sip|destination|phone|stack|detail|hint/i);
  });

  it("keeps provider outcome failure separate from processing failure", async () => {
    const processor = await readFile("lib/voice/events/elevenlabs-event-processor.ts", "utf8");
    const governed = processor.slice(processor.indexOf("async function processGovernedExecutionOutcome"), processor.indexOf("export async function processElevenLabsWebhook"));
    expect(governed).toContain("`provider_${event.outcome}`");
    expect(governed).not.toContain("completion_processing_failed");
    expect(governed).not.toContain("webhook_processing_failed");
  });
});
