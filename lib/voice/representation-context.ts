import type { SupabaseClient } from "@supabase/supabase-js";
import { createRepresentationStateService } from "@/lib/representation/representation-service";

export const VOICE_CONTEXT_SCHEMA_VERSION = "1.0";
export const VOICE_PROMPT_ASSEMBLY_VERSION = "1.0";

export type VoiceAgentIdentity = {
  id: string;
  type: string;
  role: string;
};

export type VoiceRepresentationLineage = {
  tenantUserId: string;
  businessId: string;
  businessRepresentationId: string;
  canonicalVersionId: string;
  generatedAt: string;
  authorizedElementKeys: string[];
  provisionalMode: boolean;
  agentId: string;
  agentType: string;
  agentRole: string;
  contextSchemaVersion: string;
  promptAssemblyVersion: string;
};

export type VoiceReadyContext = {
  systemContext: string;
  claims: Record<string, unknown>;
  lineage: VoiceRepresentationLineage;
};

export class VoiceContextUnavailableError extends Error {
  constructor() {
    super("Authorized voice context is unavailable");
    this.name = "VoiceContextUnavailableError";
  }
}

function claimValue(value: Record<string, unknown> | null): unknown {
  if (!value) return null;
  return Object.keys(value).length === 1 && "value" in value ? value.value : value;
}

function buildSystemContext(claims: Record<string, unknown>): string {
  const lines = Object.entries(claims).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`);
  return [
    "AUTHORIZED BUSINESS REPRESENTATION",
    "Use only the business claims below. Do not invent missing pricing, guarantees, availability, capabilities, or commitments.",
    "If an answer is not present, respond naturally that you will arrange a precise follow-up.",
    "Do not mention databases, confidence calculations, eligibility states, disputes, or internal review terminology.",
    ...lines,
  ].join("\n");
}

/** Read-only boundary: this service can query canonical Representation State but has no write operations. */
export async function assembleVoiceRepresentationContext(input: {
  db: SupabaseClient;
  tenantUserId: string;
  businessId: string;
  agent: VoiceAgentIdentity;
  provisionalMode?: boolean;
  businessRepresentationId?: string;
}): Promise<VoiceReadyContext> {
  const provisionalMode = input.provisionalMode === true;
  const business = await input.db
    .from("businesses")
    .select("id,user_id")
    .eq("id", input.businessId)
    .eq("user_id", input.tenantUserId)
    .maybeSingle();
  if (business.error || !business.data) throw new VoiceContextUnavailableError();

  let representationQuery = input.db
    .from("business_representations")
    .select("id,business_id,user_id,current_version_id")
    .eq("business_id", input.businessId)
    .eq("user_id", input.tenantUserId);
  if (input.businessRepresentationId) representationQuery = representationQuery.eq("id", input.businessRepresentationId);
  const representation = await representationQuery.maybeSingle();
  if (representation.error || !representation.data?.current_version_id) throw new VoiceContextUnavailableError();

  let authorized = null;
  try {
    authorized = await createRepresentationStateService(input.db)
      .getAgentContext(representation.data.id, provisionalMode);
  } catch {
    // A service-role session may not be allowed to execute the authenticated
    // agent-context RPC. The tenant-scoped read-only fallback below is the
    // provider-dispatch path for that expected privilege boundary.
  }
  if (authorized && authorized.businessRepresentationId !== representation.data.id) {
    throw new VoiceContextUnavailableError();
  }

  let claims = Object.fromEntries((authorized?.elements ?? []).map((element) => [element.elementKey, claimValue(element.currentValue)]));
  // The deployed agent-context RPC intentionally scopes rows with auth.uid(). A
  // service-role provider dispatch has already proven the explicit tenant ->
  // business -> representation chain above, so use an equivalent read-only
  // query when the RPC correctly returns no rows for that privileged session.
  if (Object.keys(claims).length === 0) {
    const eligibleStates = provisionalMode
      ? ["approved_for_external_use", "provisional"]
      : ["approved_for_external_use"];
    const elements = await input.db
      .from("representation_elements")
      .select("id,element_key,current_value_version_id")
      .eq("business_representation_id", representation.data.id)
      .in("claim_eligibility", eligibleStates)
      .eq("is_disputed", false);
    if (elements.error) throw new VoiceContextUnavailableError();

    const versionIds = [...new Set((elements.data ?? [])
      .map((element) => element.current_value_version_id)
      .filter((id): id is string => typeof id === "string"))];
    const versions = versionIds.length > 0
      ? await input.db.from("representation_versions").select("id,element_values").in("id", versionIds)
      : { data: [], error: null };
    if (versions.error) throw new VoiceContextUnavailableError();
    const valuesByVersion = new Map((versions.data ?? []).map((version) => [version.id, version.element_values]));
    claims = Object.fromEntries((elements.data ?? []).flatMap((element) => {
      const values = element.current_value_version_id
        ? valuesByVersion.get(element.current_value_version_id)
        : null;
      if (!values || typeof values !== "object" || Array.isArray(values)) return [];
      const canonical = values as Record<string, unknown>;
      const value = canonical[element.element_key] ?? canonical[element.id];
      return value === undefined ? [] : [[element.element_key, value]];
    }));
  }
  const authorizedElementKeys = Object.keys(claims).sort();
  if (authorizedElementKeys.length === 0) throw new VoiceContextUnavailableError();

  const lineage: VoiceRepresentationLineage = {
    tenantUserId: input.tenantUserId,
    businessId: input.businessId,
    businessRepresentationId: representation.data.id,
    canonicalVersionId: representation.data.current_version_id,
    generatedAt: (authorized?.retrievedAt ?? new Date()).toISOString(),
    authorizedElementKeys,
    provisionalMode,
    agentId: input.agent.id,
    agentType: input.agent.type,
    agentRole: input.agent.role,
    contextSchemaVersion: VOICE_CONTEXT_SCHEMA_VERSION,
    promptAssemblyVersion: VOICE_PROMPT_ASSEMBLY_VERSION,
  };

  return { systemContext: buildSystemContext(claims), claims, lineage };
}

export function buildVoiceProviderVariables(input: {
  targetName: string | null;
  targetPhone: string | null;
  objective: string;
  context: VoiceReadyContext;
}): Record<string, string | number | boolean | null> {
  return {
    target: input.targetName ?? "prospect",
    targetPhone: input.targetPhone,
    objective: input.objective,
    missionObjective: input.objective,
    authorizedBusinessContext: input.context.systemContext,
    businessRepresentationId: input.context.lineage.businessRepresentationId,
    canonicalVersionId: input.context.lineage.canonicalVersionId,
    provisionalMode: input.context.lineage.provisionalMode,
    voiceContextSchemaVersion: input.context.lineage.contextSchemaVersion,
    promptAssemblyVersion: input.context.lineage.promptAssemblyVersion,
  };
}
