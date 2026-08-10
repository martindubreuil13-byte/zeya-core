'use client';

import type { OwnerPreparationProjection, PreparationDomain } from '@/lib/onboarding/preparation-intelligence';

const LABELS: Record<PreparationDomain, string> = {
  whatYouSell: 'What the business sells',
  whoItIsFor: 'Who it is for',
  problemOrAspiration: 'Problem or aspiration',
  whyCustomersShouldCare: 'Why customers should care',
  proposedDescription: 'Proposed description',
  authorityBoundaries: 'Authority boundaries',
  clarificationsNeeded: 'Clarifications needed',
};

interface PreparedContext {
  preparation: OwnerPreparationProjection;
  relevantObservations: Array<{ meaning: string; confidence: number; domains: string[] }>;
}

export function DirectHirePreparationContext({
  context,
  onReadyToContinue,
}: {
  context: PreparedContext;
  onReadyToContinue?: () => void;
}) {
  const projection = context.preparation;
  return (
    <div className="space-y-8">
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-6 text-blue-900">
        <p><span className="font-semibold">This is what I currently believe about {projection.businessIdentity.businessName}.</span> Help me make it accurate.</p>
        <p className="mt-2 text-sm">Owner: {projection.businessIdentity.ownerName} · Growth priority: {projection.businessIdentity.growthPriority}</p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Seven provisional hypotheses</h2>
        <div className="space-y-5">
          {Object.entries(projection.domains).map(([key, domain]) => (
            <div key={key} className="border-l-4 border-blue-300 pl-4">
              <h3 className="text-sm font-medium text-slate-900">{LABELS[key as PreparationDomain]}</h3>
              <p className={domain.provisionalUnderstanding ? 'mt-1 text-sm text-slate-700' : 'mt-1 text-sm italic text-slate-600'}>
                {domain.provisionalUnderstanding ?? 'Unknown — owner clarification is required.'}
              </p>
              {domain.epistemicState === 'partial' && <p className="mt-1 text-xs text-amber-800">Partially supported; uncertainty remains.</p>}
              {domain.epistemicState === 'contradicted' && <p className="mt-1 text-xs text-red-800">Conflicting material; no account has been selected as true.</p>}
              <p className="mt-1 text-xs text-slate-500">{domain.epistemicState} · {domain.confidence} confidence · {domain.representationRisk} risk · {domain.evidenceBasis.citationCount} scoped citation{domain.evidenceBasis.citationCount === 1 ? '' : 's'}</p>
            </div>
          ))}
        </div>
      </section>

      {projection.priorityClarifications.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-3 text-lg font-semibold text-amber-900">Questions for our conversation</h2>
          <ol className="space-y-2 text-sm text-amber-900">{projection.priorityClarifications.map((question, index) => <li key={question}>{index + 1}. {question}</li>)}</ol>
        </section>
      )}

      {context.relevantObservations.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-3 text-lg font-semibold text-slate-900">Relevant preliminary observations</h2>
          <ul className="space-y-2 text-sm text-slate-700">{context.relevantObservations.map((observation, index) => <li key={`${index}-${observation.meaning}`}>{observation.meaning} <span className="text-xs text-slate-500">({observation.confidence}% confidence)</span></li>)}</ul>
        </section>
      )}

      {onReadyToContinue && (
        <div className="flex justify-end">
          <button onClick={onReadyToContinue} className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700">This is provisional. Let&apos;s talk.</button>
        </div>
      )}
    </div>
  );
}
