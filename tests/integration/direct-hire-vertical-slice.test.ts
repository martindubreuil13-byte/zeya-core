import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Direct Hire Vertical Slice 1", () => {
  it("uses the authenticated API without client-supplied tenant identity", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/route.ts", "utf8");
    expect(route).toContain("createAuthenticatedRepresentationContext(request)");
    expect(route).toContain('.eq("owner_id", ownerId)');
    expect(route).toContain('.eq("user_id", ownerId)');
    expect(route).toContain('rpc("zeya_upsert_direct_hire_profile"');
    expect(route).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(route).not.toMatch(/body\.(?:ownerId|businessId|businessRepresentationId)/);
  });

  it("returns only lifecycle status, not profile PII", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/route.ts", "utf8");
    const success = route.slice(
      route.indexOf("function success("),
      route.indexOf("export async function GET"),
    );
    expect(success).toContain("state, preparationStatus");
    expect(success).not.toContain("phone");
    expect(success).not.toContain("website");
    expect(success).not.toContain("ownerName");
  });

  it("renders the protected first meeting and exactly five accessible fields", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    expect(component).toContain("I noticed we’ve never spoken before.");
    expect(component).toContain("Before my first day");
    for (const label of [
      "Owner name",
      "Business name",
      "Website",
      "Best phone number",
      "Product or service you most want to sell or grow",
    ]) {
      expect(component).toContain(`label=\"${label}\"`);
    }
    expect(component.match(/<ProfileField/g)).toHaveLength(5);
    expect(component).toContain("<label htmlFor={id}");
    expect(component).toContain('aria-describedby');
    expect(component).toContain('aria-invalid');
  });

  it("retains form state across recoverable validation and persistence failures", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    const submit = component.slice(
      component.indexOf("const submitProfile"),
      component.indexOf("const handleSignOut"),
    );
    expect(submit).not.toContain("setProfile(EMPTY_PROFILE)");
    expect(submit).toContain("setErrors(validated.errors)");
    expect(submit).toContain("Your answers are still here");
    expect(component).not.toContain("localStorage");
    expect(component).not.toContain("sessionStorage");
  });

  it("shows only truthful received, queued, and pending preparation states", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    expect(component).toContain('label="Business profile" status="Received"');
    expect(component).toContain('label="Preparation" status="Queued"');
    expect(component).toContain('label="Website review" status="Pending"');
    expect(component).toContain('label="Questions" status="Pending"');
    expect(component).toContain("Preparation has not started yet");
    expect(component).not.toContain("Research complete");
  });

  it("resumes durable preparation and safely returns signed-out owners", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    expect(component).toContain('authenticatedFetch(\n        "/api/onboarding/direct-hire"');
    expect(component).toContain('body.data.state === "preparation" ? "preparation" : "first_meeting"');
    expect(component).toContain('`/login?next=${encodeURIComponent(DIRECT_HIRE_ONBOARDING_PATH)}`');
    expect(component).toContain('router.replace("/login")');
  });

  it("does not contain Public Experience, persuasion, provider, or Formation actions", async () => {
    const component = await readFile(
      "components/onboarding/DirectHireOnboarding.tsx",
      "utf8",
    );
    const api = await readFile("app/api/onboarding/direct-hire/route.ts", "utf8");
    for (const source of [component, api]) {
      expect(source).not.toContain("/api/experience");
      expect(source).not.toContain("/api/formation");
      expect(source).not.toContain("Hire Zeya");
      expect(source).not.toContain("Representation Brief");
      expect(source).not.toContain("OpenAI");
      expect(source).not.toContain("ElevenLabs");
      expect(source).not.toContain("Twilio");
    }
  });
});
