BEGIN;

DROP POLICY IF EXISTS representation_proposals_owner_update
  ON public.representation_proposals;
CREATE POLICY representation_proposals_owner_update
  ON public.representation_proposals
  FOR UPDATE TO authenticated
  USING(EXISTS(
    SELECT 1 FROM public.business_representations r
    WHERE r.id=business_representation_id AND r.user_id=auth.uid()
  ))
  WITH CHECK(EXISTS(
    SELECT 1 FROM public.business_representations r
    WHERE r.id=business_representation_id AND r.user_id=auth.uid()
  ));

GRANT UPDATE ON public.representation_proposals TO authenticated;

COMMIT;
