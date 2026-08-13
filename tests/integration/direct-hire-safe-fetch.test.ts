import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  createPinnedLookup,
  isGlobalPublicAddress,
  normalizeResearchUrl,
  robotsAllowsPath,
  safeFetchPublicSite,
  SafeFetchError,
  WEBSITE_RESEARCH_LIMITS,
} from "../../lib/research/safe-public-site-fetch";

type MockReply = { status?: number; headers?: Record<string, string>; body?: string };

function requestSequence(replies: MockReply[], pinned: string[] = []) {
  let index = 0;
  return ((options: Record<string, unknown>, callback: (response: PassThrough & {
    statusCode: number;
    headers: Record<string, string>;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
    request.end = () => {
      const lookup = options.lookup as (
        hostname: string,
        lookupOptions: unknown,
        callback: (error: null, address: string, family: number) => void,
      ) => void;
      lookup(String(options.hostname), {}, (_error, address) => pinned.push(address));
      const reply = replies[index++] ?? {};
      const response = new PassThrough() as PassThrough & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = reply.status ?? 200;
      response.headers = reply.headers ?? { "content-type": "text/html" };
      callback(response);
      response.end(reply.body ?? "<html><title>Safe</title></html>");
    };
    return request;
  }) as never;
}

function node24LookupRequest(pinned: string[]) {
  return ((options: Record<string, unknown>, callback: (response: PassThrough & {
    statusCode: number;
    headers: Record<string, string>;
  }) => void) => {
    const request = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error: Error) => void;
    };
    request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
    request.end = () => {
      const lookup = options.lookup as (
        hostname: string,
        lookupOptions: { all: true },
        callback: (
          error: NodeJS.ErrnoException | null,
          addresses: Array<{ address: string; family: number }>,
        ) => void,
      ) => void;
      lookup(String(options.hostname), { all: true }, (error, addresses) => {
        if (error) {
          request.emit("error", error);
          return;
        }
        if (!Array.isArray(addresses)) {
          request.emit("error", Object.assign(new Error("invalid lookup result"), {
            code: "ERR_INVALID_IP_ADDRESS",
          }));
          return;
        }
        pinned.push(...addresses.map(({ address }) => address));
        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = 200;
        response.headers = { "content-type": "text/html" };
        callback(response);
        response.end("<html><title>Safe</title></html>");
      });
    };
    return request;
  }) as never;
}

