"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { deriveMissionWorkflow } from "@/lib/mission/mission-workflow";
import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";
import type { Lead, LeadSummary, FitStatus } from "@/lib/leads/types";
import type { BriefContext } from "@/lib/mission/caller-brief";
import type { SalesAgent, MissionAssignment } from "@/lib/supabase/sales-agents";

interface Props {
  businessId: string;
  missionKey: string | null;
  missionDetail?: MissionDetail | null;
  callerBrief?: string | null;
  offer?: string | null;
  icp?: string | null;
  positioning?: string | null;
  objections?: string | null;
  salesArguments?: string | null;
  knownFacts?: string | null;
  assumptions?: string | null;
  validatedLearnings?: string | null;
  onMissionReadyChange?: (isReady: boolean) => void;
}

type LeadGroup = "likely" | "possible" | "weak";

const EASE = [0.22, 1, 0.36, 1] as const;

const FIT_DOT: Record<FitStatus, string> = {
  likely_match:   "bg-zeya-champagne/75",
  possible_match: "bg-zeya-mineral/65",
  weak_match:     "bg-zeya-graphite/55",
  unreviewed:     "bg-zeya-graphite/35",
};

const FIT_LABEL: Record<FitStatus, string> = {
  likely_match:   "Likely",
  possible_match: "Possible",
  weak_match:     "Weak",
  unreviewed:     "—",
};

interface LeadsByGroup {
  likely: Lead[];
  possible: Lead[];
  weak: Lead[];
}

