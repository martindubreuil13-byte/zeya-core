import type {
  FormationSessionStatusResponse,
  FormationSummary,
} from '@/types/formation';

export type FormationWorkflowUIState =
  | 'loading'
  | 'entry'
  | 'presenting_preparation'
  | 'getting_familiar'
  | 'conversation_ready'
  | 'conversation_active'
  | 'processing'
  | 'summary_pending'
  | 'summary_review'
  | 'correction_entry'
  | 'approval_confirmation'
  | 'version_created'
  | 'error';

export type FormationWorkflowResolution = {
  uiState: FormationWorkflowUIState;
  summary: FormationSummary | null;
  error: string | null;
};

export class FormationSessionLoadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'FormationSessionLoadError';
  }
}

export function resolveFormationAuthGate(
  authLoading: boolean,
  hasSession: boolean,
): 'loading' | 'ready' | 'unauthenticated' {
  if (authLoading) return 'loading';
  return hasSession ? 'ready' : 'unauthenticated';
}

export function resolveFormationWorkflowState(
  session: FormationSessionStatusResponse,
): FormationWorkflowResolution {
  switch (session.status) {
    case 'initiated':
      return { uiState: 'entry', summary: null, error: null };
    case 'getting_familiar':
      return { uiState: 'getting_familiar', summary: null, error: null };
    case 'working_conversation_pending':
      return { uiState: 'conversation_ready', summary: null, error: null };
    case 'working_conversation_linked':
      if (!session.firstWorkingConversationId) {
        return {
          uiState: 'error',
          summary: null,
          error: 'The governed conversation lineage is incomplete.',
        };
      }
      return session.summary
        ? { uiState: 'summary_review', summary: session.summary, error: null }
        : { uiState: 'summary_pending', summary: null, error: null };
    default:
      return {
        uiState: 'error',
        summary: null,
        error: 'The Formation session returned an unsupported state.',
      };
  }
}

export async function loadFormationWorkflowState(
  fetchSession: () => Promise<Response>,
): Promise<FormationWorkflowResolution & { session: FormationSessionStatusResponse }> {
  const response = await fetchSession();
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new FormationSessionLoadError(
      'Formation session returned an invalid response.',
      response.status,
    );
  }

  const envelope = payload as {
    success?: unknown;
    data?: unknown;
    error?: unknown;
  };
  if (!response.ok || envelope.success !== true || !envelope.data) {
    throw new FormationSessionLoadError(
      typeof envelope.error === 'string'
        ? envelope.error
        : 'Failed to load Formation session.',
      response.status,
    );
  }

  const session = envelope.data as FormationSessionStatusResponse;
  return { ...resolveFormationWorkflowState(session), session };
}
