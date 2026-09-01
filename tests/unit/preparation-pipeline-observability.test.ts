import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { executeDirectHirePreparation } from "../../lib/onboarding/direct-hire-preparation";
import { logPreparationStage, safePreparationFailureCode } from "../../lib/onboarding/preparation-telemetry";
import { safeFetchPublicSite } from "../../lib/research/safe-public-site-fetch";

const context = {
  workingSessionId: "11111111-1111-4111-8111-111111111111",
  onboardingSessionId: "22222222-2222-4222-8222-222222222222",
  contractVersion: "first-working-session-preparation-v5",
  correlationId: "33333333-3333-4333-8333-333333333333",
};

function page(url: string, html: string) {
  return { requestedUrl: url, finalUrl: url, status: 200, contentType: "text/html", body: Buffer.from(html), redirectCount: 0, totalBytes: Buffer.byteLength(html) };
}

describe("preparation pipeline observability", () => {
  it("emits safe successful acquisition progression and counts without content", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const privateContent = "PRIVATE-OWNER-PROSE-DO-NOT-LOG";
    try {
      const result = await executeDirectHirePreparation("https://example.com/?secret=query", {
        sourceScope: "scope",
        telemetry: context,
        safeFetch: (async (url: string) => url.includes("robots.txt")
          ? page(url, "User-agent: *\nAllow: /")
          : page(url, `<title>Business</title><main><h1>Services</h1><p>${privateContent} ${"public detail ".repeat(20)}</p></main>`)) as never,
      });
      expect(result.status).toBe("ready");
      const entries = info.mock.calls.map(([entry]) => entry as Record<string, unknown>);
      expect(entries).toEqual(expect.arrayContaining([
        expect.objectContaining({ preparationStage: "website_acquisition", status: "started" }),
        expect.objectContaining({ preparationStage: "homepage_acquisition", status: "completed", homepageSuccessful: true }),
        expect.objectContaining({ preparationStage: "candidate_selection", status: "completed" }),
        expect.objectContaining({ preparationStage: "website_acquisition", status: "completed", evidenceRecordsPrepared: expect.any(Number), observationsProduced: expect.any(Number) }),
      ]));
      const logged = JSON.stringify(entries);
      expect(logged).not.toContain(privateContent);
      expect(logged).not.toContain("secret=query");
      expect(logged).not.toContain("service-role-secret");
    } finally { info.mockRestore(); }
  });

  it("labels safe-fetch failures by acquisition subsection without query strings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const request = ((_options: unknown, callback: (response: PassThrough & { statusCode: number; headers: Record<string, string> }) => void) => {
      const req = new EventEmitter() as EventEmitter & { end(): void; destroy(error: Error): void };
      req.destroy = failure => queueMicrotask(() => req.emit("error", failure));
      req.end = () => { const response = new PassThrough() as PassThrough & { statusCode: number; headers: Record<string, string> }; response.statusCode = 404; response.headers = {}; callback(response); response.end(); };
      return req;
    }) as never;
    try {
      await expect(safeFetchPublicSite("https://example.com/about?token=private", {
        diagnostic: { acquisitionStage: "common_path_probe", sourceCategory: "company_website", pageCategory: "about" },
        dependencies: { resolve: async () => [{ address: "93.184.216.34", family: 4 }], request },
      })).rejects.toMatchObject({ code: "request_failed" });
      expect(error).toHaveBeenLastCalledWith(expect.objectContaining({ acquisitionStage: "common_path_probe", origin: "https://example.com", pathname: "/about", httpStatusCode: 404 }));
      expect(JSON.stringify(error.mock.calls)).not.toContain("token=private");
    } finally { error.mockRestore(); }
  });

  it("retains only sanitized terminal classifications", () => {
    expect(safePreparationFailureCode(new Error("website_persistence_failed:SECRET_DB_DETAIL"))).toBe("website_persistence_failed");
    expect(safePreparationFailureCode(new Error("owner prose and token=secret"))).toBe("preparation_failed");
  });

  it("stage markers contain identifiers and counts but never arbitrary content", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      logPreparationStage(context, "finalize", "completed", { evidenceRecordsPersisted: 4 });
      expect(info).toHaveBeenCalledWith(expect.objectContaining({ event: "first_working_session_preparation_stage", correlationId: context.correlationId, evidenceRecordsPersisted: 4 }));
    } finally { info.mockRestore(); }
  });
});
