// Formation Workflow Component
// Complete RF-B lifecycle: entry → getting_familiar → conversation → synthesis → approval → Version 0.1

'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import type { FormationSession, FormationSummary } from '@/types/formation';

interface FormationWorkflowProps {
  sessionId: string;
}

type UIState = 'loading' | 'entry' | 'getting_familiar' | 'conversation_ready' | 'conversation_active'
  | 'processing' | 'summary_review' | 'correction_entry' | 'approval_confirmation' | 'version_created' | 'error';

export function FormationWorkflow({ sessionId }: FormationWorkflowProps) {
  const router = useRouter();
  const { session: authSession, loading: authLoading } = useAuth();
  const [session, setSession] = useState<FormationSession | null>(null);
  const [summary, setSummary] = useState<FormationSummary | null>(null);
  const [uiState, setUiState] = useState<UIState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(null);

  const mapSessionToUIState = useCallback((sess: FormationSession) => {
    switch (sess.status) {
      case 'initiated':
        setUiState('entry');
        break;
      case 'getting_familiar':
        setUiState('getting_familiar');
        break;
      case 'working_conversation_pending':
        setUiState('conversation_ready');
        break;
      case 'working_conversation_linked':
        setUiState('summary_review');
        break;
    }
  }, []);

  // Load Formation Session on mount
  useEffect(() => {
    if (authLoading || !authSession) return;

    const loadSession = async () => {
      try {
        setUiState('loading');
        const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}`, authSession);

        if (res.status === 401) {
          router.replace('/login');
          return;
        }

        if (!res.ok) throw new Error(`Session not found`);
        const data = await res.json();
        if (data.success) {
          setSession(data.data);
          mapSessionToUIState(data.data);
        } else {
          setError(data.error);
          setUiState('error');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setUiState('error');
      }
    };
    loadSession();
  }, [sessionId, mapSessionToUIState, authLoading, authSession, router]);

  const advanceState = useCallback(async (nextStatus: string) => {
    if (!authSession) {
      setError('Not authenticated');
      return;
    }

    try {
      setIsProcessing(true);
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/advance`, authSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextStatus }),
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        const updatedSession = { ...session!, status: nextStatus as any };
        setSession(updatedSession);
        mapSessionToUIState(updatedSession);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, session, mapSessionToUIState, authSession, router]);

  const generateSummary = useCallback(async () => {
    if (!authSession) {
      setError('Not authenticated');
      return;
    }

    try {
      setIsProcessing(true);
      setUiState('processing');
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/summary`, authSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setSummary(data.data);
        setUiState('summary_review');
      } else {
        setError(data.error);
        setUiState('summary_review');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Summary generation failed');
      setUiState('error');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, authSession, router]);

  const submitCorrection = useCallback(async () => {
    if (!correctionText.trim() || !authSession) return;
    try {
      setIsProcessing(true);
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/correct`, authSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionStatement: correctionText }),
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setCorrectionText('');
        // Regenerate summary with correction
        await generateSummary();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Correction failed');
    } finally {
      setIsProcessing(false);
    }
  }, [correctionText, sessionId, generateSummary, authSession, router]);

  const approveSummary = useCallback(async () => {
    if (!summary || !authSession) return;
    try {
      setIsProcessing(true);
      setUiState('processing');
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/approve`, authSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: summary.proposalId,
          sourceFingerprint: summary.sourceFingerprint,
        }),
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setVersionId(data.data.versionId);
        setUiState('version_created');
      } else {
        setError(data.error);
        setUiState('approval_confirmation');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
      setUiState('approval_confirmation');
    } finally {
      setIsProcessing(false);
    }
  }, [summary, sessionId, authSession, router]);

  const requestMoreTime = useCallback(async () => {
    if (!authSession) return;
    try {
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/pause`, authSession, {
        method: 'POST',
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        alert('Your Formation session is saved. Come back whenever you\'re ready.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    }
  }, [sessionId, authSession, router]);

  if (uiState === 'loading') {
    return (
      <div className="flex items-center justify-center p-12">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Preparing Formation...</p>
        </div>
      </div>
    );
  }

  if (uiState === 'error') {
    return (
      <div className="p-6 bg-red-50 border border-red-200 rounded">
        <h3 className="font-semibold text-red-900 mb-2">Error</h3>
        <p className="text-red-700 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 max-w-2xl">
      <div>
        <h1 className="text-3xl font-bold mb-1">First Working Conversation</h1>
        <p className="text-gray-600 text-sm">Building your Representation together</p>
      </div>

      {/* Entry: Formation starts */}
      {uiState === 'entry' && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-blue-900">Before we begin, I&apos;d like to tell you how I prepared for today.</p>
            <p className="text-blue-800 text-sm mt-2">I reviewed everything from your introduction, thought about what I&apos;ve learned, and prepared some thoughts on how I can best represent you.</p>
          </div>
          <button
            onClick={() => advanceState('getting_familiar')}
            disabled={isProcessing}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
          >
            I&apos;m ready to listen
          </button>
        </div>
      )}

      {/* Getting Familiar: Zeya speaks intro */}
      {uiState === 'getting_familiar' && (
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-amber-900 font-semibold">Getting to know you better</p>
            <p className="text-amber-800 text-sm mt-2">Zeya is preparing to listen and learn.</p>
          </div>
          <button
            onClick={() => advanceState('working_conversation_pending')}
            disabled={isProcessing}
            className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
          >
            Begin conversation
          </button>
        </div>
      )}

      {/* Conversation Ready: About to speak */}
      {uiState === 'conversation_ready' && (
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
            <p className="text-yellow-900 font-semibold">Ready to listen deeply</p>
            <p className="text-yellow-800 text-sm mt-2">When you start speaking, I&apos;ll be paying full attention to understand what makes your business unique.</p>
          </div>
          <button
            onClick={() => setUiState('conversation_active')}
            disabled={isProcessing}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 disabled:opacity-50"
          >
            Start first working conversation
          </button>
        </div>
      )}

      {/* Conversation Active: Voice is live */}
      {uiState === 'conversation_active' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <div className="mb-4">
            <div className="inline-block w-4 h-4 bg-red-600 rounded-full animate-pulse"></div>
          </div>
          <p className="text-red-900 font-semibold text-lg mb-2">Listening...</p>
          <p className="text-red-700 text-sm mb-4">Share your thoughts, plans, and what drives your business.</p>
          <button
            onClick={() => advanceState('working_conversation_linked')}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
          >
            Conversation complete
          </button>
        </div>
      )}

      {/* Processing: Synthesizing summary */}
      {uiState === 'processing' && (
        <div className="flex items-center justify-center p-8 bg-gray-50 rounded-lg">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border border-gray-300 border-t-blue-600 mx-auto mb-4"></div>
            <p className="text-gray-600">Synthesizing what I&apos;ve learned...</p>
          </div>
        </div>
      )}

      {/* Summary Review */}
      {uiState === 'summary_review' && summary && (
        <div className="space-y-4">
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-xl font-semibold mb-4">What I&apos;ve Understood</h2>
            <div className="space-y-4">
              {summary.sections.map((section, idx) => (
                <div key={idx}>
                  <h3 className="font-semibold text-gray-900 mb-1">{section.title}</h3>
                  <p className="text-gray-700 text-sm">{section.content}</p>
                </div>
              ))}
            </div>
            {!summary.isCurrent && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded text-yellow-700 text-sm">
                This summary may be stale. Refresh to regenerate.
              </div>
            )}
          </div>

          <div className="space-y-2">
            <button
              onClick={() => setUiState('correction_entry')}
              disabled={isProcessing}
              className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              Close, but let me adjust something
            </button>
            <button
              onClick={requestMoreTime}
              disabled={isProcessing}
              className="w-full px-4 py-2 border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
            >
              I need more time
            </button>
            <button
              onClick={() => setUiState('approval_confirmation')}
              disabled={isProcessing || !summary.isCurrent}
              className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              This looks right
            </button>
          </div>
        </div>
      )}

      {/* Correction Entry */}
      {uiState === 'correction_entry' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2">What should I correct or add?</label>
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              className="w-full p-3 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Tell me what I got wrong or what I'm missing..."
              rows={4}
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={submitCorrection}
              disabled={isProcessing || !correctionText.trim()}
              className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Submit correction
            </button>
            <button
              onClick={() => setUiState('summary_review')}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Approval Confirmation */}
      {uiState === 'approval_confirmation' && summary && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <p className="text-green-900 font-semibold">Ready to create your first Representation?</p>
            <p className="text-green-800 text-sm mt-2">Once approved, this becomes your official Representation Version 0.1.</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={approveSummary}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
            >
              Approve & create Representation
            </button>
            <button
              onClick={() => setUiState('summary_review')}
              disabled={isProcessing}
              className="flex-1 px-4 py-2 border border-gray-300 rounded hover:bg-gray-50"
            >
              Review again
            </button>
          </div>
        </div>
      )}

      {/* Version Created: Success */}
      {uiState === 'version_created' && versionId && (
        <div className="space-y-4">
          <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-center">
            <div className="text-3xl mb-3">✓</div>
            <p className="text-green-900 font-semibold text-lg mb-2">Representation Created</p>
            <p className="text-green-700 text-sm mb-4">Your first canonical Representation Version 0.1 is ready.</p>
            <button
              onClick={() => {
                // Navigate to Living Representation workspace
                window.location.href = '/representation/living';
              }}
              className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-700"
            >
              Enter your Workspace
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
