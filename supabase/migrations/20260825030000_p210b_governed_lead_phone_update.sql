BEGIN;

CREATE FUNCTION public.zeya_update_operating_lead_phone(
  p_owner_id uuid,
  p_lead_id uuid,
  p_expected_lead_fingerprint text,
  p_phone text
) RETURNS TABLE(lead_id uuid,previous_fingerprint text,current_fingerprint text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  v_lead public.mission_leads%ROWTYPE;
  v_previous text;
  v_current text;
BEGIN
  IF auth.role()<>'service_role' THEN
    RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='not authorized';
  END IF;
  IF p_lead_id IS NULL OR p_expected_lead_fingerprint!~'^[0-9a-f]{64}$'
    OR p_phone IS NULL OR btrim(p_phone)!~'^\+[1-9][0-9]{7,14}$' OR btrim(p_phone)<>p_phone
  THEN
    RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='invalid lead phone update';
  END IF;

  SELECT lead.* INTO v_lead
  FROM public.mission_leads AS lead
  JOIN public.business_representations AS representation
    ON representation.id=lead.business_representation_id
   AND representation.business_id=lead.business_id
   AND representation.user_id=p_owner_id
  WHERE lead.id=p_lead_id
  FOR UPDATE OF lead;
  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE='PZ404',MESSAGE='lead not found';
  END IF;

  v_previous:=public.zeya_p24_lead_fingerprint(v_lead);
  IF v_previous<>p_expected_lead_fingerprint THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='lead changed';
  END IF;
  IF v_lead.phone IS NOT DISTINCT FROM p_phone THEN
    RAISE EXCEPTION USING ERRCODE='PZ409',MESSAGE='lead phone is unchanged';
  END IF;

  UPDATE public.mission_leads AS lead SET phone=p_phone WHERE lead.id=v_lead.id RETURNING lead.* INTO v_lead;
  v_current:=public.zeya_p24_lead_fingerprint(v_lead);
  RETURN QUERY SELECT v_lead.id,v_previous,v_current;
END $$;

ALTER FUNCTION public.zeya_update_operating_lead_phone(uuid,uuid,text,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.zeya_update_operating_lead_phone(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.zeya_update_operating_lead_phone(uuid,uuid,text,text) TO service_role;

NOTIFY pgrst,'reload schema';
COMMIT;
