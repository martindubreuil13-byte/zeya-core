import { createHash } from 'node:crypto';

export const TELEPHONE_BD_READINESS_CATEGORIES = [
  'offer', 'target', 'immediate_bd_objective', 'qualification', 'meeting_objective',
  'pricing_authority', 'negotiation_authority', 'commitment_authority',
  'meeting_booking_authority', 'escalation_owner_approval', 'blocking_contradictions',
] as const;

export type TelephoneBdReadinessCategory = typeof TELEPHONE_BD_READINESS_CATEGORIES[number];
export type ReadinessState = 'satisfied' | 'unresolved' | 'blocked';
export type AuthorityDisposition =
  | 'allowed_within_bounds'
  | 'owner_approval_required'
  | 'prohibited'
  | 'unresolved';

export type ReadinessSource = {
  key: string;
  disposition?: AuthorityDisposition | 'decided';
  sourceIds: string[];
};

export type TelephoneBdReadinessResult = {
  contractVersion: 'direct-hire-telephone-bd-readiness-v1';
  ready: boolean;
  categories: Record<TelephoneBdReadinessCategory, {
    state: ReadinessState;
    sourceIds: string[];
  }>;
};

const AUTHORITY_KEYS: Partial<Record<TelephoneBdReadinessCategory, string>> = {
  pricing_authority: 'authority_pricing',
  negotiation_authority: 'authority_negotiation',
  commitment_authority: 'authority_customer_commitments',
  meeting_booking_authority: 'authority_meeting_booking',
  escalation_owner_approval: 'authority_escalation_rules',
};

export function deriveTelephoneBdReadiness(input: {
  sources: ReadinessSource[];
  blockingContradictionSourceIds?: string[];
}): TelephoneBdReadinessResult {
  const byKey = new Map(input.sources.map((source) => [source.key, source]));
  const result = {} as TelephoneBdReadinessResult['categories'];
  const ordinary: Partial<Record<TelephoneBdReadinessCategory, string>> = {
    offer: 'offer', target: 'primary_target_segment', immediate_bd_objective: 'immediate_bd_goal',
    qualification: 'qualification_threshold', meeting_objective: 'meeting_objective',
  };
  for (const category of TELEPHONE_BD_READINESS_CATEGORIES) {
    if (category === 'blocking_contradictions') {
      const ids = input.blockingContradictionSourceIds ?? [];
      result[category] = { state: ids.length ? 'blocked' : 'satisfied', sourceIds: [...ids].sort() };
      continue;
    }
    const key = ordinary[category] ?? AUTHORITY_KEYS[category];
    const source = key ? byKey.get(key) : undefined;
    if (!source) {
      result[category] = { state: 'unresolved', sourceIds: [] };
      continue;
    }
    const authority = category in AUTHORITY_KEYS;
    const explicit = !authority || source.disposition === 'allowed_within_bounds'
      || source.disposition === 'owner_approval_required' || source.disposition === 'prohibited';
    result[category] = { state: explicit ? 'satisfied' : 'unresolved', sourceIds: [...source.sourceIds].sort() };
  }
  return {
    contractVersion: 'direct-hire-telephone-bd-readiness-v1',
    ready: TELEPHONE_BD_READINESS_CATEGORIES.every((category) => result[category].state === 'satisfied'),
    categories: result,
  };
}

export function deterministicOutcomeFingerprint(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') return Object.fromEntries(
      Object.entries(input as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, normalize(nested)]),
    );
    return input;
  };
  return createHash('sha256').update(JSON.stringify(normalize(value))).digest('hex');
}

export function boundedAuthorityDisposition(text: string): AuthorityDisposition {
  if (/\b(?:owner approval|required approval|must escalate|escalate to)\b/i.test(text)) return 'owner_approval_required';
  if (/\b(?:prohibited|never|must not|may not|cannot|can't|do not|don't)\b/i.test(text)) return 'prohibited';
  if (/\b(?:up to|within|only|limited to|provided that|as long as)\b/i.test(text)) return 'allowed_within_bounds';
  return 'unresolved';
}
