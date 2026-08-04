import { normalizePublicExperiencePhone } from "../experience/public-handoff";
import type {
  DirectHireProfileErrors,
  DirectHireProfileInput,
  DirectHireProfileValidation,
} from "./direct-hire-contract";

const MAX_NAME_LENGTH = 120;
const MAX_BUSINESS_NAME_LENGTH = 160;
const MAX_GROWTH_PRIORITY_LENGTH = 500;
const MAX_WEBSITE_LENGTH = 2048;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function hasControlCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function isPublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
  ) {
    return false;
  }

  // Direct Hire accepts public hostnames, not raw IP destinations. This keeps a
  // later research executor from inheriting an unsafe URL without revalidation.
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(normalized) || normalized.includes(":")) {
    return false;
  }

  const labels = normalized.split(".");
  return labels.length >= 2 && labels.every((label) =>
    label.length > 0 &&
    label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  );
}

export function normalizeDirectHireWebsite(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_WEBSITE_LENGTH || hasControlCharacters(trimmed)) {
    return null;
  }

  const candidate = /^[a-z][a-z\d+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !isPublicHostname(url.hostname)) return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function validateDirectHireProfile(input: unknown): DirectHireProfileValidation {
  const source = input && typeof input === "object"
    ? input as Record<string, unknown>
    : {};
  const ownerName = text(source.ownerName);
  const businessName = text(source.businessName);
  const websiteInput = typeof source.website === "string" ? source.website : "";
  const website = normalizeDirectHireWebsite(websiteInput);
  const phoneInput = typeof source.phone === "string" ? source.phone : "";
  const phone = normalizePublicExperiencePhone(phoneInput);
  const growthPriority = text(source.growthPriority);
  const errors: DirectHireProfileErrors = {};

  if (!ownerName || ownerName.length > MAX_NAME_LENGTH || hasControlCharacters(ownerName)) {
    errors.ownerName = "Enter the name you'd like me to use.";
  }
  if (
    !businessName ||
    businessName.length > MAX_BUSINESS_NAME_LENGTH ||
    hasControlCharacters(businessName)
  ) {
    errors.businessName = "Enter the business name.";
  }
  if (!website) {
    errors.website = "Enter a valid public website address.";
  }
  if (!phone) {
    errors.phone = "Enter a valid phone number with its country code.";
  }
  if (
    !growthPriority ||
    growthPriority.length > MAX_GROWTH_PRIORITY_LENGTH ||
    hasControlCharacters(growthPriority)
  ) {
    errors.growthPriority = "Tell me which product or service should come first.";
  }

  if (Object.keys(errors).length > 0) return { success: false, errors };

  return {
    success: true,
    data: {
      ownerName,
      businessName,
      website: website!,
      phone: phone!,
      growthPriority,
    },
  };
}
