import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationPath = 'supabase/migrations/20260808000004_hypothesis_owner_operation_governance.sql';
const sql = readFileSync(migrationPath, 'utf8');
const normalized = sql.replace(/\s+/g, ' ');

function position(fragment: string): number {
  const found = normalized.indexOf(fragment.replace(/\s+/g, ' '));
  expect(found, `missing SQL fragment: ${fragment}`).toBeGreaterThanOrEqual(0);
  return found;
}

describe('hypothesis owner-operation governance migration', () => {
  it('creates the exact immutable operation record without duplicated correction payload', () => {
    const table = sql.slice(
      sql.indexOf('CREATE TABLE public.hypothesis_owner_operations'),
      sql.indexOf('CREATE INDEX hypothesis_owner_operations_owner_created_idx'),
    );
    expect(table).toContain('operation_id UUID PRIMARY KEY');
    expect(table).toContain('request_hash TEXT NOT NULL');
    expect(table).not.toMatch(/request_payload|raw_correction|correction_text/i);
    expect(table).not.toMatch(/updated_at|successor_hypothesis_id|status\s+TEXT/i);
    expect(sql).not.toMatch(/request_payload/i);
  });

  it('uses PostgreSQL-valid local constraints and standalone partial unique indexes', () => {
    expect(sql).toContain("request_hash ~ '^[0-9a-f]{64}$'");
    expect(sql).toContain('CONSTRAINT hypothesis_owner_operation_decision_shape CHECK');
    expect(sql).toContain('CREATE UNIQUE INDEX hypothesis_owner_operations_correction_evidence_idx');
    expect(sql).toContain('WHERE correction_evidence_id IS NOT NULL');
    expect(sql).toContain('CREATE UNIQUE INDEX hypothesis_owner_operations_one_rejection_idx');
    expect(sql).toContain("WHERE decision = 'rejected'::public.approval_decision_type");
    expect(sql).not.toMatch(/UNIQUE\s*\([^)]*\)\s*WHERE/i);
    expect(sql).not.toMatch(/CHECK\s*\([^;]*\bSELECT\b/i);
  });

  it('enforces immutability, controlled purge, RLS, and read-only table grants', () => {
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON public.hypothesis_owner_operations');
    expect(sql).toContain("current_user = 'postgres'");
    expect(sql).toContain("current_setting('zeya.controlled_purge', true) = 'on'");
    expect(sql).toContain('ALTER TABLE public.hypothesis_owner_operations ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('USING (auth.uid() = owner_id)');
    expect(normalized).toContain('REVOKE ALL ON TABLE public.hypothesis_owner_operations FROM PUBLIC, anon, authenticated, service_role');
    expect(normalized).toContain('GRANT SELECT ON TABLE public.hypothesis_owner_operations TO authenticated, service_role');
  });

  it('makes both governed RPCs service-role-only SECURITY DEFINER functions', () => {
    for (const name of [
      'zeya_apply_hypothesis_owner_action',
      'zeya_persist_hypothesis_owner_correction_successor',
    ]) {
      expect(sql).toContain(`CREATE FUNCTION public.${name}`);
      expect(sql).toContain(`ALTER FUNCTION public.${name}`);
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${name}`);
      expect(sql).toContain(`GRANT EXECUTE ON FUNCTION public.${name}`);
    }
    expect((sql.match(/SECURITY DEFINER/g) ?? [])).toHaveLength(3);
    expect((sql.match(/SET search_path = ''/g) ?? [])).toHaveLength(4);
  });

  it('hashes only a transient canonical request and globally locks the operation UUID', () => {
    expect(sql).toContain("'hypothesisId', p_hypothesis_id");
    expect(sql).toContain("'decision', p_decision::TEXT");
    expect(sql).toContain("'correctionText', v_normalized_correction");
    expect(sql).toContain("extensions.digest(");
    expect(sql).toContain("pg_catalog.pg_advisory_xact_lock(");
    expect(sql).toContain("pg_catalog.hashtextextended(p_operation_id::TEXT, 0)");
    expect(sql).not.toContain('INSERT INTO public.hypothesis_owner_operations (\n    request_payload');
  });

  it('checks replay and conflict before stale-hypothesis rejection', () => {
    const operationLookup = position('FROM public.hypothesis_owner_operations AS op WHERE op.operation_id = p_operation_id');
    const conflict = position("MESSAGE = 'operation_conflict'");
    const stale = position("MESSAGE = 'stale_hypothesis'");
    expect(operationLookup).toBeLessThan(conflict);
    expect(conflict).toBeLessThan(stale);
    expect(sql).toContain('v_existing_operation.request_hash IS DISTINCT FROM v_request_hash');
  });

  it('locks the session and validates the current exact domain version', () => {
    expect(normalized).toContain('FROM public.direct_hire_onboarding_sessions AS s WHERE s.id = v_initial_hypothesis.direct_hire_onboarding_session_id AND s.owner_id = p_owner_id FOR UPDATE');
    expect(normalized).toContain('WHERE current_h.direct_hire_onboarding_session_id = v_session.id AND current_h.constitutional_domain = v_hypothesis.constitutional_domain ORDER BY current_h.hypothesis_version DESC LIMIT 1');
    expect(sql).toContain("MESSAGE = 'stale_hypothesis'");
  });

  it('writes rejected Evidence before verification and operation without copying correction reasoning', () => {
    const evidenceInsert = position('INSERT INTO public.evidence AS correction_evidence');
    const verificationInsert = position('INSERT INTO public.hypothesis_verifications AS inserted_verification');
    const operationInsert = position('INSERT INTO public.hypothesis_owner_operations AS inserted_operation');
    expect(evidenceInsert).toBeLessThan(verificationInsert);
    expect(verificationInsert).toBeLessThan(operationInsert);
    expect(sql).toContain("'manual'::public.evidence_source_type");
    expect(sql).toContain('ARRAY[v_hypothesis.constitutional_domain]::TEXT[]');
    expect(normalized).toContain('p_decision, NULL, p_owner_id');
  });

  it('creates the deterministic successor trace and delegates persistence unchanged', () => {
    expect(sql).toContain("'hypothesis-owner-correction-v1'");
    expect(sql).toContain("|| p_operation_id::TEXT");
    expect(sql).toContain("|| v_hypothesis.constitutional_domain");
    expect(sql).toContain('FROM public.zeya_persist_hypothesis(');
    expect(sql).toContain("'owner_correction'");
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.zeya_persist_hypothesis\s*\(/);
  });

  it('requires correction Evidence, exact domain, and exact predecessor in the successor wrapper', () => {
    const wrapper = sql.slice(
      sql.indexOf('CREATE FUNCTION public.zeya_persist_hypothesis_owner_correction_successor'),
      sql.indexOf('ALTER FUNCTION public.zeya_persist_hypothesis_owner_correction_successor'),
    );
    expect(sql).toContain('v_operation.correction_evidence_id = ANY(p_source_evidence_ids)');
    expect(sql).toContain('p_constitutional_domain IS DISTINCT FROM v_operation.constitutional_domain');
    expect(sql).toContain('v_successor.previous_hypothesis_id IS DISTINCT FROM v_operation.hypothesis_id');
    expect(wrapper).not.toContain('INSERT INTO public.hypothesis_verifications');
  });

  it('extends controlled purge with operation-first and descendant-first hypothesis deletion', () => {
    const operations = position('DELETE FROM public.hypothesis_owner_operations AS owner_operation');
    const verifications = position('DELETE FROM public.hypothesis_verifications AS verification');
    const hypotheses = position('DELETE FROM public.hypotheses AS leaf_hypothesis');
    const observations = position('DELETE FROM public.observations AS observation');
    const evidence = position('DELETE FROM public.evidence AS evidence_row');
    expect(operations).toBeLessThan(verifications);
    expect(verifications).toBeLessThan(hypotheses);
    expect(hypotheses).toBeLessThan(observations);
    expect(observations).toBeLessThan(evidence);
    expect(sql).toContain('WHERE child_hypothesis.previous_hypothesis_id = leaf_hypothesis.id');
    expect(sql).toContain("MESSAGE = 'hypothesis purge lineage invalid'");
  });

  it('does not create or mutate canonical governance artifacts', () => {
    expect(sql).not.toMatch(/INSERT INTO public\.(representation_proposals|approval_decisions|representation_versions)/);
    expect(sql).toContain('SET current_version_id = NULL');
    expect((sql.match(/SET current_version_id =/g) ?? [])).toHaveLength(1);
    expect(sql).not.toMatch(/UPDATE public\.(hypotheses|hypothesis_verifications|evidence)/);
  });

  it('qualifies table columns in RETURNS TABLE functions to avoid 42702 ambiguity', () => {
    expect(sql).toContain('FROM public.hypotheses AS current_h');
    expect(sql).toContain('FROM public.hypothesis_owner_operations AS op');
    expect(sql).toContain('FROM public.hypothesis_verifications AS hv');
    expect(sql).toContain('RETURNING inserted_verification.id INTO v_verification_id');
    expect(sql).toContain('RETURNING inserted_operation.created_at INTO v_operation_created_at');
  });
});
