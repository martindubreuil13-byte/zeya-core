import { loadEnvConfig } from "@next/env";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(`Voice lineage authorization: ${message}`);
}

async function blockedTableWrites(client: SupabaseClient, label: string): Promise<void> {
  const id = crypto.randomUUID();
  const payload = {
    voice_context_id: id,
    worker_brief_id: `authorization-${id}`,
    mission_id: `authorization-${id}`,
    tenant_user_id: crypto.randomUUID(),
    business_id: crypto.randomUUID(),
    business_representation_id: crypto.randomUUID(),
    canonical_version_id: crypto.randomUUID(),
    context_generated_at: new Date().toISOString(),
    authorized_element_keys: ["fabricated_claim"],
    provisional_mode: false,
    agent_id: "unauthorized",
    agent_type: "CALLER",
    agent_role: "unauthorized",
    context_schema_version: "test",
    prompt_assembly_version: "test",
  };
  assert((await client.from("voice_representation_lineage").insert(payload)).error, `${label} direct INSERT blocked`);
  assert((await client.from("voice_representation_lineage").update({ agent_id: "mutated" }).eq("voice_context_id", id)).error, `${label} direct UPDATE blocked`);
  assert((await client.from("voice_representation_lineage").delete().eq("voice_context_id", id)).error, `${label} direct DELETE blocked`);
}

async function blockedRpcs(client: SupabaseClient, label: string, tenantUserId: string): Promise<void> {
  const id = crypto.randomUUID();
  const create = await client.rpc("zeya_create_voice_representation_lineage", {
    p_voice_context_id: id,
    p_worker_brief_id: `authorization-${id}`,
    p_mission_id: `authorization-${id}`,
    p_conversation_id: `authorization-${id}`,
    p_tenant_user_id: tenantUserId,
    p_business_id: crypto.randomUUID(),
    p_business_representation_id: crypto.randomUUID(),
    p_canonical_version_id: crypto.randomUUID(),
    p_context_generated_at: new Date().toISOString(),
    p_authorized_element_keys: ["fabricated_claim"],
    p_provisional_mode: false,
    p_agent_id: "unauthorized",
    p_agent_type: "CALLER",
    p_agent_role: "unauthorized",
    p_context_schema_version: "test",
    p_prompt_assembly_version: "test",
  });
  assert(create.error, `${label} creation RPC blocked`);
  const attach = await client.rpc("zeya_attach_voice_provider_ids", {
    p_voice_context_id: id,
    p_conversation_id: `authorization-${id}`,
    p_provider_call_id: `authorization-${id}`,
  });
  assert(attach.error, `${label} attachment RPC blocked`);
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishable = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url && publishable && serviceKey, "required environment is unavailable");

  const service = createClient(url, serviceKey, { auth: { persistSession: false } });
  const anon = createClient(url, publishable, { auth: { persistSession: false } });
  const email = `voice-lineage-auth-${crypto.randomUUID()}@zeya.test`;
  const password = `T-${crypto.randomUUID()}!`;
  const created = await service.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;

  try {
    const signed = await anon.auth.signInWithPassword({ email, password });
    if (signed.error || !signed.data.session) throw signed.error ?? new Error("Authentication failed");
    const authenticated = createClient(url, publishable, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${signed.data.session.access_token}` } },
    });
    const anonymous = createClient(url, publishable, { auth: { persistSession: false } });

    assert((await service.from("voice_representation_lineage").select("voice_context_id").limit(1)).error === null, "service-role direct SELECT permitted");
    assert((await authenticated.from("voice_representation_lineage").select("voice_context_id").limit(1)).error === null, "authenticated SELECT permitted through RLS");
    assert((await anonymous.from("voice_representation_lineage").select("voice_context_id").limit(1)).error, "anonymous SELECT blocked");

    await blockedTableWrites(anonymous, "anonymous");
    await blockedTableWrites(authenticated, "authenticated");
    await blockedTableWrites(service, "service-role");
    await blockedRpcs(anonymous, "anonymous", created.data.user.id);
    await blockedRpcs(authenticated, "authenticated", created.data.user.id);

    const serviceCreate = await service.rpc("zeya_create_voice_representation_lineage", {
      p_voice_context_id: crypto.randomUUID(),
      p_worker_brief_id: "authorization-mismatch",
      p_mission_id: "authorization-mismatch",
      p_conversation_id: "authorization-mismatch",
      p_tenant_user_id: created.data.user.id,
      p_business_id: crypto.randomUUID(),
      p_business_representation_id: crypto.randomUUID(),
      p_canonical_version_id: crypto.randomUUID(),
      p_context_generated_at: new Date().toISOString(),
      p_authorized_element_keys: ["fabricated_claim"],
      p_provisional_mode: false,
      p_agent_id: "test",
      p_agent_type: "CALLER",
      p_agent_role: "test",
      p_context_schema_version: "test",
      p_prompt_assembly_version: "test",
    });
    assert(serviceCreate.error, "service-role inconsistent lineage rejected after RPC execution");

    console.log("Voice Lineage Authorization\n\nAnonymous access — PASS\nAuthenticated direct writes — PASS\nAuthenticated privileged RPCs — PASS\nService-role direct writes — PASS\nService-role SELECT — PASS\nService-role RPC validation — PASS");
  } finally {
    const deleted = await service.auth.admin.deleteUser(created.data.user.id);
    if (deleted.error && !deleted.error.message.toLowerCase().includes("not found")) throw deleted.error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Voice lineage authorization failed");
  process.exitCode = 1;
});
