import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  assertAllowedOwner,
  assertUnprotectedBusinessId,
  assertZeyaApplication,
  provisionPublicExperienceRepresentation,
} from "./public-experience-provisioning";

loadEnvConfig(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const email = required("ZEYA_EXPERIENCE_OWNER_EMAIL").toLowerCase();
  const password = required("ZEYA_EXPERIENCE_OWNER_PASSWORD");
  const businessId = required("ZEYA_EXPERIENCE_BUSINESS_ID");
  const baseUrl = required("REPRESENTATION_TEST_BASE_URL").replace(/\/$/, "");
  assertAllowedOwner(email);
  assertUnprotectedBusinessId(businessId);
  await assertZeyaApplication(baseUrl);

  const db = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await db.auth.signInWithPassword({ email, password });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) throw new Error("Experience owner authentication failed");
  const result = await provisionPublicExperienceRepresentation({
    db,
    baseUrl,
    accessToken: signedIn.data.session.access_token,
    ownerUserId: signedIn.data.user.id,
    businessId,
  });
  console.log(`business ID: ${businessId}`);
  console.log(`owner email: ${email}`);
  console.log(`representation: ${result.disposition}`);
  console.log(`representation ID: ${result.representationId}`);
  console.log(`canonical Version ID: ${result.versionId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Representation provisioning failed");
  process.exitCode = 1;
});
