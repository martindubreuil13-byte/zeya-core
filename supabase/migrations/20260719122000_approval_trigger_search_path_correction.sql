-- Additive correction exposed by the empty-search-path canonicalization caller.
-- Preserve approval semantics while making every relation/type reference explicit.
BEGIN;
CREATE OR REPLACE FUNCTION public.zeya_validate_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  owner_id uuid;
  proposal_state public.proposal_status;
BEGIN
  SELECT br.user_id, rp.status INTO owner_id, proposal_state
  FROM public.representation_proposals rp
  JOIN public.business_representations br ON br.id=rp.business_representation_id
  WHERE rp.id=NEW.representation_proposal_id
    AND rp.business_representation_id=NEW.business_representation_id;
  IF owner_id IS NULL THEN RAISE EXCEPTION 'proposal not found for representation'; END IF;
  IF NEW.approver_user_id<>owner_id THEN RAISE EXCEPTION 'only the business owner may approve this foundation-stage proposal'; END IF;
  IF proposal_state NOT IN ('risk_assessed'::public.proposal_status,'pending_approval'::public.proposal_status) THEN
    RAISE EXCEPTION 'proposal status % is not eligible for approval',proposal_state;
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION public.zeya_validate_approval() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_validate_approval() FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
