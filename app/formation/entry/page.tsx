'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { OwnerOnboarding } from '@/components/owner/OwnerOnboarding';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { resolveOwnerJourneyPath } from '@/lib/owner/owner-route';
import { useEffect, useState } from 'react';

type OwnerStatus =
  | 'loading'
  | 'active_formation'
  | 'has_representation'
  | 'new_owner'
  | 'business_selection_required'
  | 'error';

interface OwnerState {
  status: OwnerStatus;
  formationSessionId?: string;
  formationStatus?: string;
  businessRepresentationId?: string;
  businessId?: string;
  versionNumber?: number;
}

type OwnerStatusErrorBody = {
  error?: string;
  stage?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function FormationEntryPage() {
  const router = useRouter();
  const { user, loading, signOut, session } = useAuth();
  const [ownerState, setOwnerState] = useState<OwnerState>({ status: 'loading' });
  const [showLogout, setShowLogout] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);
  const [statusRequest, setStatusRequest] = useState(0);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  // Loading timeout fallback - if status stays 'loading' for 10s, show timeout UI
  useEffect(() => {
    if (ownerState.status !== 'loading') return;

    const timeoutId = setTimeout(() => {
      setLoadingTimeout(true);
    }, 10000);

    return () => {
      clearTimeout(timeoutId);
      setLoadingTimeout(false);
    };
  }, [ownerState.status]);

  // Check owner's current state
  useEffect(() => {
    if (!user || loading || !session) return;

    const checkOwnerStatus = async () => {
      try {
        const res = await authenticatedFetch('/api/owner/status', session);

        if (res.status === 401) {
          const failure = await res.json().catch(() => ({})) as OwnerStatusErrorBody;
          console.error('[formation-entry] owner status failed', {
            status: res.status,
            error: failure.error ?? 'owner_status_failed',
            stage: failure.stage ?? 'authentication',
          });
          router.replace('/login');
          return;
        }

        if (res.status === 409) {
          const failure = await res.json().catch(() => ({})) as OwnerStatusErrorBody;
          console.error('[formation-entry] owner status requires business selection', {
            status: res.status,
            error: failure.error ?? 'owner_status_failed',
            stage: failure.stage ?? 'business_lookup',
          });

          if (
            failure.error === 'business_selection_required' &&
            failure.stage === 'business_lookup'
          ) {
            setOwnerState({ status: 'business_selection_required' });
            return;
          }

          setOwnerState({ status: 'error' });
          return;
        }

        if (!res.ok) {
          const failure = await res.json().catch(() => ({})) as OwnerStatusErrorBody;
          console.error('[formation-entry] owner status failed', {
            status: res.status,
            error: failure.error ?? 'owner_status_failed',
            stage: failure.stage ?? 'response_validation',
          });
          setOwnerState({ status: 'error' });
          return;
        }

        const data = await res.json();

        if (!data.success) {
          console.error('[formation-entry] owner status failed', {
            status: res.status,
            error: data.error ?? 'owner_status_failed',
            stage: data.stage ?? 'response_validation',
          });
          setOwnerState({ status: 'error' });
          return;
        }

        const ownerData = data.data;

        // Resume the exact active Formation returned by the owner-state API.
        if (ownerData.status === 'active_formation') {
          if (
            typeof ownerData.formationSessionId !== 'string' ||
            !UUID.test(ownerData.formationSessionId)
          ) {
            setOwnerState({ status: 'error' });
            return;
          }
          const nextPath = resolveOwnerJourneyPath({
            status: 'active_formation',
            formationSessionId: ownerData.formationSessionId,
          });
          if (!nextPath) {
            setOwnerState({ status: 'error' });
            return;
          }
          router.replace(nextPath);
          return;
        }

        // If has Representation, redirect to workspace
        if (ownerData.status === 'has_representation') {
          const nextPath = resolveOwnerJourneyPath({ status: 'has_representation' });
          if (!nextPath) {
            setOwnerState({ status: 'error' });
            return;
          }
          router.replace(nextPath);
          return;
        }

        // New owner - show onboarding (Representation Experience)
        setOwnerState({ status: 'new_owner' });
      } catch (err) {
        console.error('[formation-entry] Failed to check status:', err);
        setOwnerState({ status: 'error' });
      }
    };

    checkOwnerStatus();
  }, [user, loading, session, router, statusRequest]);

  const retryOwnerStatus = () => {
    setLoadingTimeout(false);
    setOwnerState({ status: 'loading' });
    setStatusRequest((request) => request + 1);
  };

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
  };

  const handleStartExperience = () => {
    if (!user || !session) {
      setOwnerState({ status: 'error' });
      return;
    }
    const nextPath = resolveOwnerJourneyPath({ status: 'new_owner' });
    if (!nextPath) {
      setOwnerState({ status: 'error' });
      return;
    }
    router.push(nextPath);
  };

  // Loading state
  if (loading || ownerState.status === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your account...</p>

          {loadingTimeout && (
            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded">
              <p className="text-sm text-yellow-800 mb-4">
                This is taking longer than expected.
              </p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  // Error state
  if (ownerState.status === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-red-600 mb-4">Failed to load your account</p>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (ownerState.status === 'business_selection_required') {
    return (
      <div className="flex items-center justify-center min-h-screen px-6">
        <div className="text-center max-w-lg">
          <h1 className="text-xl font-semibold text-gray-900 mb-3">
            Business selection required
          </h1>
          <p className="text-gray-600 mb-6">
            More than one business is connected to this account. Business selection is not
            available in this Preview yet. Please resolve the existing business records before
            continuing.
          </p>
          <button
            onClick={retryOwnerStatus}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // New owner - show Representation Experience onboarding
  if (ownerState.status === 'new_owner') {
    return (
      <div>
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setShowLogout(!showLogout)}
            className="text-sm text-gray-600 hover:text-gray-900 px-3 py-2 rounded hover:bg-gray-200"
          >
            Menu
          </button>
          {showLogout && (
            <button
              onClick={handleLogout}
              className="absolute right-0 mt-2 px-3 py-2 text-sm bg-red-600 text-white rounded hover:bg-red-700"
            >
              Sign Out
            </button>
          )}
        </div>

        <OwnerOnboarding onStartExperience={handleStartExperience} />
      </div>
    );
  }

  return null;
}
