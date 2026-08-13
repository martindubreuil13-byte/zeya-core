import { createHash } from "node:crypto";
import {
  evidenceFromExtractedPage,
  extractWebsitePage,
  WEBSITE_EXTRACTION_VERSION,
  type ExtractedWebsitePage,
  type WebsiteEvidenceKind,
  type WebsitePageType,
} from "../research/html-extraction";
import {
  robotsAllowsPath,
  safeFetchPublicSite,
  SafeFetchError,
  WEBSITE_RESEARCH_LIMITS,
  type SafeFetchDependencies,
  type SafeFetchFailureCode,
} from "../research/safe-public-site-fetch";
import type {
  DirectHireProgress,
  DirectHireSafeFailureCode,
} from "./direct-hire-contract";

export type WebsiteEvidenceDraft = {
  sourceKey: string;
  rawStatement: string;
  requestedUrl: string;
  finalUrl: string;
  retrievedAt: string;
  documentContentHash: string;
  pageType: WebsitePageType;
  kind: WebsiteEvidenceKind;
  selector: string;
  extractionVersion: string;
  affectedDomains: string[];
};

export type WebsiteObservationDraft = {
  observationKey: string;
  evidenceSourceKey: string;
  interpretedMeaning: string;
  confidence: number;
  affectedDomains: string[];
};

export type PreparationExecutionResult = {
  status: "ready" | "partial" | "failed";
  failureCode: DirectHireSafeFailureCode | null;
  progress: DirectHireProgress;
  successfulPageCount: number;
  failedPageCount: number;
  evidence: WebsiteEvidenceDraft[];
  observations: WebsiteObservationDraft[];
};

type PreparationDependencies = {
  sourceScope: string;
  safeFetch?: typeof safeFetchPublicSite;
  safeFetchDependencies?: SafeFetchDependencies;
  now?: () => Date;
};

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sourceKey(
  sourceScope: string,
  page: ExtractedWebsitePage,
  kind: WebsiteEvidenceKind,
  excerpt: string,
): string {
  return hash([
    WEBSITE_EXTRACTION_VERSION,
    sourceScope,
    page.requestedUrl,
    page.finalUrl,
    page.documentContentHash,
    page.pageType,
    kind,
    hash(excerpt),
  ].join("|"));
}

function toEvidence(sourceScope: string, page: ExtractedWebsitePage): WebsiteEvidenceDraft[] {
  return evidenceFromExtractedPage(page).map((item) => ({
    sourceKey: sourceKey(sourceScope, page, item.kind, item.excerpt),
    rawStatement: item.excerpt,
    requestedUrl: page.requestedUrl,
    finalUrl: page.finalUrl,
    retrievedAt: page.retrievedAt,
    documentContentHash: page.documentContentHash,
    pageType: page.pageType,
    kind: item.kind,
    selector: item.selector,
    extractionVersion: WEBSITE_EXTRACTION_VERSION,
    affectedDomains: item.affectedDomains,
  }));
}

