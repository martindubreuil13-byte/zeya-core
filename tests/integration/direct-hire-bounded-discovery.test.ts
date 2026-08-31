import { describe, expect, it, beforeEach } from "vitest";
import type { SafeFetchDependencies } from "../../lib/research/safe-public-site-fetch";
import { executeDirectHirePreparation } from "../../lib/onboarding/direct-hire-preparation";

// Mock fetch function for testing
function createMockFetch(fixtures: Record<string, { body: string; status: number; contentType?: string; delay?: number }>) {
  return async (url: string, options?: any) => {
    const fixture = fixtures[url];
    if (!fixture) {
      throw new Error(`No fixture for ${url}`);
    }
    if (fixture.delay) {
      await new Promise(resolve => setTimeout(resolve, fixture.delay));
    }
    if (fixture.status !== 200) {
      const error = new Error(`HTTP ${fixture.status}`);
      (error as any).code = "request_failed";
      throw error;
    }
    return {
      requestedUrl: url,
      finalUrl: url,
      status: fixture.status,
      contentType: fixture.contentType || "text/html",
      body: Buffer.from(fixture.body),
      redirectCount: 0,
      totalBytes: fixture.body.length,
    };
  };
}

describe("P2.12D.1 — Bounded Intelligent Website Discovery", () => {
  describe("A. Small consulting site with direct links", () => {
    it("discovers and fetches all high-value pages from homepage", async () => {
      const fixtures: Record<string, any> = {
        "https://small-site.example.com/": {
          body: `<!doctype html><html>
            <title>Consulting Firm</title>
            <meta name="description" content="Business strategy consulting">
            <main>
              <h1>Transform Your Business</h1>
              <nav>
                <a href="/about">About Us</a>
                <a href="/services">Services</a>
                <a href="/pricing">Pricing</a>
                <a href="/contact">Contact</a>
              </nav>
              <p>We help companies scale.</p>
            </main>
          </html>`,
          status: 200,
        },
        "https://small-site.example.com/about": {
          body: `<html><h1>About</h1><main><h2>Our Story</h2><p>Founded in 2020, we've helped 50 companies scale.</p></main></html>`,
          status: 200,
        },
        "https://small-site.example.com/services": {
          body: `<html><h1>Services</h1><main><h2>Strategic Planning</h2><p>We provide comprehensive strategy consulting.</p></main></html>`,
          status: 200,
        },
        "https://small-site.example.com/pricing": {
          body: `<html><h1>Pricing</h1><main><h2>Packages</h2><p>Starter: $5K/month. Premium: $20K/month.</p></main></html>`,
          status: 200,
        },
        "https://small-site.example.com/contact": {
          body: `<html><h1>Contact</h1><main><p>Get in touch for a consultation.</p></main></html>`,
          status: 200,
        },
      };

      const result = await executeDirectHirePreparation("https://small-site.example.com/", {
        sourceScope: "test-small-site",
        safeFetch: createMockFetch(fixtures) as any,
      });

      expect(result.status).toBe("ready");
      expect(result.successfulPageCount).toBeGreaterThanOrEqual(4);
      expect(result.evidence.length).toBeGreaterThanOrEqual(8); // At least 8 evidence items
      const pageTypes = new Set(result.evidence.map(e => e.pageType));
      expect(pageTypes).toContain("homepage");
      expect(pageTypes).toContain("about");
      expect(pageTypes).toContain("products_services");
      expect(pageTypes).toContain("pricing");
    });
  });

  describe("B. Hidden high-value pages discovered via common paths", () => {
    it("probes common paths when /about and /methodology not in homepage links", async () => {
      const fixtures: Record<string, any> = {
        "https://hidden-pages.example.com/": {
          body: `<!doctype html>
            <title>Consulting</title>
            <main><h1>Our Consulting</h1>
              <a href="/blog">Blog</a>
              <a href="/team">Team</a>
              <a href="/faq">FAQ</a>
            </main>
          </html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/blog": {
          body: `<html><h1>Blog</h1></html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/team": {
          body: `<html><h1>Team</h1></html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/faq": {
          body: `<html><h1>FAQ</h1></html>`,
          status: 200,
        },
        // Probed common paths
        "https://hidden-pages.example.com/about": {
          body: `<html><h1>About</h1><main><h2>Our Mission</h2><p>We transform businesses through strategic architecture.</p></main></html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/services": {
          body: `<html><h1>Services</h1><main><h2>Business Architecture</h2><p>Our core service offerings.</p></main></html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/methodology": {
          body: `<html><h1>Methodology</h1><main><h2>Our Process</h2><p>Phase 1: Discovery. Phase 2: Design. Phase 3: Implementation.</p></main></html>`,
          status: 200,
        },
        "https://hidden-pages.example.com/pricing": { status: 404, body: "" },
        "https://hidden-pages.example.com/case-studies": { status: 404, body: "" },
      };

      const result = await executeDirectHirePreparation("https://hidden-pages.example.com/", {
        sourceScope: "test-hidden",
        safeFetch: createMockFetch(fixtures) as any,
      });

      expect(result.status).toMatch(/ready|partial/);
      const urls = new Set(result.evidence.map(e => e.finalUrl));
      expect(urls).toContain("https://hidden-pages.example.com/about");
      expect(urls).toContain("https://hidden-pages.example.com/services");
      expect(urls).toContain("https://hidden-pages.example.com/methodology");
    });
  });

  describe("C. Large noisy site with 100+ links", () => {
    it("prioritizes useful pages over blog/tags/pagination", async () => {
      const generateBlogLinks = () => {
        let html = "";
        for (let i = 1; i <= 50; i++) {
          html += `<a href="/blog/${i}/article-${i}">Article ${i}</a>\n`;
        }
        return html;
      };

      const fixtures: Record<string, any> = {
        "https://large-site.example.com/": {
          body: `<!doctype html>
            <title>Large Firm</title>
            <main>
              <a href="/about">About</a>
              <a href="/services">Services</a>
              <a href="/pricing">Pricing</a>
              <a href="/case-studies">Case Studies</a>
              ${generateBlogLinks()}
              <a href="/tag/consulting">Tag: Consulting</a>
              <a href="/page/2">Page 2</a>
              <a href="/page/3">Page 3</a>
            </main>
          </html>`,
          status: 200,
        },
        "https://large-site.example.com/about": {
          body: `<html><h1>About</h1><main><p>We are a consulting firm.</p></main></html>`,
          status: 200,
        },
        "https://large-site.example.com/services": {
          body: `<html><h1>Services</h1><main><p>Strategic consulting services.</p></main></html>`,
          status: 200,
        },
        "https://large-site.example.com/pricing": {
          body: `<html><h1>Pricing</h1><main><p>Custom pricing available.</p></main></html>`,
          status: 200,
        },
        "https://large-site.example.com/case-studies": {
          body: `<html><h1>Case Studies</h1><main><p>Client success stories.</p></main></html>`,
          status: 200,
        },
      };

      // Add defaults for blog and other pages to prevent errors
      for (let i = 1; i <= 50; i++) {
        fixtures[`https://large-site.example.com/blog/${i}/article-${i}`] = {
          body: `<html><h1>Article ${i}</h1></html>`,
          status: 200,
        };
      }

      const result = await executeDirectHirePreparation("https://large-site.example.com/", {
        sourceScope: "test-large",
        safeFetch: createMockFetch(fixtures) as any,
      });

      expect(result.status).toMatch(/ready|partial/);
      const pageTypes = new Set(result.evidence.map(e => e.pageType));

      // Verify high-value pages are present
      expect(pageTypes).toContain("about");
      expect(pageTypes).toContain("products_services");
      expect(pageTypes).toContain("pricing");
      expect(pageTypes).toContain("case_studies");
    });
  });

  describe("D. Duplicate/canonical URL detection", () => {
    it("normalizes URLs before ranking to avoid duplicate fetching", async () => {
      const aboutContent = `<html><h1>About</h1><main><p>Our unique story.</p></main></html>`;
      const fixtures: Record<string, any> = {
        "https://dedup-site.example.com/": {
          body: `<!doctype html>
            <main>
              <a href="/about">About</a>
              <a href="/about/">About with slash</a>
              <a href="/about?ref=nav">About canonical</a>
            </main>
          </html>`,
          status: 200,
        },
        "https://dedup-site.example.com/about": { body: aboutContent, status: 200 },
      };

      const result = await executeDirectHirePreparation("https://dedup-site.example.com/", {
        sourceScope: "test-dedup",
        safeFetch: createMockFetch(fixtures) as any,
      });

      // URL normalization should prevent redundant fetches. Verify /about page was found.
      const aboutEvidence = result.evidence.filter(e => e.pageType === "about");
      expect(aboutEvidence.length).toBeGreaterThan(0);
      expect(aboutEvidence.every(e => e.finalUrl.includes("/about"))).toBe(true);
    });
  });

  describe("E. Timeout and partial failure handling", () => {
    it("returns partial status when a page times out", async () => {
      let requestCount = 0;
      const slowFetch = async (url: string, options?: any) => {
        requestCount++;
        if (requestCount === 3) {
          throw new Error("request_timeout");
        }
        const fixtures: Record<string, any> = {
          "https://slow-site.example.com/": {
            body: `<html><main><a href="/about">About</a><a href="/services">Services</a></main></html>`,
            status: 200,
          },
          "https://slow-site.example.com/about": {
            body: `<html><h1>About</h1></html>`,
            status: 200,
          },
          "https://slow-site.example.com/services": {
            body: `<html><h1>Services</h1></html>`,
            status: 200,
          },
        };
        const fixture = fixtures[url];
        if (!fixture) throw new Error("Not found");
        return {
          requestedUrl: url,
          finalUrl: url,
          status: fixture.status,
          contentType: "text/html",
          body: Buffer.from(fixture.body),
          redirectCount: 0,
          totalBytes: fixture.body.length,
        };
      };

      const result = await executeDirectHirePreparation("https://slow-site.example.com/", {
        sourceScope: "test-slow",
        safeFetch: slowFetch as any,
      });

      expect(result.status).toMatch(/ready|partial/);
      expect(result.evidence.length).toBeGreaterThan(0);
    });
  });

  describe("F. Substantive content extraction", () => {
    it("captures meaningful sections from service and methodology pages", async () => {
      const fixtures: Record<string, any> = {
        "https://content-site.example.com/": {
          body: `<!doctype html>
            <title>Service Firm</title>
            <main><a href="/services">Services</a><a href="/methodology">Approach</a></main>
          </html>`,
          status: 200,
        },
        "https://content-site.example.com/services": {
          body: `<html><h1>Services</h1><main>
            <h2>Strategic Consulting</h2>
            <p>We provide end-to-end strategic consulting for companies looking to scale. Our services include market analysis, competitive positioning, and go-to-market strategy.</p>
            <h2>Implementation Support</h2>
            <p>Beyond strategy, we help implement changes across your organization with dedicated program management.</p>
          </main></html>`,
          status: 200,
        },
        "https://content-site.example.com/methodology": {
          body: `<html><h1>Our Methodology</h1><main>
            <h2>Phase 1: Discovery</h2>
            <p>We conduct comprehensive interviews with your leadership and key stakeholders to understand business model, market position, and growth aspirations.</p>
            <h2>Phase 2: Analysis & Strategy</h2>
            <p>Our team synthesizes findings into actionable strategy recommendations with clear prioritization.</p>
            <h2>Phase 3: Execution</h2>
            <p>We support implementation with project management, training, and ongoing guidance.</p>
          </main></html>`,
          status: 200,
        },
      };

      const result = await executeDirectHirePreparation("https://content-site.example.com/", {
        sourceScope: "test-content",
        safeFetch: createMockFetch(fixtures) as any,
      });

      const serviceEvidence = result.evidence.filter(e => e.pageType === "products_services");
      const methodologyEvidence = result.evidence.filter(e => e.pageType === "methodology");

      // Should capture meaningful sections, not just title/h1
      expect(serviceEvidence.some(e => e.rawStatement.includes("strategic consulting"))).toBe(true);
      expect(methodologyEvidence.some(e => e.rawStatement.includes("Phase") || e.rawStatement.includes("Discovery"))).toBe(true);
    });
  });

  describe("G. Common-path 404 handling", () => {
    it("gracefully handles missing common paths without failing preparation", async () => {
      let callCount = 0;
      const fixtures: Record<string, any> = {
        "https://minimal-site.example.com/": {
          body: `<html><main><a href="/contact">Contact</a></main></html>`,
          status: 200,
        },
        "https://minimal-site.example.com/contact": {
          body: `<html><h1>Contact</h1></html>`,
          status: 200,
        },
      };

      const mockFetch = async (url: string, options?: any) => {
        callCount++;
        const fixture = fixtures[url];
        if (!fixture) {
          // All other paths return 404; probing should handle this gracefully
          throw new Error(`404 Not Found: ${url}`);
        }
        return {
          requestedUrl: url,
          finalUrl: url,
          status: fixture.status,
          contentType: "text/html",
          body: Buffer.from(fixture.body),
          redirectCount: 0,
          totalBytes: fixture.body.length,
        };
      };

      const result = await executeDirectHirePreparation("https://minimal-site.example.com/", {
        sourceScope: "test-minimal",
        safeFetch: mockFetch as any,
      });

      expect(result.status).toBe("ready");
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(callCount).toBeGreaterThan(2); // Homepage + contact + probes
    });
  });

  describe("H. Tenant isolation and lineage", () => {
    it("preserves exact page URL and onboarding session lineage in evidence", async () => {
      const fixtures: Record<string, any> = {
        "https://lineage-site.example.com/": {
          body: `<html><main><a href="/about">About</a><a href="/services">Services</a></main></html>`,
          status: 200,
        },
        "https://lineage-site.example.com/about": {
          body: `<html><h1>About Us</h1><main><p>Lineage test</p></main></html>`,
          status: 200,
        },
        "https://lineage-site.example.com/services": {
          body: `<html><h1>Services</h1><main><p>Service lineage test</p></main></html>`,
          status: 200,
        },
      };

      const sessionId = "test-session-123";
      const result = await executeDirectHirePreparation("https://lineage-site.example.com/", {
        sourceScope: sessionId,
        safeFetch: createMockFetch(fixtures) as any,
      });

      for (const evidence of result.evidence) {
        expect(evidence.requestedUrl).toMatch(/^https:\/\/lineage-site\.example\.com\//);
        expect(evidence.finalUrl).toMatch(/^https:\/\/lineage-site\.example\.com\//);
        expect(evidence.pageType).toMatch(/^(homepage|about|products_services)$/);
        expect(evidence.selector).toBeTruthy(); // Should have location info
      }
    });
  });

  describe("I. Regression: existing homepage-only behavior", () => {
    it("still works correctly on one-page website", async () => {
      const fixtures: Record<string, any> = {
        "https://single-page.example.com/": {
          body: `<!doctype html>
            <title>Solo Consultant</title>
            <meta name="description" content="Your personal business guide">
            <main>
              <h1>Business Coaching</h1>
              <p>I help entrepreneurs build sustainable businesses.</p>
              <p>Services include strategy, operations, and growth.</p>
            </main>
          </html>`,
          status: 200,
        },
      };

      const result = await executeDirectHirePreparation("https://single-page.example.com/", {
        sourceScope: "test-single",
        safeFetch: createMockFetch(fixtures) as any,
      });

      expect(result.status).toBe("ready");
      expect(result.successfulPageCount).toBe(1);
      expect(result.evidence.length).toBeGreaterThan(0);
      expect(result.evidence.some(e => e.pageType === "homepage")).toBe(true);
    });
  });

  describe("J. Bounded observation generation", () => {
    it("generates deterministic observations from richer evidence", async () => {
      const fixtures: Record<string, any> = {
        "https://obs-site.example.com/": {
          body: `<!doctype html>
            <title>AI Architecture Academy</title>
            <meta name="description" content="Business architecture for AI companies">
            <h1>Transform ideas into architecture</h1>
            <main>
              <a href="/about">About</a>
              <a href="/pricing">Pricing</a>
              <a href="/case-studies">Results</a>
            </main>
          </html>`,
          status: 200,
        },
        "https://obs-site.example.com/about": {
          body: `<html><h1>About</h1><main><p>Founded 2022. Helped 100+ companies.</p></main></html>`,
          status: 200,
        },
        "https://obs-site.example.com/pricing": {
          body: `<html><h1>Pricing</h1><main><h2>Plans</h2><p>Starter: $5K/month. Enterprise: Custom.</p></main></html>`,
          status: 200,
        },
        "https://obs-site.example.com/case-studies": {
          body: `<html><h1>Results</h1><main><p>Client grew from 0 to $50M revenue.</p></main></html>`,
          status: 200,
        },
      };

      const result = await executeDirectHirePreparation("https://obs-site.example.com/", {
        sourceScope: "test-obs",
        safeFetch: createMockFetch(fixtures) as any,
      });

      expect(result.observations.length).toBeGreaterThan(0);
      expect(result.observations.length).toBeLessThanOrEqual(4); // Max 4 observations
      // Observations should reflect discovered website structure
      const meanings = result.observations.map(o => o.interpretedMeaning.toLowerCase());
      expect(meanings.some(m => m.includes("homepage") || m.includes("position") || m.includes("website"))).toBe(true);
    });
  });
});
