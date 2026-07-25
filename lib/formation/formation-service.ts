// Formation Session Service
// Implements RF-A Formation orchestration

import { SupabaseClient } from '@supabase/supabase-js';
import {
  FormationSession,
  FormationSessionRow,
  FormationSessionStatus,
  FormationInitiationSource,
} from '@/types/formation';

export interface FormationSessionService {
  initiateFormation(
    businessId: string,
    businessRepresentationId: string,
    ownerId: string,
    initiatedFrom?: FormationInitiationSource,
    initiatedFromId?: string
  ): Promise<FormationSession>;

  getFormationSession(sessionId: string): Promise<FormationSession>;

  advanceFormationStatus(
    sessionId: string,
    businessRepresentationId: string,
    expectedCurrentStatus: FormationSessionStatus,
    newStatus: FormationSessionStatus,
    transitionDetails?: Record<string, unknown>
  ): Promise<FormationSession>;

  linkWorkingConversation(
    sessionId: string,
    businessRepresentationId: string,
    conversationId: string,
    conversationType?: string
  ): Promise<FormationSession>;
}

function mapFormationSessionRow(row: FormationSessionRow): FormationSession {
  return {
    id: row.id,
    businessId: row.business_id,
    businessRepresentationId: row.business_representation_id,
    ownerId: row.owner_id,
    status: row.status,
    initiatedFrom: row.initiated_from,
    initiatedFromId: row.initiated_from_id,
    publicExperienceSessionId: row.public_experience_session_id,
    representationBriefId: row.representation_brief_id,
    firstWorkingConversationId: row.first_working_conversation_id,
    formationStartedAt: new Date(row.formation_started_at),
    formationCompletedAt: row.formation_completed_at ? new Date(row.formation_completed_at) : null,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
  };
}

export function createFormationService(supabase: SupabaseClient): FormationSessionService {
  return {
    async initiateFormation(
      businessId: string,
      businessRepresentationId: string,
      ownerId: string,
      initiatedFrom?: FormationInitiationSource,
      initiatedFromId?: string
    ): Promise<FormationSession> {
      const { data, error } = await supabase.rpc('zeya_initiate_formation_session', {
        p_business_id: businessId,
        p_business_representation_id: businessRepresentationId,
        p_owner_id: ownerId,
        p_initiated_from: initiatedFrom || null,
        p_initiated_from_id: initiatedFromId || null,
      });

      if (error) {
        throw new FormationError(`Failed to initiate formation: ${error.message}`, error.code);
      }

      if (!data || data.length === 0) {
        throw new FormationError('Formation initiation returned no data', 'NO_DATA');
      }

      return {
        id: data[0].session_id,
        businessId,
        businessRepresentationId,
        ownerId,
        status: data[0].status,
        initiatedFrom: initiatedFrom || null,
        initiatedFromId: initiatedFromId || null,
        publicExperienceSessionId: null,
        representationBriefId: null,
        firstWorkingConversationId: null,
        formationStartedAt: new Date(data[0].initiated_at),
        formationCompletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    async getFormationSession(sessionId: string): Promise<FormationSession> {
      const { data, error } = await supabase
        .from('representation_formation_sessions')
        .select('*')
        .eq('id', sessionId)
        .maybeSingle();

      if (error) {
        throw new FormationError(`Failed to fetch formation session: ${error.message}`, error.code);
      }

      if (!data) {
        throw new FormationNotFoundError(sessionId);
      }

      return mapFormationSessionRow(data);
    },

    async advanceFormationStatus(
      sessionId: string,
      businessRepresentationId: string,
      expectedCurrentStatus: FormationSessionStatus,
      newStatus: FormationSessionStatus,
      transitionDetails?: Record<string, unknown>
    ): Promise<FormationSession> {
      const { data, error } = await supabase.rpc('zeya_advance_formation_status', {
        p_session_id: sessionId,
        p_business_representation_id: businessRepresentationId,
        p_expected_current_status: expectedCurrentStatus,
        p_new_status: newStatus,
        p_transition_details: transitionDetails || {},
      });

      if (error) {
        if (error.code === '23505') {
          throw new FormationStateError(
            `Cannot transition from ${expectedCurrentStatus} to ${newStatus}: ${error.message}`,
            expectedCurrentStatus,
            newStatus
          );
        }
        throw new FormationError(`Failed to advance formation status: ${error.message}`, error.code);
      }

      if (!data || data.length === 0) {
        throw new FormationError('Formation status advance returned no data', 'NO_DATA');
      }

      // Fetch updated session
      return this.getFormationSession(sessionId);
    },

    async linkWorkingConversation(
      sessionId: string,
      businessRepresentationId: string,
      conversationId: string,
      conversationType?: string
    ): Promise<FormationSession> {
      const { data, error } = await supabase.rpc('zeya_link_formation_conversation', {
        p_session_id: sessionId,
        p_business_representation_id: businessRepresentationId,
        p_conversation_id: conversationId,
        p_conversation_type: conversationType || 'voice_conversation_output',
      });

      if (error) {
        if (error.code === '23505') {
          throw new FormationStateError(
            `Cannot link conversation: ${error.message}`,
            'working_conversation_pending',
            'working_conversation_linked'
          );
        }
        throw new FormationError(`Failed to link formation conversation: ${error.message}`, error.code);
      }

      if (!data || data.length === 0) {
        throw new FormationError('Formation conversation link returned no data', 'NO_DATA');
      }

      // Fetch updated session
      return this.getFormationSession(sessionId);
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// ERROR TYPES
// ─────────────────────────────────────────────────────────────────────

export class FormationError extends Error {
  constructor(
    message: string,
    public code: string | null = null
  ) {
    super(message);
    this.name = 'FormationError';
  }
}

export class FormationNotFoundError extends FormationError {
  constructor(sessionId: string) {
    super(`Formation session not found: ${sessionId}`, 'PZ404');
    this.name = 'FormationNotFoundError';
  }
}

export class FormationStateError extends FormationError {
  constructor(
    message: string,
    public fromStatus: FormationSessionStatus,
    public toStatus: FormationSessionStatus
  ) {
    super(message, '23505');
    this.name = 'FormationStateError';
  }
}

export function isFormationError(error: unknown): error is FormationError {
  return error instanceof FormationError;
}

export function isFormationNotFoundError(error: unknown): error is FormationNotFoundError {
  return error instanceof FormationNotFoundError;
}

export function isFormationStateError(error: unknown): error is FormationStateError {
  return error instanceof FormationStateError;
}
