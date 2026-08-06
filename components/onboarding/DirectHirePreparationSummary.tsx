'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';

interface PreparationSummary {
  understood: Array<{ category: string; items: Array<{ label: string; value: string }> }>;
  gaps: string[];
  contradictions: Array<{ description: string; question: string }>;
  unansweredQuestions: string[];
}

interface DirectHirePreparationSummaryProps {
  onboardingSessionId: string;
  preparationStatus: 'ready' | 'partial' | 'failed';
  summary?: PreparationSummary;
}

export function DirectHirePreparationSummary({
  onboardingSessionId,
  preparationStatus,
  summary,
}: DirectHirePreparationSummaryProps) {
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
      const response = await authenticatedFetch(
        '/api/onboarding/direct-hire/formation',
        authSession,
        {
          method: 'POST',
          body: JSON.stringify({
            partialAcknowledged: preparationStatus === 'partial',
          }),
        },
      );

      const body = await response.json();

      if (!response.ok || !body.success) {
        setError(body.error || 'Failed to initiate formation');
        return;
      }

      const formationSessionId = body.data.formationSessionId;
      router.push(`/formation/sessions/${formationSessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Formation initiation failed');
    } finally {
      setIsInitiating(false);
    }
  }, [authSession, preparationStatus, partialAcknowledged, router]);

  const canInitiate = preparationStatus === 'ready'
    || (preparationStatus === 'partial' && partialAcknowledged);

  return (
    <div className="space-y-6">
      {/* Seven required sections - ALWAYS visible */}

      {/* Section 1: What I understand you sell */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          What I understand you sell
        </h3>
        {summary?.understood && summary.understood.length > 0 ? (
          <div className="space-y-4">
            {summary.understood.map((category) => (
              <div key={category.category}>
                <h4 className="mb-2 text-sm font-medium text-slate-700">
                  {category.category}
                </h4>
                <ul className="space-y-1">
                  {category.items.map((item) => (
                    <li key={item.label} className="text-sm text-slate-600">
                      <span className="font-medium">{item.label}:</span> {item.value}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">Still learning from your website and materials</p>
        )}
      </div>

      {/* Section 2: Who I understand it is for */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Who I understand it is for
        </h3>
        {summary?.understood && summary.understood.some((c) => c.category.toLowerCase().includes('target')) ? (
          <div className="space-y-2">
            {summary.understood
              .filter((c) => c.category.toLowerCase().includes('target'))
              .flatMap((c) => c.items)
              .map((item) => (
                <p key={item.label} className="text-sm text-slate-600">
                  <span className="font-medium">{item.label}:</span> {item.value}
                </p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">Not yet specified in materials</p>
        )}
      </div>

      {/* Section 3: The problem or aspiration */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          The problem or aspiration it addresses
        </h3>
        {summary?.understood && summary.understood.some((c) => c.category.toLowerCase().includes('problem')) ? (
          <div className="space-y-2">
            {summary.understood
              .filter((c) => c.category.toLowerCase().includes('problem'))
              .flatMap((c) => c.items)
              .map((item) => (
                <p key={item.label} className="text-sm text-slate-600">
                  <span className="font-medium">{item.label}:</span> {item.value}
                </p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">To be discussed in first working session</p>
        )}
      </div>

      {/* Section 4: Why customers should care */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          Why I believe customers should care
        </h3>
        {summary?.understood && summary.understood.some((c) => c.category.toLowerCase().includes('value')) ? (
          <div className="space-y-2">
            {summary.understood
              .filter((c) => c.category.toLowerCase().includes('value'))
              .flatMap((c) => c.items)
              .map((item) => (
                <p key={item.label} className="text-sm text-slate-600">
                  <span className="font-medium">{item.label}:</span> {item.value}
                </p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">Will be clarified during preparation</p>
        )}
      </div>

      {/* Section 5: How to describe it (with pricing) */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          How I propose to describe it
        </h3>
        {summary?.understood && summary.understood.some((c) => c.category.toLowerCase().includes('describe')) ? (
          <div className="space-y-3">
            {summary.understood
              .filter((c) => c.category.toLowerCase().includes('describe'))
              .flatMap((c) => c.items)
              .map((item) => (
                <div key={item.label}>
                  <p className="text-sm font-medium text-slate-700">{item.label}</p>
                  <p className="text-sm text-slate-600">{item.value}</p>
                </div>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">To be determined</p>
        )}
      </div>

      {/* Section 6: What I must never claim */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          What I must never claim, promise or assume
        </h3>
        {summary?.understood && summary.understood.some((c) => c.category.toLowerCase().includes('boundary')) ? (
          <div className="space-y-2">
            {summary.understood
              .filter((c) => c.category.toLowerCase().includes('boundary'))
              .flatMap((c) => c.items)
              .map((item) => (
                <p key={item.label} className="text-sm text-slate-600">
                  <span className="font-medium">{item.label}:</span> {item.value}
                </p>
              ))}
          </div>
        ) : (
          <p className="text-sm text-slate-600 italic">Will establish in first meeting</p>
        )}
      </div>

      {/* Section 7: What I still need to clarify */}
      <div className="rounded-lg border border-slate-200 bg-white p-6">
        <h3 className="mb-4 text-lg font-semibold text-slate-900">
          What I still need you to clarify
        </h3>
        {summary?.unansweredQuestions && summary.unansweredQuestions.length > 0 ? (
          <ol className="space-y-2">
            {summary.unansweredQuestions.map((question, idx) => (
              <li key={idx} className="text-sm text-slate-700">
                {idx + 1}. {question}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-slate-600 italic">Will ask during first working session</p>
        )}
      </div>

      {/* Contradictions - if any */}
      {summary?.contradictions && summary.contradictions.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h3 className="mb-4 text-lg font-semibold text-amber-900">
            Items I need to verify with you
          </h3>
          <div className="space-y-3">
            {summary.contradictions.map((item, idx) => (
              <div key={idx} className="text-sm">
                <p className="mb-1 font-medium text-amber-900">{item.description}</p>
                <p className="text-amber-800">{item.question}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Unknowns and Gaps - ALWAYS show explicitly */}
      {summary?.gaps && summary.gaps.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
          <h3 className="mb-4 text-lg font-semibold text-slate-900">
            Still learning
          </h3>
          <ul className="space-y-2">
            {summary.gaps.map((gap, idx) => (
              <li key={idx} className="text-sm text-slate-700">
                • {gap}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Evidence basis */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm text-blue-900">
          Evidence basis: website research + owner-provided materials
        </p>
      </div>

      {/* Status and Actions */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        {preparationStatus === 'ready' && (
          <div className="space-y-4">
            <div className="text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-900">Preparation complete</p>
              <p>I have what I need to begin our first working session.</p>
            </div>
            <button
              onClick={handleBeginFormation}
              disabled={isInitiating}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
            >
              {isInitiating ? 'Beginning formation...' : 'Begin our first working session'}
            </button>
          </div>
        )}

        {preparationStatus === 'partial' && (
          <div className="space-y-4">
            <div className="text-sm text-slate-700">
              <p className="mb-2 font-medium text-slate-900">Preparation partial</p>
              <p className="mb-4">
                I have the essentials but there are gaps. You can proceed now and we&apos;ll fill gaps during
                our conversation.
              </p>
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  checked={partialAcknowledged}
                  onChange={(e) => setPartialAcknowledged(e.target.checked)}
                  className="mt-1 h-4 w-4"
                />
                <span>I understand preparation is incomplete and I&apos;m ready to begin anyway</span>
              </label>
            </div>
            <button
              onClick={handleBeginFormation}
              disabled={isInitiating || !canInitiate}
              className="w-full rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:bg-slate-400"
            >
              {isInitiating ? 'Beginning formation...' : 'Begin with these gaps'}
            </button>
          </div>
        )}

        {preparationStatus === 'failed' && (
          <div className="text-sm text-slate-700">
            <p className="mb-2 font-medium text-slate-900">Preparation failed</p>
            <p>Unable to complete preparation. Please contact support.</p>
          </div>
        )}

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-800">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
