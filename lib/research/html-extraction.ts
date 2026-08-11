import { load } from "cheerio";
import { createHash } from "node:crypto";
import { isSameResearchSite, WEBSITE_RESEARCH_LIMITS } from "./safe-public-site-fetch";

export const WEBSITE_EXTRACTION_VERSION = "direct-hire-web-v1";

export type WebsitePageType = "homepage" | "about" | "products_services" | "registered_public_page";
export type WebsiteEvidenceKind =
  | "title"
  | "meta_description"
  | "primary_heading"
  | "main_excerpt"
  | "about_excerpt"
  | "products_services_excerpt"
  | "registered_page_excerpt"
  | "explicit_absence";

export type DiscoveredPage = {
  pageType: "about" | "products_services";
  url: string;
  label: string;
};

export type ExtractedWebsitePage = {
  pageType: WebsitePageType;
  requestedUrl: string;
  finalUrl: string;
  retrievedAt: string;
  documentContentHash: string;
  title: string | null;
  metaDescription: string | null;
  openGraph: { title: string | null; description: string | null };
  primaryHeading: string | null;
  mainExcerpt: string | null;
  discoveredPages: DiscoveredPage[];
};

function normalizedText(value: string | undefined | null, limit: number): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, limit) : null;
}

function meaningfulHeading(value: string | null): string | null {
  return value && value.length >= 3 ? value : null;
}

function classifyLink(label: string, pathname: string): DiscoveredPage["pageType"] | null {
  const candidate = `${label} ${pathname.replace(/[-_/]+/g, " ")}`.toLowerCase();
  if (/\b(?:about|company|our story|who we are)\b/.test(candidate)) return "about";
  if (/\b(?:products?|services?|solutions?|what we do)\b/.test(candidate)) {
    return "products_services";
  }
  return null;
}

export function extractWebsitePage(input: {
  html: Buffer | string;
  requestedUrl: string;
  finalUrl: string;
  pageType: WebsitePageType;
  retrievedAt?: string;
}): ExtractedWebsitePage {
  const html = Buffer.isBuffer(input.html) ? input.html.toString("utf8") : input.html;
  const $ = load(html);
  const raw = load(html);
  $("script,style,template,svg,form,dialog,noscript,iframe,canvas").remove();
  $("[hidden],[aria-hidden='true']").remove();

  const title = normalizedText($("title").first().text(), 300);
  const metaDescription = normalizedText(
    $("meta[name='description' i]").first().attr("content"),
    500,
  );
  const primaryHeading = meaningfulHeading(normalizedText($("h1").first().text(), 500));
  const openGraph = {
    title: normalizedText($("meta[property='og:title' i]").first().attr("content"), 300),
    description: normalizedText(
      $("meta[property='og:description' i]").first().attr("content"),
      500,
    ),
  };

  $("nav,footer,header,aside").remove();
  const contentRoot = $("main,article,[role='main']").first();
  const bodyText = contentRoot.length ? contentRoot.text() : $("body").text();
  const mainExcerpt = normalizedText(
    bodyText,
    WEBSITE_RESEARCH_LIMITS.maxExtractedCharactersPerPage,
  );

  const current = new URL(input.finalUrl);
  const discovered = new Map<DiscoveredPage["pageType"], DiscoveredPage>();
  raw("nav a[href],header a[href],a[href]").each((_index, element) => {
    if (discovered.size >= WEBSITE_RESEARCH_LIMITS.maxDiscoveredLinks) return;
    const href = raw(element).attr("href");
    const label = normalizedText(raw(element).text(), 120);
    if (!href || !label) return;
    let url: URL;
    try {
      url = new URL(href, current);
    } catch {
      return;
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.hash ||
      !isSameResearchSite(current.hostname, url.hostname)
    ) return;
    const pageType = classifyLink(label, url.pathname);
    if (!pageType || discovered.has(pageType)) return;
    discovered.set(pageType, { pageType, url: url.toString(), label });
  });

  return {
    pageType: input.pageType,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    documentContentHash: createHash("sha256").update(html).digest("hex"),
    title,
    metaDescription,
    openGraph,
    primaryHeading,
    mainExcerpt,
    discoveredPages: [...discovered.values()],
  };
}

export function evidenceFromExtractedPage(page: ExtractedWebsitePage): Array<{
  kind: WebsiteEvidenceKind;
  selector: string;
  excerpt: string;
  affectedDomains: string[];
}> {
  const records: Array<{
    kind: WebsiteEvidenceKind;
    selector: string;
    excerpt: string;
    affectedDomains: string[];
  }> = [];
  if (page.pageType === "homepage") {
    if (page.title) records.push({
      kind: "title", selector: "title", excerpt: page.title,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.metaDescription) records.push({
      kind: "meta_description", selector: "meta[name=description]",
      excerpt: page.metaDescription,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.primaryHeading) records.push({
      kind: "primary_heading", selector: "h1", excerpt: page.primaryHeading,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.mainExcerpt && page.mainExcerpt.length >= 80) records.push({
      kind: "main_excerpt", selector: "main", excerpt: page.mainExcerpt.slice(0, 2_000),
      affectedDomains: ["business_identity", "offer", "positioning"],
    });
    for (const [label, missing] of [
      ["title", !page.title],
      ["meta description", !page.metaDescription],
      ["primary heading", !page.primaryHeading],
    ] as const) {
      if (missing) records.push({
        kind: "explicit_absence",
        selector: label,
        excerpt: `No usable ${label} was present on the retrieved homepage.`,
        affectedDomains: ["business_identity", "positioning"],
      });
    }
  } else if (page.pageType === "registered_public_page") {
    if (page.title) records.push({
      kind: "title", selector: "title", excerpt: page.title,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.metaDescription) records.push({
      kind: "meta_description", selector: "meta[name=description]",
      excerpt: page.metaDescription,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.primaryHeading) records.push({
      kind: "primary_heading", selector: "h1", excerpt: page.primaryHeading,
      affectedDomains: ["business_identity", "positioning"],
    });
    if (page.mainExcerpt && page.mainExcerpt.length >= 80) records.push({
      kind: "registered_page_excerpt", selector: "main",
      excerpt: page.mainExcerpt.slice(0, 2_000),
      affectedDomains: ["business_identity", "offer", "positioning", "differentiation"],
    });
  } else if (page.mainExcerpt && page.mainExcerpt.length >= 80) {
    records.push({
      kind: page.pageType === "about" ? "about_excerpt" : "products_services_excerpt",
      selector: "main",
      excerpt: page.mainExcerpt.slice(0, 2_000),
      affectedDomains: page.pageType === "about"
        ? ["business_identity", "positioning", "differentiation"]
        : ["offer"],
    });
  }
  return records;
}
