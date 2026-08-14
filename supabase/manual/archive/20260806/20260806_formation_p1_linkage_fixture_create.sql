-- Controlled Preview-only Formation P1 governed-linkage fixture creation.
-- Confirm Preview project hdjojgvvlojbhgidirht before use. Never run in Production.
BEGIN;
DO $fixture$
DECLARE
  v_owner_id constant uuid := 'da53cf7f-beb1-4168-a0cb-015610f092fc';
  v_owner_email constant text := 'mdubreu@gmail.com';
  v_business_id constant uuid := 'bab67c0d-8027-4315-8086-60a49679939d';
  v_representation_id constant uuid := '6caa5310-61d7-46cf-99b7-b5d915f0293f';
  v_formation_id constant uuid := 'ba339a69-35cc-4e98-b03b-2a2d4f8717b2';
  v_voice_context_id constant uuid := 'f1060800-0000-4000-8000-000000000001';
  v_conversation_id constant text := 'zeya-preview-fixture:formation-p1-linkage:20260806';
  v_linkage_fixture_key constant text := 'zeya:preview:formation_p1:linkage:20260806';
  v_event_time timestamptz := pg_catalog.clock_timestamp();
  v_output_id uuid;
  v_linked_status public.formation_session_status;
BEGIN
  IF current_user<>'postgres' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='privileged Preview SQL Editor required';
  END IF;

  PERFORM 1 FROM auth.users AS auth_user
  WHERE auth_user.id=v_owner_id AND auth_user.email=v_owner_email
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact QA Auth identity not found';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_owner_id::text,0)
  );

  PERFORM 1 FROM public.businesses AS business
  WHERE business.id=v_business_id AND business.user_id=v_owner_id
    AND business.business_profile->>'fixture_key'='zeya:preview:formation_p1:20260806'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact fixture Business not found';
  END IF;
  PERFORM 1 FROM public.business_representations AS representation
  WHERE representation.id=v_representation_id
    AND representation.business_id=v_business_id
    AND representation.user_id=v_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact fixture Representation not found';
  END IF;
  PERFORM 1 FROM public.representation_formation_sessions AS formation
  WHERE formation.id=v_formation_id AND formation.business_id=v_business_id
    AND formation.business_representation_id=v_representation_id
    AND formation.owner_id=v_owner_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='exact fixture Formation not found';
  END IF;

  IF (SELECT count(*) FROM public.representation_formation_sessions AS formation
      WHERE formation.id=v_formation_id
        AND formation.status='working_conversation_pending'
        AND formation.first_working_conversation_id IS NULL)<>1
    OR (SELECT count(*) FROM public.business_representations AS representation
      WHERE representation.id=v_representation_id
        AND representation.current_version_id IS NULL)<>1
    OR (SELECT count(*) FROM public.representation_versions AS version
      WHERE version.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.representation_proposals AS proposal
      WHERE proposal.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.evidence AS evidence
      WHERE evidence.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.approval_decisions AS approval
      WHERE approval.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.public_experience_sessions AS experience
      WHERE experience.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire
      WHERE direct_hire.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.dispatches AS dispatch
      WHERE dispatch.user_id=v_owner_id)<>0
    OR (SELECT count(*) FROM public.voice_representation_lineage AS lineage
      WHERE lineage.business_representation_id=v_representation_id
        OR lineage.voice_context_id=v_voice_context_id
        OR lineage.conversation_id=v_conversation_id)<>0
    OR (SELECT count(*) FROM public.voice_conversation_outputs AS output
      WHERE output.business_representation_id=v_representation_id
        OR output.conversation_id=v_conversation_id
        OR output.safe_metadata->>'fixture_key'=v_linkage_fixture_key)<>0 THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='linkage fixture preconditions changed';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role','service_role',true);

  PERFORM public.zeya_create_pre_canonical_voice_representation_lineage(
    v_voice_context_id,
    'zeya-preview-fixture:formation-p1-linkage:worker-brief',
    'zeya-preview-fixture:formation-p1-linkage:mission',
    v_conversation_id,
    v_owner_id,
    v_business_id,
    v_representation_id,
    NULL,
    v_event_time,
    ARRAY[]::text[],
    true,
    'zeya-preview-fixture-agent',
    'ZEYA',
    'formation_p1_linkage_fixture',
    'preview-fixture-v1',
    'preview-fixture-v1'
  );

  SELECT public.zeya_capture_voice_conversation_output(
    v_voice_context_id,
    v_conversation_id,
    NULL,
    'preview_fixture_no_provider',
    'zeya_realtime',
    'authenticated_client_relay',
    'authenticated_client_relay',
    false,
    v_owner_id,
    v_event_time,
    v_event_time,
    '[{"role":"owner","text":"PREVIEW FIXTURE ONLY — NO CONVERSATION CONTENT"}]'::jsonb,
    'finalized',
    'preview-fixture-v1',
    'completed',
    'preview_fixture_completed',
    'preview-fixture-v1',
    jsonb_build_object(
      'fixture_key',v_linkage_fixture_key,
      'synthetic',true,
      'provider_activity',false
    )
  ) INTO v_output_id;

  SELECT linked.status INTO v_linked_status
  FROM public.zeya_link_formation_conversation(
    v_formation_id,
    v_representation_id,
    v_output_id,
    'voice_conversation_output'
  ) AS linked;

  IF v_linked_status IS DISTINCT FROM 'working_conversation_linked'
    OR (SELECT count(*) FROM public.representation_formation_sessions AS formation
      WHERE formation.id=v_formation_id
        AND formation.status='working_conversation_linked'
        AND formation.first_working_conversation_id=v_output_id)<>1
    OR (SELECT count(*) FROM public.voice_representation_lineage AS lineage
      WHERE lineage.voice_context_id=v_voice_context_id
        AND lineage.tenant_user_id=v_owner_id
        AND lineage.business_id=v_business_id
        AND lineage.business_representation_id=v_representation_id
        AND lineage.canonical_version_id IS NULL
        AND lineage.representation_context_mode='pre_canonical'
        AND lineage.provisional_mode
        AND cardinality(lineage.authorized_element_keys)=0
        AND lineage.provider_call_id IS NULL)<>1
    OR (SELECT count(*) FROM public.voice_conversation_outputs AS output
      WHERE output.id=v_output_id
        AND output.voice_context_id=v_voice_context_id
        AND output.tenant_user_id=v_owner_id
        AND output.business_id=v_business_id
        AND output.business_representation_id=v_representation_id
        AND output.canonical_version_id IS NULL
        AND output.representation_context_mode='pre_canonical'
        AND output.transcript_status='finalized'
        AND output.completed_at IS NOT NULL
        AND output.capture_source='authenticated_client_relay'
        AND output.transcript_trust_level='authenticated_client_relay'
        AND NOT output.provider_attested
        AND output.provider_call_id IS NULL
        AND output.safe_metadata->>'fixture_key'=v_linkage_fixture_key)<>1
    OR (SELECT count(*) FROM public.representation_proposals AS proposal
      WHERE proposal.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.evidence AS evidence
      WHERE evidence.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.approval_decisions AS approval
      WHERE approval.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.representation_versions AS version
      WHERE version.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.business_representations AS representation
      WHERE representation.id=v_representation_id
        AND representation.current_version_id IS NOT NULL)<>0
    OR (SELECT count(*) FROM public.public_experience_sessions AS experience
      WHERE experience.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.direct_hire_onboarding_sessions AS direct_hire
      WHERE direct_hire.business_representation_id=v_representation_id)<>0
    OR (SELECT count(*) FROM public.dispatches AS dispatch
      WHERE dispatch.user_id=v_owner_id)<>0 THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='governed linkage postcondition failed';
  END IF;

  PERFORM pg_catalog.set_config('zeya.fixture.voice_context_id',v_voice_context_id::text,true);
  PERFORM pg_catalog.set_config('zeya.fixture.conversation_output_id',v_output_id::text,true);
