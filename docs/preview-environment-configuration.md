# Preview environment configuration

The `full-cycle-backend-integration` Preview deployment must use the isolated
Supabase Preview project. Configure these variables in Vercel's **Preview**
scope, then create a fresh Preview deployment:

- `NEXT_PUBLIC_SUPABASE_URL`: URL for project `hdjojgvvlojbhgidirht`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: anon key for project `hdjojgvvlojbhgidirht`
- `SUPABASE_SERVICE_ROLE_KEY`: service-role key for project `hdjojgvvlojbhgidirht`
- `ZEYA_PREVIEW_SUPABASE_PROJECT_REF`: `hdjojgvvlojbhgidirht`
- `ZEYA_PRODUCTION_SUPABASE_PROJECT_REF`: `eqdhftogzzlkpjebgbue`

Do not copy Production Supabase credentials into Preview. The runtime isolation
guard must remain enabled and must reject a Preview deployment whose effective
Supabase URL resolves to the Production project.

## Manually installed pre-canonical contract

On the isolated Preview project `hdjojgvvlojbhgidirht`, the pre-canonical
database package was installed and verified manually in three reviewed,
transactional SQL Editor blocks. It is intentionally not represented as a
Supabase migration and must not be added to a normal migration push.

The application depends on these service-role-only creation RPCs:

- `zeya_create_pre_canonical_public_experience_session(text,timestamptz,uuid,text,text,uuid,uuid,uuid,uuid,timestamptz,text[],text,text,text)`
- `zeya_create_pre_canonical_voice_representation_lineage(uuid,text,text,text,uuid,uuid,uuid,uuid,timestamptz,text[],boolean,text,text,text,text,text)`

The installed package preserves canonical sessions and adds pre-canonical
lineage with `canonical_version_id IS NULL` and
`representation_context_mode = 'pre_canonical'`. No placeholder
Representation Version is created.
