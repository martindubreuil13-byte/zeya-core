BEGIN;

CREATE OR REPLACE FUNCTION public.zeya_set_representation_version_hash()
RETURNS trigger
LANGUAGE plpgsql
SET search_path=''
AS $$
BEGIN
  IF NEW.content_hash IS NULL OR btrim(NEW.content_hash)='' THEN
    NEW.content_hash:=encode(extensions.digest(NEW.element_values::text,'sha256'),'hex');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS zeya_set_representation_version_hash
  ON public.representation_versions;
CREATE TRIGGER zeya_set_representation_version_hash
BEFORE INSERT ON public.representation_versions
FOR EACH ROW EXECUTE FUNCTION public.zeya_set_representation_version_hash();

REVOKE ALL ON FUNCTION public.zeya_set_representation_version_hash()
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.zeya_set_representation_version_hash() TO postgres;

COMMIT;