function concise(value: string, maximum = 280): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1).trimEnd()}…`;
}

export function createDeterministicWebsiteObservations(
  evidence: WebsiteEvidenceDraft[],
): WebsiteObservationDraft[] {
  const observations: WebsiteObservationDraft[] = [];
  const positioning = evidence.find((item) =>
    item.pageType === "homepage" &&
    (item.kind === "primary_heading" || item.kind === "meta_description") &&
    item.rawStatement.length >= 20,
  );
  if (positioning) observations.push({
    observationKey: hash(`positioning|${positioning.sourceKey}`),
    evidenceSourceKey: positioning.sourceKey,
    interpretedMeaning: `The homepage appears to position the business with this language: “${concise(positioning.rawStatement)}”`,
    confidence: 50,
    affectedDomains: ["positioning"],
  });

  const services = evidence.find((item) =>
    item.pageType === "products_services" &&
    ["section_text", "section_list", "products_services_excerpt"].includes(item.kind) &&
    item.rawStatement.length >= 80,
  );
  if (services) observations.push({
    observationKey: hash(`services|${services.sourceKey}`),
    evidenceSourceKey: services.sourceKey,
    interpretedMeaning: `The services page appears to emphasize this public description: “${concise(services.rawStatement)}”`,
    confidence: 50,
    affectedDomains: ["offer"],
  });

  const absence = evidence.find((item) => item.kind === "explicit_absence");
  if (absence) observations.push({
    observationKey: hash(`clarity|${absence.sourceKey}`),
    evidenceSourceKey: absence.sourceKey,
    interpretedMeaning: "The current homepage may not clearly state one of the basic signals used to understand the business.",
    confidence: 40,
    affectedDomains: ["business_identity", "positioning"],
  });
  for (const [pageType, observationKey, meaning, domains] of [
    ["pricing", "pricing-present", "The public website contains explicit pricing or package information.", ["whatYouSell", "authorityBoundaries"]],
    ["case_studies", "proof-present", "The public website contains case-study or customer-outcome material.", ["whyCustomersShouldCare"]],
    ["customers", "customers-present", "The public website identifies customers or customer segments.", ["whoItIsFor"]],
    ["methodology", "methodology-present", "The public website describes a methodology, process, or way of working.", ["whatYouSell", "whyCustomersShouldCare"]],
  ] as const) {
    const source = evidence.find((item) => item.pageType === pageType && item.kind !== "title");
    if (source) observations.push({
      observationKey: hash(`${observationKey}|${source.sourceKey}`),
      evidenceSourceKey: source.sourceKey,
      interpretedMeaning: meaning,
      confidence: 60,
      affectedDomains: [...domains],
    });
  }
  const representedTypes = new Set(evidence.map((item) => item.pageType).filter((type) => type !== "homepage"));
  const breadthSource = evidence.find((item) => item.pageType !== "homepage");
  if (breadthSource && representedTypes.size >= 3) observations.push({
    observationKey: hash(`research-breadth|${[...representedTypes].sort().join("|")}|${breadthSource.sourceKey}`),
    evidenceSourceKey: breadthSource.sourceKey,
    interpretedMeaning: `The website provides substantive business information across ${representedTypes.size} distinct page categories.`,
    confidence: 60,
    affectedDomains: ["business_identity", "offer", "positioning"],
  });
  return observations.slice(0, 3);
}

function failureCode(error: unknown): DirectHireSafeFailureCode {
  return error instanceof SafeFetchError
    ? error.code
    : "request_failed";
}

function homepageFailureCode(error: unknown, submittedUrl: string): DirectHireSafeFailureCode {
  let submittedOverHttp = false;
  try {
    submittedOverHttp = new URL(submittedUrl).protocol === "http:";
  } catch {
    return "unsupported_site";
  }
  const code = failureCode(error);
  return submittedOverHttp && ["dns_failed", "request_failed", "request_timeout"].includes(code)
    ? "unsupported_site"
    : code;
}

async function fetchRobots(
  homepageUrl: string,
  signal: AbortSignal,
  dependencies: PreparationDependencies,
  maxBytes: number,
): Promise<{ text: string; totalBytes: number } | null> {
  const url = new URL("/robots.txt", homepageUrl).toString();
  try {
    const fetched = await (dependencies.safeFetch ?? safeFetchPublicSite)(url, {
      maxBytes: Math.min(WEBSITE_RESEARCH_LIMITS.robotsMaxBytes, maxBytes),
      acceptedContentTypes: /^(?:text\/plain|text\/html)(?:;|$)/i,
      signal,
      dependencies: dependencies.safeFetchDependencies,
    });
    return { text: fetched.body.toString("utf8"), totalBytes: fetched.totalBytes };
  } catch {
    return null;
  }
}

export async function executeDirectHirePreparation(
  websiteUrl: string,
  dependencies: PreparationDependencies,
): Promise<PreparationExecutionResult> {
  if (!dependencies.sourceScope) {
    throw new Error("Direct Hire preparation source scope is required");
  }
  const progress: DirectHireProgress = {
    validating_destination: "running",
    homepage: "pending",
    about: "pending",
    products_services: "pending",
    evidence: "pending",
    observations: "pending",
  };
  const evidence: WebsiteEvidenceDraft[] = [];
  let successfulPageCount = 0;
  let failedPageCount = 0;
  let totalHtmlBytes = 0;
  let retainedCharacters = 0;
  const retainedContentByPage = new Set<string>();
  const controller = new AbortController();
  const runTimer = setTimeout(() => controller.abort(), WEBSITE_RESEARCH_LIMITS.runTimeoutMs);
  const fetchPage = dependencies.safeFetch ?? safeFetchPublicSite;

  try {
    progress.validating_destination = "complete";
    let homepage;
    try {
      homepage = await fetchPage(websiteUrl, {
        signal: controller.signal,
        dependencies: dependencies.safeFetchDependencies,
      });
    } catch (error) {
      progress.homepage = "failed";
      progress.evidence = "failed";
      progress.observations = "skipped";
      return {
        status: "failed",
        failureCode: homepageFailureCode(error, websiteUrl),
        progress,
        successfulPageCount: 0,
        failedPageCount: 1,
        evidence: [],
        observations: [],
      };
    }

    totalHtmlBytes += homepage.totalBytes;
    progress.homepage = "complete";
    successfulPageCount += 1;
    const homepagePage = extractWebsitePage({
      html: homepage.body,
      requestedUrl: homepage.requestedUrl,
      finalUrl: homepage.finalUrl,
      pageType: "homepage",
      retrievedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    });
    const homepageEvidence = toEvidence(dependencies.sourceScope, homepagePage).filter((item) => {
      const contentKey = `${item.finalUrl}|${hash(item.rawStatement.toLowerCase().replace(/\s+/g, " ").trim())}`;
      if (retainedContentByPage.has(contentKey)) return false;
      retainedContentByPage.add(contentKey);
      return true;
    });
    evidence.push(...homepageEvidence);
    retainedCharacters += homepageEvidence.reduce((sum, item) => sum + item.rawStatement.length, 0);

    // Policy: the owner-submitted homepage is fetched regardless of robots.txt.
    // robots.txt applies only to automatically discovered optional pages.
    const robots = await fetchRobots(
      homepage.finalUrl,
      controller.signal,
      dependencies,
      WEBSITE_RESEARCH_LIMITS.maxRunBytes - totalHtmlBytes,
    );
    totalHtmlBytes += robots?.totalBytes ?? 0;
    const selectedPages = homepagePage.discoveredPages.slice(0, WEBSITE_RESEARCH_LIMITS.maxPages - 1);
    for (const discovered of selectedPages) {
      const progressKey = discovered.pageType === "about" || discovered.pageType === "products_services"
        ? discovered.pageType
        : null;
      const discoveredUrl = new URL(discovered.url);
      const robotsPath = `${discoveredUrl.pathname}${discoveredUrl.search}`;
      if (robots && !robotsAllowsPath(robots.text, robotsPath)) {
        if (progressKey) progress[progressKey] = "skipped";
        failedPageCount += 1;
        continue;
      }
      if (progressKey) progress[progressKey] = "running";
      try {
        const remainingBytes = WEBSITE_RESEARCH_LIMITS.maxRunBytes - totalHtmlBytes;
        if (remainingBytes <= 0) throw new SafeFetchError("response_too_large");
        const page = await fetchPage(discovered.url, {
          maxBytes: Math.min(
            WEBSITE_RESEARCH_LIMITS.maxPageBytes,
            remainingBytes,
          ),
          signal: controller.signal,
          dependencies: dependencies.safeFetchDependencies,
        });
        if (totalHtmlBytes + page.totalBytes > WEBSITE_RESEARCH_LIMITS.maxRunBytes) {
          throw new SafeFetchError("response_too_large");
        }
        totalHtmlBytes += page.totalBytes;
        const extracted = extractWebsitePage({
          html: page.body,
          requestedUrl: page.requestedUrl,
          finalUrl: page.finalUrl,
          pageType: discovered.pageType,
          retrievedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
        });
        const pageEvidence = toEvidence(dependencies.sourceScope, extracted).filter((item) => {
          const contentKey = `${item.finalUrl}|${hash(item.rawStatement.toLowerCase().replace(/\s+/g, " ").trim())}`;
          if (retainedContentByPage.has(contentKey)) return false;
          if (retainedCharacters + item.rawStatement.length > WEBSITE_RESEARCH_LIMITS.maxRetainedCharactersPerRun) {
            return false;
          }
          retainedContentByPage.add(contentKey);
          retainedCharacters += item.rawStatement.length;
          return true;
        });
        if (pageEvidence.length === 0) {
          throw new SafeFetchError("request_failed");
        }
        evidence.push(...pageEvidence);
        successfulPageCount += 1;
        if (progressKey) progress[progressKey] = "complete";
      } catch {
        failedPageCount += 1;
        if (progressKey) progress[progressKey] = "failed";
      }
    }

    for (const key of ["about", "products_services"] as const) {
      if (progress[key] === "pending") progress[key] = "skipped";
    }
    progress.evidence = evidence.length ? "complete" : "failed";
    const observations = createDeterministicWebsiteObservations(evidence);
    progress.observations = observations.length ? "complete" : "skipped";
    if (!evidence.length) {
      return {
        status: "failed",
        failureCode: "no_usable_evidence",
        progress,
        successfulPageCount,
        failedPageCount,
        evidence: [],
        observations: [],
      };
    }
    return {
      status: failedPageCount > 0 ? "partial" : "ready",
      failureCode: null,
      progress,
      successfulPageCount,
      failedPageCount,
      evidence,
      observations,
    };
  } finally {
    clearTimeout(runTimer);
  }
}

export function isSafePreparationFailureCode(value: string): value is SafeFetchFailureCode | "robots_disallowed" | "no_usable_evidence" | "persistence_failed" {
  return [
    "unsupported_site", "unsafe_destination", "dns_failed", "redirect_blocked",
    "too_many_redirects", "response_too_large", "response_compressed",
    "unsupported_content_type", "request_timeout", "request_failed",
    "robots_disallowed", "no_usable_evidence", "persistence_failed",
  ].includes(value);
}
