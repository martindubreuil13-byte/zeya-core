import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertAllowedOwner,
  assertUnprotectedBusinessId,
  canonicalValuesMatch,
  EXPERIENCE_BUSINESS_NAME,
  EXPERIENCE_ELEMENT_VALUES,
  EXPERIENCE_INDUSTRY,
  EXPERIENCE_PURPOSE,
  selectDedicatedBusiness,
} from "../../scripts/public-experience-provisioning";

const ownerId = "11111111-1111-4111-8111-111111111111";
const exact = {
  id: "22222222-2222-4222-8222-222222222222",
  user_id: ownerId,
  business_name: EXPERIENCE_BUSINESS_NAME,
  industry: EXPERIENCE_INDUSTRY,
  business_profile: { purpose: EXPERIENCE_PURPOSE },
};

assert.doesNotThrow(() => assertAllowedOwner("martin@mindrasolutions.com"));
assert.throws(() => assertAllowedOwner("experience-demo@zeya.invalid"), /real operational owner/);
assert.throws(() => assertUnprotectedBusinessId("9340229c-3608-47c9-b204-3bedc99ed656"), /Protected Business/);
assert.throws(() => assertUnprotectedBusinessId("e2db4a3e-7c37-4b61-b123-7e1915eb4a91"), /Protected Business/);
assert.equal(selectDedicatedBusiness([exact], ownerId)?.id, exact.id, "exact owner Business is reused");
assert.equal(selectDedicatedBusiness([], ownerId), null, "no match selects the create path");
assert.throws(() => selectDedicatedBusiness([exact, { ...exact, id: "33333333-3333-4333-8333-333333333333" }], ownerId), /Multiple/);
assert.throws(() => selectDedicatedBusiness([{ ...exact, user_id: "44444444-4444-4444-8444-444444444444" }], ownerId), /Cross-tenant/);
assert.throws(() => selectDedicatedBusiness([{ ...exact, business_profile: { purpose: "other" } }], ownerId), /Conflicting/);
assert.equal(canonicalValuesMatch(EXPERIENCE_ELEMENT_VALUES), true, "exact canonical baseline is idempotently reusable");
assert.equal(canonicalValuesMatch({ ...EXPERIENCE_ELEMENT_VALUES, system_identity: "conflict" }), false, "conflicting active canonical content fails comparison");

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const shared = read("scripts/public-experience-provisioning.ts");
const entry = read("scripts/provision-public-experience-business.ts");
assert(shared.includes('.eq("user_id", ownerUserId)'), "Business resolution is owner-scoped");
assert(shared.includes('.insert({\n      user_id: ownerUserId'), "no-match path creates exactly through authenticated Business insert");
assert(shared.includes("Multiple dedicated Experience Businesses found"), "multiple matches fail closed");
assert(shared.includes("Conflicting active Experience Representation found"), "conflicting active Representation fails closed");
assert(shared.includes('postApi(args.baseUrl, "/api/representation/evidence"'), "canonical Evidence API is used");
assert(shared.includes('postApi(args.baseUrl, "/api/representation/versions"'), "canonical Version API is used");
assert(!shared.includes('.from("representation_versions").insert'), "canonical Versions are never inserted directly");
assert(!shared.includes("update({ current_version_id"), "current_version_id is never mutated directly");
assert(!shared.includes("SUPABASE_SERVICE_ROLE_KEY"), "provisioning has no service-role shortcut");
assert(!/console\.(?:log|error)\([^\n]*(?:password|accessToken|refresh_token|service_role)/i.test(shared + entry), "credentials and tokens are never logged");
assert(entry.includes("signInWithPassword"), "normal owner authentication is used");
assert(entry.includes("assertZeyaApplication"), "base URL identity is verified before provisioning");
assert(entry.includes("resolveOrCreateExperienceBusiness"), "Business creation and reuse share one idempotent path");
assert(entry.includes("provisionPublicExperienceRepresentation"), "Business provisioning invokes canonical representation provisioning");

console.log("Public Experience provisioning checks — PASS");
