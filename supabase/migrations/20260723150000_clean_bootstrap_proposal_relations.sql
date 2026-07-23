BEGIN;

CREATE TABLE IF NOT EXISTS public.proposal_observations (
  proposal_id uuid NOT NULL REFERENCES public.representation_proposals(id) ON DELETE CASCADE,
  observation_id uuid NOT NULL REFERENCES public.observations(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  PRIMARY KEY(proposal_id,observation_id)
);

CREATE TABLE IF NOT EXISTS public.proposal_evidence (
  proposal_id uuid NOT NULL REFERENCES public.representation_proposals(id) ON DELETE CASCADE,
  evidence_id uuid NOT NULL REFERENCES public.evidence(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  PRIMARY KEY(proposal_id,evidence_id)
);

CREATE TABLE IF NOT EXISTS public.proposal_elements (
  proposal_id uuid NOT NULL REFERENCES public.representation_proposals(id) ON DELETE CASCADE,
  element_id uuid NOT NULL REFERENCES public.representation_elements(id) ON DELETE RESTRICT,
  business_representation_id uuid NOT NULL REFERENCES public.business_representations(id) ON DELETE CASCADE,
  PRIMARY KEY(proposal_id,element_id)
);

ALTER TABLE public.proposal_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.proposal_elements ENABLE ROW LEVEL SECURITY;

CREATE POLICY proposal_observations_owner_all ON public.proposal_observations TO authenticated
  USING(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()))
  WITH CHECK(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()));
CREATE POLICY proposal_evidence_owner_all ON public.proposal_evidence TO authenticated
  USING(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()))
  WITH CHECK(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()));
CREATE POLICY proposal_elements_owner_all ON public.proposal_elements TO authenticated
  USING(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()))
  WITH CHECK(EXISTS(SELECT 1 FROM public.business_representations r WHERE r.id=business_representation_id AND r.user_id=auth.uid()));

GRANT SELECT,INSERT,DELETE ON public.proposal_observations,public.proposal_evidence,public.proposal_elements TO authenticated;
GRANT ALL ON public.proposal_observations,public.proposal_evidence,public.proposal_elements TO service_role;

COMMIT;
