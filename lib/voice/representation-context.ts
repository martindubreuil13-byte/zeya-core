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

  const authorized = await createRepresentationStateService(input.db)
    .getAgentContext(representation.data.id, provisionalMode);
  if (!authorized || authorized.businessRepresentationId !== representation.data.id) {
    throw new VoiceContextUnavailableError();
  }

  const claims = Object.fromEntries(authorized.elements.map((element) => [element.elementKey, claimValue(element.currentValue)]));
  const authorizedElementKeys = Object.keys(claims).sort();
  if (authorizedElementKeys.length === 0) throw new VoiceContextUnavailableError();

  const lineage: VoiceRepresentationLineage = {
    tenantUserId: input.tenantUserId,
    businessId: input.businessId,
    businessRepresentationId: representation.data.id,
    canonicalVersionId: representation.data.current_version_id,
    generatedAt: authorized.retrievedAt.toISOString(),
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
