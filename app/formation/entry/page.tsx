'use client';

import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { FormationEntry } from '@/components/formation/FormationEntry';
import { OwnerOnboarding } from '@/components/owner/OwnerOnboarding';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import { useEffect, useState } from 'react';

type OwnerStatus = 'loading' | 'active_formation' | 'has_representation' | 'new_owner' | 'error';

interface OwnerState {
  status: OwnerStatus;
  formationSessionId?: string;
  formationStatus?: string;
  businessRepresentationId?: string;
  businessId?: string;
  versionNumber?: number;
}

export default function FormationEntryPage() {
  const router = useRouter();
  const { user, loading, signOut, session } = useAuth();
  const [ownerState, setOwnerState] = useState<OwnerState>({ status: 'loading' });
  const [showLogout, setShowLogout] = useState(false);
  const [loadingTimeout, setLoadingTimeout] = useState(false);

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
          console.error('[formation-entry] Unauthorized - redirecting to login');
          router.replace('/login');
          return;
        }

        if (!res.ok) {
          setOwnerState({ status: 'error' });
          return;
        }

        const data = await res.json();

        if (!data.success) {
          setOwnerState({ status: 'error' });
          return;
        }

        const ownerData = data.data;

        // If active Formation, stay on this page to resume
        if (ownerData.status === 'active_formation') {
          setOwnerState({
            status: 'active_formation',
            formationSessionId: ownerData.formationSessionId,
            formationStatus: ownerData.formationStatus,
            businessRepresentationId: ownerData.businessRepresentationId,
          });
          return;
        }

        // If has Representation, redirect to workspace
        if (ownerData.status === 'has_representation') {
          router.replace('/representation/living');
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
  }, [user, loading, session, router]);

  const handleLogout = async () => {
    await signOut();
    router.replace('/login');
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

        <OwnerOnboarding onStartExperience={() => setOwnerState({ status: 'loading' })} />
      </div>
    );
  }

  // Active Formation - show FormationEntry component to resume
  if (ownerState.status === 'active_formation' && ownerState.formationSessionId) {
    return (
      <div className="min-h-screen bg-gray-50">
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

        <FormationEntry onComplete={() => {}} />
      </div>
    );
  }

  return null;
}
