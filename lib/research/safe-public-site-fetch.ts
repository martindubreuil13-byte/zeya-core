import { resolve4, resolve6 } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";

export const WEBSITE_RESEARCH_LIMITS = {
  maxPages: 3,
  maxDiscoveredLinks: 2,
  maxRedirects: 3,
  maxPageBytes: 512 * 1024,
  maxRunBytes: 1_310_720,
  maxExtractedCharactersPerPage: 20_000,
  maxRetainedCharactersPerRun: 40_000,
  headerTimeoutMs: 5_000,
  pageTimeoutMs: 10_000,
  runTimeoutMs: 25_000,
  robotsMaxBytes: 64 * 1024,
} as const;

export type SafeFetchFailureCode =
  | "unsupported_site"
  | "unsafe_destination"
  | "dns_failed"
  | "redirect_blocked"
  | "too_many_redirects"
  | "response_too_large"
  | "response_compressed"
  | "unsupported_content_type"
  | "request_timeout"
  | "request_failed";

export class SafeFetchError extends Error {
  constructor(public readonly code: SafeFetchFailureCode) {
    super(code);
    this.name = "SafeFetchError";
  }
}

type SafeFetchDiagnosticStage =
  | "dns"
  | "request_construction"
  | "request_socket"
  | "response_stream"
  | "http_status"
  | "unknown";

function nativeErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    && typeof error.code === "string"
    ? error.code
    : "unknown";
}

function logSafeFetchFailure(
  stage: SafeFetchDiagnosticStage,
  error: unknown,
  statusClass?: "4xx" | "5xx" | "other",
): void {
  console.error({
    event: "direct_hire_safe_fetch_failure",
    stage,
    nativeErrorCode: nativeErrorCode(error),
    ...(statusClass ? { statusClass } : {}),
  });
}

export type ResolvedAddress = { address: string; family: 4 | 6 };

export function createPinnedLookup(pinned: ResolvedAddress): LookupFunction {
  return (_hostname, lookupOptions, callback) => {
    if (lookupOptions.all === true) {
      callback(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    callback(null, pinned.address, pinned.family);
  };
}

export type SafeFetchDependencies = {
  resolve?: (hostname: string) => Promise<ResolvedAddress[]>;
  request?: typeof httpsRequest;
};

export type SafeFetchResult = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
  redirectCount: number;
  totalBytes: number;
};

function parseIpv4(address: string): number[] | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  const values = parts.map((part) => Number(part));
  return values.every((value, index) =>
    Number.isInteger(value) && value >= 0 && value <= 255 && String(value) === parts[index]
  ) ? values : null;
}

function isGlobalIpv4(address: string): boolean {
  const value = parseIpv4(address);
  if (!value) return false;
  const [a, b, c] = value;
  if (a === 0 || a === 10 || a === 127) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 192 && b === 0 && c === 0) return false;
  if (a === 192 && b === 0 && c === 2) return false;
  if (a === 192 && b === 31 && c === 196) return false;
  if (a === 192 && b === 52 && c === 193) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 192 && b === 175 && c === 48) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  if (a === 198 && b === 51 && c === 100) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  if (a >= 224) return false;
  return true;
}

function expandIpv6(address: string): number[] | null {
  const withoutZone = address.split("%")[0].toLowerCase();
  if (withoutZone.includes(".")) return null;
  const sides = withoutZone.split("::");
  if (sides.length > 2) return null;
  const left = sides[0] ? sides[0].split(":") : [];
  const right = sides[1] ? sides[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((sides.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = sides.length === 2
    ? [...left, ...Array(missing).fill("0"), ...right]
    : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) {
    return null;
  }
  return parts.map((part) => Number.parseInt(part, 16));
}

function isGlobalIpv6(address: string): boolean {
  const parts = expandIpv6(address);
  if (!parts) return false;
  // Only global-unicast space is eligible. Explicitly exclude special-use
  // allocations inside 2000::/3, including documentation and ORCHID ranges.
  if ((parts[0] & 0xe000) !== 0x2000) return false;
  if (parts[0] === 0x2001 && parts[1] <= 0x01ff) return false;
  if (parts[0] === 0x2001 && parts[1] === 0x0db8) return false;
  if (parts[0] === 0x2002) return false;
  if (parts[0] >= 0x3ff0) return false;
  return true;
}

export function isGlobalPublicAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? isGlobalIpv4(address)
    : family === 6
      ? isGlobalIpv6(address)
      : false;
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, "");
}

function isAllowedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  if (
    !normalized ||
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized.endsWith(".lan") ||
    normalized.endsWith(".home") ||
    normalized.endsWith(".home.arpa") ||
    normalized.endsWith(".onion") ||
    isIP(normalized) !== 0
  ) return false;
  const labels = normalized.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

export function normalizeResearchUrl(input: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new SafeFetchError("unsupported_site");
  }
  if (parsed.protocol === "http:") {
    parsed.protocol = "https:";
    if (parsed.port === "80") parsed.port = "";
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash ||
    (parsed.port && parsed.port !== "443") ||
    !isAllowedHostname(parsed.hostname)
  ) throw new SafeFetchError("unsupported_site");
  parsed.port = "";
  return parsed;
}

export function isSameResearchSite(originalHostname: string, nextHostname: string): boolean {
  const withoutWww = (value: string) => normalizeHostname(value).replace(/^www\./, "");
  return withoutWww(originalHostname) === withoutWww(nextHostname);
}

async function defaultResolve(hostname: string): Promise<ResolvedAddress[]> {
  const resolveOptional = async (
    resolver: (value: string) => Promise<string[]>,
  ): Promise<string[]> => {
    try {
      return await resolver(hostname);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String(error.code)
        : "";
      if (code === "ENODATA" || code === "ENOTFOUND") return [];
      throw error;
    }
  };
  const [v4, v6] = await Promise.all([
    resolveOptional(resolve4),
    resolveOptional(resolve6),
  ]);
  return [
    ...v4.map((address) => ({ address, family: 4 as const })),
    ...v6.map((address) => ({ address, family: 6 as const })),
  ];
}

function validateResolvedAddresses(addresses: ResolvedAddress[]): ResolvedAddress {
  if (addresses.length === 0) throw new SafeFetchError("dns_failed");
  if (addresses.some(({ address, family }) =>
    isIP(address) !== family || !isGlobalPublicAddress(address)
  )) {
    throw new SafeFetchError("unsafe_destination");
  }
  return addresses.find(({ family }) => family === 4) ?? addresses[0];
}

type RequestOnceOptions = {
  maxBytes: number;
  acceptedContentTypes: RegExp;
  signal?: AbortSignal;
  dependencies: SafeFetchDependencies;
};

async function requestOnce(url: URL, options: RequestOnceOptions): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}> {
  let pinned: ResolvedAddress;
  try {
    const addresses = await (options.dependencies.resolve ?? defaultResolve)(url.hostname);
    pinned = validateResolvedAddresses(addresses);
  } catch (error) {
    logSafeFetchFailure("dns", error);
    throw error instanceof SafeFetchError ? error : new SafeFetchError("dns_failed");
  }
  const requestImpl = options.dependencies.request ?? httpsRequest;

  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>((resolve, reject) => {
    let settled = false;
    let headerTimer: ReturnType<typeof setTimeout> | undefined;
    let pageTimer: ReturnType<typeof setTimeout> | undefined;
    let request: ReturnType<typeof httpsRequest>;
    const onAbort = () => request.destroy(new SafeFetchError("request_timeout"));
    const finish = (error?: Error, value?: { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }) => {
      if (settled) return;
      settled = true;
      clearTimeout(headerTimer);
      clearTimeout(pageTimer);
      options.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve(value!);
    };
    try {
      request = requestImpl({
        protocol: "https:",
        hostname: url.hostname,
        servername: url.hostname,
        port: 443,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/plain;q=0.5",
          "Accept-Encoding": "identity",
          "User-Agent": "ZeyaWebsiteResearch/1.0",
        },
        lookup: createPinnedLookup(pinned),
      }, (response) => {
        clearTimeout(headerTimer);
        const encoding = String(response.headers["content-encoding"] ?? "identity").toLowerCase();
        if (encoding !== "identity") {
          response.destroy();
          finish(new SafeFetchError("response_compressed"));
          return;
        }
        if (response.statusCode && response.statusCode >= 200 && response.statusCode < 300) {
          const contentType = String(response.headers["content-type"] ?? "").toLowerCase();
          if (!options.acceptedContentTypes.test(contentType)) {
            response.destroy();
            finish(new SafeFetchError("unsupported_content_type"));
            return;
          }
        }
        const declaredLength = Number(response.headers["content-length"]);
        if (Number.isFinite(declaredLength) && declaredLength > options.maxBytes) {
          response.destroy();
          finish(new SafeFetchError("response_too_large"));
          return;
        }
        const chunks: Buffer[] = [];
        let bytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          bytes += buffer.length;
          if (bytes > options.maxBytes) {
            response.destroy(new SafeFetchError("response_too_large"));
            return;
          }
          chunks.push(buffer);
        });
        response.on("end", () => finish(undefined, {
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }));
        response.on("error", (error) => {
          logSafeFetchFailure("response_stream", error);
          finish(error instanceof SafeFetchError ? error : new SafeFetchError("request_failed"));
        });
      });
    } catch (error) {
      logSafeFetchFailure("request_construction", error);
      finish(error instanceof SafeFetchError ? error : new SafeFetchError("request_failed"));
      return;
    }
    request.on("error", (error) => {
      logSafeFetchFailure("request_socket", error);
      finish(error instanceof SafeFetchError ? error : new SafeFetchError("request_failed"));
    });
    options.signal?.addEventListener("abort", onAbort, { once: true });
    headerTimer = setTimeout(() => request.destroy(new SafeFetchError("request_timeout")), WEBSITE_RESEARCH_LIMITS.headerTimeoutMs);
    pageTimer = setTimeout(() => request.destroy(new SafeFetchError("request_timeout")), WEBSITE_RESEARCH_LIMITS.pageTimeoutMs);
    if (options.signal?.aborted) {
      onAbort();
      return;
    }
    request.end();
  });
}

