BEGIN;

-- The initial Preview install correctly rolled back its first projection when
-- JSON null reached the uncertainty check as a JSONB scalar. Normalize JSON
-- null at the table boundary as an additional defense for every service writer.
CREATE FUNCTION public.zeya_p29b_normalize_observation_nulls() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.value='null'::jsonb THEN NEW.value:=NULL; END IF;
  IF NEW.uncertainty='null'::jsonb THEN NEW.uncertainty:=NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER prospect_observations_normalize_nulls
  BEFORE INSERT ON public.prospect_observations
  FOR EACH ROW EXECUTE FUNCTION public.zeya_p29b_normalize_observation_nulls();

COMMIT;
