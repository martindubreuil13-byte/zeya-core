import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildFirstWorkingSessionBriefPrompt, isFirstWorkingSessionBriefCurrent, synthesizeFirstWorkingSessionBrief } from "../../lib/onboarding/first-working-session-brief";

const migration = "supabase/migrations/20260813010000_direct_hire_first_working_session_preparation.sql";

describe("P2.2 durable eligibility and leases", () => {
  it("requires scheduled, employed, induction-complete lineage", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("candidate.status = 'scheduled'");
    expect(sql).toContain("onboarding.onboarding_state = 'employment_accepted'");
    expect(sql).toContain("onboarding.induction_state = 'preparation_pending'");
  });
  it("serializes claims, recovers expired leases, and bounds attempts", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("FOR UPDATE OF candidate SKIP LOCKED");
    expect(sql).toContain("preparation_lease_expires_at <= now()");
    expect(sql).toContain("preparation_attempt_count < 3");
    expect(sql).toContain("preparation_attempt_count BETWEEN 0 AND 3");
    expect(sql).toContain("preparation_attempt_count=least(preparation_attempt_count + 1,3)");
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).toContain("p_lease_seconds: 600");
  });
  it("supports existing P2.1 appointments and rejects current completed work", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("ADD COLUMN preparation_status text NOT NULL DEFAULT 'pending'");
    expect(sql).toContain("candidate.preparation_status IN ('pending', 'failed')");
    expect(sql).toContain("candidate.preparation_status = 'ready' AND candidate.preparation_contract_version IS DISTINCT FROM p_contract_version");
    expect(sql).toContain("direct_hire_induction_marks_working_session_preparation_stale");
    expect(sql).toContain("SET current=false");
  });
  it("keeps the appointment lifecycle independent from historical onboarding Preparation", async () => {
    const sql = await readFile(migration, "utf8");
    const claimBody = sql.slice(sql.indexOf("CREATE FUNCTION public.zeya_claim_first_working_session_preparation"), sql.indexOf("CREATE FUNCTION public.zeya_persist_first_working_session_website_research"));
    expect(claimBody).not.toContain("UPDATE public.direct_hire_onboarding_sessions");
    expect(sql).toContain("preparation_website_persisted_at");
  });
  it("makes finalize/fail replay safe and private", async () => {
    const sql = await readFile(migration, "utf8");
    expect(sql).toContain("v_session.preparation_status = 'ready'");
    expect(sql).toContain("v_session.preparation_status = 'failed' AND v_session.preparation_lease_id IS NULL");
    expect(sql).toContain("REVOKE ALL ON TABLE public.direct_hire_first_working_session_briefs FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT ALL ON TABLE public.direct_hire_first_working_session_briefs TO service_role");
    expect(sql).toContain("preparation brief Evidence lineage invalid");
  });
});

describe("P2.2 orchestration", () => {
  it("runs registered sources, P1, hypotheses, then brief in order", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    const source = worker.lastIndexOf("acquirePendingRegisteredPublicSources(client");
    const research = worker.indexOf("executeDirectHirePreparation(claim.website_url");
    const intelligence = worker.indexOf("ensurePreparationIntelligence(client, scope,");
    const brief = worker.indexOf("buildFirstWorkingSessionBrief(client, scope)");
    expect(source).toBeLessThan(research);
    expect(research).toBeLessThan(intelligence);
    expect(intelligence).toBeLessThan(brief);
    expect(worker).toContain('sourceScope: claim.onboarding_session_id');
    expect(worker).toContain('rpc("zeya_persist_first_working_session_website_research"');
    expect(worker).not.toContain('rpc("zeya_finalize_direct_hire_preparation"');
  });
  it("uses a synchronous secret worker and no fire-and-forget promise", async () => {
    const route = await readFile("app/api/internal/direct-hire/first-working-session-preparation/route.ts", "utf8");
    expect(route).toContain("DIRECT_HIRE_PREPARATION_WORKER_SECRET");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("await executeOneFirstWorkingSessionPreparation");
    expect(route).not.toContain("void executeOne");
  });
  it("does not mutate Formation or canonical Representation", async () => {
    const worker = await readFile("lib/onboarding/first-working-session-preparation-worker.ts", "utf8");
    expect(worker).not.toContain("representation_versions");
    expect(worker).not.toContain("representation_formation_sessions");
    expect(worker).not.toContain("current_version_id");
  });
});

