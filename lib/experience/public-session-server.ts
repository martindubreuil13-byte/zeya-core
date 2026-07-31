import { createHash, createHmac, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertCurrentPreviewEnvironmentIsolation } from "./preview-environment-guard";
export {
  PUBLIC_EXPERIENCE_MAX_TRANSCRIPT_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURN_CHARS,
  PUBLIC_EXPERIENCE_MAX_TURNS,
} from "./public-session-contract";

export const PUBLIC_EXPERIENCE_TTL_MS = 30 * 60 * 1_000;

export type PublicExperienceSessionRow = {
  id: string;
  token_hash: string;
  tenant_user_id: string;
  business_id: string;
  business_representation_id: string;
  canonical_version_id: string | null;
  representation_context_mode: "canonical" | "pre_canonical";
  zeya_voice_context_id: string;
  zeya_conversation_output_id: string | null;
  veya_voice_context_id: string | null;
  veya_conversation_output_id: string | null;
  dispatch_id: string | null;
  phone_hash: string | null;
  provider_conversation_id: string | null;
  provider_call_id: string | null;
  state: string;
  expires_at: string;
  created_at: string;
};

export function createExperienceToken() {
  return randomBytes(32).toString("base64url");
}

export function hashExperienceToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function hashExperiencePhone(token: string, phone: string) {
  return createHmac("sha256", token).update(phone, "utf8").digest("hex");
}

export function isPlausibleExperienceToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

export function createExperienceServiceClient(): SupabaseClient {
  assertCurrentPreviewEnvironmentIsolation();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Experience service is unavailable");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export async function findExperienceSession(db: SupabaseClient, token: string) {
  const result = await db.from("public_experience_sessions").select("*")
    .eq("token_hash", hashExperienceToken(token)).maybeSingle();
  if (result.error) throw new Error("Experience session lookup failed");
  return result.data as PublicExperienceSessionRow | null;
}

export function isExpired(session: Pick<PublicExperienceSessionRow, "expires_at">) {
  return Date.parse(session.expires_at) <= Date.now();
}

export function publicSessionState(session: PublicExperienceSessionRow) {
  switch (session.state) {
    case "reflection_ready": return "reflection_ready";
    case "call_failed":
    case "call_unanswered":
    case "call_rejected":
    case "call_completed_without_transcript":
    case "completion_processing_failed":
    case "failed": return "call_failed";
  }
  if (isExpired(session) && !["call_requested","call_correlation_pending","dispatch_resolution_pending","call_dispatched","call_active"].includes(session.state)) return "expired";
  switch (session.state) {
    case "zeya_active": return "waiting_for_zeya";
    case "zeya_finalized": return "ready_for_phone";
    case "call_requested": return "call_requested";
    case "call_correlation_pending": return "correlation_pending";
    case "dispatch_resolution_pending": return "resolution_pending";
    case "call_dispatched":
    case "call_active": return "call_in_progress";
    default: return "call_failed";
  }
}
