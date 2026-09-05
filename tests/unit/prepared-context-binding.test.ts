import { describe, expect, it } from 'vitest';
import {
  ensureImmutablePreparedContext,
  preparedContextIdentitiesMatch,
  SnapshotBindingConflictError,
  type PreparedContextIdentity,
} from '../../lib/formation/prepared-context-binding';

const identity: PreparedContextIdentity = {
  formationSessionId: '00000000-0000-4000-8000-000000000001',
  businessRepresentationId: '00000000-0000-4000-8000-000000000002',
  preparationBriefId: '00000000-0000-4000-8000-000000000003',
  hypothesisSnapshotIds: [
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000004',
  ],
  preparationContractVersion: 'first-working-session-preparation-v6',
  reasoningContractVersion: '1.1-source-semantics',
};

describe('immutable Formation prepared-context binding', () => {
  it('accepts the complete identity with deterministically reordered hypothesis IDs', () => {
    expect(preparedContextIdentitiesMatch(identity, {
      ...identity,
      hypothesisSnapshotIds: [...identity.hypothesisSnapshotIds].reverse(),
    })).toBe(true);
  });

  it.each([
    ['reasoning contract', { reasoningContractVersion: 'different' }],
    ['business representation', { businessRepresentationId: '00000000-0000-4000-8000-000000000099' }],
    ['brief', { preparationBriefId: '00000000-0000-4000-8000-000000000099' }],
    ['hypotheses', { hypothesisSnapshotIds: ['00000000-0000-4000-8000-000000000099'] }],
  ])('rejects a %s mismatch', async (_label, difference) => {
    const actual = { ...identity, ...difference } as PreparedContextIdentity;
    await expect(ensureImmutablePreparedContext({
      expected: identity,
      load: async () => actual,
      create: async () => 'created',
    })).rejects.toBeInstanceOf(SnapshotBindingConflictError);
  });

  it('fails closed on a transient first attempt and succeeds on retry with one persisted snapshot', async () => {
    const formationIds = new Set([identity.formationSessionId]);
    let snapshot: PreparedContextIdentity | null = null;
    let attempts = 0;
    const start = () => ensureImmutablePreparedContext({
      expected: identity,
      load: async () => snapshot,
      create: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient_snapshot_failure');
        snapshot = identity;
        return 'created';
      },
    });

    await expect(start()).rejects.toThrow('transient_snapshot_failure');
    expect(snapshot).toBeNull();
    expect(formationIds).toEqual(new Set([identity.formationSessionId]));
    await expect(start()).resolves.toBe('created');
    expect(snapshot).toEqual(identity);
    expect(formationIds.size).toBe(1);
    expect(attempts).toBe(2);
  });

  it('normalizes an already-bound concurrent create to success', async () => {
    let snapshot: PreparedContextIdentity | null = null;
    const create = async (): Promise<'created' | 'already_bound'> => {
      await Promise.resolve();
      if (snapshot) return 'already_bound';
      snapshot = identity;
      return 'created';
    };
    const start = () => ensureImmutablePreparedContext({ expected: identity, load: async () => snapshot, create });
    await expect(Promise.all([start(), start()])).resolves.toEqual(expect.arrayContaining(['created', 'reconciled']));
    expect(snapshot).toEqual(identity);
  });
});
