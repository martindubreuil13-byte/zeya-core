import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import {
  assertAllowedOwner,
  assertZeyaApplication,
  EXPERIENCE_BUSINESS_NAME,
  provisionPublicExperienceRepresentation,
  resolveOrCreateExperienceBusiness,
} from "./public-experience-provisioning";

loadEnvConfig(process.cwd());

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const ownerEmail = required("ZEYA_EXPERIENCE_OWNER_EMAIL").toLowerCase();
  const ownerPassword = required("ZEYA_EXPERIENCE_OWNER_PASSWORD");
  const baseUrl = required("REPRESENTATION_TEST_BASE_URL").replace(/\/$/, "");
  assertAllowedOwner(ownerEmail);
  await assertZeyaApplication(baseUrl);

  const db = createClient(
    required("NEXT_PUBLIC_SUPABASE_URL"),
    required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await db.auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
  if (signedIn.error || !signedIn.data.session || !signedIn.data.user) throw new Error("Experience owner authentication failed");

  const resolved = await resolveOrCreateExperienceBusiness(db, signedIn.data.user.id);
  const representation = await provisionPublicExperienceRepresentation({
    db,
    baseUrl,
    accessToken: signedIn.data.session.access_token,
    ownerUserId: signedIn.data.user.id,
    businessId: resolved.business.id,
  });

  console.log(`business ID: ${resolved.business.id}`);
  console.log(`business name: ${EXPERIENCE_BUSINESS_NAME}`);
  console.log(`owner email: ${ownerEmail}`);
  console.log(`business: ${resolved.disposition}`);
  console.log(`representation: ${representation.disposition}`);
  console.log(`representation ID: ${representation.representationId}`);
  console.log(`canonical Version ID: ${representation.versionId}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Public Experience provisioning failed");
  process.exitCode = 1;
});
