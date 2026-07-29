// Formation Entry Component
// Handles transition from identity_confirmation to Formation after authentication
// Calls /api/formation/prepare with public experience session ID

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface FormationEntryProps {
  onComplete?: (sessionId: string) => void;
}

export function FormationEntry({ onComplete }: FormationEntryProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    const prepareFormation = async () => {
      try {
        setLoading(true);

        // Get public experience session ID from sessionStorage
        const sessionStorage = typeof window !== 'undefined' ? window.sessionStorage : null;
        const publicExpSessionId = sessionStorage?.getItem('publicExperienceSessionId');

        if (!publicExpSessionId) {
          setError('Public experience session not found. Please start from the beginning.');
          setLoading(false);
          return;
        }

        // Call /api/formation/prepare
        const res = await fetch('/api/formation/prepare', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicExperienceSessionId: publicExpSessionId,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to prepare formation: ${res.statusText}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Failed to prepare formation');
        }

        const formationSessionId = data.data.sessionId;
        setSessionId(formationSessionId);

        // Notify parent or redirect
        if (onComplete) {
          onComplete(formationSessionId);
        } else {
          // Redirect to Formation workflow
          router.push(`/formation/sessions/${formationSessionId}`);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError(message);
        console.error('[formation-entry]', err);
      } finally {
        setLoading(false);
      }
    };

    prepareFormation();
  }, [router, onComplete]);

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Preparing Formation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded">
        <h3 className="font-semibold text-red-900 mb-2">Formation Preparation Failed</h3>
        <p className="text-red-700 text-sm mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (sessionId) {
    return (
      <div className="p-6 bg-green-50 border border-green-200 rounded">
        <h3 className="font-semibold text-green-900 mb-2">Formation Ready</h3>
        <p className="text-green-700 text-sm">Session {sessionId.substring(0, 8)}...</p>
      </div>
    );
  }

  return null;
}
