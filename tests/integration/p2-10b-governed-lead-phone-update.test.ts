import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

const migration="supabase/migrations/20260825030000_p210b_governed_lead_phone_update.sql";
const route="app/api/work/leads/[leadId]/route.ts";

describe("P2.10B governed lead phone update",()=>{
  it("uses owner authentication and a service-only RPC",async()=>{
    const [sql,api]=await Promise.all([readFile(migration,"utf8"),readFile(route,"utf8")]);
    expect(api).toContain("createAuthenticatedRepresentationContext");
    expect(api).toContain("zeya_update_operating_lead_phone");
    expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain("representation.user_id=p_owner_id");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.zeya_update_operating_lead_phone");
  });
  it("accepts only E.164 phone plus expected immutable lead identity",async()=>{
    const [sql,api]=await Promise.all([readFile(migration,"utf8"),readFile(route,"utf8")]);
    expect(api).toContain("const E164=/^\\+[1-9]\\d{7,14}$/");
    expect(api).toContain('["phone","expectedLeadFingerprint"]');
    expect(sql).toContain("p_expected_lead_fingerprint!~'^[0-9a-f]{64}$'");
    expect(sql).toContain("v_previous<>p_expected_lead_fingerprint");
  });
  it("updates phone only and returns before/after fingerprints",async()=>{
    const sql=await readFile(migration,"utf8");
    expect(sql).toContain("UPDATE public.mission_leads AS lead SET phone=p_phone");
    expect(sql.match(/UPDATE public\.mission_leads/g)).toHaveLength(1);
    for(const field of ["notes","source","fit_status","status","company_name","contact_name","email","business_id","business_representation_id"])
      expect(sql).not.toContain(`SET ${field}=`);
    expect(sql).toContain("RETURN QUERY SELECT v_lead.id,v_previous,v_current");
  });
  it("does not mutate missions, prospect memory, Representation, or mandate",async()=>{
    const sql=await readFile(migration,"utf8");
    expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO|DELETE FROM) public\.(?:operating_missions|prospect_observations|prospect_observation_relations|business_representations|representation_versions|direct_hire_formation_outcome_packages)/);
  });
});
