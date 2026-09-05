import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(resolve('supabase/migrations/20260904000002_p2_12d_3d_formation_mode_rpc_and_immutability.sql'), 'utf8');
const route = readFileSync(resolve('app/api/onboarding/direct-hire/formation/route.ts'), 'utf8');
const snapshotMigration = readFileSync(resolve('supabase/migrations/20260903010000_p2_12d_3_immutable_formation_prepared_context.sql'), 'utf8');

describe('P2.12D.3D mode repair static contract', () => {
  it('persists snapshot mode only in the new v6 Formation INSERT', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.zeya_initiate_direct_hire_first_working_session_formation');
    expect(migration).toMatch(/formation_started_at, prepared_context_mode[\s\S]*'immutable_snapshot_v6'/);
    expect(migration).toContain("preparation_contract_version = 'first-working-session-preparation-v6'");
    expect(migration).not.toMatch(/UPDATE public\.representation_formation_sessions[\s\S]*prepared_context_mode\s*=/);
  });

  it('makes only prepared_context_mode immutable while allowing unrelated updates', () => {
    expect(migration).toContain('BEFORE UPDATE OF prepared_context_mode');
    expect(migration).toContain('OLD.prepared_context_mode IS DISTINCT FROM NEW.prepared_context_mode');
    expect(migration).toContain("RAISE EXCEPTION 'formation_prepared_context_mode_immutable'");
    expect(migration).toContain('RETURN NEW');
  });

  it('branches snapshot behavior exclusively on persisted mode', () => {
    expect(route).toContain(".select('id,business_representation_id,prepared_context_mode')");
    expect(route).toContain('if (mode === null) return success');
    expect(route).toContain('if (mode !== IMMUTABLE_SNAPSHOT_V6_MODE)');
    expect(route).not.toMatch(/initiated_from/);
    expect(route).not.toMatch(/if\s*\(isNew\)/);
  });

  it('normalizes the real snapshot INSERT race to already_bound', () => {
    expect(snapshotMigration).toContain('ON CONFLICT ON CONSTRAINT direct_hire_formation_prepared_context_pkey DO NOTHING');
    expect(snapshotMigration).toContain('RETURNING inserted_context.formation_session_id INTO v_context_id');
    expect(snapshotMigration).not.toMatch(/ON CONFLICT \(formation_session_id\)|RETURNING formation_session_id/);
    expect(snapshotMigration).toContain("RAISE EXCEPTION 'formation_prepared_context_already_bound'");
  });

  it('preserves the exact snapshot RPC input and output contract', () => {
    expect(snapshotMigration).toMatch(/zeya_create_formation_prepared_context_snapshot\(\s*p_formation_session_id uuid,\s*p_working_session_id uuid,\s*p_business_representation_id uuid,\s*p_preparation_brief_id uuid,\s*p_hypothesis_snapshot_ids uuid\[\],\s*p_preparation_contract_version text,\s*p_reasoning_contract_version text\s*\) RETURNS TABLE \(\s*context_id uuid,\s*formation_session_id uuid,\s*brief_id uuid,\s*hypothesis_count int,\s*created_at timestamptz\s*\)/);
  });
});
