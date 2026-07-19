import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const original = readFileSync("supabase/migrations/20260716103000_conversation_review_canonical_insert_parity_repair.sql", "utf8");
const migration = readFileSync("supabase/migrations/20260719100000_voice_candidate_promotion_core.sql", "utf8");
const originalBody = original.slice(original.indexOf("DECLARE c "), original.indexOf("END; $$;", original.indexOf("DECLARE c ")));
const core = migration.slice(migration.indexOf("DECLARE c "), migration.indexOf("END; $$;", migration.indexOf("DECLARE c ")));
const normalize = (value: string) => value.replace(/--.*$/gm, "").replace(/\s+/g, " ").replace(/auth\.uid\(\)/g, "p_actor_user_id").replace(/confirmed\s*\?\s*'elementKey'/g, "confirmed ? 'elementKey'").trim();
const normalizedOriginal = normalize(originalBody).replace(/auth\.role\(\)<>\s*'authenticated'\s*OR\s*p_actor_user_id\s+IS\s+NULL\s+THEN[^;]+;\s*END\s+IF;?/g, "");
const normalizedCore = normalize(core).replace(/IF p_actor_user_id IS NULL THEN[^;]+;\s*END IF;?/g, "");
for (const marker of ["candidate_review_decisions", "public.evidence", "public.observations", "public.representation_proposals", "proposal_evidence", "proposal_observations", "proposal_elements", "conversation_candidate_promotions", "promotion request conflicts", "candidate already promoted with different configuration", "reviewDecisionId", "promotionId", "idempotent"]) {
  assert(normalizedOriginal.includes(marker) && normalizedCore.includes(marker), `missing preserved marker: ${marker}`);
}
const writes = normalizedCore.slice(normalizedCore.indexOf("INSERT INTO public.conversation_candidate_review_decisions"));
const order = ["INSERT INTO public.conversation_candidate_review_decisions", "INSERT INTO public.evidence", "INSERT INTO public.observations", "INSERT INTO public.representation_proposals", "INSERT INTO public.proposal_evidence", "INSERT INTO public.proposal_observations", "INSERT INTO public.proposal_elements", "INSERT INTO public.conversation_candidate_promotions", "RETURN jsonb_build_object('reviewDecisionId'"];
for (let i = 1; i < order.length; i++) assert(writes.indexOf(order[i - 1]) < writes.indexOf(order[i]), `operation ordering changed before ${order[i]}`);
assert.equal((originalBody.match(/auth\.uid\(\)/g) ?? []).length, 5);
assert((normalizedCore.match(/p_actor_user_id/g) ?? []).length >= 3);
console.log("Voice candidate-promotion wrapper compatibility — PASS");
