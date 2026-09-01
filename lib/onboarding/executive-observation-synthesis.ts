import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EvidenceInput } from "./hypothesis-reasoning-types";
import { normalizeEffectivePreparationEvidence, toEvidenceInput } from "./persist-hypotheses-orchestration";
import type { DatabaseEvidence } from "./persist-hypotheses-types";

export const EXECUTIVE_OBSERVATION_SYNTHESIS_VERSION = "executive-observation-synthesis-v1";

export type ExecutiveObservationCategory =
  | "confirmation" | "pattern" | "segmentation" | "tension"
  | "contradiction" | "implication" | "gap" | "differentiation_signal";

export type ExecutiveObservationDraft = {
  observationKey: string;
  category: ExecutiveObservationCategory;
  evidenceIds: string[];
  interpretedMeaning: string;
  confidence: number;
  affectedDomains: string[];
};

const STOP = new Set("a an and are as at be been being by can company do for from has have how i in into is it its may more my of on or our that the their them they this to we what when where which who will with you your business businesses people help helps need needs offer offers work working".split(" "));
const BOILERPLATE = /(?:contact us|cookie|privacy policy|terms (?:of use|and conditions)|all rights reserved|subscribe|sign up|follow us|navigation|menu)/i;
const STAGES = [
  { key: "evaluation", label: "evaluating whether an idea can become a viable business", pattern: /\b(?:idea|concept|validat|viab|test|uncertain|explor)\w*/i },
  { key: "structure", label: "turning early work into a structured business", pattern: /\b(?:architect|structure|system|model|foundation|design|build|building|started)\w*/i },
  { key: "execution", label: "moving into execution or market readiness", pattern: /\b(?:execut|launch|market|go[- ]to[- ]market|operat|scale|growth|ready)\w*/i },
] as const;

