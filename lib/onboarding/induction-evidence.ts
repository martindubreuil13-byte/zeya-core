import type { ConstitutionalDomain } from './hypothesis-reasoning-types';

const FIXED_INDUCTION_DOMAINS: Record<string, ConstitutionalDomain[]> = {
  'What the business sells': ['whatYouSell'],
  'Target customer': ['whoItIsFor'],
};

export function constitutionalDomainsForInductionMaterial(
  label: string | null | undefined,
): ConstitutionalDomain[] {
  return label ? [...(FIXED_INDUCTION_DOMAINS[label] ?? [])] : [];
}

export function isFixedInductionMaterial(
  label: string | null | undefined,
  type: string | null | undefined,
): boolean {
  return type === 'description' && Boolean(label && label in FIXED_INDUCTION_DOMAINS);
}
