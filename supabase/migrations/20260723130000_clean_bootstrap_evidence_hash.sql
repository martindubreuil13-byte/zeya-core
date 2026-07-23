BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_set_evidence_statement_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $$
BEGIN
  IF NEW.statement_hash IS NULL OR btrim(NEW.statement_hash)='' THEN
    NEW.statement_hash:=encode(extensions.digest(NEW.raw_statement,'sha256'),'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zeya_set_evidence_statement_hash ON public.evidence;
CREATE TRIGGER zeya_set_evidence_statement_hash
BEFORE INSERT ON public.evidence
FOR EACH ROW EXECUTE FUNCTION public.zeya_set_evidence_statement_hash();

REVOKE ALL ON FUNCTION public.zeya_set_evidence_statement_hash()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_set_evidence_statement_hash() TO postgres;

COMMIT;