function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function publicEvidence(e: EvidenceInput) { return e.sourceType === "public_website"; }
function ownerEvidence(e: EvidenceInput) { return ["direct_hire_induction", "conversation", "manual"].includes(e.sourceType); }
function useful(e: EvidenceInput) {
  return e.rawStatement.trim().length >= 18 && !BOILERPLATE.test(e.rawStatement)
    && e.source_page_type !== "contact" && e.source_evidence_kind !== "title";
}
function tokens(value: string) {
  return [...new Set((value.toLowerCase().match(/[a-z][a-z-]{2,}/g) ?? [])
    .map(token => token.replace(/(?:ing|ed|es|s)$/, ""))
    .filter(token => token.length >= 3 && !STOP.has(token)))];
}
function rankedTerms(rows: EvidenceInput[]) {
  const counts = new Map<string, number>();
  for (const row of rows) for (const token of tokens(row.rawStatement)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
function cited(rows: EvidenceInput[], terms: string[], limit = 6) {
  return rows.filter(row => terms.some(term => tokens(row.rawStatement).includes(term)))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit);
}
function confidence(rows: EvidenceInput[], inference: boolean, conflict = false) {
  const logical = new Set(rows.map(row => row.logical_source_key ?? row.id)).size;
  const authorities = new Set(rows.map(row => row.authority_key ?? `${row.sourceType}:${row.id}`)).size;
  const origins = new Set(rows.map(row => ownerEvidence(row) ? "owner" : publicEvidence(row) ? "public" : "other")).size;
  const direct = rows.filter(row => row.source_evidence_kind !== "explicit_absence" && row.sourceType !== "inference").length;
  const score = 45 + Math.min(rows.length, 4) * 3 + Math.min(logical, 3) * 3
    + Math.min(authorities, 2) * 3 + (origins > 1 ? 7 : 0) + (direct === rows.length ? 4 : 0)
    - (inference ? 9 : 0) - (conflict ? 5 : 0);
  return Math.max(35, Math.min(85, Math.round(score / 5) * 5));
}
function make(category: ExecutiveObservationCategory, rows: EvidenceInput[], meaning: string, domains: string[], inference = true, conflict = false): ExecutiveObservationDraft {
  const evidenceIds = [...new Set(rows.map(row => row.id))].sort();
  return {
    observationKey: hash([EXECUTIVE_OBSERVATION_SYNTHESIS_VERSION, category, ...evidenceIds, meaning].join("|")),
    category, evidenceIds, interpretedMeaning: meaning,
    confidence: confidence(rows, inference, conflict), affectedDomains: [...new Set(domains)].sort(),
  };
}

export function synthesizeExecutiveObservations(input: EvidenceInput[]): ExecutiveObservationDraft[] {
  const evidence = input.filter(useful).sort((a, b) => a.id.localeCompare(b.id));
  const publicRows = evidence.filter(publicEvidence);
  const ownerRows = evidence.filter(ownerEvidence);
  const observations: ExecutiveObservationDraft[] = [];

  const stageRows = STAGES.map(stage => ({ stage, rows: publicRows.filter(row => stage.pattern.test(row.rawStatement)) }))
    .filter(item => item.rows.length > 0);
  if (stageRows.length >= 2) {
    const rows = [...new Map(stageRows.flatMap(item => item.rows).map(row => [row.id, row])).values()].slice(0, 6);
    const pages = new Set(rows.map(row => row.logical_source_key ?? row.canonical_source_url ?? row.id));
    if (pages.size >= 2) observations.push(make("segmentation", rows,
      `The public material acquired appears to address distinct customer moments: ${stageRows.map(item => item.stage.label).join(", and ")}.`,
      ["whoItIsFor", "problemOrAspiration", "whatYouSell"]));
    if (stageRows.length === 3 && pages.size >= 2) observations.push(make("pattern", rows,
      "Across the public pages acquired, the customer journey appears to progress from validation, through business structure, into execution or market readiness.",
      ["problemOrAspiration", "whyCustomersShouldCare", "whatYouSell"]));
  }

  if (ownerRows.length && publicRows.length) {
    const ownerTerms = rankedTerms(ownerRows);
    const publicTerms = new Map(rankedTerms(publicRows));
    const shared = ownerTerms.filter(([term]) => publicTerms.has(term)).slice(0, 3).map(([term]) => term);
    if (shared.length >= 2) {
      const rows = [...cited(ownerRows, shared, 3), ...cited(publicRows, shared, 3)];
      if (rows.some(ownerEvidence) && rows.some(publicEvidence)) observations.push(make("confirmation", rows,
        `Owner-provided material and the public pages acquired independently align around ${shared.join(", ")}.`,
        ["proposedDescription", "whoItIsFor", "whatYouSell"], false));
    }
    const publicTermSet = new Set(publicTerms.keys());
    const ownerOnly = ownerTerms.filter(([term]) => !publicTermSet.has(term)).slice(0, 2).map(([term]) => term);
    const publicOnly = [...publicTerms].filter(([term, count]) => count >= 2 && !ownerTerms.some(([owner]) => owner === term)).slice(0, 3).map(([term]) => term);
    if (ownerOnly.length && publicOnly.length) {
      const rows = [...cited(ownerRows, ownerOnly, 3), ...cited(publicRows, publicOnly, 3)];
      observations.push(make("tension", rows,
        `Owner-provided material emphasizes ${ownerOnly.join(" and ")}, while the public pages acquired emphasize ${publicOnly.join(", ")} more strongly. This is a positioning-emphasis tension, not proof of a factual contradiction.`,
        ["proposedDescription", "whatYouSell", "clarificationsNeeded"]));
    }

    for (const term of shared) {
      const affirming = evidence.filter(row => tokens(row.rawStatement).includes(term) && !new RegExp(`\\b(?:no|not|never|without)\\b.{0,30}\\b${term}`, "i").test(row.rawStatement));
      const denying = evidence.filter(row => new RegExp(`\\b(?:no|not|never|without)\\b.{0,30}\\b${term}`, "i").test(row.rawStatement));
      if (affirming.length && denying.length) {
        observations.push(make("contradiction", [affirming[0], denying[0]],
          `Governed sources materially conflict about ${term}; the conflict remains unresolved and requires owner verification.`,
          ["clarificationsNeeded", "proposedDescription"], true, true));
        break;
      }
    }
  }
  return observations.slice(0, 6);
}

export async function ensureExecutiveObservationSynthesis(client: SupabaseClient, scope: {
  workingSessionId: string; leaseId: string; onboardingSessionId: string; businessRepresentationId: string;
}) {
  const result = await client.from("evidence").select("id,business_representation_id,direct_hire_onboarding_session_id,source_type,raw_statement,affected_domains,canonical_source_url,requested_source_url,source_page_type,source_evidence_kind,source_selector,source_content_hash,source_retrieved_at,extraction_method_version,source_authority_type,source_authority_key,registered_public_source_id,captured_by_actor,induction_material_type,induction_material_label,created_at")
    .eq("direct_hire_onboarding_session_id", scope.onboardingSessionId).eq("business_representation_id", scope.businessRepresentationId);
  if (result.error) throw new Error(`executive_observation_source_load_failed:${result.error.code}`);
  const evidence = toEvidenceInput(normalizeEffectivePreparationEvidence((result.data ?? []) as DatabaseEvidence[]));
  const observations = synthesizeExecutiveObservations(evidence);
  const persisted = await client.rpc("zeya_persist_first_working_session_executive_observations", {
    p_working_session_id: scope.workingSessionId, p_lease_id: scope.leaseId, p_observations: observations,
  });
  if (persisted.error) throw new Error(`executive_observation_persistence_failed:${persisted.error.code}`);
  return observations;
}
