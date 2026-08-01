import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_SCREEN_LAB_PHASES,
  experienceScreenLabState,
  isExperienceScreenLabEnabled,
} from "../../lib/experience/screen-lab";
import {
  ACADEMY_BRIEF,
  ACADEMY_IDS,
  ACADEMY_LIVING_REPRESENTATION,
  ACADEMY_PROFILE,
} from "../../lib/testing/fixtures/academy";
import {
  bodyContainsScreenLabFixtureId,
  isScreenLabFixtureId,
  rejectScreenLabFixturePersistence,
  urlContainsScreenLabFixtureId,
} from "../../lib/testing/screen-lab-guard";

describe("Experience Screen Lab", () => {
  it("is enabled only for the exact Preview target", () => {
    expect(isExperienceScreenLabEnabled("preview")).toBe(true);
    expect(isExperienceScreenLabEnabled("production")).toBe(false);
    expect(isExperienceScreenLabEnabled("development")).toBe(false);
    expect(isExperienceScreenLabEnabled(undefined)).toBe(false);
  });

  it("routes non-Preview requests through notFound", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/experience/screen-lab/page.tsx"),
      "utf8",
    );
    expect(routeSource).toContain(
      "isExperienceScreenLabEnabled(process.env.ZEYA_ENVIRONMENT_TARGET)",
    );
    expect(routeSource).toMatch(/if \(!isExperienceScreenLabEnabled[\s\S]*?notFound\(\)/);
    expect(isExperienceScreenLabEnabled("production")).toBe(false);
    expect(isExperienceScreenLabEnabled("preview")).toBe(true);
  });

  it("provides a renderable fixture for every required phase", () => {
    expect(EXPERIENCE_SCREEN_LAB_PHASES.map(([phase]) => phase)).toEqual([
      "initial_owner",
      "voice_active",
      "handoff",
      "collecting_phone",
      "submitting_handoff",
      "waiting_for_call",
      "call_delayed",
      "call_failed",
      "reflection_processing",
      "valid_brief",
      "clarification_brief",
      "calibration",
      "bridge_recognition",
      "bridge_role",
      "bridge_boundaries",
      "hiring_decision",
      "onboarding_preview",
      "identity_confirmation",
      "representation_preview",
      "completed",
      "formation_error",
    ]);

    for (const [phase] of EXPERIENCE_SCREEN_LAB_PHASES) {
      expect(experienceScreenLabState(phase).phase).toBeTruthy();
    }
  });

  it("keeps the lab shell local and persistence-free", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "app/experience/screen-lab/screen-lab-client.tsx"),
      "utf8",
    );

    expect(clientSource).toContain("PREVIEW SCREEN LAB — NO DATA WILL BE SAVED");
    expect(clientSource).toContain("setPhase(event.target.value");
    expect(clientSource).toContain("pointer-events-none");
    expect(clientSource).toContain("Screen actions disabled");
    expect(clientSource).not.toMatch(/\bfetch\s*\(/);
    expect(clientSource).not.toContain("authenticatedFetch");
    expect(clientSource).not.toContain("sessionStorage");
    expect(clientSource).not.toContain("supabase");
    expect(clientSource).not.toMatch(/\.rpc\s*\(/);
    expect(clientSource).not.toContain("OpenAI");
    expect(clientSource).not.toContain("ElevenLabs");
    expect(clientSource).not.toContain("Twilio");
    expect(clientSource).toContain("FormationWorkflow");
    expect(clientSource).toContain("LivingRepresentationView");
    expect(clientSource).toContain("OperationalConceptView");
  });

  it("uses immutable, visibly non-database Academy fixtures", () => {
    expect(ACADEMY_PROFILE.businessName).toBe(
      "AI Architecture Academy for Small Businesses",
    );
    expect(Object.isFrozen(ACADEMY_PROFILE)).toBe(true);
    expect(Object.isFrozen(ACADEMY_PROFILE.offers)).toBe(true);
    expect(Object.isFrozen(ACADEMY_LIVING_REPRESENTATION.version)).toBe(true);
    expect(ACADEMY_BRIEF.id).toBe("screenlab:academy:brief");
    for (const id of Object.values(ACADEMY_IDS)) {
      expect(id).toMatch(/^screenlab:academy:/);
      expect(id).not.toMatch(/^[0-9a-f]{8}-/i);
    }
  });

  it("rejects fixture identifiers at the authenticated persistence boundary", async () => {
    expect(isScreenLabFixtureId(ACADEMY_IDS.business)).toBe(true);
    expect(bodyContainsScreenLabFixtureId({ businessId: ACADEMY_IDS.business })).toBe(true);
    expect(bodyContainsScreenLabFixtureId({ nested: { representation_id: ACADEMY_IDS.representation } })).toBe(true);
    expect(urlContainsScreenLabFixtureId(`/api/businesses/${encodeURIComponent(ACADEMY_IDS.business)}`)).toBe(true);
    expect(urlContainsScreenLabFixtureId(`/api/representation?businessId=${encodeURIComponent(ACADEMY_IDS.business)}`)).toBe(true);
    const rejected = rejectScreenLabFixturePersistence(
      "/api/formation/prepare",
      JSON.stringify({ businessId: ACADEMY_IDS.business }),
    );
    expect(rejected?.status).toBe(400);
    await expect(rejected?.json()).resolves.toEqual({
      success: false,
      error: "screen_lab_fixture_persistence_forbidden",
    });
    expect(rejectScreenLabFixturePersistence("/api/owner/status", undefined)).toBeNull();
  });

  it("accepts legitimate user text containing the screenlab substring", () => {
    const authoredText =
      "Use screenlab: as an example namespace in the workshop documentation.";

    expect(isScreenLabFixtureId(authoredText)).toBe(false);
    expect(bodyContainsScreenLabFixtureId({
      description: authoredText,
      notes: `Martin said: ${authoredText}`,
      alignmentQuestion: "Should the copy mention screenlab: during testing?",
    })).toBe(false);
    expect(bodyContainsScreenLabFixtureId({
      businessId: "customer-screenlab:academy",
      description: authoredText,
    })).toBe(false);
    expect(urlContainsScreenLabFixtureId(
      `/api/search?q=${encodeURIComponent(authoredText)}`,
    )).toBe(false);
    expect(rejectScreenLabFixturePersistence(
      "/api/formation/notes",
      JSON.stringify({ notes: authoredText }),
    )).toBeNull();
  });

  it("marks every exploratory operational surface as conceptual", () => {
    const conceptSource = readFileSync(
      resolve(process.cwd(), "components/testing/OperationalConceptView.tsx"),
      "utf8",
    );
    expect(conceptSource).toContain("CONCEPT — NOT YET OPERATIONAL");
    for (const phase of [
      "empty_workspace", "document_upload", "connectors",
      "lead_list", "agent_activity", "daily_brief",
    ]) expect(conceptSource).toContain(phase);
  });

  it("disables provider construction and all real Experience effects", () => {
    const experienceSource = readFileSync(
      resolve(process.cwd(), "app/experience/page.tsx"),
      "utf8",
    );
    const voiceHookSource = readFileSync(
      resolve(process.cwd(), "hooks/realtime/useRealtimeOnboardingSession.ts"),
      "utf8",
    );

    expect(experienceSource).toContain(
      "usePublicExperienceVoiceConversation({ disabled: Boolean(screenLab) })",
    );
    expect(experienceSource.match(/if\s*\(screenLab\)\s*return/g)?.length).toBeGreaterThanOrEqual(12);
    expect(voiceHookSource).toContain("if (options.disabled)");
    expect(voiceHookSource.indexOf("if (options.disabled)")).toBeLessThan(
      voiceHookSource.indexOf("new OpenAIRealtimeClient"),
    );
  });
});
