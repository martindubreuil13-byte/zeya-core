import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const route = readFileSync("app/api/experience/session/route.ts", "utf8");
const context = readFileSync("lib/voice/representation-context.ts", "utf8");
const lineageRepository = readFileSync(
  "lib/voice/persistence/representation-lineage-repository.ts",
  "utf8",
);
const dispatcher = readFileSync("lib/workers/worker-dispatcher.ts", "utf8");
const delegateRoute = readFileSync(
  "app/api/experience/delegate-call/route.ts",
  "utf8",
);
const outputService = readFileSync(
  "lib/voice/conversation-output/service.ts",
  "utf8",
);
const eventProcessor = readFileSync(
  "lib/voice/events/elevenlabs-event-processor.ts",
  "utf8",
);

describe("governed pre-canonical Public Experience", () => {
  it("keeps canonical and pre-canonical creation as separate RPC contracts", () => {
    expect(route).toContain(
      '"zeya_create_pre_canonical_public_experience_session"',
    );
    expect(route).toContain('"zeya_create_public_experience_session"');
    expect(lineageRepository).toContain(
      '"zeya_create_pre_canonical_voice_representation_lineage"',
    );
    expect(lineageRepository).toContain(
      '"zeya_create_voice_representation_lineage"',
    );
  });

  it("propagates exact mode and nullable-Version identity through Veya", () => {
    expect(delegateRoute).toContain(
      "representationContextMode: session.representation_context_mode",
    );
    expect(delegateRoute).toContain(
      "canonicalVersionId: session.canonical_version_id",
    );
    expect(dispatcher).toContain(
      'representationContextMode === "pre_canonical"',
    );
    expect(dispatcher).toContain("assemblePreCanonicalVoiceContext");
    expect(lineageRepository).toContain(
      "p_canonical_version_id: input.lineage.canonicalVersionId",
    );
    expect(outputService).toContain(
      "representation_context_mode,authorized_element_keys",
    );
    expect(eventProcessor).toContain(
      "session.data.representation_context_mode!==lineage.data.representation_context_mode",
    );
  });

  it("requires owner-scoped clean lineage and creates no Version", () => {
    expect(context).toContain('.eq("user_id", input.tenantUserId)');
    expect(context).toContain("representation.data.current_version_id !== null");
    expect(context).toContain('.from("representation_versions")');
    expect(context).toContain("versions.count !== 0");
    expect(route).not.toContain('.from("representation_versions")');
    expect(route).not.toMatch(/insert[\s\S]*representation_versions/i);
  });

  it("passes the installed pre-canonical RPC argument contract exactly", () => {
    for (const argument of [
      "p_token_hash",
      "p_expires_at",
      "p_voice_context_id",
      "p_worker_brief_id",
      "p_conversation_id",
      "p_tenant_user_id",
      "p_business_id",
      "p_business_representation_id",
      "p_canonical_version_id",
      "p_context_generated_at",
      "p_authorized_element_keys",
      "p_agent_id",
      "p_context_schema_version",
      "p_prompt_assembly_version",
    ]) {
      expect(route).toContain(`${argument}:`);
    }
    for (const argument of [
      "p_voice_context_id",
      "p_worker_brief_id",
      "p_mission_id",
      "p_conversation_id",
      "p_tenant_user_id",
      "p_business_id",
      "p_business_representation_id",
      "p_canonical_version_id",
      "p_context_generated_at",
      "p_authorized_element_keys",
      "p_provisional_mode",
      "p_agent_id",
      "p_agent_type",
      "p_agent_role",
      "p_context_schema_version",
      "p_prompt_assembly_version",
    ]) {
      expect(lineageRepository).toContain(`${argument}:`);
    }
  });

  it("uses discovery-only assembly without weakening canonical assembly", () => {
    expect(context).toContain("export async function assemblePreCanonicalVoiceContext");
    expect(context).toContain("export async function assembleVoiceRepresentationContext");
    expect(context).toContain("PRE-CANONICAL BUSINESS DISCOVERY");
    expect(route).toContain("assemblePreCanonicalVoiceContext");
    expect(route).toContain("assembleVoiceRepresentationContext");
    expect(route).toContain(
      'representation.data.current_version_id === null',
    );
    expect(route).toContain('? "pre_canonical"');
    expect(route).toContain(': "canonical"');
    expect(route).toContain(
      "voiceContext.lineage.representationContextMode !==",
    );
    expect(route).toContain(
      "voiceContext.lineage.canonicalVersionId !== null",
    );
  });

  it("keeps the manually installed contract out of the migration chain", () => {
    expect(() =>
      readFileSync(
        "supabase/migrations/20260730100000_pre_canonical_public_experience.sql",
        "utf8",
      ),
    ).toThrow();
  });
});
