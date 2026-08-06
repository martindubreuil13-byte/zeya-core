'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { DirectHireInduction } from '@/components/onboarding/DirectHireInduction';
import { DirectHirePreparationSummary } from '@/components/onboarding/DirectHirePreparationSummary';
import type { DirectHirePreparationStatus } from '@/lib/onboarding/direct-hire-contract';

interface PreparationData {
  onboardingSessionId: string;
  onboardingState: string;
  preparationStatus: DirectHirePreparationStatus;
  summary?: {
    understood: Array<{ category: string; items: Array<{ label: string; value: string }> }>;
    gaps: string[];
    contradictions: Array<{ description: string; question: string }>;
    unansweredQuestions: string[];
  };
}

export default function DirectHirePreparationPage() {
  const { session: authSession } = useAuth();
  const [data, setData] = useState<PreparationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authSession) return;

    const loadPreparation = async () => {
      try {
        const response = await authenticatedFetch(
          '/api/onboarding/direct-hire/preparation/summary',
          authSession,
        );

        if (!response.ok) {
          setError('Failed to load preparation status');
          return;
        }

        const body = await response.json();
        if (body.success && body.data) {
          setData({
            onboardingSessionId: body.data.onboardingSessionId,
            onboardingState: body.data.onboardingState,
            preparationStatus: body.data.preparationStatus,
            summary: body.data.summary,
          });
        } else {
          setError(body.error || 'Unknown error');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load preparation');
      } finally {
        setLoading(false);
      }
    };

    void loadPreparation();
  }, [authSession]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-slate-600">Loading preparation...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4">
        <p className="text-sm text-red-800">{error}</p>
      </div>
    );
  }

  // Show summary if preparation is ready or partial
  if (data && (data.preparationStatus === 'ready' || data.preparationStatus === 'partial')) {
    return (
      <div className="mx-auto max-w-2xl py-8 px-4">
        <DirectHirePreparationSummary
          onboardingSessionId={data.onboardingSessionId}
          preparationStatus={data.preparationStatus}
          summary={data.summary}
        />
      </div>
    );
  }

  // Otherwise show induction flow (for employment_accepted state)
  return <DirectHireInduction />;
}
