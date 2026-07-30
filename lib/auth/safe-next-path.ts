export const DEFAULT_AUTHENTICATED_PATH = "/formation/entry";

export function safeInternalPath(
  value: string | null | undefined,
  fallback = DEFAULT_AUTHENTICATED_PATH,
): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return fallback;

  try {
    const decoded = decodeURIComponent(value);
    if (
      decoded.includes("\\") ||
      decoded.startsWith("//") ||
      /[\u0000-\u001f\u007f]/.test(decoded)
    ) {
      return fallback;
    }

    const parsed = new URL(value, "https://zeya.internal");
    if (parsed.origin !== "https://zeya.internal") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}
