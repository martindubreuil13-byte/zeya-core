import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Direct Hire Vertical Slice 2 boundaries", () => {
  it("uses an authenticated claim and dedicated service finalization without profile PII", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/preparation/route.ts", "utf8");
    expect(route).toContain("createAuthenticatedRepresentationContext(request)");
    expect(route).toContain('rpc("zeya_claim_direct_hire_preparation")');
    expect(route).toContain("createDirectHireServiceClient()");
    expect(route).toContain("sourceScope: row.onboarding_session_id");
    expect(route).toContain('rpc("zeya_finalize_direct_hire_preparation"');
    expect(route).not.toContain("phone_e164");
    expect(route).not.toContain("owner_relationship_name");
    expect(route).not.toContain("raw HTML");
  });

  it("derives stale-lease retry without exposing lease internals", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/route.ts", "utf8");
    expect(route).toContain("retryAvailable: onboarding.preparation_status === \"running\"");
    expect(route).toContain("Date.parse(onboarding.preparation_lease_expires_at) <= Date.now()");
    expect(route).not.toContain("preparationLeaseId:");
    expect(route).not.toContain("leaseExpiresAt:");
  });

  it("does not import or invoke Formation, canonical, voice, analytics, or providers", async () => {
    const sources = await Promise.all([
      "app/api/onboarding/direct-hire/preparation/route.ts",
      "lib/onboarding/direct-hire-preparation.ts",
      "lib/research/safe-public-site-fetch.ts",
    ].map((file) => readFile(file, "utf8")));
    for (const source of sources) {
      expect(source).not.toContain("/api/formation");
      expect(source).not.toContain("createProposal");
      expect(source).not.toContain("createCanonical");
      expect(source).not.toContain("OpenAI");
      expect(source).not.toContain("ElevenLabs");
      expect(source).not.toContain("Twilio");
      expect(source).not.toContain("Telnyx");
      expect(source).not.toContain("analytics");
    }
  });

  it("renders backend-derived queued, running, ready, partial, failed, and retry states", async () => {
    const component = await readFile("components/onboarding/DirectHireOnboarding.tsx", "utf8");
    for (const status of ["queued", "running", "ready", "partial", "failed"] as const) {
      expect(component).toContain(`preparationStatus === "${status}"`);
    }
    expect(component).toContain("Begin preparation");
    expect(component).toContain("Try preparation again");
    expect(component).toContain("Retry expired preparation");
    expect(component).toContain('? "Retrying"');
    expect(component).toContain("setInterval(() => void loadStatus(), 3_000)");
    expect(component).not.toContain("/api/formation");
  });
});
