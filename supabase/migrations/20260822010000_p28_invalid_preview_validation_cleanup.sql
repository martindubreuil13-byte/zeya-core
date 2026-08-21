BEGIN;

-- One-time removal of the explicitly owner-authorized invalid P2.8 Preview
-- validation artifact. The predicates bind deletion to the exact specimen.
DELETE FROM public.mission_execution_outcomes
WHERE id='b625ea22-5bb8-42fa-bbc0-d7ec2142be29'::uuid
  AND mission_id='05cfbdd3-60d0-4a1b-bada-98b9629ff889'::uuid
  AND result_operation_id='fe603735-5991-4f56-8bca-755fb0a8046d'::uuid;

ALTER TABLE public.conversation_interpretations DISABLE TRIGGER conversation_interpretations_immutable;
DELETE FROM public.conversation_interpretations
WHERE id='fe603735-5991-4f56-8bca-755fb0a8046d'::uuid
  AND conversation_output_id='082089d5-bb92-4f1a-9dd1-47f3a4395ae8'::uuid
  AND mission_id='05cfbdd3-60d0-4a1b-bada-98b9629ff889'::uuid
  AND interpretation_schema_version='conversation-interpretation-v1';
ALTER TABLE public.conversation_interpretations ENABLE TRIGGER conversation_interpretations_immutable;

COMMIT;
