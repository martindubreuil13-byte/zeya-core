import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const OWNER = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER = "22222222-2222-4222-8222-222222222222";
const EXPERIENCE = "33333333-3333-4333-8333-333333333333";
const BUSINESS = "44444444-4444-4444-8444-444444444444";
const REPRESENTATION = "55555555-5555-4555-8555-555555555555";
const BRIEF = "66666666-6666-4666-8666-666666666666";
const FORMATION = "77777777-7777-4777-8777-777777777777";

const authClientFrom = vi.fn(() => {
  throw new Error("authenticated client must not read protected or Formation tables");
});
const createAuthenticatedRepresentationContext = vi.fn();
const createExperienceServiceClient = vi.fn();

vi.mock("@/lib/representation/api-auth", () => ({
  createAuthenticatedRepresentationContext,
}));
vi.mock("@/lib/experience/public-session-server", () => ({
  createExperienceServiceClient,
}));

type Fixture = {
  session: Record<string, unknown> | null;
  businesses: Array<Record<string, unknown>>;
  representation: Record<string, unknown> | null;
  versionCount: number;
  brief: Record<string, unknown> | null;
  responses: Array<Record<string, unknown>>;
  formations: Array<Record<string, unknown>>;
};

function fixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    session: {
      id: EXPERIENCE,
      state: "reflection_ready",
      business_id: BUSINESS,
      business_representation_id: REPRESENTATION,
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      tenant_user_id: OWNER,
    },
    businesses: [{ id: BUSINESS, user_id: OWNER }],
    representation: {
      id: REPRESENTATION,
      business_id: BUSINESS,
      user_id: OWNER,
      current_version_id: null,
    },
    versionCount: 0,
    brief: {
      id: BRIEF,
      public_experience_session_id: EXPERIENCE,
      status: "valid",
    },
    responses: [{
      id: "88888888-8888-4888-8888-888888888888",
      public_experience_session_id: EXPERIENCE,
      representation_brief_id: BRIEF,
      response_type: "confirm",
    }],
    formations: [],
    ...overrides,
  };
}

class Query {
  private filters = new Map<string, unknown>();
  constructor(
    private readonly table: string,
    private readonly state: Fixture,
  ) {}
  select() { return this; }
  eq(column: string, value: unknown) { this.filters.set(column, value); return this; }
  limit() { return this; }
  maybeSingle() {
    const result = this.resolve();
    const rows = result.data;
    return Promise.resolve({
      ...result,
      data: Array.isArray(rows) ? (rows[0] ?? null) : rows,
    });
  }
  then<TResult1 = unknown, TResult2 = never>(
    onfulfilled?: ((value: ReturnType<Query["resolve"]>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.resolve()).then(onfulfilled, onrejected);
  }
  private resolve() {
    if (this.table === "public_experience_sessions") return { data: this.state.session, error: null, count: null };
    if (this.table === "businesses") return { data: this.state.businesses, error: null, count: null };
    if (this.table === "business_representations") return { data: this.state.representation, error: null, count: null };
    if (this.table === "representation_versions") return { data: null, error: null, count: this.state.versionCount };
    if (this.table === "public_experience_representation_briefs") return { data: this.state.brief, error: null, count: null };
    if (this.table === "public_experience_brief_responses") return { data: this.state.responses, error: null, count: null };
    if (this.table === "representation_formation_sessions") {
      const id = this.filters.get("id");
      return {
        data: id ? this.state.formations.filter((row) => row.id === id) : this.state.formations,
        error: null,
        count: null,
      };
    }
    throw new Error(`Unexpected table ${this.table}`);
  }
}

function serviceDb(state: Fixture) {
  const rpc = vi.fn(async (name: string) => {
    if (name !== "zeya_initiate_formation_session") throw new Error(name);
    const row = {
      id: FORMATION,
      business_id: BUSINESS,
      business_representation_id: REPRESENTATION,
      owner_id: OWNER,
      status: "initiated",
      initiated_from: "public_experience_session",
      initiated_from_id: EXPERIENCE,
    };
    state.formations.push(row);
    return { data: [{ session_id: FORMATION, status: "initiated" }], error: null };
  });
  return {
    from: vi.fn((table: string) => new Query(table, state)),
    rpc,
  };
}

async function post(state: Fixture) {
  const db = serviceDb(state);
  createExperienceServiceClient.mockReturnValue(db);
  const { POST } = await import("../../app/api/formation/prepare/route");
  const response = await POST(new NextRequest("http://localhost/api/formation/prepare", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer owner-token" },
    body: JSON.stringify({ publicExperienceSessionId: EXPERIENCE }),
  }));
  return { response, body: await response.json(), db };
}

