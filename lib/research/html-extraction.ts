import { load } from "cheerio";
import { createHash } from "node:crypto";
import { isSameResearchSite, WEBSITE_RESEARCH_LIMITS } from "./safe-public-site-fetch";

export const WEBSITE_EXTRACTION_VERSION = "direct-hire-web-v2";

export type WebsitePageType =
  | "homepage"
  | "about"
  | "products_services"
  | "pricing"
  | "customers"
  | "case_studies"
  | "testimonials"
  | "industries"
  | "methodology"
  | "team"
  | "faq"
  | "contact"
  | "resources"
  | "registered_public_page";

export type DiscoverableWebsitePageType = Exclude<WebsitePageType, "homepage" | "registered_public_page">;

export type WebsiteEvidenceKind =
  | "title"
  | "meta_description"
  | "primary_heading"
  | "section_text"
  | "section_list"
  | "pricing_block"
  | "testimonial"
  | "quantitative_claim"
  | "main_excerpt"
  | "about_excerpt"
  | "products_services_excerpt"
  | "registered_page_excerpt"
  | "explicit_absence";

export type DiscoveredPage = {
  pageType: DiscoverableWebsitePageType;
  url: string;
  label: string;
  score: number;
};

export type ExtractedSection = {
  kind: "section_text" | "section_list" | "pricing_block" | "testimonial" | "quantitative_claim";
  heading: string | null;
  text: string;
  selector: string;
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
  sections: ExtractedSection[];
  discoveredPages: DiscoveredPage[];
};

const TYPE_PRIORITY: Record<DiscoverableWebsitePageType, number> = {
  products_services: 130,
  pricing: 120,
  case_studies: 110,
  customers: 105,
  about: 100,
  industries: 90,
  methodology: 80,
  testimonials: 70,
  team: 60,
  faq: 50,
  contact: 30,
  resources: 20,
};

const CLASSIFIERS: Array<[DiscoverableWebsitePageType, RegExp]> = [
  ["case_studies", /\b(?:case studies?|case study|success stories?|customer stories?|client stories?|results?)\b/],
  ["pricing", /\b(?:pricing|prices?|plans?|packages?|subscriptions?|fees?)\b/],
  ["products_services", /\b(?:products?|services?|solutions?|offerings?|what we do|capabilities|work with (?:me|us)|qualif(?:y|ication)|start here|apply|application)\b/],
  ["customers", /\b(?:customers?|clients?|who we serve|our work|portfolio)\b/],
  ["about", /\b(?:about|company|our story|who we are|mission|company profile)\b/],
  ["industries", /\b(?:industries|sectors?|use cases?|verticals?|markets? served)\b/],
  ["methodology", /\b(?:methodology|method|process|how it works|approach|framework|way of working)\b/],
  ["testimonials", /\b(?:testimonials?|reviews?|what clients say|customer feedback)\b/],
  ["team", /\b(?:team|leadership|founders?|our people|management)\b/],
  ["faq", /\b(?:faq|frequently asked questions?|common questions?)\b/],
  ["contact", /\b(?:contact|contact us|get in touch|book a call|schedule a call)\b/],
  ["resources", /\b(?:resources?|insights?|blog|articles?|guides?|news|library)\b/],
];

function normalizedText(value: string | undefined | null, limit: number): string | null {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  return normalized ? normalized.slice(0, limit) : null;
}

function meaningfulHeading(value: string | null): string | null {
  return value && value.length >= 3 ? value : null;
}

export function classifyBusinessLink(label: string, pathname: string): DiscoverableWebsitePageType | null {
  let decodedPath = pathname;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    // A malformed percent escape is inert input, not a reason to fail the page.
  }
  const candidate = `${label} ${decodedPath.replace(/[-_/.]+/g, " ")}`.toLowerCase();
  return CLASSIFIERS.find(([, expression]) => expression.test(candidate))?.[0] ?? null;
}

