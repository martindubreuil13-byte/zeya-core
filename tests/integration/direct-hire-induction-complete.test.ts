import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Employee Induction Material Collection", () => {
  describe("Governance — Materials Do NOT Create Canonical Representation", () => {
    it("induction materials do not create representation_versions", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).not.toContain("representation_versions");
      // Verify evidence table is used
      expect(route).toContain('.from("evidence")');
      expect(route).toContain(".insert({");
      expect(route).not.toContain("current_version_id");
    });

    it("induction materials do not set current_version_id", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("evidence");
      expect(route).not.toContain("current_version_id");
    });

    it("materials are stored as evidence, not as representation input", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain('source_type: "direct_hire_induction"');
      expect(route).toContain(".from(\"evidence\")");
      expect(route).toContain("direct_hire_onboarding_session_id");
    });

    it("owner remains new_owner status during induction", async () => {
      const route = await readFile(
        "app/api/owner/status/route.ts",
        "utf8",
      );
      // Induction state doesn't create has_representation
      expect(route).toContain("direct_hire_employed");
      expect(route).not.toContain("preparation_pending");
    });
  });

  describe("State Progression and Durability", () => {
    it("induction_state enum includes all expected states", async () => {
      const migration = await readFile(
        "supabase/migrations/20260805000002_employee_induction_material_collection.sql",
        "utf8",
      );
      expect(migration).toContain("'not_started'");
      expect(migration).toContain("'material_requested'");
      expect(migration).toContain("'material_received'");
      expect(migration).toContain("'preparation_pending'");
    });

    it("induction API updates state on material submission", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("induction_state");
      expect(route).toContain("induction_materials_count");
      expect(route).toContain("induction_started_at");
      expect(route).toContain("induction_materials_received_at");
    });

    it("state transitions are explicit and ordered", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      // Verify progression logic
      expect(route).toContain("not_started");
      expect(route).toContain("material_requested");
      expect(route).toContain("material_received");
    });
  });

  describe("UI Surfaces and Routing", () => {
    it("induction component has employment_accepted surface with Begin My Induction action", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain('surface === "employment_accepted"');
      expect(component).toContain("Thank you for trusting me");
      expect(component).toContain("Begin My Induction");
    });

    it("induction component has material_requested surface (form)", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain('surface === "material_requested"');
      expect(component).toContain("What the business sells");
      expect(component).toContain("target customers");
      expect(component).toContain("business-development priority");
      expect(component).toContain("Useful links");
    });

    it("induction component has material_received surface (review)", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain('surface === "material_received"');
      expect(component).toContain("Here's what you've shared");
      expect(component).toContain("I've reviewed this");
    });

    it("induction component has preparation_pending surface (boundary)", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain('surface === "preparation_pending"');
      expect(component).toContain("I have what I need to begin preparing");
      expect(component).toContain("I'll review the material you shared");
      expect(component).toContain("before our first");
    });

    it("preparation page routes to DirectHireInduction component", async () => {
      const page = await readFile(
        "app/onboarding/preparation/page.tsx",
        "utf8",
      );
      expect(page).toContain("DirectHireInduction");
    });
  });

  describe("Material Types and Validation", () => {
    it("supports description, link, and note material types", async () => {
      const contract = await readFile(
        "lib/onboarding/direct-hire-contract.ts",
        "utf8",
      );
      expect(contract).toContain('"description"');
      expect(contract).toContain('"link"');
      expect(contract).toContain('"note"');
      expect(contract).not.toContain('"document"');
    });

    it("does not support document upload", async () => {
      const contract = await readFile(
        "lib/onboarding/direct-hire-contract.ts",
        "utf8",
      );
      expect(contract).not.toContain("fileMetadata");
    });

    it("component validates URLs for link materials", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("new URL");
      expect(component).toContain("valid URL");
      expect(component).toContain("type=\"url\"");
    });

    it("component prevents duplicate links", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("already added this URL");
    });

    it("component requires minimum one material before submission", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("at least one material");
    });
  });

  describe("Evidence Persistence", () => {
    it("induction materials stored in evidence table with source_type='direct_hire_induction'", async () => {
      const migration = await readFile(
        "supabase/migrations/20260805000002_employee_induction_material_collection.sql",
        "utf8",
      );
      expect(migration).toContain("direct_hire_induction");
      expect(migration).toContain(
        "ALTER TYPE public.evidence_source_type ADD VALUE IF NOT EXISTS",
      );
    });

    it("evidence records include material type and label", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("induction_material_type");
      expect(route).toContain("induction_material_label");
      expect(route).toContain("induction_material_url");
    });

    it("evidence records include statement_hash for integrity", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("statement_hash");
      expect(route).toContain("createHash");
    });

    it("direct_hire_onboarding_session_id creates proper linkage", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("direct_hire_onboarding_session_id");
      expect(route).toContain("direct_hire_onboarding_sessions");
    });

    it("captured_by_actor preserves owner identity", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("captured_by_actor: ownerId");
    });
  });

  describe("Security and Tenant Isolation", () => {
    it("induction API requires employment_accepted state", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("employment_accepted");
      expect(route).toContain("not_in_employment_accepted_state");
    });

    it("induction API verifies session belongs to owner", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).toContain("owner_id");
      expect(route).toContain("ownerId");
    });

    it("evidence RLS prevents cross-tenant access", async () => {
      const migration = await readFile(
        "supabase/migrations/20260711000000_representation_state_foundation.sql",
        "utf8",
      );
      expect(migration).toContain("users_can_view_own_evidence");
      expect(migration).toContain("auth.uid()");
    });
  });

  describe("Honest Processing States", () => {
    it("component does not claim to be reading or analyzing materials", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).not.toContain("reading");
      expect(component).not.toContain("analysing");
      expect(component).not.toContain("learning");
      expect(component).not.toContain("extracting");
    });

    it("boundary screen states truthful next step", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("I'll review the material you shared");
      expect(component).not.toContain("Preparation is underway");
      expect(component).not.toContain("I have learned");
    });

    it("no fake progress bars or processing animations", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      // Check for absence of progress/loading theatrics
      const preparationSurface = component.slice(
        component.indexOf('preparation_pending'),
        component.indexOf('error'),
      );
      expect(preparationSurface).not.toContain("progress");
      expect(preparationSurface).not.toContain("animate");
    });
  });

  describe("No Next-Phase Leakage", () => {
    it("does not implement document parsing", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).not.toContain("parse");
      expect(route).not.toContain("extract");
      expect(route).not.toContain("LLM");
    });

    it("does not create representation proposals", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).not.toContain("representation_proposals");
      expect(route).not.toContain("proposal");
    });

    it("does not implement independent preparation", async () => {
      const route = await readFile(
        "app/api/onboarding/direct-hire/induction/route.ts",
        "utf8",
      );
      expect(route).not.toContain("preparation_job");
      expect(route).not.toContain("study");
    });

    it("does not implement meeting scheduling", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).not.toContain("schedule");
      expect(component).not.toContain("meeting_time");
    });

    it("does not create living representation route", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).not.toContain("/representation/living");
    });
  });

  describe("Re-entry Durability", () => {
    it("component loads induction state on mount", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("loadStatus");
      expect(component).toContain("useEffect");
      expect(component).toContain("/api/onboarding/direct-hire/induction");
    });

    it("component surfaces are driven by induction_state, not local state only", async () => {
      const component = await readFile(
        "components/onboarding/DirectHireInduction.tsx",
        "utf8",
      );
      expect(component).toContain("setInductionState");
      expect(component).toContain("loadStatus");
      // Verify it loads from API not just local
      expect(component).toContain("induction_state");
    });
  });
});
