BEGIN;

-- Proposal relation rows must not combine an owner-controlled representation
-- identity with foreign proposal artifacts.
DROP POLICY IF EXISTS proposal_observations_owner_all ON public.proposal_observations;
CREATE POLICY proposal_observations_owner_all
ON public.proposal_observations
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.observations AS observation
      ON observation.id = proposal_observations.observation_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_observations.business_representation_id
    WHERE proposal.id = proposal_observations.proposal_id
      AND proposal.business_representation_id = proposal_observations.business_representation_id
      AND observation.business_representation_id = proposal_observations.business_representation_id
      AND representation.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.observations AS observation
      ON observation.id = proposal_observations.observation_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_observations.business_representation_id
    WHERE proposal.id = proposal_observations.proposal_id
      AND proposal.business_representation_id = proposal_observations.business_representation_id
      AND observation.business_representation_id = proposal_observations.business_representation_id
      AND representation.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS proposal_evidence_owner_all ON public.proposal_evidence;
CREATE POLICY proposal_evidence_owner_all
ON public.proposal_evidence
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.evidence AS evidence
      ON evidence.id = proposal_evidence.evidence_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_evidence.business_representation_id
    WHERE proposal.id = proposal_evidence.proposal_id
      AND proposal.business_representation_id = proposal_evidence.business_representation_id
      AND evidence.business_representation_id = proposal_evidence.business_representation_id
      AND representation.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.evidence AS evidence
      ON evidence.id = proposal_evidence.evidence_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_evidence.business_representation_id
    WHERE proposal.id = proposal_evidence.proposal_id
      AND proposal.business_representation_id = proposal_evidence.business_representation_id
      AND evidence.business_representation_id = proposal_evidence.business_representation_id
      AND representation.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS proposal_elements_owner_all ON public.proposal_elements;
CREATE POLICY proposal_elements_owner_all
ON public.proposal_elements
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.representation_elements AS element
      ON element.id = proposal_elements.element_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_elements.business_representation_id
    WHERE proposal.id = proposal_elements.proposal_id
      AND proposal.business_representation_id = proposal_elements.business_representation_id
      AND element.business_representation_id = proposal_elements.business_representation_id
      AND representation.user_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.representation_proposals AS proposal
    JOIN public.representation_elements AS element
      ON element.id = proposal_elements.element_id
    JOIN public.business_representations AS representation
      ON representation.id = proposal_elements.business_representation_id
    WHERE proposal.id = proposal_elements.proposal_id
      AND proposal.business_representation_id = proposal_elements.business_representation_id
      AND element.business_representation_id = proposal_elements.business_representation_id
      AND representation.user_id = auth.uid()
  )
);

COMMIT;
