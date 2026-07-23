import assert from "node:assert/strict";
import { assertPreviewEnvironmentIsolation, supabaseProjectRef } from "../../lib/experience/preview-environment-guard";

const preview = "hdjojgvvlojbhgidirht";
const production = "eqdhftogzzlkpjebgbue";
assert.equal(supabaseProjectRef(`https://${preview}.supabase.co`), preview);
assert.equal(supabaseProjectRef("not-a-url"), null);

assert.doesNotThrow(() => assertPreviewEnvironmentIsolation({
  vercelEnv: "preview", environmentTarget: "preview",
  supabaseUrl: `https://${preview}.supabase.co`,
  previewProjectRef: preview, productionProjectRef: production,
  experienceBusinessId: "preview-business", productionExperienceBusinessId: "production-business",
}));

for (const input of [
  { environmentTarget: "production", supabaseUrl: `https://${preview}.supabase.co`, previewProjectRef: preview, productionProjectRef: production },
  { environmentTarget: "preview", supabaseUrl: `https://${production}.supabase.co`, previewProjectRef: production, productionProjectRef: production },
  { environmentTarget: "preview", supabaseUrl: `https://${preview}.supabase.co`, previewProjectRef: production, productionProjectRef: production },
  { environmentTarget: "preview", supabaseUrl: `https://${preview}.supabase.co`, previewProjectRef: preview, productionProjectRef: production, experienceBusinessId: "same", productionExperienceBusinessId: "same" },
]) assert.throws(() => assertPreviewEnvironmentIsolation({ vercelEnv: "preview", ...input }));

assert.doesNotThrow(() => assertPreviewEnvironmentIsolation({
  vercelEnv: "production", environmentTarget: "production",
  supabaseUrl: `https://${production}.supabase.co`,
}));

console.log("Preview environment isolation guard — PASS");
