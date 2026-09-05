import { describe, expect, it } from "vitest";
import {
  createDeterministicWebsiteObservations,
  executeDirectHirePreparation,
  type WebsiteEvidenceDraft,
} from "../../lib/onboarding/direct-hire-preparation";
import { SafeFetchError, type SafeFetchResult, type SafeFetchDiagnosticContext } from "../../lib/research/safe-public-site-fetch";
import { WEBSITE_RESEARCH_LIMITS } from "../../lib/research/safe-public-site-fetch";

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

// Discovery probes must not turn unlisted paths into successful fixture pages.
function homepageOnly(url: string): SafeFetchResult {
  if (new URL(url).pathname === "/") return page("https://example.com/", homepage);
  throw new SafeFetchError("request_failed");
}

describe("Direct Hire preparation execution", () => {
  it("creates ready sourced Evidence and at most three cautious Observations", async () => {
    const safeFetch = async (url: string) => {
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nAllow: /");
      if (url.endsWith("/about")) return page(url, optional("About the Academy"));
      if (url.endsWith("/services")) return page(url, optional("Architecture services"));
      return homepageOnly(url);
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
      return homepageOnly(url);
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
      return homepageOnly(url);
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
      return homepageOnly(url);
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

  it("fetches the best nine pages rather than the first nine links in DOM order", async () => {
    const links = [
      ["/resource-1", "Resources"], ["/contact", "Contact"], ["/faq", "FAQ"],
      ["/team", "Team"], ["/testimonials", "Testimonials"], ["/method", "Our approach"],
      ["/industries", "Industries"], ["/about", "About"], ["/customers", "Customers"],
      ["/case-studies", "Case studies"], ["/pricing", "Pricing"], ["/services", "Services"],
    ];
    const fetched: Array<{ url: string; stage?: SafeFetchDiagnosticContext["acquisitionStage"] }> = [];
    const safeFetch = async (url: string, options?: { diagnostic?: SafeFetchDiagnosticContext }) => {
      fetched.push({ url, stage: options?.diagnostic?.acquisitionStage });
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nAllow: /");
      if (url === "https://example.com/") return page(url, `<nav>${links.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}</nav><main><h1>Home</h1><p>${"Business context. ".repeat(10)}</p></main>`);
      return page(url, optional(new URL(url).pathname));
    };
    const result = await executeDirectHirePreparation("https://example.com/", {
      sourceScope: "budget-test", safeFetch: safeFetch as never,
    });
    // maxPages limits homepage + ranked extraction, not sitemap/probe requests.
    const pageCalls = fetched.filter(call => call.stage === "homepage" || call.stage === "selected_page")
      .map(call => call.url);
    expect(fetched.filter(call => call.stage === "robots")).toHaveLength(1);
    expect(fetched.filter(call => call.stage === "sitemap")).toHaveLength(1);
    expect(fetched.filter(call => call.stage === "common_path_probe")).toHaveLength(10);
    expect(pageCalls).toHaveLength(WEBSITE_RESEARCH_LIMITS.maxPages);
    expect(pageCalls).toContain("https://example.com/services");
    expect(pageCalls).toContain("https://example.com/pricing");
    expect(pageCalls).not.toContain("https://example.com/resource-1");
    expect(result.successfulPageCount).toBe(WEBSITE_RESEARCH_LIMITS.maxPages);
  });

  it("suppresses duplicates within a page without erasing cross-page provenance", async () => {
    const repeated = "The same substantive sourced public information. ".repeat(8);
    const safeFetch = async (url: string) => {
      if (url.endsWith("robots.txt")) return page(url, "User-agent: *\nAllow: /");
      if (url === "https://example.com/") return page(url, `<nav><a href="/about">About</a><a href="/services">Services</a></nav><main><h1>Home</h1><p>${"Homepage context. ".repeat(8)}</p></main>`);
      if (url.endsWith("/about") || url.endsWith("/services")) {
        return page(url, `<main><h1>Shared heading</h1><p>${repeated}</p></main>`);
      }
      throw new SafeFetchError("request_failed");
    };
    const result = await executeDirectHirePreparation("https://example.com/", { sourceScope: "dedupe-test", safeFetch: safeFetch as never });
    const shared = result.evidence.filter(item => item.rawStatement === "Shared heading");
    expect(shared).toHaveLength(2);
    expect(new Set(shared.map(item => item.finalUrl))).toEqual(new Set([
      "https://example.com/about", "https://example.com/services",
    ]));
    expect(shared.map(item => item.requestedUrl)).toEqual(shared.map(item => item.finalUrl));
    expect(new Set(shared.map(item => item.sourceKey)).size).toBe(2);
    expect(new Set(shared.map(item => item.pageType))).toEqual(new Set(["about", "products_services"]));
    expect(result.status).toBe("ready");
  });

  it("honors robots before probing unlinked common paths and preserves the homepage exception", async () => {
    const calls: string[] = [];
    const safeFetch = async (url: string) => {
      calls.push(url);
      if (url.endsWith("/robots.txt")) return page(url, "User-agent: *\nDisallow: /");
      if (new URL(url).pathname === "/") return page(url, optional("Owner-submitted homepage"));
      throw new SafeFetchError("request_failed");
    };
    const result = await executeDirectHirePreparation("https://example.com/", {
      sourceScope: "robots-probes", safeFetch: safeFetch as never,
    });
    expect(calls).not.toContain("https://example.com/about");
    expect(calls.filter(url => !["/", "/robots.txt", "/sitemap.xml"].includes(new URL(url).pathname))).toEqual([]);
    expect(result.progress.homepage).toBe("complete");
    expect(result.progress.about).toBe("skipped");
    expect(result.successfulPageCount).toBe(1);
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});
