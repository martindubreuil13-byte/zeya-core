"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { ExperienceScreen } from "@/app/experience/page";
import { FormationWorkflow, type UIState } from "@/components/formation/FormationWorkflow";
import { LivingRepresentationView, type LivingRepresentationState } from "@/components/representation/LivingRepresentationView";
import { OperationalConceptView, type OperationalConceptPhase } from "@/components/testing/OperationalConceptView";
import { ACADEMY_FORMATION_SUMMARY, ACADEMY_IDS, ACADEMY_LIVING_REPRESENTATION } from "@/lib/testing/fixtures/academy";
import {
  EXPERIENCE_SCREEN_LAB_PHASES,
  experienceScreenLabState,
  type ExperienceScreenLabPhase,
} from "@/lib/experience/screen-lab";

export function ExperienceScreenLab() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [phase, setPhase] = useState<ExperienceScreenLabPhase>("initial_owner");
  const [surface, setSurface] = useState<"experience" | "formation" | "representation" | "operations">("experience");
  const [formationPhase, setFormationPhase] = useState<UIState>("entry");
  const [representationPhase, setRepresentationPhase] = useState<LivingRepresentationState>("loaded");
  const [operationalPhase, setOperationalPhase] = useState<OperationalConceptPhase>("empty_workspace");

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login?next=%2Fexperience%2Fscreen-lab");
    }
  }, [loading, router, user]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zeya-void text-zeya-taupe">
        <p className="text-sm">Authenticating Preview Screen Lab…</p>
      </main>
    );
  }

  const state = experienceScreenLabState(phase);
  const selectors = {
    formation: [
      ["entry", "Entry"], ["getting_familiar", "Getting familiar"], ["conversation_ready", "Working conversation pending"],
      ["conversation_active", "Conversation active"], ["processing", "Processing"], ["summary_review", "Summary review"],
      ["correction_entry", "Correction"], ["approval_confirmation", "Approval"], ["version_created", "Version created"],
    ] as const,
    representation: [
      ["loading", "Loading"], ["loaded", "Canonical Representation"], ["no_business", "No business"],
      ["no_representation", "No Representation"], ["no_version", "No canonical Version"],
      ["multiple_businesses", "Multiple businesses"], ["error", "Load error"],
    ] as const,
    operations: [
      ["empty_workspace", "Empty workspace"], ["document_upload", "Document upload"], ["connectors", "Connectors"],
      ["lead_list", "Lead list"], ["agent_activity", "Agent activity"], ["daily_brief", "Daily brief"],
    ] as const,
  };

  return (
    <main className="relative min-h-screen bg-zeya-void">
      <div className="fixed inset-x-0 top-0 z-50 border-b border-amber-300/40 bg-amber-300 px-3 py-2 text-slate-950 shadow-lg">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-bold tracking-[0.12em] sm:text-sm">
            PREVIEW SCREEN LAB — NO DATA WILL BE SAVED
          </p>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <label className="flex items-center gap-2"><span>Surface</span><select aria-label="Screen Lab surface" value={surface} onChange={(event) => setSurface(event.target.value as typeof surface)} className="rounded border border-slate-700 bg-white px-2 py-1 text-xs text-slate-950"><option value="experience">Experience</option><option value="formation">Formation</option><option value="representation">Living Representation</option><option value="operations">Operational concepts</option></select></label>
          {surface === "experience" && <label className="flex items-center gap-2 text-xs font-semibold">
            <span>Screen</span>
            <select
              aria-label="Experience screen phase"
              value={phase}
              onChange={(event) => setPhase(event.target.value as ExperienceScreenLabPhase)}
              className="max-w-[15rem] rounded border border-slate-700 bg-white px-2 py-1 text-xs text-slate-950 sm:max-w-none"
            >
              {EXPERIENCE_SCREEN_LAB_PHASES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>}
          {surface === "formation" && <label className="flex items-center gap-2"><span>Screen</span><select aria-label="Formation phase" value={formationPhase} onChange={(event) => setFormationPhase(event.target.value as UIState)} className="rounded border border-slate-700 bg-white px-2 py-1 text-xs text-slate-950">{selectors.formation.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {surface === "representation" && <label className="flex items-center gap-2"><span>Screen</span><select aria-label="Representation phase" value={representationPhase} onChange={(event) => setRepresentationPhase(event.target.value as LivingRepresentationState)} className="rounded border border-slate-700 bg-white px-2 py-1 text-xs text-slate-950">{selectors.representation.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          {surface === "operations" && <label className="flex items-center gap-2"><span>Screen</span><select aria-label="Operational concept" value={operationalPhase} onChange={(event) => setOperationalPhase(event.target.value as OperationalConceptPhase)} className="rounded border border-slate-700 bg-white px-2 py-1 text-xs text-slate-950">{selectors.operations.map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
          </div>
        </div>
      </div>

      <div className="fixed right-3 top-14 z-50 rounded bg-slate-950/90 px-3 py-1.5 text-[0.65rem] font-semibold uppercase tracking-wider text-amber-200">
        Screen actions disabled
      </div>

      <div
        key={`${surface}:${phase}:${formationPhase}:${representationPhase}:${operationalPhase}`}
        aria-label="Inert Experience screen preview"
        aria-disabled="true"
        className="pointer-events-none pt-10 [&_button]:cursor-not-allowed [&_button]:opacity-50 [&_input]:cursor-not-allowed [&_input]:opacity-70 [&_textarea]:cursor-not-allowed [&_textarea]:opacity-70"
      >
        {surface === "experience" && <ExperienceScreen screenLab={state} />}
        {surface === "formation" && <div className="min-h-screen bg-slate-50 pt-12"><FormationWorkflow sessionId={ACADEMY_IDS.formation} screenLab={{ uiState: formationPhase, summary: ACADEMY_FORMATION_SUMMARY, versionId: formationPhase === "version_created" ? ACADEMY_IDS.version : null }} /></div>}
        {surface === "representation" && <LivingRepresentationView state={representationPhase} data={representationPhase === "loaded" ? ACADEMY_LIVING_REPRESENTATION : null} error={representationPhase === "error" ? "The Representation could not be loaded." : representationPhase === "no_business" ? "No business found. Please complete onboarding first." : representationPhase === "multiple_businesses" ? "Multiple businesses found. Business selection coming soon." : representationPhase === "no_version" ? "No canonical version exists yet." : representationPhase === "no_representation" ? "No representation found." : null} actionsDisabled />}
        {surface === "operations" && <OperationalConceptView phase={operationalPhase} />}
      </div>
    </main>
  );
}
