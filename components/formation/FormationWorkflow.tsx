// Formation Workflow Component
// Complete RF-B lifecycle: entry → getting_familiar → conversation → synthesis → approval → Version 0.1

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';
import type { FormationSessionStatusResponse, FormationSummary } from '@/types/formation';
import {
  FormationSessionLoadError,
  loadFormationWorkflowState,
  resolveFormationAuthGate,
  resolveFormationWorkflowState,
  type FormationWorkflowUIState,
} from '@/lib/formation/workflow-state';

interface FormationWorkflowProps {
  sessionId: string;
  screenLab?: {
    uiState: UIState;
    summary?: FormationSummary | null;
    versionId?: string | null;
  };
}

export type UIState = FormationWorkflowUIState;

export function FormationWorkflow({ sessionId, screenLab }: FormationWorkflowProps) {
  const router = useRouter();
  const { session: authSession, loading: authLoading } = useAuth();
  const [session, setSession] = useState<FormationSessionStatusResponse | null>(null);
  const [summary, setSummary] = useState<FormationSummary | null>(screenLab?.summary ?? null);
  const [uiState, setUiState] = useState<UIState>(screenLab?.uiState ?? 'loading');
  const [error, setError] = useState<string | null>(null);
  const [correctionText, setCorrectionText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [versionId, setVersionId] = useState<string | null>(screenLab?.versionId ?? null);
  const correctionRequestKey = useRef<string>(crypto.randomUUID());

  const mapSessionToUIState = useCallback((sess: FormationSessionStatusResponse) => {
    const resolution = resolveFormationWorkflowState(sess);
    setSummary(resolution.summary);
    setError(resolution.error);
    setUiState(resolution.uiState);
  }, []);

  // Load Formation Session on mount
  useEffect(() => {
    if (screenLab) return;
    const authGate = resolveFormationAuthGate(authLoading, !!authSession);
    if (authGate === 'loading') return;
    let cancelled = false;

    if (authGate === 'unauthenticated') {
      const redirectToLogin = async () => {
        await Promise.resolve();
        if (cancelled) return;
        setError('Please sign in to continue your Formation.');
        setUiState('error');
        router.replace(`/login?next=${encodeURIComponent(`/formation/sessions/${sessionId}`)}`);
      };
      void redirectToLogin();
      return () => {
        cancelled = true;
      };
    }

    const loadSession = async () => {
      try {
        setUiState('loading');
        setError(null);
        const loaded = await loadFormationWorkflowState(() =>
          authenticatedFetch(`/api/formation/sessions/${sessionId}`, authSession),
        );
        if (cancelled) return;
        setSession(loaded.session);
        setSummary(loaded.summary);
        setError(loaded.error);
        setUiState(loaded.uiState);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load session');
        setUiState('error');
        if (err instanceof FormationSessionLoadError && err.status === 401) {
          router.replace(`/login?next=${encodeURIComponent(`/formation/sessions/${sessionId}`)}`);
        }
      }
    };
    void loadSession();
    return () => {
      cancelled = true;
    };
  }, [sessionId, mapSessionToUIState, authLoading, authSession, router, screenLab]);

  const advanceState = useCallback(async (nextStatus: string) => {
    if (screenLab) return;
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
        const updatedSession = { ...session!, status: nextStatus as FormationSessionStatusResponse['status'] };
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
  }, [sessionId, session, mapSessionToUIState, authSession, router, screenLab]);

  const generateSummary = useCallback(async () => {
    if (screenLab) return;
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
        setUiState('error');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Summary generation failed');
      setUiState('error');
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, authSession, router, screenLab]);

  const submitCorrection = useCallback(async () => {
    if (screenLab) return;
    if (!correctionText.trim() || !authSession) return;
    try {
      setIsProcessing(true);
      const res = await authenticatedFetch(`/api/formation/sessions/${sessionId}/correct`, authSession, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          proposalId: summary?.proposalId,
          requestKey: correctionRequestKey.current,
          correctionStatement: correctionText,
        }),
      });

      if (res.status === 401) {
        router.replace('/login');
        return;
      }

      const data = await res.json();
      if (data.success) {
        setCorrectionText('');
        correctionRequestKey.current = crypto.randomUUID();
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
  }, [correctionText, sessionId, generateSummary, authSession, router, screenLab, summary]);

  const approveSummary = useCallback(async () => {
    if (screenLab) return;
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
  }, [summary, sessionId, authSession, router, screenLab]);

  const requestMoreTime = useCallback(async () => {
    if (screenLab) return;
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
  }, [sessionId, authSession, router, screenLab]);

  if (uiState === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border border-slate-700 border-t-slate-400 mx-auto mb-6"></div>
          <p className="text-slate-300 text-sm tracking-wide">Preparing Formation…</p>
        </div>
      </div>
    );
  }

  if (uiState === 'error') {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12">
        <div className="border border-slate-700 bg-slate-900 rounded p-6 space-y-2">
          <h3 className="font-semibold text-slate-100 text-sm">Error</h3>
          <p className="text-slate-300 text-sm leading-relaxed">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950">
      <div className="space-y-0 max-w-4xl mx-auto">
        {/* Header - hidden in summary pending/review states, shown in other states */}
        {!['summary_pending', 'summary_review', 'approval_confirmation', 'correction_entry', 'version_created', 'processing'].includes(uiState) && (
          <div className="p-6 pb-4">
            <h1 className="text-3xl font-serif font-light leading-tight text-slate-100 mb-1">First Working Conversation</h1>
            <p className="text-slate-400 text-sm">Building your Representation together</p>
          </div>
        )}

      {/* Entry: Formation starts */}
      {uiState === 'entry' && (
        <div className="space-y-8 py-12 px-6">
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="space-y-4">
              <p className="text-base text-slate-300 leading-relaxed">Before we begin, I&apos;d like to tell you how I prepared for today.</p>
              <p className="text-base text-slate-300 leading-relaxed">I reviewed everything from your introduction, thought about what I&apos;ve learned, and prepared some thoughts on how I can best represent you.</p>
            </div>
            <button
              onClick={() => advanceState('getting_familiar')}
              disabled={isProcessing}
              className="px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              I&apos;m ready to listen
            </button>
          </div>
        </div>
      )}

      {/* Getting Familiar: Zeya speaks intro */}
      {uiState === 'getting_familiar' && (
        <div className="space-y-8 py-12 px-6">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h2 className="text-2xl font-serif font-light text-slate-100">Getting to know you better</h2>
            <p className="text-base text-slate-300 leading-relaxed">Zeya is preparing to listen and learn.</p>
            <button
              onClick={() => advanceState('working_conversation_pending')}
              disabled={isProcessing}
              className="inline-block px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950 mt-2"
            >
              Begin conversation
            </button>
          </div>
        </div>
      )}

      {/* Conversation Ready: About to speak */}
      {uiState === 'conversation_ready' && (
        <div className="space-y-8 py-12 px-6">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h2 className="text-2xl font-serif font-light text-slate-100">Ready to listen deeply</h2>
            <p className="text-base text-slate-300 leading-relaxed">When you start speaking, I&apos;ll be paying full attention to understand what makes your business unique.</p>
            {screenLab ? (
              <button
                onClick={() => setUiState('conversation_active')}
                className="inline-block px-8 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 transition-colors rounded text-sm font-medium mt-2"
              >
                Start first working conversation
              </button>
            ) : (
              <p className="text-sm text-slate-400">This session will remain pending until a completed governed conversation is linked.</p>
            )}
          </div>
        </div>
      )}

      {/* Conversation Active: Voice is live */}
      {uiState === 'conversation_active' && screenLab && (
        <div className="space-y-8 py-12 px-6">
          <div className="max-w-2xl mx-auto text-center space-y-8">
            <div className="flex justify-center pt-4">
              <div className="w-20 h-20 rounded-full border-2 border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
                <div className="w-3 h-3 bg-slate-400 rounded-full animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-4">
              <p className="text-2xl font-serif font-light text-slate-100">Listening…</p>
              <p className="text-base text-slate-300 leading-relaxed">Share your thoughts, plans, and what drives your business.</p>
            </div>
            <button
              onClick={() => setUiState('summary_pending')}
              className="inline-block px-8 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 transition-colors rounded text-sm font-medium mt-2"
            >
              Conversation complete
            </button>
          </div>
        </div>
      )}

      {uiState === 'summary_pending' && (
        <div className="space-y-8 py-12 px-6">
          {/* Eyebrow */}
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-8">Our First Working Session</p>
          </div>

          {/* Heading */}
          <div className="space-y-6 max-w-2xl mx-auto text-center">
            <h2 className="text-4xl font-serif font-light leading-tight text-slate-100">I&apos;m preparing what I understood.</h2>
            <p className="text-base text-slate-300 leading-relaxed">
              Our conversation is complete. I&apos;m organizing what I heard into a Representation review for you.
            </p>
            <p className="text-base text-slate-300 leading-relaxed">
              Nothing becomes part of your business Representation until you review and approve it.
            </p>
          </div>

          {/* Voice presence placeholder */}
          <div className="flex justify-center my-12">
            <div className="w-20 h-20 rounded-full border border-slate-700 bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center">
              <svg className="w-6 h-6 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4" />
              </svg>
            </div>
          </div>

          {/* Primary action */}
          <div className="flex justify-center pt-4">
            <button
              onClick={generateSummary}
              disabled={isProcessing}
              className="px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Prepare my review
            </button>
          </div>

          {/* Secondary text */}
          <div className="text-center pt-6">
            <p className="text-sm text-slate-400">You can leave and return. I&apos;ll keep this state.</p>
          </div>
        </div>
      )}

      {/* Processing: Synthesizing summary */}
      {uiState === 'processing' && (
        <div className="flex items-center justify-center py-16">
          <div className="text-center">
            <div className="inline-block">
              <div className="animate-spin rounded-full h-10 w-10 border border-slate-700 border-t-slate-400 mb-6"></div>
            </div>
            <p className="text-slate-300 text-sm tracking-wide">Synthesizing what I&apos;ve learned…</p>
          </div>
        </div>
      )}

      {/* Summary Review */}
      {uiState === 'summary_review' && summary && (
        <div className="space-y-8 py-12 px-6">
          {/* Eyebrow */}
          <div className="text-center">
            <p className="text-xs font-semibold tracking-widest text-slate-500 uppercase mb-8">What I Understood</p>
          </div>

          {/* Heading */}
          <div className="space-y-6 max-w-2xl mx-auto text-center mb-8">
            <h2 className="text-4xl font-serif font-light leading-tight text-slate-100">Here is the Representation I would begin with.</h2>
          </div>

          {/* Review Content */}
          <div className="max-w-3xl mx-auto space-y-10">
            {summary.sections.map((section, idx) => (
              <div key={idx} className="space-y-3 pb-10 border-b border-slate-700 last:border-b-0 last:pb-0">
                <h3 className="text-lg font-serif font-light text-slate-200">{section.title}</h3>
                <p className="text-base text-slate-300 leading-relaxed">{section.content}</p>
              </div>
            ))}

            {!summary.isCurrent && (
              <div className="mt-8 p-4 border border-slate-700 bg-slate-900 rounded">
                <p className="text-sm text-slate-400">This summary may be stale. Refresh to regenerate.</p>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="space-y-3 max-w-2xl mx-auto mt-12 pt-6 border-t border-slate-700">
            {/* Primary action */}
            <button
              onClick={() => setUiState('approval_confirmation')}
              disabled={isProcessing || !summary.isCurrent}
              className="w-full px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              This is right
            </button>

            {/* Secondary action */}
            <button
              onClick={() => setUiState('correction_entry')}
              disabled={isProcessing}
              className="w-full px-6 py-3 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 transition-colors rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Close, but let me adjust something
            </button>

            {/* Tertiary action */}
            <button
              onClick={requestMoreTime}
              disabled={isProcessing}
              className="w-full px-6 py-3 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 transition-colors rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              I need more time
            </button>
          </div>
        </div>
      )}

      {/* Correction Entry */}
      {uiState === 'correction_entry' && (
        <div className="space-y-8 py-12 px-6">
          {/* Heading */}
          <div className="max-w-2xl mx-auto text-center">
            <h2 className="text-3xl font-serif font-light leading-tight text-slate-100 mb-6">What should I correct or adjust?</h2>
          </div>

          {/* Input */}
          <div className="max-w-2xl mx-auto">
            <textarea
              value={correctionText}
              onChange={(e) => setCorrectionText(e.target.value)}
              className="w-full p-4 border border-slate-700 bg-slate-900 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-slate-600 focus:ring-1 focus:ring-slate-700 rounded text-sm leading-relaxed"
              placeholder="Tell me what I got wrong or what I&apos;m missing…"
              rows={6}
            />
          </div>

          {/* Actions */}
          <div className="space-y-3 max-w-2xl mx-auto">
            <button
              onClick={submitCorrection}
              disabled={isProcessing || !correctionText.trim()}
              className="w-full px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Submit correction
            </button>
            <button
              onClick={() => setUiState('summary_review')}
              disabled={isProcessing}
              className="w-full px-6 py-3 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 transition-colors rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Approval Confirmation */}
      {uiState === 'approval_confirmation' && summary && (
        <div className="space-y-8 py-12 px-6">
          {/* Confirmation content */}
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <h2 className="text-3xl font-serif font-light leading-tight text-slate-100">Ready to create your first Representation?</h2>
            <p className="text-base text-slate-300 leading-relaxed">Once approved, this becomes your official Representation Version 0.1.</p>
          </div>

          {/* Actions */}
          <div className="space-y-3 max-w-2xl mx-auto">
            <button
              onClick={approveSummary}
              disabled={isProcessing}
              className="w-full px-6 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Approve & create Representation
            </button>
            <button
              onClick={() => setUiState('summary_review')}
              disabled={isProcessing}
              className="w-full px-6 py-3 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-slate-100 disabled:opacity-50 transition-colors rounded text-sm focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 focus:ring-offset-slate-950"
            >
              Review again
            </button>
          </div>
        </div>
      )}

      {/* Version Created: Success */}
      {uiState === 'version_created' && versionId && (
        <div className="space-y-8 py-12 px-6">
          <div className="max-w-2xl mx-auto text-center space-y-6">
            <div className="text-5xl mb-4">✓</div>
            <h2 className="text-3xl font-serif font-light leading-tight text-slate-100">Representation Created</h2>
            <p className="text-base text-slate-300 leading-relaxed">Your first canonical Representation Version 0.1 is ready.</p>
            <button
              onClick={() => {
                router.replace('/representation/living');
              }}
              className="inline-block px-8 py-3 bg-slate-700 text-slate-50 hover:bg-slate-600 transition-colors rounded text-sm font-medium mt-6"
            >
              Enter your Workspace
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
