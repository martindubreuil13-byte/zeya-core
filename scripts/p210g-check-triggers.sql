SELECT tgname, tgrelid::regclass, tgtype, tgfoid::regprocedure
FROM pg_trigger
WHERE tgrelid = 'public.mission_execution_contexts'::regclass;
