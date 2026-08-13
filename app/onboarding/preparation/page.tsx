'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { DirectHireInduction } from '@/components/onboarding/DirectHireInduction';
import { DirectHireWorkingSessionScheduler } from '@/components/onboarding/DirectHireWorkingSession';

export default function DirectHirePreparationPage() {
  const { session: authSession } = useAuth();
  const [inductionState, setInductionState] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authSession) return;
    const loadJourney = async () => {
      try {
        const response = await authenticatedFetch(
          '/api/onboarding/direct-hire/induction',
          authSession,
        );
        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success || !body.data) {
          setError(body.error || 'induction_status_failed');
          return;
        }
        setInductionState(body.data.induction_state);
      } catch {
        setError('induction_status_failed');
      } finally {
        setLoading(false);
      }
    };
    void loadJourney();
  }, [authSession]);

  if (loading) {
    return (
      <main className="min-h-screen bg-zeya-void text-zeya-ivory grid place-items-center px-6">
        <p className="text-zeya-taupe" role="status">Loading your induction…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-zeya-void text-zeya-ivory grid place-items-center px-6">
        <p role="alert" className="text-red-200">{error}</p>
      </main>
    );
  }

  // Routing precedence: incomplete induction, then scheduling, then the
  // scheduled/preparing view. The scheduler derives its latter two surfaces
  // from the durable active appointment; Formation is intentionally untouched.
  if (inductionState !== 'preparation_pending') {
    return <DirectHireInduction onReadyForScheduling={() => setInductionState('preparation_pending')} />;
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zeya-void px-5 py-12 text-zeya-ivory sm:px-8 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(197,164,126,0.12),transparent_42%)]" />
      <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] max-w-2xl items-center">
        <DirectHireWorkingSessionScheduler />
      </div>
    </main>
  );
}
