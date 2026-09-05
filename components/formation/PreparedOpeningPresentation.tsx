'use client';

import { useCallback } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import type { PreparedOpening } from '@/lib/formation/prepared-opening';

interface PreparedOpeningPresentationProps {
  opening: PreparedOpening;
  sessionId: string;
  onAcknowledged: (status: string, acknowledged: boolean) => void;
  isProcessing?: boolean;
}

export function PreparedOpeningPresentation({
  opening,
  sessionId,
  onAcknowledged,
  isProcessing = false,
}: PreparedOpeningPresentationProps) {
  const { session: authSession } = useAuth();

  const handleAcknowledge = useCallback(async () => {
    if (isProcessing || !authSession) return;

    try {
      const res = await authenticatedFetch(
        `/api/formation/sessions/${sessionId}/acknowledge-preparation`,
        authSession,
        { method: 'POST' }
      );

      if (!res.ok) {
        console.error('Failed to acknowledge preparation:', res.statusText);
        return;
      }

      const data = await res.json();
      if (data.success && data.data) {
        onAcknowledged(data.data.status, data.data.preparationOpeningAcknowledged);
      }
    } catch (error) {
      console.error('Error acknowledging preparation:', error);
    }
  }, [sessionId, isProcessing, onAcknowledged, authSession]);

  return (
    <div className="space-y-8 py-12 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Introduction */}
        <p className="text-lg text-stone-300 leading-relaxed mb-8">{opening.introduction}</p>

        {/* Segments */}
        <div className="space-y-6">
          {opening.segments.map((segment, idx) => (
            <div key={idx} className="space-y-2">
              {segment.kind === 'supported' && (
                <p className="text-base text-amber-100 leading-relaxed">{segment.content}</p>
              )}

              {segment.kind === 'inference' && (
                <p className="text-base text-stone-300 leading-relaxed italic">{segment.content}</p>
              )}

              {segment.kind === 'uncertain' && (
                <div className="border-l-2 border-amber-700 pl-4">
                  <p className="text-base text-amber-200 leading-relaxed">{segment.content}</p>
                </div>
              )}

              {segment.kind === 'contradiction' && (
                <div className="border-l-2 border-red-700 pl-4">
                  <p className="text-base text-red-200 leading-relaxed">{segment.content}</p>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Transition */}
        <p className="text-base text-stone-300 leading-relaxed mt-8 pt-8 border-t border-purple-800">
          {opening.transition}
        </p>
      </div>

      {/* Action */}
      <div className="flex justify-center pt-6">
        <button
          onClick={handleAcknowledge}
          disabled={isProcessing}
          className="px-6 py-3 bg-purple-950 text-amber-50 hover:bg-purple-900 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-stone-950"
        >
          {isProcessing ? 'Preparing next phase…' : "Got it, let's dig deeper"}
        </button>
      </div>
    </div>
  );
}
