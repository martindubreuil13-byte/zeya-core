import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  isOwnerExperiencePath,
  OWNER_EXPERIENCE_PATH,
  resolveOwnerJourneyPath,
} from "../../lib/owner/owner-route";

const formationEntry = readFileSync("app/formation/entry/page.tsx", "utf8");
const experience = readFileSync("app/experience/page.tsx", "utf8");
const sessionRoute = readFileSync("app/api/experience/session/route.ts", "utf8");
const authProvider = readFileSync("components/auth/auth-provider.tsx", "utf8");
const authModal = readFileSync("components/auth/auth-modal.tsx", "utf8");
const safeNextPath = readFileSync("lib/auth/safe-next-path.ts", "utf8");

describe("owner route and state transitions", () => {
  it("resolves every persisted owner state deterministically", () => {
    const formationId = "11111111-1111-4111-8111-111111111111";
    expect(resolveOwnerJourneyPath({ status: "new_owner" })).toBe(
      OWNER_EXPERIENCE_PATH,
    );
    expect(resolveOwnerJourneyPath({
      status: "active_formation",
      formationSessionId: formationId,
    })).toBe(`/formation/sessions/${formationId}`);
    expect(resolveOwnerJourneyPath({
      status: "active_formation",
      formationSessionId: "invalid",
    })).toBeNull();
    expect(resolveOwnerJourneyPath({ status: "has_representation" })).toBe(
      "/representation/living",
    );
  });

  it("does not discard clean-owner entry state at the start action", () => {
    expect(formationEntry).toContain("resolveOwnerJourneyPath({ status: 'new_owner' })");
    expect(formationEntry).not.toContain("router.push('/experience')");
    expect(isOwnerExperiencePath("?entry=owner")).toBe(true);
    expect(isOwnerExperiencePath("")).toBe(false);
    expect(experience).toContain('entryContext !== "owner" || authLoading || user');
    expect(experience).toContain("Preparing your Experience");
  });

  it("keeps unauthenticated public Experience separate", () => {
    expect(experience).toContain('entryContext === "owner"');
    expect(experience).toContain('entryContext === "resolving"');
    expect(experience).toContain('const ownerExperience = entryContext === "owner"');
  });

  it("classifies provisioned owners from the live Representation state", () => {
    expect(sessionRoute).toContain(
      '.select("id,business_id,user_id,current_version_id")',
    );
    expect(sessionRoute).toContain(
      "representation.data.current_version_id === null",
    );
    expect(sessionRoute).toContain('? "pre_canonical"');
    expect(sessionRoute).toContain(': "canonical"');
    expect(sessionRoute).not.toContain(
      'businessRepresentationId = provision.business_representation_id;\n      representationContextMode = "pre_canonical"',
    );
  });

  it("preserves safe post-auth next paths without an open redirect", () => {
    expect(authProvider).toContain("safeInternalPath(requestedPath)");
    expect(safeNextPath).toContain('value.startsWith("//")');
    expect(safeNextPath).toContain('parsed.origin !== "https://zeya.internal"');
    expect(experience).toContain("encodeURIComponent(OWNER_EXPERIENCE_PATH)");
  });

  it("keeps signup pending until email confirmation establishes a session", () => {
    expect(authModal).toContain("supabase.auth.signUp");
    expect(authModal).toContain(
      "Check your inbox if confirmation is needed",
    );
    const signupBranch = authModal.slice(
      authModal.indexOf('if (mode === "create-account")'),
      authModal.indexOf('if (mode === "forgot-password")'),
    );
    expect(signupBranch).not.toContain("onAuthenticated");
    expect(signupBranch).not.toContain("router.");
  });

  it("contains no automatic owner fallback back to the generic Experience URL", () => {
    for (const source of [formationEntry, experience]) {
      expect(source).not.toMatch(/router\.(?:push|replace)\(["']\/experience["']\)/);
    }
  });
});
