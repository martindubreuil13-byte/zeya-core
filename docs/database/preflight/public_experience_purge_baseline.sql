SELECT p.oid::regprocedure AS exact_signature,pg_get_userbyid(p.proowner) AS function_owner,p.prosecdef AS security_definer,p.proconfig AS function_configuration,p.proacl AS function_acl,
 md5(pg_get_functiondef(p.oid)) AS definition_md5,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.voice_conversation_candidates') AS candidate_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.voice_conversation_outputs') AS output_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.voice_representation_lineage') AS lineage_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.representation_versions') AS version_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.approval_decisions') AS approval_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.representation_proposals') AS proposal_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.observations') AS observation_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.evidence') AS evidence_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.representation_elements') AS element_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.representation_domains') AS domain_delete_position,
 strpos(pg_get_functiondef(p.oid),'DELETE FROM public.business_representations') AS representation_delete_position,
 pg_get_functiondef(p.oid) AS exact_definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.oid='public.zeya_purge_business_representation(uuid,uuid)'::regprocedure;
