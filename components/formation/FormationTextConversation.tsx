'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/components/auth/auth-provider';
import { authenticatedFetch } from '@/lib/auth/authenticated-fetch';

export interface ConversationMessage {
  speaker: 'zeya' | 'owner';
  text: string;
  sequence: number;
}

export interface ConversationState {
  status: 'active' | 'paused' | 'completed';
  messages: ConversationMessage[];
  currentTopic: string | null;
  progress: { answered: number; total: number };
  blockingItemsRemaining: number;
  complete: boolean;
}

interface FormationTextConversationProps {
  sessionId: string;
  onConversationComplete?: () => void;
}

export function FormationTextConversation({ sessionId, onConversationComplete }: FormationTextConversationProps) {
  const { session: authSession } = useAuth();
  const [conversationState, setConversationState] = useState<ConversationState | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  // Load/start conversation
  useEffect(() => {
    if (!authSession) return;

    const loadConversation = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Try to get current state first
        let res = await authenticatedFetch(
          `/api/formation/sessions/${sessionId}/conversation`,
          authSession
        );

        // If no active conversation, start one
        if (!res.ok || res.status === 404) {
          res = await authenticatedFetch(
            `/api/formation/sessions/${sessionId}/conversation`,
            authSession,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'start' }),
            }
          );
        }

        if (!res.ok) {
          throw new Error(`Failed to load conversation: ${res.statusText}`);
        }

        const data = await res.json();
        if (data.success && data.data) {
          setConversationState(data.data);
          // Messages are included in state
          if (Array.isArray(data.data.messages)) {
            setMessages(data.data.messages);
          }
        } else {
          throw new Error(data.error || 'Failed to load conversation');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load conversation');
      } finally {
        setIsLoading(false);
      }
    };

    void loadConversation();
  }, [sessionId, authSession]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSendMessage = useCallback(async () => {
    if (!inputText.trim() || !authSession || isSending) return;

    try {
      setIsSending(true);
      setError(null);

      const res = await authenticatedFetch(
        `/api/formation/sessions/${sessionId}/conversation`,
        authSession,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'answer',
            answer: inputText.trim(),
            idempotencyKey: idempotencyKeyRef.current,
          }),
        }
      );

      if (!res.ok) {
        throw new Error(`Failed to send message: ${res.statusText}`);
      }

      const data = await res.json();
      if (data.success && data.data) {
        setConversationState(data.data);
        setMessages(data.data.messages || []);
        setInputText('');
        idempotencyKeyRef.current = crypto.randomUUID();

        // Check if conversation is complete
        if (data.data.complete) {
          onConversationComplete?.();
        }
      } else {
        throw new Error(data.error || 'Failed to send message');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setIsSending(false);
    }
  }, [inputText, authSession, isSending, sessionId, onConversationComplete]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border border-purple-800 border-t-amber-600 mb-6 mx-auto" />
          <p className="text-stone-300 text-sm tracking-wide">Loading conversation…</p>
        </div>
      </div>
    );
  }

  if (!conversationState) {
    return (
      <div className="p-8 max-w-2xl mx-auto my-12">
        <div className="border border-purple-800 bg-stone-900 rounded p-6 space-y-2">
          <h3 className="font-semibold text-amber-50 text-sm">Conversation not available</h3>
          <p className="text-stone-300 text-sm leading-relaxed">Unable to load conversation state.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 py-8 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h2 className="text-2xl font-serif font-light text-amber-50 mb-2">Refining your Representation</h2>
          <div className="text-sm text-stone-400">
            <p>Progress: {conversationState.progress.answered} of {conversationState.progress.total} topics</p>
            {conversationState.blockingItemsRemaining > 0 && (
              <p>{conversationState.blockingItemsRemaining} blocking items remaining</p>
            )}
          </div>
        </div>

        {/* Error state */}
        {error && (
          <div className="mb-6 border border-red-700 bg-red-950 rounded p-4">
            <p className="text-red-200 text-sm">{error}</p>
          </div>
        )}

        {/* Message thread */}
        <div className="space-y-6 mb-8 bg-stone-900 rounded p-6 border border-stone-800 min-h-96 overflow-y-auto max-h-96">
          {messages.length === 0 ? (
            <p className="text-stone-400 text-sm italic">Conversation starting…</p>
          ) : (
            messages.map((msg) => (
              <div key={msg.sequence} className={`space-y-2 ${msg.speaker === 'zeya' ? 'text-left' : 'text-right'}`}>
                <div
                  className={`inline-block max-w-lg px-4 py-3 rounded ${
                    msg.speaker === 'zeya'
                      ? 'bg-purple-950 text-amber-50 border border-purple-800'
                      : 'bg-stone-800 text-stone-100 border border-stone-700'
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                </div>
              </div>
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Conversation status */}
        {conversationState.complete && (
          <div className="mb-6 p-4 bg-green-950 border border-green-800 rounded">
            <p className="text-green-200 text-sm font-medium">Conversation complete. Ready to review your Representation.</p>
          </div>
        )}

        {/* Input area */}
        {!conversationState.complete && conversationState.status === 'active' && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label htmlFor="message" className="block text-sm text-stone-400">
                Your response:
              </label>
              <textarea
                id="message"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type your response here… (Shift+Enter for new line, Enter to send)"
                disabled={isSending}
                className="w-full px-4 py-3 bg-stone-900 border border-stone-700 rounded text-stone-100 placeholder-stone-600 focus:outline-none focus:ring-2 focus:ring-amber-600 focus:border-transparent disabled:opacity-50"
                rows={4}
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleSendMessage}
                disabled={isSending || !inputText.trim()}
                className="px-6 py-3 bg-purple-950 text-amber-50 hover:bg-purple-900 disabled:opacity-50 transition-colors rounded text-sm font-medium focus:outline-none focus:ring-2 focus:ring-amber-600 focus:ring-offset-2 focus:ring-offset-stone-950"
              >
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </div>
        )}

        {/* Paused state */}
        {conversationState.status === 'paused' && (
          <div className="p-4 bg-amber-950 border border-amber-800 rounded">
            <p className="text-amber-200 text-sm">Conversation paused. You can resume from where you left off.</p>
          </div>
        )}

        {/* Current topic hint */}
        {conversationState.currentTopic && (
          <div className="mt-6 text-xs text-stone-500 italic">
            Currently discussing: {conversationState.currentTopic}
          </div>
        )}
      </div>
    </div>
  );
}