describe("Direct Hire safe public-site fetch", () => {
  it("returns the pinned address in the ordinary single-address lookup shape", () => {
    const lookup = createPinnedLookup({ address: "93.184.216.34", family: 4 });
    lookup("not-observed.example", {}, (error, address, family) => {
      expect(error).toBeNull();
      expect(address).toBe("93.184.216.34");
      expect(family).toBe(4);
    });
  });

  it("returns one pinned address record when Node 24 requests all addresses", () => {
    const lookup = createPinnedLookup({ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 });
    lookup("not-observed.example", { all: true }, (error, addresses) => {
      expect(error).toBeNull();
      expect(addresses).toEqual([{
        address: "2606:2800:220:1:248:1893:25c8:1946",
        family: 6,
      }]);
    });
  });

  it("reproduces the pre-patch malformed shape under Node 24 automatic-family lookup", () => {
    let result: unknown;
    const legacyLookup = (
      _hostname: string,
      _options: { all: true },
      callback: (error: null, address: string, family: number) => void,
    ) => callback(null, "93.184.216.34", 4);
    legacyLookup("not-observed.example", { all: true }, (_error, addresses) => {
      result = addresses;
    });
    expect(Array.isArray(result)).toBe(false);
  });

  it("satisfies Node 24 automatic-family lookup without weakening address pinning", async () => {
    const pinned: string[] = [];
    await expect(safeFetchPublicSite("https://example.com", {
      dependencies: {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request: node24LookupRequest(pinned),
      },
    })).resolves.toMatchObject({ status: 200 });
    expect(pinned).toEqual(["93.184.216.34"]);
  });

  it("logs only the safe native code and construction stage", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitive = "https://secret.example/private?token=credential owner-email-value 203.0.113.8";
    const constructionFailure = (() => {
      throw Object.assign(new Error(sensitive), { code: "ERR_INVALID_IP_ADDRESS" });
    }) as never;
    try {
      await expect(safeFetchPublicSite("https://example.com", {
        dependencies: {
          resolve: async () => [{ address: "93.184.216.34", family: 4 }],
          request: constructionFailure,
        },
      })).rejects.toMatchObject({ code: "request_failed" });
      expect(diagnostic).toHaveBeenCalledWith({
        event: "direct_hire_safe_fetch_failure",
        stage: "request_construction",
        nativeErrorCode: "ERR_INVALID_IP_ADDRESS",
      });
      const logged = JSON.stringify(diagnostic.mock.calls);
      for (const forbidden of ["secret.example", "token=", "credential", "owner-email-value", "203.0.113.8"]) {
        expect(logged).not.toContain(forbidden);
      }
    } finally {
      diagnostic.mockRestore();
    }
  });

  it("distinguishes DNS, socket, response-stream, and HTTP-status failures", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pinned = async () => [{ address: "93.184.216.34", family: 4 as const }];
    const socketFailure = (() => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
      request.end = () => queueMicrotask(() => request.emit("error", Object.assign(
        new Error("must not be logged"),
        { code: "ECONNRESET" },
      )));
      return request;
    }) as never;
    const responseFailure = ((_options: unknown, callback: (response: PassThrough & {
      statusCode: number;
      headers: Record<string, string>;
    }) => void) => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
      request.end = () => {
        const response = new PassThrough() as PassThrough & {
          statusCode: number;
          headers: Record<string, string>;
        };
        response.statusCode = 200;
        response.headers = { "content-type": "text/html" };
        callback(response);
        response.emit("error", Object.assign(new Error("must not be logged"), { code: "EPROTO" }));
      };
      return request;
    }) as never;
    try {
      await expect(safeFetchPublicSite("https://example.com", {
        dependencies: {
          resolve: async () => {
            throw Object.assign(new Error("must not be logged"), { code: "EAI_AGAIN" });
          },
        },
      })).rejects.toMatchObject({ code: "dns_failed" });
      expect(diagnostic).toHaveBeenLastCalledWith({
        event: "direct_hire_safe_fetch_failure",
        stage: "dns",
        nativeErrorCode: "EAI_AGAIN",
      });

      await expect(safeFetchPublicSite("https://example.com", {
        dependencies: { resolve: pinned, request: socketFailure },
      })).rejects.toMatchObject({ code: "request_failed" });
      expect(diagnostic).toHaveBeenLastCalledWith({
        event: "direct_hire_safe_fetch_failure",
        stage: "request_socket",
        nativeErrorCode: "ECONNRESET",
      });

      await expect(safeFetchPublicSite("https://example.com", {
        dependencies: { resolve: pinned, request: responseFailure },
      })).rejects.toMatchObject({ code: "request_failed" });
      expect(diagnostic).toHaveBeenLastCalledWith({
        event: "direct_hire_safe_fetch_failure",
        stage: "response_stream",
        nativeErrorCode: "EPROTO",
      });

      await expect(safeFetchPublicSite("https://example.com", {
        dependencies: { resolve: pinned, request: requestSequence([{ status: 503 }]) },
      })).rejects.toMatchObject({ code: "request_failed" });
      expect(diagnostic).toHaveBeenLastCalledWith({
        event: "direct_hire_safe_fetch_failure",
        stage: "http_status",
        nativeErrorCode: "unknown",
        statusClass: "5xx",
      });
      expect(JSON.stringify(diagnostic.mock.calls)).not.toContain("must not be logged");
    } finally {
      diagnostic.mockRestore();
    }
  });
  it("freezes the approved page, byte, redirect, and timeout limits", () => {
    expect(WEBSITE_RESEARCH_LIMITS).toMatchObject({
      maxPages: 10,
      maxDiscoveredLinks: 40,
      maxRedirects: 3,
      maxPageBytes: 512 * 1024,
      maxRunBytes: 5 * 1024 * 1024,
      maxExtractedCharactersPerPage: 30_000,
      maxRetainedCharactersPerRun: 120_000,
      headerTimeoutMs: 5_000,
      pageTimeoutMs: 10_000,
      runTimeoutMs: 45_000,
      robotsMaxBytes: 64 * 1024,
    });
  });
  it("upgrades HTTP to HTTPS and rejects unsafe URL forms", () => {
    expect(normalizeResearchUrl("http://example.com/path").toString()).toBe("https://example.com/path");
    for (const value of [
      "ftp://example.com", "file:///etc/passwd", "https://user:pass@example.com",
      "https://example.com:8443", "https://127.0.0.1", "https://[::1]",
      "https://localhost", "https://service.internal", "https://example.com/#fragment",
    ]) expect(() => normalizeResearchUrl(value), value).toThrow(SafeFetchError);
  });

  it("blocks private, special-use, mapped, and non-global addresses", () => {
    for (const address of [
      "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
      "172.16.0.1", "192.168.1.1", "192.0.2.1", "198.18.0.1", "198.51.100.1",
      "192.31.196.1", "192.52.193.1", "192.88.99.1", "192.175.48.1",
      "203.0.113.1", "224.0.0.1", "255.255.255.255", "::1", "::ffff:127.0.0.1",
      "fc00::1", "fe80::1", "ff00::1", "2001::1", "2001:db8::1", "2002::1", "3fff::1",
    ]) expect(isGlobalPublicAddress(address), address).toBe(false);
    expect(isGlobalPublicAddress("93.184.216.34")).toBe(true);
    expect(isGlobalPublicAddress("2606:2800:220:1:248:1893:25c8:1946")).toBe(true);
  });

  it("rejects mixed public/private DNS results before opening a request", async () => {
    await expect(safeFetchPublicSite("https://example.com", {
      dependencies: {
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address: "10.0.0.2", family: 4 },
        ],
        request: requestSequence([]),
      },
    })).rejects.toMatchObject({ code: "unsafe_destination" });
  });

  it("re-resolves redirects and blocks a rebinding result", async () => {
    let resolution = 0;
    await expect(safeFetchPublicSite("https://example.com", {
      dependencies: {
        resolve: async () => resolution++ === 0
          ? [{ address: "93.184.216.34", family: 4 }]
          : [{ address: "127.0.0.1", family: 4 }],
        request: requestSequence([
          { status: 302, headers: { location: "/next", "content-type": "text/html" } },
        ]),
      },
    })).rejects.toMatchObject({ code: "unsafe_destination" });
    expect(resolution).toBe(2);
  });

  it("pins the connection and permits only the exact www-equivalent redirect boundary", async () => {
    const pinned: string[] = [];
    const result = await safeFetchPublicSite("https://example.com", {
      dependencies: {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request: requestSequence([
          { status: 302, headers: { location: "https://www.example.com/about", "content-type": "text/html" } },
          { body: "<html><title>About</title></html>" },
        ], pinned),
      },
    });
    expect(result.finalUrl).toBe("https://www.example.com/about");
    expect(pinned).toEqual(["93.184.216.34", "93.184.216.34"]);
  });

  it("rejects cross-site redirects, compression, content types, byte overflow, and aborts", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 as const }];
    await expect(safeFetchPublicSite("https://example.com", { dependencies: {
      resolve, request: requestSequence([{ status: 302, headers: { location: "https://evil.example.net", "content-type": "text/html" } }]),
    } })).rejects.toMatchObject({ code: "redirect_blocked" });
    await expect(safeFetchPublicSite("https://example.com", { dependencies: {
      resolve, request: requestSequence([{ headers: { "content-type": "text/html", "content-encoding": "gzip" } }]),
    } })).rejects.toMatchObject({ code: "response_compressed" });
    await expect(safeFetchPublicSite("https://example.com", { dependencies: {
      resolve, request: requestSequence([{ headers: { "content-type": "application/pdf" } }]),
    } })).rejects.toMatchObject({ code: "unsupported_content_type" });
    await expect(safeFetchPublicSite("https://example.com", { maxBytes: 3, dependencies: {
      resolve, request: requestSequence([{ body: "oversized" }]),
    } })).rejects.toMatchObject({ code: "response_too_large" });
    const controller = new AbortController();
    controller.abort();
    await expect(safeFetchPublicSite("https://example.com", { signal: controller.signal, dependencies: {
      resolve, request: requestSequence([]),
    } })).rejects.toMatchObject({ code: "request_timeout" });
  });

  it("stops redirect loops at three redirects and counts redirect bodies in the byte cap", async () => {
    const resolve = async () => [{ address: "93.184.216.34", family: 4 as const }];
    await expect(safeFetchPublicSite("https://example.com", { dependencies: {
      resolve,
      request: requestSequence(Array.from({ length: 4 }, () => ({
        status: 302,
        headers: { location: "/loop", "content-type": "text/html" },
      }))),
    } })).rejects.toMatchObject({ code: "too_many_redirects" });
    await expect(safeFetchPublicSite("https://example.com", {
      maxBytes: 6,
      dependencies: {
        resolve,
        request: requestSequence([
          { status: 302, headers: { location: "/next", "content-type": "text/html" }, body: "1234" },
          { body: "5678" },
        ]),
      },
    })).rejects.toMatchObject({ code: "response_too_large" });
  });

  it("terminates an in-flight request when the execution signal expires", async () => {
    const neverResponds = (() => {
      const request = new EventEmitter() as EventEmitter & {
        end: () => void;
        destroy: (error: Error) => void;
      };
      request.end = () => undefined;
      request.destroy = (error) => queueMicrotask(() => request.emit("error", error));
      return request;
    }) as never;
    await expect(safeFetchPublicSite("https://example.com", {
      signal: AbortSignal.timeout(5),
      dependencies: {
        resolve: async () => [{ address: "93.184.216.34", family: 4 }],
        request: neverResponds,
      },
    })).rejects.toMatchObject({ code: "request_timeout" });
  });

  it("honors applicable robots rules for optional paths", () => {
    const robots = "User-agent: *\nDisallow: /private\nAllow: /private/public\nSitemap: https://example.com/sitemap.xml";
    expect(robotsAllowsPath(robots, "/about")).toBe(true);
    expect(robotsAllowsPath(robots, "/private/team")).toBe(false);
    expect(robotsAllowsPath(robots, "/private/public/story")).toBe(true);
  });
});
