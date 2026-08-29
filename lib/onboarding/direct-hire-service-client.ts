import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assertPreviewEnvironmentIsolation } from "../experience/preview-environment-guard";

export function createDirectHireServiceClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Production and Preview both require these core credentials
  if (!url || !key) throw new Error("Direct Hire preparation service is unavailable");

  // Preview environment must verify isolation to prevent cross-environment access
  if (process.env.VERCEL_ENV === "preview") {
    assertPreviewEnvironmentIsolation({
      vercelEnv: process.env.VERCEL_ENV,
      environmentTarget: process.env.ZEYA_ENVIRONMENT_TARGET,
      supabaseUrl: url,
      previewProjectRef: process.env.ZEYA_PREVIEW_SUPABASE_PROJECT_REF,
      productionProjectRef: process.env.ZEYA_PRODUCTION_SUPABASE_PROJECT_REF,
      experienceBusinessId: process.env.ZEYA_EXPERIENCE_BUSINESS_ID,
      productionExperienceBusinessId: process.env.ZEYA_PRODUCTION_EXPERIENCE_BUSINESS_ID,
    });
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
