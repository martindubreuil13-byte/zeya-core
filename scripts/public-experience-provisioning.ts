import type { SupabaseClient } from "@supabase/supabase-js";

export const EXPERIENCE_BUSINESS_NAME = "Zeya Experience";
export const EXPERIENCE_INDUSTRY = "Business Representation Intelligence";
export const EXPERIENCE_PURPOSE = "public_experience";
export const PROTECTED_BUSINESS_IDS = new Set([
  "9340229c-3608-47c9-b204-3bedc99ed656",
  "e2db4a3e-7c37-4b61-b123-7e1915eb4a91",
]);

export const EXPERIENCE_ELEMENT_VALUES = {
  system_identity: "Zeya is a Business Representation Intelligence system.",
  customer_acquisition_outcome: "Zeya helps businesses acquire customers through accurate, consistent and credible representation.",
  representation_mechanism: "Representation is the mechanism; customer acquisition is the outcome.",
  category_boundaries: "Zeya is not a generic assistant, CRM or generic sales-automation platform.",
  public_experience_boundary: "The public Experience is a controlled demonstration of how Zeya represents a business.",
  canonical_governance: "Public conversations may produce review candidates but cannot independently declare canonical truth.",
  veya_role: "Veya is the calling worker used during the demonstration.",
  claim_boundaries: "The Experience must not make unsupported claims about results, pricing, integrations or customer outcomes.",
} as const;

type BusinessRow = {
  id: string;
  user_id: string;
  business_name: string | null;
  industry: string | null;
  business_profile: Record<string, unknown> | null;
};

type RepresentationRow = {
  id: string;
  current_version_id: string | null;
};

type ApiResult = Record<string, unknown>;

export type ProvisioningResult = {
  businessId: string;
  businessName: string;
  businessDisposition: "created" | "reused";
  representationId: string;
  versionId: string;
  representationDisposition: "created" | "reused";
};

export function assertAllowedOwner(email: string): void {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.endsWith(".invalid") || normalized === "experience-demo@zeya.invalid") {
    throw new Error("A real operational owner is required");
  }
}

export function assertUnprotectedBusinessId(id: string): void {
  if (PROTECTED_BUSINESS_IDS.has(id)) throw new Error("Protected Business cannot be used for public Experience provisioning");
}

function purposeOf(row: BusinessRow): unknown {
  return row.business_profile?.purpose;
}

export function selectDedicatedBusiness(rows: BusinessRow[], ownerUserId: string): BusinessRow | null {
  if (rows.some((row) => PROTECTED_BUSINESS_IDS.has(row.id))) {
    throw new Error("Protected Business appeared in dedicated Experience resolution");
  }
  if (rows.some((row) => row.user_id !== ownerUserId)) {
    throw new Error("Cross-tenant Business appeared in dedicated Experience resolution");
  }
  const exact = rows.filter((row) =>
    row.business_name === EXPERIENCE_BUSINESS_NAME
    && row.industry === EXPERIENCE_INDUSTRY
    && purposeOf(row) === EXPERIENCE_PURPOSE
  );
  const conflicting = rows.filter((row) => !exact.includes(row));
  if (conflicting.length > 0) throw new Error("Conflicting owner Business uses the dedicated Experience name");
  if (exact.length > 1) throw new Error("Multiple dedicated Experience Businesses found");
  return exact[0] ?? null;
}

export async function resolveOrCreateExperienceBusiness(
  db: SupabaseClient,
  ownerUserId: string,
): Promise<{ business: BusinessRow; disposition: "created" | "reused" }> {
  const existing = await db
    .from("businesses")
    .select("id,user_id,business_name,industry,business_profile")
    .eq("user_id", ownerUserId)
    .eq("business_name", EXPERIENCE_BUSINESS_NAME);
  if (existing.error) throw new Error("Dedicated Experience Business lookup failed");

  const selected = selectDedicatedBusiness((existing.data ?? []) as BusinessRow[], ownerUserId);
  if (selected) {
    assertUnprotectedBusinessId(selected.id);
    return { business: selected, disposition: "reused" };
  }

  const created = await db
    .from("businesses")
    .insert({
      user_id: ownerUserId,
      business_name: EXPERIENCE_BUSINESS_NAME,
      industry: EXPERIENCE_INDUSTRY,
      business_profile: { purpose: EXPERIENCE_PURPOSE },
    })
    .select("id,user_id,business_name,industry,business_profile")
    .single();
  if (created.error || !created.data) throw new Error("Dedicated Experience Business creation failed");
  const business = created.data as BusinessRow;
  assertUnprotectedBusinessId(business.id);
  if (business.user_id !== ownerUserId || purposeOf(business) !== EXPERIENCE_PURPOSE) {
    throw new Error("Created Experience Business failed ownership verification");
  }
  return { business, disposition: "created" };
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, normalize(entry)]));
  }
  return value;
}

export function canonicalValuesMatch(value: unknown): boolean {
  return JSON.stringify(normalize(value)) === JSON.stringify(normalize(EXPERIENCE_ELEMENT_VALUES));
}

