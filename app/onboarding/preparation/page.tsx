'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { DirectHireInduction } from '@/components/onboarding/DirectHireInduction';
import { DirectHirePreparationSummary } from '@/components/onboarding/DirectHirePreparationSummary';
import type { DirectHirePreparationStatus } from '@/lib/onboarding/direct-hire-contract';
import type { OwnerPreparationProjection } from '@/lib/onboarding/preparation-intelligence';

interface PreparationData {
  onboardingSessionId: string;
  onboardingState: string;
  preparationStatus: DirectHirePreparationStatus;
  inductionState: string;
  summary?: OwnerPreparationProjection;
}

export default function DirectHirePreparationPage() {
  const { session: authSession } = useAuth();
  const [data, setData] = useState<PreparationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [inductionConfirmed, setInductionConfirmed] = useState(false);

  useEffect(() => {
    if (!authSession) return;

    const loadPreparation = async () => {
      try {
        const [response, inductionResponse] = await Promise.all([
          authenticatedFetch('/api/onboarding/direct-hire/preparation/summary', authSession),
          authenticatedFetch('/api/onboarding/direct-hire/induction', authSession),
        ]);

        if (!response.ok || !inductionResponse.ok) {
          setError('Failed to load preparation status');
          return;
        }

        const body = await response.json();
        const inductionBody = await inductionResponse.json();
        if (body.success && body.data && inductionBody.success && inductionBody.data) {
          setData({
            onboardingSessionId: body.data.onboardingSessionId,
            onboardingState: body.data.onboardingState,
            preparationStatus: body.data.preparationStatus,
            inductionState: inductionBody.data.induction_state,
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

  if (data && data.inductionState !== 'preparation_pending' && !inductionConfirmed) {
    return <DirectHireInduction onReadyForPreparation={() => setInductionConfirmed(true)} />;
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
  return <DirectHireInduction onReadyForPreparation={() => setInductionConfirmed(true)} />;
}
