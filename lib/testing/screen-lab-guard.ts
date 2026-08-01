export const SCREEN_LAB_ID_PREFIX = "screenlab:";

export function isScreenLabFixtureId(value: unknown): boolean {
  if (typeof value !== "string") return false;
  return value.startsWith(SCREEN_LAB_ID_PREFIX);
}

function isIdentifierField(field: string): boolean {
  const normalized = field
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase();
  return /(?:^|_)(?:id|ids|identifier|identifiers|key|keys|token|tokens|ref|refs|reference|references|fingerprint)$/.test(
    normalized,
  );
}

function identifierValueContainsFixtureId(value: unknown): boolean {
  if (isScreenLabFixtureId(value)) return true;
  if (Array.isArray(value)) return value.some(identifierValueContainsFixtureId);
  return false;
}

export function bodyContainsScreenLabFixtureId(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value).some(([field, fieldValue]) => {
    if (isIdentifierField(field) && identifierValueContainsFixtureId(fieldValue)) {
      return true;
    }
    return bodyContainsScreenLabFixtureId(fieldValue);
  });
}

export function urlContainsScreenLabFixtureId(url: string): boolean {
  try {
    const parsed = new URL(url, "https://screen-lab.local");
    const pathContainsFixture = parsed.pathname
      .split("/")
      .some((segment) => isScreenLabFixtureId(decodeURIComponent(segment)));
    if (pathContainsFixture) return true;

    return [...parsed.searchParams.entries()].some(
      ([field, value]) => isIdentifierField(field) && isScreenLabFixtureId(value),
    );
  } catch {
    return false;
  }
}

export function rejectScreenLabFixturePersistence(
  url: string,
  body: BodyInit | null | undefined,
): Response | null {
  let parsedBody: unknown = null;
  if (typeof body === "string") {
    try {
      parsedBody = JSON.parse(body);
    } catch {
      // Raw text is not an identifier-bearing request object.
    }
  } else if (body instanceof URLSearchParams) {
    parsedBody = Object.fromEntries(body.entries());
  }

  if (!urlContainsScreenLabFixtureId(url) && !bodyContainsScreenLabFixtureId(parsedBody)) {
    return null;
  }

  return new Response(
    JSON.stringify({ success: false, error: "screen_lab_fixture_persistence_forbidden" }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );
}