export async function assertZeyaApplication(baseUrl: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/health`);
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (!response.ok || !contentType.includes("application/json")) throw new Error("REPRESENTATION_TEST_BASE_URL is not a Zeya JSON application");
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw) as Record<string, unknown>; } catch { throw new Error("REPRESENTATION_TEST_BASE_URL returned invalid JSON"); }
  if (body.application !== "zeya" || body.service !== "canonical-representation-state") {
    throw new Error("REPRESENTATION_TEST_BASE_URL did not identify the current Zeya application");
  }
}

async function postApi(baseUrl: string, path: string, token: string, body: unknown): Promise<ApiResult> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const raw = await response.text();
  if (!contentType.includes("application/json")) throw new Error(`${path} returned a non-JSON response (${response.status})`);
  let result: { success?: boolean; data?: ApiResult; error?: string };
  try { result = JSON.parse(raw) as typeof result; } catch { throw new Error(`${path} returned invalid JSON (${response.status})`); }
  if (!response.ok || !result.success || !result.data) throw new Error(`${path} failed (${response.status}): ${result.error ?? "safe_error"}`);
  return result.data;
}

export async function provisionPublicExperienceRepresentation(args: {
  db: SupabaseClient;
  baseUrl: string;
  accessToken: string;
  ownerUserId: string;
  businessId: string;
}): Promise<{ representationId: string; versionId: string; disposition: "created" | "reused" }> {
  assertUnprotectedBusinessId(args.businessId);
  const ownedBusiness = await args.db.from("businesses").select("id,user_id").eq("id", args.businessId).eq("user_id", args.ownerUserId).maybeSingle();
  if (ownedBusiness.error || !ownedBusiness.data) throw new Error("Experience Business is not owned by the authenticated owner");

  const representations = await args.db
    .from("business_representations")
    .select("id,current_version_id")
    .eq("business_id", args.businessId)
    .eq("user_id", args.ownerUserId);
  if (representations.error) throw new Error("Experience Representation lookup failed");
  if ((representations.data ?? []).length > 1) throw new Error("Multiple Experience Representations found");
  const existing = (representations.data?.[0] ?? null) as RepresentationRow | null;

  if (existing?.current_version_id) {
    const version = await args.db
      .from("representation_versions")
      .select("id,business_representation_id,element_values")
      .eq("id", existing.current_version_id)
      .eq("business_representation_id", existing.id)
      .single();
    if (version.error || !version.data) throw new Error("Active Experience Version could not be verified");
    if (!canonicalValuesMatch(version.data.element_values)) throw new Error("Conflicting active Experience Representation found");
    return { representationId: existing.id, versionId: version.data.id, disposition: "reused" };
  }

  const statement = Object.values(EXPERIENCE_ELEMENT_VALUES).join(" ");
  const evidence = await postApi(args.baseUrl, "/api/representation/evidence", args.accessToken, {
    businessId: args.businessId,
    statement,
    sourceDescription: "Authenticated operational-owner provisioning for the public Zeya Experience",
    affectedDomains: ["business_identity", "offer", "operational_constraints", "channel_expression"],
    affectedElementValues: EXPERIENCE_ELEMENT_VALUES,
  });
  const representationId = String(evidence.businessRepresentationId);
  const proposalId = String(evidence.proposalId);
  if (existing && existing.id !== representationId) throw new Error("Evidence service resolved a conflicting Experience Representation");

  let domain = await args.db.from("representation_domains").select("id").eq("business_representation_id", representationId).eq("domain_name", "business_identity").maybeSingle();
  if (domain.error) throw new Error("Experience domain lookup failed");
  if (!domain.data) {
    domain = await args.db.from("representation_domains").insert({ business_representation_id: representationId, domain_name: "business_identity" }).select("id").single();
  }
  if (domain.error || !domain.data) throw new Error("Experience domain creation failed");

  for (const key of Object.keys(EXPERIENCE_ELEMENT_VALUES)) {
    let element = await args.db.from("representation_elements").select("id,claim_eligibility,is_disputed").eq("business_representation_id", representationId).eq("element_key", key).maybeSingle();
    if (element.error) throw new Error(`Experience Element lookup failed: ${key}`);
    if (!element.data) {
      element = await args.db.from("representation_elements").insert({
        business_representation_id: representationId,
        representation_domain_id: domain.data.id,
        element_key: key,
        element_type: "fact",
        field_sensitivity: "operational",
        claim_eligibility: "approved_for_external_use",
        is_disputed: false,
      }).select("id,claim_eligibility,is_disputed").single();
    }
    if (element.error || !element.data || element.data.claim_eligibility !== "approved_for_external_use" || element.data.is_disputed) {
      throw new Error(`Experience Element is conflicting or unavailable: ${key}`);
    }
  }

  const proposal = await args.db.from("representation_proposals").select("requires_approval,status").eq("id", proposalId).eq("business_representation_id", representationId).single();
  if (proposal.error || !proposal.data) throw new Error("Experience Proposal verification failed");
  if (proposal.data.requires_approval) {
    const approval = await args.db.from("approval_decisions").insert({
      business_representation_id: representationId,
      representation_proposal_id: proposalId,
      decision: "approved",
      approver_user_id: args.ownerUserId,
      decision_reason: "Authenticated operational owner approval for the public Experience canonical baseline",
    });
    if (approval.error) throw new Error("Experience Proposal approval failed");
  }

  const version = await postApi(args.baseUrl, "/api/representation/versions", args.accessToken, {
    businessRepresentationId: representationId,
    proposalId,
    elementValues: EXPERIENCE_ELEMENT_VALUES,
    confidenceScore: 80,
  });
  const versionId = String(version.versionId);
  const activated = await args.db.from("business_representations").select("current_version_id").eq("id", representationId).eq("business_id", args.businessId).single();
  if (activated.error || activated.data?.current_version_id !== versionId) throw new Error("Canonical Experience Version was not activated by the canonical service");
  const pointers = await args.db.from("representation_elements").select("element_key,current_value_version_id").eq("business_representation_id", representationId).in("element_key", Object.keys(EXPERIENCE_ELEMENT_VALUES));
  if (pointers.error || pointers.data?.length !== Object.keys(EXPERIENCE_ELEMENT_VALUES).length || pointers.data.some((row) => row.current_value_version_id !== versionId)) {
    throw new Error("Canonical service did not advance all Experience Element pointers");
  }
  return { representationId, versionId, disposition: "created" };
}
