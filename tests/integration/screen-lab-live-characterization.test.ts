import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("live screen controller characterization", () => {
  it("keeps Experience on its existing live endpoints and owner routing", () => {
    const page = source("app/experience/page.tsx");

    expect(page).toContain('fetch("/api/experience/session/reconcile"');
    expect(page).toContain('fetch("/api/experience/session/reflection"');
    expect(page).toContain("authenticatedFetch('/api/formation/prepare'");
    expect(page).toContain("isOwnerExperiencePath(window.location.search)");
    expect(page).toContain("if(screenLab)return");
  });

  it("keeps Formation live loading and mutations in its controller", () => {
    const workflow = source("components/formation/FormationWorkflow.tsx");

    for (const endpoint of [
      "`/api/formation/sessions/${sessionId}`",
      "`/api/formation/sessions/${sessionId}/advance`",
      "`/api/formation/sessions/${sessionId}/summary`",
      "`/api/formation/sessions/${sessionId}/correct`",
      "`/api/formation/sessions/${sessionId}/approve`",
      "`/api/formation/sessions/${sessionId}/pause`",
    ]) {
      expect(workflow).toContain(endpoint);
    }

    expect(workflow).toContain("router.replace('/representation/living')");
  });

  it("keeps Living Representation authentication and API resolution live", () => {
    const page = source("app/representation/living/page.tsx");

    expect(page).toContain('router.replace("/login")');
    expect(page).toContain(
      'authenticatedFetch("/api/representation/living", session)',
    );
    expect(page).toContain('body.state === "no_business"');
    expect(page).toContain('body.state === "no_representation"');
    expect(page).toContain('body.state === "no_canonical_version"');
    expect(page).toContain('body.state === "multiple_businesses"');
    expect(page).toContain("<LivingRepresentationView");
  });
});
