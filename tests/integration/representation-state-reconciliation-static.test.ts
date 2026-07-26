import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase/migrations", name), "utf8");

const tenantLinks = read("20260726100000_proposal_link_tenant_integrity.sql");
const immutablePrivileges = read(
  "20260726110000_immutable_table_privilege_reconciliation.sql",
);

for (const table of [
  "proposal_observations",
  "proposal_evidence",
  "proposal_elements",
]) {
  assert(
    tenantLinks.includes(
      `proposal.business_representation_id = ${table}.business_representation_id`,
    ),
    `${table} policy pins its proposal tenant`,
  );
}
assert(
  tenantLinks.includes(
    "observation.business_representation_id = proposal_observations.business_representation_id",
  ),
  "observation link pins the observation tenant",
);
assert(
  tenantLinks.includes(
    "evidence.business_representation_id = proposal_evidence.business_representation_id",
  ),
  "evidence link pins the evidence tenant",
);
assert(
  tenantLinks.includes(
    "element.business_representation_id = proposal_elements.business_representation_id",
  ),
  "element link pins the element tenant",
);
assert(
  immutablePrivileges.includes(
    "REVOKE INSERT, UPDATE, DELETE\nON TABLE public.representation_versions",
  ),
  "authenticated direct canonical Version creation is revoked",
);
assert(
  immutablePrivileges.includes(
    "REVOKE UPDATE, DELETE\nON TABLE public.audit_events",
  ),
  "authenticated Audit mutation privileges are revoked",
);

console.log("Representation state reconciliation static checks — PASS");