beforeEach(() => {
  vi.clearAllMocks();
  createAuthenticatedRepresentationContext.mockResolvedValue({
    user: { id: OWNER },
    supabase: { from: authClientFrom },
  });
});

describe("Experience-to-Formation durable handoff", () => {
  it("rejects an unauthenticated request before creating a service client", async () => {
    createAuthenticatedRepresentationContext.mockResolvedValueOnce(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const { POST } = await import("../../app/api/formation/prepare/route");
    const response = await POST(new NextRequest("http://localhost/api/formation/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ publicExperienceSessionId: EXPERIENCE }),
    }));
    expect(response.status).toBe(401);
    expect(createExperienceServiceClient).not.toHaveBeenCalled();
  });

  it("returns a deterministic missing-session error", async () => {
    const result = await post(fixture({ session: null }));
    expect(result.response.status).toBe(404);
    expect(result.body.error).toBe("experience_session_not_found");
  });

  it("prepares Formation for the authenticated owner with a valid confirmed brief", async () => {
    const result = await post(fixture());
    expect(result.response.status).toBe(201);
    expect(result.body.data).toMatchObject({
      sessionId: FORMATION,
      route: `/formation/sessions/${FORMATION}`,
      existing: false,
    });
    expect(result.db.rpc).toHaveBeenCalledTimes(1);
    expect(authClientFrom).not.toHaveBeenCalled();
  });

  it("rejects a valid brief without a confirmation", async () => {
    const result = await post(fixture({ responses: [] }));
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe("brief_confirmation_required");
    expect(result.db.rpc).not.toHaveBeenCalled();
  });

  it("does not treat a refine response as confirmation", async () => {
    const result = await post(fixture({ responses: [{
      public_experience_session_id: EXPERIENCE,
      representation_brief_id: BRIEF,
      response_type: "refine",
    }] }));
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe("brief_refinement_not_confirmed");
  });

  it.each([
    ["requires_clarification", "representation_brief_requires_clarification"],
    ["failed", "representation_brief_failed"],
  ])("rejects a %s brief", async (status, error) => {
    const result = await post(fixture({ brief: {
      id: BRIEF,
      public_experience_session_id: EXPERIENCE,
      status,
    } }));
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe(error);
  });

  it("rejects a cross-tenant Experience before reading owner state", async () => {
    const state = fixture({ session: {
      ...fixture().session,
      tenant_user_id: OTHER_OWNER,
    } });
    const result = await post(state);
    expect(result.response.status).toBe(403);
    expect(result.body.error).toBe("experience_session_owner_mismatch");
    expect(result.db.from).toHaveBeenCalledTimes(1);
  });

  it("returns the same exact Formation on retry without calling initiation", async () => {
    const existing = {
      id: FORMATION,
      business_id: BUSINESS,
      business_representation_id: REPRESENTATION,
      owner_id: OWNER,
      status: "initiated",
      initiated_from: "public_experience_session",
      initiated_from_id: EXPERIENCE,
    };
    const result = await post(fixture({ formations: [existing] }));
    expect(result.response.status).toBe(200);
    expect(result.body.data).toMatchObject({ sessionId: FORMATION, existing: true });
    expect(result.db.rpc).not.toHaveBeenCalled();
  });

  it("rejects an existing Formation with conflicting lineage", async () => {
    const result = await post(fixture({ formations: [{
      id: FORMATION,
      business_id: BUSINESS,
      business_representation_id: REPRESENTATION,
      owner_id: OWNER,
      status: "initiated",
      initiated_from: "owner_request",
      initiated_from_id: null,
    }] }));
    expect(result.response.status).toBe(409);
    expect(result.body.error).toBe("conflicting_active_formation");
  });

  it("rejects multiple-Business ambiguity and canonical owners", async () => {
    const multiple = await post(fixture({ businesses: [
      { id: BUSINESS, user_id: OWNER },
      { id: "99999999-9999-4999-8999-999999999999", user_id: OWNER },
    ] }));
    expect(multiple.body.error).toBe("business_selection_required");

    const canonical = await post(fixture({
      representation: {
        ...fixture().representation,
        current_version_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      versionCount: 1,
    }));
    expect(canonical.body.error).toBe("canonical_representation_already_exists");
  });
});
