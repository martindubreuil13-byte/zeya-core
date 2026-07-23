export type PreviewEnvironmentInput = {
  vercelEnv?: string;
  environmentTarget?: string;
  supabaseUrl?: string;
  previewProjectRef?: string;
  productionProjectRef?: string;
  experienceBusinessId?: string;
  productionExperienceBusinessId?: string;
};

export function supabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    const match = host.match(/^([a-z]{20})\.supabase\.co$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

export function assertPreviewEnvironmentIsolation(input: PreviewEnvironmentInput): void {
  if (input.vercelEnv !== "preview") return;
  const currentRef = supabaseProjectRef(input.supabaseUrl);
  if (input.environmentTarget !== "preview"
    || !currentRef
    || !input.previewProjectRef
    || currentRef !== input.previewProjectRef
    || !input.productionProjectRef
    || currentRef === input.productionProjectRef
    || (input.productionExperienceBusinessId
      && input.experienceBusinessId === input.productionExperienceBusinessId)) {
    throw new Error("Preview environment isolation check failed");
  }
}

export function assertCurrentPreviewEnvironmentIsolation(): void {
  assertPreviewEnvironmentIsolation({
    vercelEnv: process.env.VERCEL_ENV,
    environmentTarget: process.env.ZEYA_ENVIRONMENT_TARGET,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    previewProjectRef: process.env.ZEYA_PREVIEW_SUPABASE_PROJECT_REF,
    productionProjectRef: process.env.ZEYA_PRODUCTION_SUPABASE_PROJECT_REF,
    experienceBusinessId: process.env.ZEYA_EXPERIENCE_BUSINESS_ID,
    productionExperienceBusinessId: process.env.ZEYA_PRODUCTION_EXPERIENCE_BUSINESS_ID,
  });
}
