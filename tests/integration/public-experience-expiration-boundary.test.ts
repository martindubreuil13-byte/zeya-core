import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const migration = fs.readFileSync(
  path.join(root, "supabase/migrations/20260723180000_public_experience_expiration_boundary.sql"),
  "utf8",
);
const reflectionRoute = fs.readFileSync(
  path.join(root, "app/api/experience/session/reflection/route.ts"),
  "utf8",
);

assert(migration.includes("OLD.expires_at <= transaction_timestamp()"));
assert(migration.includes("NEW.state IS DISTINCT FROM OLD.state"));
assert(migration.includes("zeya_enforce_public_experience_derived_artifact_insert"));
assert(migration.includes("session.expires_at > transaction_timestamp()"));
assert(migration.includes("FOR SHARE"));
assert(migration.includes("FOR UPDATE"));
assert(migration.includes("session.expires_at <= transaction_timestamp()"));
assert(migration.includes("ERRCODE = 'PZ410'"));
assert(!migration.includes("session.state NOT IN ('call_dispatched', 'call_active', 'completion_processing_failed', 'expired')"));
assert(reflectionRoute.includes('status: "expired"'));
assert(reflectionRoute.includes("{ status: 410 }"));
assert(reflectionRoute.includes('persisted.error.code === "PZ410"'));

console.log("Public Experience expiration boundary static contract — PASS");
