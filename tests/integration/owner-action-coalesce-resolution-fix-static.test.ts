import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  'supabase/migrations/20260808000005_owner_action_coalesce_resolution_fix.sql',
  'utf8',
);
const normalized = sql.replace(/\s+/g, ' ');

describe('owner-action COALESCE resolution corrective migration', () => {
  it('targets the exact deployed function and replaces only the invalid expression', () => {
    expect(sql).toContain(
      'public.zeya_apply_hypothesis_owner_action(uuid,uuid,public.approval_decision_type,uuid,text)',
    );
    expect(sql).toContain(
      "'pg_catalog.coalesce(pg_catalog.max(hv.verification_sequence), 0) + 1'",
    );
    expect(sql).toContain(
      "'COALESCE(pg_catalog.max(hv.verification_sequence), 0::BIGINT) + 1'",
    );
    expect(sql).toContain('pg_catalog.pg_get_functiondef(v_identity)');
    expect(sql).toContain('EXECUTE pg_catalog.replace(');
  });

  it('fails closed if the deployed definition is missing or differs unexpectedly', () => {
    expect(sql).toContain('IF v_identity IS NULL THEN');
    expect(sql).toContain('does not contain the expected COALESCE defect');
    expect(sql).toContain('contains multiple COALESCE defects');
    expect(sql).toContain('BEGIN;');
    expect(sql).toContain('COMMIT;');
  });

  it('reasserts the exact owner and service-role-only ACL', () => {
    expect(normalized).toContain(
      'ALTER FUNCTION public.zeya_apply_hypothesis_owner_action( UUID, UUID, public.approval_decision_type, UUID, TEXT ) OWNER TO postgres',
    );
    expect(normalized).toContain(
      'FROM PUBLIC, anon, authenticated, service_role',
    );
    expect(normalized).toContain(
      'GRANT EXECUTE ON FUNCTION public.zeya_apply_hypothesis_owner_action( UUID, UUID, public.approval_decision_type, UUID, TEXT ) TO service_role',
    );
  });

  it('does not change schema or touch any governance table data', () => {
    expect(sql).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM/i);
    expect(sql).not.toContain('zeya_persist_hypothesis');
  });
});