export function normalizeDiscoveredUrl(href: string, baseUrl: URL): URL | null {
  let url: URL;
  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || !isSameResearchSite(baseUrl.hostname, url.hostname)) {
    return null;
  }
  url.hash = "";
  // www and apex are the same allowed research site; use the submitted host so
  // those spellings cannot consume separate discovery slots.
  url.hostname = baseUrl.hostname;
  for (const key of [...url.searchParams.keys()]) {
    if (/^(?:utm_.+|gclid|fbclid|mc_cid|mc_eid)$/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  url.pathname = url.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  if (url.pathname === baseUrl.pathname.replace(/\/$/, "") && url.search === baseUrl.search) return null;
  return url;
}

function candidateScore(pageType: DiscoverableWebsitePageType, label: string, url: URL): number {
  const depth = url.pathname.split("/").filter(Boolean).length;
  const words = label.trim().split(/\s+/).length;
  return TYPE_PRIORITY[pageType] - Math.max(0, depth - 1) * 3 - (url.search ? 4 : 0) - (words > 8 ? 2 : 0);
}

export function discoverBusinessPages(html: string, finalUrl: string): DiscoveredPage[] {
  const $ = load(html);
  const current = new URL(finalUrl);
  const candidates = new Map<string, DiscoveredPage>();
  $("a[href]").each((_index, element) => {
    const href = $(element).attr("href");
    const label = normalizedText($(element).text() || $(element).attr("aria-label") || $(element).attr("title"), 160);
    if (!href || !label) return;
    const url = normalizeDiscoveredUrl(href, current);
    if (!url) return;
    const pageType = classifyBusinessLink(label, url.pathname);
    if (!pageType) return;
    const candidate = { pageType, url: url.toString(), label, score: candidateScore(pageType, label, url) };
    const existing = candidates.get(candidate.url);
    if (!existing || candidate.score > existing.score || (candidate.score === existing.score && candidate.label < existing.label)) {
      candidates.set(candidate.url, candidate);
    }
  });
  return [...candidates.values()]
    .sort((a, b) => b.score - a.score || a.url.localeCompare(b.url) || a.label.localeCompare(b.label))
    .slice(0, WEBSITE_RESEARCH_LIMITS.maxDiscoveredLinks);
}

function sectionKind(heading: string, text: string): ExtractedSection["kind"] {
  const candidate = `${heading} ${text}`.toLowerCase();
  if (/\b(?:pricing|price|plans?|packages?|starting at|per month|per year|\$|£|€)\b/.test(candidate)) return "pricing_block";
  if (/\b(?:testimonial|what .{0,20} say|review|client feedback)\b/.test(candidate)) return "testimonial";
  if (/\b(?:\d+(?:[.,]\d+)?%|\d+x|\$\d|£\d|€\d|\d+ (?:customers?|clients?|countries|years?))\b/i.test(candidate)) return "quantitative_claim";
  return "section_text";
}

function isBoilerplateSection(heading: string, text: string): boolean {
  const value = `${heading} ${text}`.toLowerCase();
  if (/\b(?:cookie preferences?|privacy preferences?|accept all cookies?|manage consent|necessary cookies?)\b/.test(value)) {
    return true;
  }
  return text.length < 120
    && /\b(?:get started|book (?:a )?call|contact us|learn more|sign up|subscribe now)\b/.test(value);
}

function extractSections($: ReturnType<typeof load>): ExtractedSection[] {
  const root = $("main,article,[role='main']").first().length ? $("main,article,[role='main']").first() : $("body");
  const sections: ExtractedSection[] = [];
  let retained = 0;
  root.find("h2,h3").each((index, headingElement) => {
    if (retained >= WEBSITE_RESEARCH_LIMITS.maxExtractedCharactersPerPage) return;
    const heading = meaningfulHeading(normalizedText($(headingElement).text(), 300));
    if (!heading) return;
    const parts: string[] = [];
    let sibling = $(headingElement).next();
    while (sibling.length && !/^h[1-3]$/i.test(sibling.get(0)?.tagName ?? "")) {
      if (!sibling.is("script,style,nav,footer,form,dialog,noscript,iframe,canvas")) {
        const value = normalizedText(sibling.text(), 4_000);
        if (value) parts.push(value);
      }
      sibling = sibling.next();
    }
    const text = normalizedText(parts.join(" "), Math.min(4_000, WEBSITE_RESEARCH_LIMITS.maxExtractedCharactersPerPage - retained));
    if (!text || text.length < 40 || isBoilerplateSection(heading, text)) return;
    const combined = `${heading}: ${text}`;
    retained += combined.length;
    const hasList = $(headingElement).nextUntil("h1,h2,h3").find("li").length > 1;
    sections.push({
      kind: hasList ? "section_list" : sectionKind(heading, text),
      heading,
      text: combined,
      selector: `main heading[${index + 1}] (${headingElement.tagName.toLowerCase()})`,
    });
  });
  return sections.slice(0, 16);
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
  $("script,style,template,svg,form,dialog,noscript,iframe,canvas").remove();
  $("[hidden],[aria-hidden='true']").remove();
  const title = normalizedText($("title").first().text(), 300);
  const metaDescription = normalizedText($("meta[name='description' i]").first().attr("content"), 500);
  const primaryHeading = meaningfulHeading(normalizedText($("h1").first().text(), 500));
  const openGraph = {
    title: normalizedText($("meta[property='og:title' i]").first().attr("content"), 300),
    description: normalizedText($("meta[property='og:description' i]").first().attr("content"), 500),
  };
  const discoveredPages = discoverBusinessPages(html, input.finalUrl);
  $("nav,footer,header,aside").remove();
  const sections = extractSections($);
  const contentRoot = $("main,article,[role='main']").first();
  const bodyText = contentRoot.length ? contentRoot.text() : $("body").text();
  const mainExcerpt = normalizedText(bodyText, WEBSITE_RESEARCH_LIMITS.maxExtractedCharactersPerPage);
  return {
    pageType: input.pageType,
    requestedUrl: input.requestedUrl,
    finalUrl: input.finalUrl,
    retrievedAt: input.retrievedAt ?? new Date().toISOString(),
    documentContentHash: createHash("sha256").update(html).digest("hex"),
    title, metaDescription, openGraph, primaryHeading, mainExcerpt, sections, discoveredPages,
  };
}

function affectedDomains(pageType: WebsitePageType): string[] {
  if (pageType === "pricing") return ["offer", "whatYouSell", "authorityBoundaries"];
  if (["customers", "industries"].includes(pageType)) return ["customer", "whoItIsFor", "problemOrAspiration"];
  if (["case_studies", "testimonials"].includes(pageType)) return ["value", "whyCustomersShouldCare", "differentiation"];
  if (pageType === "products_services") return ["offer", "whatYouSell", "problemOrAspiration"];
  if (pageType === "about" || pageType === "team") return ["business_identity", "positioning", "proposedDescription", "differentiation"];
  if (pageType === "methodology") return ["offer", "whatYouSell", "whyCustomersShouldCare", "differentiation"];
  if (pageType === "faq") return ["whatYouSell", "whoItIsFor", "clarificationsNeeded"];
  return ["business_identity", "offer", "positioning", "proposedDescription"];
}

export function evidenceFromExtractedPage(page: ExtractedWebsitePage): Array<{
  kind: WebsiteEvidenceKind; selector: string; excerpt: string; affectedDomains: string[];
}> {
  const records: Array<{ kind: WebsiteEvidenceKind; selector: string; excerpt: string; affectedDomains: string[] }> = [];
  const domains = affectedDomains(page.pageType);
  if (page.title) records.push({ kind: "title", selector: "title", excerpt: page.title, affectedDomains: domains });
  if (page.metaDescription) records.push({ kind: "meta_description", selector: "meta[name=description]", excerpt: page.metaDescription, affectedDomains: domains });
  if (page.primaryHeading) records.push({ kind: "primary_heading", selector: "h1", excerpt: page.primaryHeading, affectedDomains: domains });

  if (page.pageType !== "registered_public_page") {
    for (const section of page.sections) records.push({
      kind: section.kind, selector: section.selector, excerpt: section.text, affectedDomains: domains,
    });
  }

  if ((page.sections.length === 0 || page.pageType === "registered_public_page") && page.mainExcerpt && page.mainExcerpt.length >= 80) {
    const kind: WebsiteEvidenceKind = page.pageType === "about" ? "about_excerpt"
      : page.pageType === "products_services" ? "products_services_excerpt"
        : page.pageType === "registered_public_page" ? "registered_page_excerpt" : "main_excerpt";
    records.push({ kind, selector: "main", excerpt: page.mainExcerpt.slice(0, 4_000), affectedDomains: domains });
  }
  if (page.pageType === "homepage") {
    for (const [label, missing] of [["title", !page.title], ["meta description", !page.metaDescription], ["primary heading", !page.primaryHeading]] as const) {
      if (missing) records.push({ kind: "explicit_absence", selector: label, excerpt: `No usable ${label} was present on the retrieved homepage.`, affectedDomains: ["business_identity", "positioning"] });
    }
  }
  return records;
}