describe("P2.2 private brief governance", () => {
  it("stores required lineage, fingerprints, version, and private JSON", async () => {
    const sql = await readFile(migration, "utf8");
    for (const marker of ["direct_hire_working_session_id", "direct_hire_onboarding_session_id", "business_representation_id", "source_snapshot_fingerprint", "hypothesis_trace_fingerprint", "preparation_contract_version", "generated_at"]) {
      expect(sql).toContain(marker);
    }
    const service = await readFile("lib/onboarding/first-working-session-brief.ts", "utf8");
    expect(service).toContain('"first-working-session-preparation-v1"');
  });
  it("independently synthesizes a specific, governed representative brief", async () => {
    const inputs = {
      evidence: [{ id: "e1", sourceType: "public_website", rawStatement: "We use business architecture to redesign offers and operating systems, not traditional coaching.", affected_domains: ["whatYouSell", "proposedDescription"] }],
      observations: [{ id: "o1", evidenceId: "e1", interpreted_meaning: "The offer is framed as architecture and operating-system design.", confidence_in_interpretation: 55, affected_domains: ["whatYouSell"] }],
      hypotheses: Array.from({ length: 7 }, (_, index) => ({ id: `h${index + 1}`, constitutionalDomain: ["whatYouSell","whoItIsFor","problemOrAspiration","whyCustomersShouldCare","proposedDescription","authorityBoundaries","clarificationsNeeded"][index], currentBelief: "Current governed hypothesis", sourceEvidenceIds: ["e1"] })),
    } as never;
    const statement = (text: string, kind = "supported_finding") => ({ statement: text, kind, evidenceIds: ["e1"], hypothesisIds: ["h1"] });
    const fixture = {
      businessRead: statement("The business is an architecture-led advisory practice."),
      offerRead: statement("It redesigns offers and operating systems."), customerRead: statement("The customer remains to be narrowed."),
      problemOutcomeRead: statement("It targets structural execution problems."), positioningRead: statement("Business architecture is the explicit positioning anchor."),
      commercialSignals: [statement("The offer language points to transformation of operating systems.")], contradictions: [],
      unknowns: [{ statement: "Pricing authority is unknown.", kind: "unknown", evidenceIds: [], hypothesisIds: [] }],
      workingOpinions: [statement("My working interpretation is that the business is positioned closer to business architecture than traditional coaching.", "working_opinion")],
      formationPriorities: [statement("Test whether architecture language is understood by the intended buyer.", "interpretation")],
      openingInsights: [statement("The architecture-versus-coaching distinction is a productive opening for the session.", "interpretation")],
      questions: [{ statement: "Which buyer most values the operating-system redesign?", kind: "unknown", evidenceIds: [], hypothesisIds: [] }],
      authorityGaps: [{ statement: "Pricing and promise authority are not established.", kind: "unknown", evidenceIds: [], hypothesisIds: [] }],
      governance: { canonical: false, containsChainOfThought: false },
    };
    const prompt = buildFirstWorkingSessionBriefPrompt(inputs);
    expect(prompt).toContain("business architecture");
    const brief = await synthesizeFirstWorkingSessionBrief(inputs, async () => fixture);
    for (const key of ["businessRead","offerRead","customerRead","problemOutcomeRead","positioningRead","commercialSignals","contradictions","unknowns","workingOpinions","formationPriorities","openingInsights","questions","authorityGaps"]) expect(brief).toHaveProperty(key);
    expect(brief.workingOpinions[0].statement).toContain("closer to business architecture than traditional coaching");
    expect(brief.workingOpinions.every(item => item.kind === "working_opinion")).toBe(true);
    expect(brief.governance).toEqual({ canonical: false, containsChainOfThought: false });
  });
  it("never exposes private brief through the owner API", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/working-session/route.ts", "utf8");
    expect(route).not.toContain("direct_hire_first_working_session_briefs");
    expect(route).not.toContain("sourceEvidenceIds");
    expect(route).toContain("preparationStatus");
  });
  it("rejects a stale brief when its governed snapshot changes", () => {
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "first-working-session-preparation-v1" }, "a")).toBe(true);
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "first-working-session-preparation-v1" }, "b")).toBe(false);
    expect(isFirstWorkingSessionBriefCurrent({ sourceSnapshotFingerprint: "a", preparationContractVersion: "old" }, "a")).toBe(false);
  });
});

describe("P2.2 manual verification bundle", () => {
  it("is read-only and checks the predecessor/final state", async () => {
    const files = await Promise.all([
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_preflight.sql", "utf8"),
      readFile("supabase/manual/20260813_direct_hire_first_working_session_preparation_postcheck.sql", "utf8"),
    ]);
    for (const sql of files) {
      expect(sql).toContain("PASS");
      expect(sql).toContain("pg_catalog");
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\s+(TABLE|INTO|public\.)/i);
    }
    expect(files[0]).toContain("zeya_finalize_direct_hire_preparation");
    expect(files[1]).toContain("zeya_claim_first_working_session_preparation");
  });
});