export function MissionControl({
  businessId,
  missionKey,
  missionDetail,
  callerBrief,
  offer,
  icp,
  positioning,
  objections,
  salesArguments,
  knownFacts,
  assumptions,
  validatedLearnings,
  onMissionReadyChange,
}: Props) {
  const { session } = useAuth();

  const [leads, setLeads] = useState<Lead[]>([]);
  const [expandedGroup, setExpandedGroup] = useState<LeadGroup | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<Set<string>>(new Set());
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [showBrief, setShowBrief] = useState(false);
  const [salesAgents, setSalesAgents] = useState<SalesAgent[]>([]);
  const [assignment, setAssignment] = useState<MissionAssignment | null>(null);
  const [assigningBrief, setAssigningBrief] = useState(false);
  const [assignmentError, setAssignmentError] = useState<string | null>(null);

  // Derive lead summary from loaded leads
  const leadSummary: LeadSummary = {
    total: leads.length,
    likelyMatch: leads.filter((l) => l.fit_status === "likely_match").length,
    possibleMatch: leads.filter((l) => l.fit_status === "possible_match").length,
    weakMatch: leads.filter((l) => l.fit_status === "weak_match").length,
    selected: leads.filter((l) => l.status === "selected").length,
  };

  // Get assigned agent name
  const assignedAgentName = assignment
    ? salesAgents.find((a) => a.id === assignment.agent_id)?.name ?? null
    : null;

  // Derive mission workflow state
  const workflow = deriveMissionWorkflow(
    missionDetail ?? null,
    leadSummary,
    callerBrief ?? null,
    assignedAgentName
  );

  // Get selected leads
  const selectedLeads = leads.filter((l) => l.status === "selected");
  const selectedCompanies = selectedLeads
    .map((l) => l.company_name || l.contact_name)
    .filter(Boolean) as string[];

  // Fetch leads, agents, and assignments on mount and when missionKey changes
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({
          businessId,
          ...(missionKey && { missionKey }),
        });

        // Fetch leads
        const leadsRes = await fetch(`/api/zeya/mission-leads?${params}`, {
          headers: {
            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
          },
        });

        if (leadsRes.ok) {
          const data = await leadsRes.json();
          setLeads(data.leads ?? []);
        }

        // Fetch sales agents
        const agentsRes = await fetch(`/api/zeya/sales-agents?businessId=${businessId}`, {
          headers: {
            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
          },
        });

        if (agentsRes.ok) {
          const data = await agentsRes.json();
          setSalesAgents(data.agents ?? []);
        }

        // Fetch mission assignment (latest for this mission)
        if (missionKey) {
          const assignmentParams = new URLSearchParams({
            businessId,
            missionKey,
          });

          const assignmentRes = await fetch(`/api/zeya/mission-assignments?${assignmentParams}`, {
            headers: {
              ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
            },
          });

          if (assignmentRes.ok) {
            const data = await assignmentRes.json();
            const latest = data.assignments?.[0] ?? null;
            setAssignment(latest);
          }
        }
      } catch (err) {
        console.error("[Zeya] fetch data failed:", err);
      } finally {
        setLoading(false);
      }
    };

    void fetchData();
  }, [businessId, missionKey, session?.access_token]);

  // Group leads by fit_status
  const leadsByGroup: LeadsByGroup = {
    likely:   leads.filter((l) => l.fit_status === "likely_match"),
    possible: leads.filter((l) => l.fit_status === "possible_match"),
    weak:     leads.filter((l) => l.fit_status === "weak_match"),
  };

  const selectedCount = leads.filter((l) => l.status === "selected").length;

  // Update lead status
  const updateLeadStatus = useCallback(
    async (leadId: string, newStatus: "selected" | "rejected") => {
      setUpdating((prev) => new Set([...prev, leadId]));

      try {
        const res = await fetch(`/api/zeya/mission-leads/${leadId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
          },
          body: JSON.stringify({ status: newStatus }),
        });

        if (res.ok) {
          setLeads((prev) =>
            prev.map((l) => (l.id === leadId ? { ...l, status: newStatus } : l))
          );
        }
      } catch (err) {
        console.error("[Zeya] update lead failed:", err);
      } finally {
        setUpdating((prev) => {
          const next = new Set(prev);
          next.delete(leadId);
          return next;
        });
      }
    },
    [session?.access_token]
  );

  // Generate caller brief
  const generateBrief = useCallback(async () => {
    if (!missionDetail || selectedLeads.length === 0) return;
    setBriefError(null);
    setGeneratingBrief(true);

    try {
      const body: BriefContext = {
        missionName: missionDetail.name,
        targetSegment: missionDetail.target_segment,
        hypothesis: missionDetail.hypothesis,
        salesAngle: missionDetail.sales_angle,
        selectedLeadsCount: selectedLeads.length,
        selectedCompanies,
        offer: offer ?? null,
        icp: icp ?? null,
        positioning: positioning ?? null,
        objections: objections ?? null,
        salesArguments: salesArguments ?? null,
        knownFacts: knownFacts ?? null,
        assumptions: assumptions ?? null,
        validatedLearnings: validatedLearnings ?? null,
      };

      const res = await fetch("/api/zeya/caller-brief/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
        },
        body: JSON.stringify({ businessId, ...body }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || "Failed to generate brief");
      }

      setShowBrief(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Brief generation failed";
      setBriefError(message);
      console.error("[Zeya] generate brief failed:", err);
    } finally {
      setGeneratingBrief(false);
    }
  }, [businessId, missionDetail, selectedLeads, selectedCompanies, offer, icp, positioning, objections, salesArguments, knownFacts, assumptions, validatedLearnings, session?.access_token]);

  // Assign brief to a caller agent
  const assignBrief = useCallback(
    async (agentId: string) => {
      if (!missionKey) return;
      setAssignmentError(null);
      setAssigningBrief(true);

      try {
        const res = await fetch("/api/zeya/mission-assignments", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(session?.access_token && { Authorization: `Bearer ${session.access_token}` }),
          },
          body: JSON.stringify({
            businessId,
            missionKey,
            agentId,
            briefSnapshot: callerBrief,
            selectedLeadCount: selectedCount,
          }),
        });

        if (!res.ok) {
          const error = await res.json();
          throw new Error(error.error || "Failed to assign brief");
        }

        const data = await res.json();
        setAssignment(data.assignment);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Assignment failed";
        setAssignmentError(message);
        console.error("[Zeya] assign brief failed:", err);
      } finally {
        setAssigningBrief(false);
      }
    },
    [businessId, missionKey, callerBrief, selectedCount, session?.access_token]
  );

  // Calculate readiness
  const hasLeadsUploaded = leads.length > 0;
  const hasSelectedLeads = selectedCount > 0;

  // Notify parent of readiness change
  useEffect(() => {
    onMissionReadyChange?.(hasSelectedLeads);
  }, [hasSelectedLeads, onMissionReadyChange]);

  // Render workflow stage with clear step guidance
  if (loading && missionKey) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[0.72rem] font-light tracking-wide text-zeya-hush/42">
          Loading prospects…
        </p>
      </div>
    );
  }

  // Show workflow step and next step for all states
  if (workflow.stage !== "brief_prepared") {
    return (
      <div className="flex flex-col gap-4">
        {/* Current workflow step */}
        <div className="space-y-1.5">
          <p className="text-[0.65rem] font-light tracking-widest text-zeya-hush/35 uppercase">
            Current step
          </p>
          <p className="text-[0.8125rem] font-light tracking-wide text-zeya-ivory/75">
            {workflow.currentStep}
          </p>
        </div>

        {/* Next workflow step */}
        <div className="space-y-1.5">
          <p className="text-[0.65rem] font-light tracking-widest text-zeya-hush/35 uppercase">
            Next
          </p>
          <p className="text-[0.75rem] font-light leading-relaxed tracking-wide text-zeya-hush/55">
            {workflow.nextStep}
          </p>
        </div>

        {/* Lead management UI (only if prospects uploaded) */}
        {hasLeadsUploaded && (
          <>
            <div className="border-t border-zeya-graphite/18 pt-4">
              <div className="flex gap-2">
                {(["likely", "possible", "weak"] as LeadGroup[]).map((group) => {
                  const count = leadsByGroup[group].length;
                  if (count === 0) return null;

                  const fitStatus = group === "likely" ? "likely_match" : group === "possible" ? "possible_match" : "weak_match";
                  const label = FIT_LABEL[fitStatus];

                  return (
                    <motion.button
                      key={group}
                      onClick={() => setExpandedGroup(expandedGroup === group ? null : group)}
                      className={[
                        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.65rem] font-light tracking-wide transition-all duration-200",
                        expandedGroup === group
                          ? "border-zeya-champagne/28 bg-zeya-champagne/7 text-zeya-champagne/80"
                          : "border-zeya-graphite/28 text-zeya-hush/45 hover:border-zeya-graphite/42",
                      ].join(" ")}
                    >
                      <span className={["h-1.5 w-1.5 rounded-full", FIT_DOT[fitStatus]].join(" ")} />
                      {label} {count > 0 && <span className="opacity-60">({count})</span>}
                    </motion.button>
                  );
                })}
              </div>
            </div>

            {/* Lead list for expanded group */}
            <AnimatePresence mode="wait">
              {expandedGroup && (
                <motion.div
                  key={expandedGroup}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: EASE }}
                  className="flex flex-col gap-2 border-l-2 border-zeya-graphite/20 pl-3"
                >
                  {leadsByGroup[expandedGroup].map((lead) => (
                    <div
                      key={lead.id}
                      className="flex items-start gap-3 rounded-presence border border-zeya-graphite/22 bg-zeya-aubergine/30 px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.75rem] font-light tracking-wide text-zeya-ivory/78">
                          {lead.company_name ?? lead.contact_name ?? "(unnamed)"}
                        </p>
                        <p className="truncate text-[0.65rem] font-light tracking-wide text-zeya-hush/45">
                          {[lead.contact_name && lead.company_name ? lead.contact_name : null, lead.email, lead.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <button
                          onClick={() => void updateLeadStatus(lead.id, "selected")}
                          disabled={updating.has(lead.id) || lead.status === "selected"}
                          className={[
                            "px-2.5 py-1 rounded-presence text-[0.6rem] font-light tracking-wide transition-all duration-200",
                            lead.status === "selected"
                              ? "border border-zeya-champagne/22 bg-zeya-champagne/8 text-zeya-champagne/60 cursor-default"
                              : "border border-zeya-graphite/22 text-zeya-hush/45 hover:border-zeya-graphite/45 hover:text-zeya-hush/65 disabled:opacity-40",
                          ].join(" ")}
                        >
                          {updating.has(lead.id) ? "…" : lead.status === "selected" ? "Selected" : "Select"}
                        </button>
                        <button
                          onClick={() => void updateLeadStatus(lead.id, "rejected")}
                          disabled={updating.has(lead.id) || lead.status === "rejected"}
                          className={[
                            "px-2.5 py-1 rounded-presence text-[0.6rem] font-light tracking-wide transition-all duration-200",
                            lead.status === "rejected"
                              ? "border border-zeya-graphite/38 bg-zeya-graphite/8 text-zeya-hush/35 cursor-default"
                              : "border border-zeya-graphite/22 text-zeya-hush/35 hover:border-zeya-graphite/42 hover:text-zeya-hush/55 disabled:opacity-40",
                          ].join(" ")}
                        >
                          {updating.has(lead.id) ? "…" : lead.status === "rejected" ? "Rejected" : "Reject"}
                        </button>
                      </div>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Readiness status */}
            <div className="border-t border-zeya-graphite/18 pt-3 space-y-3">
              <div className="space-y-1.5 text-[0.65rem] font-light tracking-wide text-zeya-hush/48">
                <div className="flex items-center gap-2">
                  <span
                    className={["h-1 w-1 rounded-full", hasLeadsUploaded ? "bg-zeya-champagne/50" : "bg-zeya-graphite/35"].join(" ")}
                  />
                  <span>Prospects uploaded</span>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={["h-1 w-1 rounded-full", hasSelectedLeads ? "bg-zeya-champagne/50" : "bg-zeya-graphite/35"].join(" ")}
                  />
                  <span>
                    {selectedCount} / {leads.length} selected
                  </span>
                </div>
              </div>

              {/* Prepare caller brief button */}
              {hasSelectedLeads && (
                <motion.button
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  onClick={() => void generateBrief()}
                  disabled={generatingBrief || !!callerBrief}
                  className={[
                    "w-full rounded-presence border px-3 py-2 text-[0.7rem] font-light tracking-wide transition-all duration-200",
                    callerBrief
                      ? "border-zeya-champagne/22 bg-zeya-champagne/8 text-zeya-champagne/60 cursor-default"
                      : "border-zeya-graphite/28 text-zeya-hush/48 hover:border-zeya-graphite/45 hover:text-zeya-hush/65 disabled:opacity-40",
                  ].join(" ")}
                >
                  {generatingBrief ? "Preparing…" : callerBrief ? "Brief Ready" : "Prepare Caller Brief"}
                </motion.button>
              )}

              {briefError && (
                <p className="text-[0.65rem] font-light tracking-wide text-zeya-hush/35">
                  Error: {briefError}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    );
  }

  // Brief prepared state
  if (workflow.stage === "brief_prepared") {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-[0.72rem] font-light tracking-wide text-zeya-champagne/55">
            Caller brief prepared.
          </p>
          <p className="text-[0.65rem] font-light tracking-wide text-zeya-hush/42 mt-1">
            {workflow.nextStep}
          </p>
        </div>

        {/* Assign to caller agent */}
        {salesAgents.length > 0 && (
          <div className="space-y-2 border-t border-zeya-graphite/18 pt-3">
            <p className="text-[0.65rem] font-light tracking-widest text-zeya-hush/35 uppercase">
              Available Callers
            </p>
            <div className="space-y-1.5">
              {salesAgents.map((agent) => (
                <motion.button
                  key={agent.id}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => void assignBrief(agent.id)}
                  disabled={assigningBrief}
                  className={[
                    "w-full rounded-presence border px-3 py-2 text-[0.7rem] font-light tracking-wide transition-all duration-200 text-left",
                    "border-zeya-graphite/28 text-zeya-hush/55 hover:border-zeya-graphite/45 hover:text-zeya-hush/75 disabled:opacity-40",
                  ].join(" ")}
                >
                  <span className="font-light">{agent.name}</span>
                  {agent.status !== "available" && (
                    <span className="text-[0.6rem] text-zeya-hush/35 ml-2">({agent.status})</span>
                  )}
                </motion.button>
              ))}
            </div>
            {assignmentError && (
              <p className="text-[0.65rem] font-light tracking-wide text-zeya-hush/35">
                Error: {assignmentError}
              </p>
            )}
          </div>
        )}
      </div>
    );
  }

  // Assigned state
  if (workflow.stage === "assigned_waiting_execution") {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-[0.72rem] font-light tracking-wide text-zeya-champagne/55">
          {workflow.currentStep}
        </p>
        <p className="text-[0.65rem] font-light tracking-wide text-zeya-hush/42">
          {workflow.nextStep}
        </p>
      </div>
    );
  }
}