END;
$fixture$;

SELECT
  current_setting('zeya.fixture.voice_context_id')::uuid AS voice_context_id,
  current_setting('zeya.fixture.conversation_output_id')::uuid AS conversation_output_id,
  'ba339a69-35cc-4e98-b03b-2a2d4f8717b2'::uuid AS formation_session_id,
  true AS linkage_fixture_created,
  EXISTS (
    SELECT 1 FROM public.representation_formation_sessions AS formation
    WHERE formation.id='ba339a69-35cc-4e98-b03b-2a2d4f8717b2'::uuid
      AND formation.status='working_conversation_linked'
      AND formation.first_working_conversation_id=
        current_setting('zeya.fixture.conversation_output_id')::uuid
  ) AS governed_linkage_complete,
  NOT EXISTS (
    SELECT 1 FROM public.representation_proposals AS proposal
    WHERE proposal.formation_session_id='ba339a69-35cc-4e98-b03b-2a2d4f8717b2'::uuid
  ) AS summary_still_absent,
  NOT EXISTS (
    SELECT 1 FROM public.representation_versions AS version
    WHERE version.business_representation_id='6caa5310-61d7-46cf-99b7-b5d915f0293f'::uuid
  ) AND EXISTS (
    SELECT 1 FROM public.business_representations AS representation
    WHERE representation.id='6caa5310-61d7-46cf-99b7-b5d915f0293f'::uuid
      AND representation.current_version_id IS NULL
  ) AS canonical_absent;
COMMIT;
