'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';

interface LivingRepresentationData {
  businessId: string;
  representationId: string;
  version: {
    id: string;
    number: number;
    confidenceScore: number;
    createdAt: string;
    isCanonical: boolean;
    elementValues: Record<string, unknown>;
  };
}

type LoadingState = 'loading' | 'loaded' | 'error' | 'no_business' | 'no_representation' | 'no_version' | 'multiple_businesses';

export default function LivingRepresentationPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [data, setData] = useState<LivingRepresentationData | null>(null);
  const [state, setState] = useState<LoadingState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [loadTimeout, setLoadTimeout] = useState(false);

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!authLoading && !user) {
      router.replace('/login');
    }
  }, [user, authLoading, router]);

  // Load representation data
  useEffect(() => {
    if (authLoading || !session) return;

    let timeoutId: NodeJS.Timeout;

    const loadRepresentation = async () => {
      try {
        setState('loading');
        setError(null);
        setLoadTimeout(false);

        // Set timeout for loading
        timeoutId = setTimeout(() => {
          setLoadTimeout(true);
        }, 8000);

        const res = await authenticatedFetch('/api/representation/living', session);

        clearTimeout(timeoutId);

        if (res.status === 401) {
          router.replace('/login');
          return;
        }

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({ error: 'Request failed' }));

          if (res.status === 404) {
            if (errorData.state === 'no_business') {
              setState('no_business');
              setError('No business found. Please complete onboarding first.');
            } else if (errorData.state === 'no_representation') {
              setState('no_representation');
              setError('No representation found.');
            } else if (errorData.state === 'no_canonical_version') {
              setState('no_version');
              setError('No canonical version exists yet.');
            } else {
              setState('error');
              setError(errorData.error || 'Failed to load representation');
            }
          } else if (res.status === 409) {
            if (errorData.state === 'multiple_businesses') {
              setState('multiple_businesses');
              setError('Multiple businesses found. Business selection coming soon.');
            } else {
              setState('error');
              setError(errorData.error || 'Request failed');
            }
          } else {
            setState('error');
            setError(errorData.error || 'Failed to load representation');
          }
          return;
        }

        const responseData = await res.json();
        if (responseData.success && responseData.data) {
          setData(responseData.data);
          setState('loaded');
        } else {
          setState('error');
          setError(responseData.error || 'Failed to load representation');
        }
      } catch (err) {
        clearTimeout(timeoutId);
        console.error('[living-representation] Failed:', err);
        setState('error');
        setError(err instanceof Error ? err.message : 'Failed to load representation');
      }
    };

    loadRepresentation();

    return () => clearTimeout(timeoutId);
  }, [session, authLoading, router]);

  // Loading state
  if (authLoading || state === 'loading') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="text-center space-y-4">
          <div className="inline-flex">
            <div className="animate-spin rounded-full h-12 w-12 border border-slate-300 border-t-blue-600"></div>
          </div>
          <p className="text-slate-600">Loading your Representation...</p>
          {loadTimeout && (
            <div className="pt-4">
              <p className="text-sm text-slate-500 mb-2">This is taking longer than expected.</p>
              <button
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-700"
              >
                Reload
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Error state: no business
  if (state === 'no_business') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-lg mx-auto px-6">
          <div className="text-center space-y-4">
            <p className="text-slate-700">No business found</p>
            <p className="text-slate-500 text-sm">{error}</p>
            <button
              onClick={() => router.replace('/formation/entry')}
              className="mt-6 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Start Onboarding
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state: multiple businesses
  if (state === 'multiple_businesses') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-lg mx-auto px-6">
          <div className="text-center space-y-4">
            <p className="text-slate-700">Multiple businesses</p>
            <p className="text-slate-500 text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state: no representation or version
  if (state === 'no_representation' || state === 'no_version') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-lg mx-auto px-6">
          <div className="text-center space-y-4">
            <p className="text-slate-700">Representation not yet ready</p>
            <p className="text-slate-500 text-sm">{error}</p>
            <button
              onClick={() => window.location.reload()}
              className="mt-6 px-6 py-3 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Error state: generic error
  if (state === 'error') {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="w-full max-w-lg mx-auto px-6">
          <div className="text-center space-y-4">
            <p className="text-slate-700">Unable to load Representation</p>
            <p className="text-slate-500 text-sm">{error}</p>
            <div className="flex gap-3 justify-center pt-4">
              <button
                onClick={() => window.location.reload()}
                className="px-6 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              >
                Try again
              </button>
              <button
                onClick={() => router.replace('/login')}
                className="px-6 py-2 border border-slate-300 text-slate-700 rounded hover:bg-slate-50 text-sm"
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success: loaded representation
  if (!data) {
    return null;
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  // Extract element values for display
  const elements = data.version.elementValues as Record<string, any>;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="w-full max-w-2xl mx-auto px-6 py-12">
        {/* Welcome Section */}
        <div className="mb-12 space-y-2">
          <h1 className="text-4xl font-light tracking-tight text-slate-900">
            Welcome back.
          </h1>
          <p className="text-lg text-slate-600">
            Your Representation is ready.
          </p>
        </div>

        {/* Version Info */}
        <div className="mb-8 text-sm text-slate-500">
          <div className="flex items-center gap-4 pb-4 border-b border-slate-200">
            <span>Version 0.{data.version.number}</span>
            <span>•</span>
            <span>Confidence {data.version.confidenceScore}%</span>
            <span>•</span>
            <span>{formatDate(data.version.createdAt)}</span>
          </div>
        </div>

        {/* What Zeya Understands Section */}
        <div className="space-y-10 mb-12">
          <div>
            <h2 className="text-sm uppercase tracking-wider text-slate-500 mb-3">
              What we understand about your business
            </h2>

            {/* Render element values as sections */}
            <div className="space-y-8">
              {Object.entries(elements).map(([key, element]) => {
                if (!element || typeof element !== 'object') return null;

                const elementData = element as any;
                const value = elementData.value || elementData.current_value || elementData;

                if (!value) return null;

                // Format section title from element key
                const titleMap: Record<string, string> = {
                  'business_identity': 'What the business is',
                  'offer': 'What it provides',
                  'customer': 'Who it represents itself to',
                  'market': 'Market context',
                  'positioning': 'How it positions itself',
                  'differentiation': 'What makes it different',
                  'objections': 'Common objections',
                  'trust': 'Building trust',
                  'qualification': 'Who is a good fit',
                  'commercial_objectives': 'Business goals',
                  'operational_constraints': 'Boundaries and constraints',
                  'channel_expression': 'Communication character',
                };

                const title = titleMap[key] || key;

                return (
                  <div key={key}>
                    <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">
                      {title}
                    </p>
                    <p className="text-slate-700 leading-relaxed">
                      {typeof value === 'string' ? value : JSON.stringify(value)}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Continue Working Section */}
        <div className="border-t border-slate-200 pt-8">
          <p className="text-sm text-slate-500 mb-4">Continue developing your Representation</p>
          <button
            onClick={() => {
              // Placeholder: would route to owner conversation mode
              console.log('Talk with Zeya - placeholder action');
            }}
            className="w-full px-6 py-4 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors font-medium"
          >
            Talk with Zeya
          </button>
          <p className="text-xs text-slate-400 mt-3">
            Use this action to have ongoing conversations that deepen and evolve your Representation.
          </p>
        </div>
      </div>
    </div>
  );
}
