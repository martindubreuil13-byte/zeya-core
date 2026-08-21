BEGIN;

-- One-time removal of the explicitly owner-authorized invalid P2.8 Preview
-- qualification validation artifact. Predicates bind deletion to the specimen.
DELETE FROM public.mission_execution_outcomes
WHERE id='9fae0c27-4dfd-4b01-9b06-24d602fc4c95'::uuid
  AND mission_id='05cfbdd3-60d0-4a1b-bada-98b9629ff889'::uuid
  AND result_operation_id='486dd67c-9336-4490-97ec-fbc517d3caa3'::uuid;

ALTER TABLE public.conversation_interpretations DISABLE TRIGGER conversation_interpretations_immutable;
DELETE FROM public.conversation_interpretations
WHERE id='486dd67c-9336-4490-97ec-fbc517d3caa3'::uuid
  AND conversation_output_id='082089d5-bb92-4f1a-9dd1-47f3a4395ae8'::uuid
  AND mission_id='05cfbdd3-60d0-4a1b-bada-98b9629ff889'::uuid
  AND interpretation_schema_version='conversation-interpretation-v1';
ALTER TABLE public.conversation_interpretations ENABLE TRIGGER conversation_interpretations_immutable;

COMMIT;
