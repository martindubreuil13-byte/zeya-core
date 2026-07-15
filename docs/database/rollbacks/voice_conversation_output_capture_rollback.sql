BEGIN;

-- MANUAL EMERGENCY ROLLBACK ONLY.
-- Never execute as part of normal forward migration sequencing.

CREATE OR REPLACE FUNCTION public.zeya_purge_business_representation(p_business_representation_id uuid, p_expected_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
DECLARE
v_actual_business_id uuid;
v_deleted jsonb := '{}'::jsonb;
v_count integer;
BEGIN
IF auth.role() <> 'service_role' THEN
RAISE EXCEPTION USING
ERRCODE = '42501',
MESSAGE = 'purge not authorized';
END IF;

SELECT br.business_id
INTO v_actual_business_id
FROM public.business_representations br
WHERE br.id = p_business_representation_id
FOR UPDATE;

IF v_actual_business_id IS NULL
OR v_actual_business_id <> p_expected_business_id
THEN
RAISE EXCEPTION USING
ERRCODE = 'PZ404',
MESSAGE = 'representation not found';
END IF;

PERFORM set_config(
'zeya.controlled_purge',
'on',
true
);

DELETE FROM public.audit_events
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'audit_events',
v_count
);

DELETE FROM public.confidence_assessments
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'confidence_assessments',
v_count
);

DELETE FROM public.voice_representation_lineage
WHERE business_representation_id =
p_business_representation_id
AND business_id =
p_expected_business_id;

GET DIAGNOSTICS v_count = ROW_COUNT;

v_deleted := v_deleted || jsonb_build_object(
'voice_representation_lineage',
v_count
);

UPDATE public.business_representations
SET current_version_id = NULL
WHERE id = p_business_representation_id
AND business_id = p_expected_business_id;

UPDATE public.representation_elements
SET current_value_version_id = NULL
WHERE business_representation_id =
p_business_representation_id;

DELETE FROM public.representation_versions
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'representation_versions',
v_count
);

DELETE FROM public.approval_decisions
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'approval_decisions',
v_count
);

DELETE FROM public.proposal_elements
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'proposal_elements',
v_count
);

DELETE FROM public.proposal_evidence
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'proposal_evidence',
v_count
);

DELETE FROM public.proposal_observations
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'proposal_observations',
v_count
);

DELETE FROM public.representation_proposals
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'representation_proposals',
v_count
);

DELETE FROM public.observations
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'observations',
v_count
);

DELETE FROM public.evidence
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'evidence',
v_count
);

DELETE FROM public.representation_elements
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'representation_elements',
v_count
);

DELETE FROM public.representation_domains
WHERE business_representation_id =
p_business_representation_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'representation_domains',
v_count
);

DELETE FROM public.business_representations
WHERE id = p_business_representation_id
AND business_id = p_expected_business_id;

GET DIAGNOSTICS v_count = ROW_COUNT;
v_deleted := v_deleted || jsonb_build_object(
'business_representations',
v_count
);

PERFORM set_config(
'zeya.controlled_purge',
'off',
true
);

RETURN jsonb_build_object(
'businessRepresentationId',
p_business_representation_id,
'businessId',
p_expected_business_id,
'deleted',
v_deleted
);

EXCEPTION
WHEN OTHERS THEN
PERFORM set_config(
'zeya.controlled_purge',
'off',
true
);

RAISE;

END;
$function$;

REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_purge_business_representation(UUID, UUID) TO service_role;

DROP FUNCTION IF EXISTS public.zeya_store_voice_conversation_candidates(UUID,TEXT,JSONB);
DROP FUNCTION IF EXISTS public.zeya_set_voice_conversation_processing_status(UUID,TEXT);
DROP FUNCTION IF EXISTS public.zeya_finalize_voice_conversation_transcript(UUID,JSONB,TIMESTAMPTZ,TEXT,TEXT);
DROP FUNCTION IF EXISTS public.zeya_capture_voice_conversation_output(UUID,TEXT,TEXT,TEXT,TEXT,TEXT,TEXT,BOOLEAN,UUID,TIMESTAMPTZ,TIMESTAMPTZ,JSONB,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB);

DROP POLICY IF EXISTS voice_candidates_tenant_select ON public.voice_conversation_candidates;
DROP POLICY IF EXISTS voice_outputs_tenant_select ON public.voice_conversation_outputs;
DROP TABLE IF EXISTS public.voice_conversation_candidates;
DROP TRIGGER IF EXISTS zeya_voice_output_immutability ON public.voice_conversation_outputs;
DROP TABLE IF EXISTS public.voice_conversation_outputs;
DROP FUNCTION IF EXISTS public.zeya_enforce_voice_output_immutability();

DROP INDEX IF EXISTS public.voice_lineage_identity_idx;

NOTIFY pgrst, 'reload schema';
COMMIT;
