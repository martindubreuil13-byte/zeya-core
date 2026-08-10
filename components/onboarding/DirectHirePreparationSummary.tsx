'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import type { OwnerPreparationProjection, PreparationDomain, PreparationProjectionDomain } from '@/lib/onboarding/preparation-intelligence';

const DOMAIN_SECTIONS: Array<{ domain: PreparationDomain; title: string }> = [
  { domain: 'whatYouSell', title: 'What I understand you sell' },
  { domain: 'whoItIsFor', title: 'Who I understand it is for' },
  { domain: 'problemOrAspiration', title: 'The problem or aspiration it addresses' },
  { domain: 'whyCustomersShouldCare', title: 'Why I believe customers should care' },
  { domain: 'proposedDescription', title: 'How I propose to describe it' },
  { domain: 'authorityBoundaries', title: 'What I must never claim, promise or assume' },
  { domain: 'clarificationsNeeded', title: 'What I still need you to clarify' },
];

function DomainCard({ title, domain }: { title: string; domain: PreparationProjectionDomain }) {
  const unknown = domain.epistemicState === 'unknown' || !domain.provisionalUnderstanding;
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6">
      <h3 className="mb-3 text-lg font-semibold text-slate-900">{title}</h3>
      <p className={unknown ? 'text-sm italic text-slate-600' : 'text-sm text-slate-700'}>
        {unknown ? 'Unknown — I need your clarification before I can represent this.' : domain.provisionalUnderstanding}
      </p>
      {domain.epistemicState === 'partial' && (
        <p className="mt-2 text-sm text-amber-800">This is only partially supported; important uncertainty remains.</p>
      )}
      {domain.epistemicState === 'contradicted' && (
        <p className="mt-2 text-sm text-red-800">The available material conflicts. I have not chosen one account as true.</p>
      )}
      {domain.riskReason && <p className="mt-2 text-sm text-slate-600">Risk: {domain.riskReason}</p>}
      {domain.verificationNeed && <p className="mt-2 text-sm text-slate-600">Still to verify: {domain.verificationNeed}</p>}
      <p className="mt-3 text-xs text-slate-500">
        {domain.epistemicState} · {domain.confidence} confidence · {domain.representationRisk} representation risk · {domain.evidenceBasis.citationCount} scoped Evidence citation{domain.evidenceBasis.citationCount === 1 ? '' : 's'}
      </p>
    </section>
  );
}

interface Props {
  onboardingSessionId: string;
  preparationStatus: 'ready' | 'partial' | 'failed';
  summary?: OwnerPreparationProjection;
}

export function DirectHirePreparationSummary({ preparationStatus, summary }: Props) {
  const router = useRouter();
  const { session: authSession } = useAuth();
  const [isInitiating, setIsInitiating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialAcknowledged, setPartialAcknowledged] = useState(false);

  const handleBeginFormation = useCallback(async () => {
    if (preparationStatus === 'partial' && !partialAcknowledged) {
      setError('Please acknowledge the gaps before proceeding');
      return;
    }
    setIsInitiating(true);
    setError(null);
    try {
      const response = await authenticatedFetch('/api/onboarding/direct-hire/formation', authSession, {
        method: 'POST',
        body: JSON.stringify({ partialAcknowledged: preparationStatus === 'partial' }),
      });
      const body = await response.json();
      if (!response.ok || !body.success) return setError(body.error || 'Failed to initiate formation');
      router.push(`/formation/sessions/${body.data.formationSessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Formation initiation failed');
    } finally {
      setIsInitiating(false);
    }
  }, [authSession, preparationStatus, partialAcknowledged, router]);

  if (!summary) {
    return <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">Preparation intelligence is still being completed.</div>;
  }

  const canInitiate = preparationStatus === 'ready' || (preparationStatus === 'partial' && partialAcknowledged);
  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
        <p className="font-semibold">My current provisional understanding of {summary.businessIdentity.businessName}</p>
        <p className="mt-1">Based on the scoped website research and material you provided. This is not approved canonical truth.</p>
      </div>

      {DOMAIN_SECTIONS.map(({ domain, title }) => <DomainCard key={domain} title={title} domain={summary.domains[domain]} />)}

      {summary.majorUnknowns.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-slate-900">Still learning</h3>
          <ul className="space-y-2 text-sm text-slate-700">{summary.majorUnknowns.map((item) => <li key={item}>• {item}</li>)}</ul>
        </section>
      )}

      {summary.contradictions.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h3 className="mb-3 text-lg font-semibold text-red-900">Items I need to verify with you</h3>
          {summary.contradictions.map((item) => <p key={item.domain} className="text-sm text-red-800">{item.provisionalUnderstanding ?? item.domain}</p>)}
        </section>
      )}

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        {preparationStatus === 'partial' && (
          <label className="mb-4 flex items-start gap-3 text-sm text-slate-700">
            <input type="checkbox" checked={partialAcknowledged} onChange={(event) => setPartialAcknowledged(event.target.checked)} className="mt-1 h-4 w-4" />
            <span>I understand the research is partial and I&apos;m ready to clarify its uncertainties.</span>
          </label>
        )}
        {preparationStatus !== 'failed' ? (
          <button onClick={handleBeginFormation} disabled={isInitiating || !canInitiate} className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-slate-400">
            {isInitiating ? 'Beginning formation...' : 'Begin our first working session'}
          </button>
        ) : <p className="text-sm text-slate-700">Unable to complete preparation. Please contact support.</p>}
        {error && <p className="mt-3 text-sm text-red-800">{error}</p>}
      </div>
    </div>
  );
}