export async function safeFetchPublicSite(
  input: string,
  options: {
    maxBytes?: number;
    acceptedContentTypes?: RegExp;
    signal?: AbortSignal;
    dependencies?: SafeFetchDependencies;
  } = {},
): Promise<SafeFetchResult> {
  const requested = normalizeResearchUrl(input);
  const originalHostname = requested.hostname;
  let current = requested;
  let redirectCount = 0;
  let totalBytes = 0;
  const maxBytes = options.maxBytes ?? WEBSITE_RESEARCH_LIMITS.maxPageBytes;
  while (true) {
    const remainingBytes = maxBytes - totalBytes;
    if (remainingBytes <= 0) throw new SafeFetchError("response_too_large");
    const response = await requestOnce(current, {
      maxBytes: remainingBytes,
      acceptedContentTypes: options.acceptedContentTypes ?? /^(?:text\/html|application\/xhtml\+xml)(?:;|$)/i,
      signal: options.signal,
      dependencies: options.dependencies ?? {},
    });
    totalBytes += response.body.length;
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.location;
      if (!location || Array.isArray(location)) throw new SafeFetchError("redirect_blocked");
      redirectCount += 1;
      if (redirectCount > WEBSITE_RESEARCH_LIMITS.maxRedirects) {
        throw new SafeFetchError("too_many_redirects");
      }
      let next: URL;
      try {
        next = normalizeResearchUrl(new URL(location, current).toString());
      } catch {
        throw new SafeFetchError("redirect_blocked");
      }
      if (!isSameResearchSite(originalHostname, next.hostname)) {
        throw new SafeFetchError("redirect_blocked");
      }
      current = next;
      continue;
    }
    if (response.status < 200 || response.status >= 300) {
      const statusClass = response.status >= 400 && response.status < 500
        ? "4xx"
        : response.status >= 500 && response.status < 600
          ? "5xx"
          : "other";
      logSafeFetchFailure("http_status", null, statusClass);
      throw new SafeFetchError("request_failed");
    }
    return {
      requestedUrl: requested.toString(),
      finalUrl: current.toString(),
      status: response.status,
      contentType: String(response.headers["content-type"] ?? ""),
      body: response.body,
      redirectCount,
      totalBytes,
    };
  }
}

export function robotsAllowsPath(robots: string, path: string): boolean {
  const groups: Array<{ agents: string[]; disallow: string[]; allow: string[] }> = [];
  let current: { agents: string[]; disallow: string[]; allow: string[] } | null = null;
  for (const rawLine of robots.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const match = /^([^:]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (!current || current.disallow.length || current.allow.length) {
        current = { agents: [], disallow: [], allow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current && key === "disallow" && value) {
      current.disallow.push(value);
    } else if (current && key === "allow" && value) {
      current.allow.push(value);
    }
  }
  const applicable = groups.filter((group) =>
    group.agents.includes("zeyawebsiteresearch") || group.agents.includes("*"),
  );
  let best: { allowed: boolean; length: number } | null = null;
  for (const group of applicable) {
    for (const rule of group.disallow) {
      if (path.startsWith(rule) && (!best || rule.length > best.length)) {
        best = { allowed: false, length: rule.length };
      }
    }
    for (const rule of group.allow) {
      if (path.startsWith(rule) && (!best || rule.length >= best.length)) {
        best = { allowed: true, length: rule.length };
      }
    }
  }
  return best?.allowed ?? true;
}
