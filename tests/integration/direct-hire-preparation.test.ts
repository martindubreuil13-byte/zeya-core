import { describe, expect, it } from "vitest";
import {
  createDeterministicWebsiteObservations,
  executeDirectHirePreparation,
  type WebsiteEvidenceDraft,
} from "../../lib/onboarding/direct-hire-preparation";
import { SafeFetchError, type SafeFetchResult } from "../../lib/research/safe-public-site-fetch";

function page(url: string, html: string): SafeFetchResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: "text/html",
    body: Buffer.from(html),
    redirectCount: 0,
    totalBytes: Buffer.byteLength(html),
  };
}

const homepage = `<!doctype html><title>Academy</title>
  <meta name="description" content="Practical AI architecture for responsible business teams">
  <nav><a href="/about">About</a><a href="/services">Services</a></nav>
  <main><h1>Practical AI business architecture</h1><p>${"Useful public business context. ".repeat(8)}</p></main>`;
const optional = (heading: string) => `<main><h1>${heading}</h1><p>${"Substantive sourced public information. ".repeat(8)}</p></main>`;

describe("Direct Hire preparation execution", () => {
  it("creates ready sourced Evidence and at most three cautious Observations", async () => {
    const safeFetch = async (url: string) => {
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nAllow: /");
      if (url.endsWith("/about")) return page(url, optional("About the Academy"));
      if (url.endsWith("/services")) return page(url, optional("Architecture services"));
      return page("https://example.com/", homepage);
    };
    const result = await executeDirectHirePreparation("http://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: safeFetch as never,
      now: () => new Date("2026-08-05T00:00:00.000Z"),
    });
    expect(result.status).toBe("ready");
    expect(result.successfulPageCount).toBe(3);
    expect(result.failedPageCount).toBe(0);
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.evidence.every((item) =>
      item.finalUrl.startsWith("https://") &&
      item.documentContentHash.length === 64 &&
      item.sourceKey.length === 64
    )).toBe(true);
    expect(result.observations.length).toBeLessThanOrEqual(3);
    expect(result.observations.every((item) => item.confidence <= 60)).toBe(true);
  });

  it("returns partial when optional work fails after durable homepage Evidence", async () => {
    const safeFetch = async (url: string) => {
      if (url.endsWith("robots.txt")) throw new SafeFetchError("request_failed");
      if (url.endsWith("/about")) throw new SafeFetchError("request_timeout");
      if (url.endsWith("/services")) return page(url, optional("Services"));
      return page("https://example.com/", homepage);
    };
    const result = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: safeFetch as never,
    });
    expect(result.status).toBe("partial");
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.progress.about).toBe("failed");
    expect(result.failedPageCount).toBe(1);
  });

  it("returns partial when an optional page has no usable extract", async () => {
    const safeFetch = async (url: string) => {
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nAllow: /");
      if (url.endsWith("/about")) return page(url, "<main><p>Short</p></main>");
      if (url.endsWith("/services")) return page(url, optional("Services"));
      return page("https://example.com/", homepage);
    };
    const result = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: safeFetch as never,
    });
    expect(result.status).toBe("partial");
    expect(result.progress.about).toBe("failed");
    expect(result.successfulPageCount).toBe(2);
  });

  it("scopes deterministic Evidence keys to the session and complete source provenance", async () => {
    const safeFetch = async () => page("https://example.com/", homepage);
    const first = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "session:one",
      safeFetch: safeFetch as never,
    });
    const replay = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "session:one",
      safeFetch: safeFetch as never,
    });
    const otherSession = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "session:two",
      safeFetch: safeFetch as never,
    });
    expect(replay.evidence.map((item) => item.sourceKey)).toEqual(
      first.evidence.map((item) => item.sourceKey),
    );
    expect(otherSession.evidence[0]?.sourceKey).not.toBe(first.evidence[0]?.sourceKey);
  });

  it("honors robots for optional pages but still handles the submitted homepage", async () => {
    const calls: string[] = [];
    const safeFetch = async (url: string) => {
      calls.push(url);
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nDisallow: /about");
      if (url.endsWith("/services")) return page(url, optional("Services"));
      return page("https://example.com/", homepage);
    };
    const result = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: safeFetch as never,
    });
    expect(calls.some((url) => url.endsWith("/about"))).toBe(false);
    expect(result.progress.about).toBe("skipped");
    expect(result.status).toBe("partial");
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("fails safely with no Evidence when the homepage cannot be fetched", async () => {
    const result = await executeDirectHirePreparation("https://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: (async () => { throw new SafeFetchError("unsafe_destination"); }) as never,
    });
    expect(result).toMatchObject({
      status: "failed",
      failureCode: "unsafe_destination",
      evidence: [],
      observations: [],
    });
  });

  it("records unsupported_site when an HTTP submission cannot be reached over upgraded HTTPS", async () => {
    const result = await executeDirectHirePreparation("http://example.com", {
      sourceScope: "test:onboarding-session",
      safeFetch: (async () => { throw new SafeFetchError("request_failed"); }) as never,
    });
    expect(result).toMatchObject({ status: "failed", failureCode: "unsupported_site" });
  });

  it("does not generate weak Observations", () => {
    const weak: WebsiteEvidenceDraft[] = [{
      sourceKey: "a".repeat(64), rawStatement: "Consulting", requestedUrl: "https://example.com/",
      finalUrl: "https://example.com/", retrievedAt: new Date().toISOString(),
      documentContentHash: "b".repeat(64), pageType: "homepage", kind: "primary_heading",
      selector: "h1", extractionVersion: "direct-hire-web-v1", affectedDomains: ["positioning"],
    }];
    expect(createDeterministicWebsiteObservations(weak)).toEqual([]);
  });
});
