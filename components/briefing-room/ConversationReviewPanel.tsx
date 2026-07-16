"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { allowedPromotionTargets, effectiveReviewState, type PromotionTarget, type ReviewConversation, type ReviewDecision } from "@/lib/voice/conversation-review/types";

const trustLabel = { provider_attested: "Provider-attested", authenticated_client_relay: "Authenticated client relay", status_only: "Status only" } as const;
const decisions: Array<{ value: Exclude<ReviewDecision, "accepted_for_promotion">; label: string }> = [
  { value: "deferred", label: "Defer" }, { value: "rejected", label: "Reject" },
  { value: "duplicate", label: "Mark duplicate" }, { value: "acknowledged", label: "Acknowledge" },
];

export function ConversationReviewPanel({ businessId, session }: { businessId: string; session: Session | null }) {
  const [items, setItems] = useState<ReviewConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stateFilter, setStateFilter] = useState("unresolved");
  const [typeFilter, setTypeFilter] = useState("all");
  const [agentFilter, setAgentFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyCandidate, setBusyCandidate] = useState<string | null>(null);

  async function load() {
    if (!session?.access_token) return;
    setLoading(true); setError(null);
    try {
      const response = await fetch(`/api/voice/conversation-review?businessId=${encodeURIComponent(businessId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const body = await response.json() as { success: boolean; data?: ReviewConversation[]; error?: string };
      if (!response.ok || !body.data) throw new Error(body.error ?? "Unable to load conversations");
      const conversations = body.data;
      setItems(conversations); setSelectedId((current) => current ?? conversations[0]?.id ?? null);
    } catch { setError("Conversation intelligence could not be loaded."); }
    finally { setLoading(false); }
  }
  // Loading is an external HTTP synchronization keyed by tenant and session.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [businessId, session?.access_token]);

  const selected = items.find((item) => item.id === selectedId) ?? null;
  const visibleCandidates = useMemo(() => (selected?.candidates ?? []).filter((candidate) => {
    const state = effectiveReviewState(candidate);
    return (stateFilter === "all" || (stateFilter === "unresolved" ? ["pending_review", "deferred"].includes(state) : state === stateFilter))
      && (typeFilter === "all" || candidate.candidateType === typeFilter);
  }), [selected, stateFilter, typeFilter]);
  const conversations = items.filter((item) => agentFilter === "all" || item.agentType.toLowerCase() === agentFilter);

  async function act(candidateId: string, payload: Record<string, unknown>) {
    if (!session?.access_token) return;
    setBusyCandidate(candidateId); setError(null);
    try {
      const response = await fetch("/api/voice/conversation-review", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ candidateId, requestKey: crypto.randomUUID(), ...payload }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error ?? "Review action failed");
      await load();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review action failed"); }
    finally { setBusyCandidate(null); }
  }

  if (loading) return <section aria-label="Conversation review" className="border-t border-zeya-graphite/14 py-6 text-sm text-zeya-hush/55">Zeya is gathering conversation intelligence…</section>;
  return (
    <section aria-label="Conversation review" className="w-full border-t border-zeya-graphite/14 py-6">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div><p className="text-[0.55rem] uppercase tracking-[0.24em] text-zeya-hush/42">Conversation intelligence</p><h2 className="mt-1 text-lg font-light text-zeya-ivory/88">What deserves your attention</h2></div>
        <span className="text-xs text-zeya-champagne/70">{items.flatMap((item) => item.candidates).filter((c) => ["pending_review", "deferred"].includes(effectiveReviewState(c))).length} unresolved</span>
      </div>
      {error && <div role="alert" className="mb-4 rounded-lg border border-red-300/20 p-3 text-xs text-red-200/80">{error} <button onClick={() => void load()} className="underline">Try again</button></div>}
      <div className="mb-4 flex flex-wrap gap-2">
        <select aria-label="Filter agent" value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="rounded-lg bg-zeya-aubergine px-3 py-2 text-xs text-zeya-hush"><option value="all">All agents</option><option value="zeya">Zeya</option><option value="veya">Veya</option></select>
        <select aria-label="Filter review state" value={stateFilter} onChange={(e) => setStateFilter(e.target.value)} className="rounded-lg bg-zeya-aubergine px-3 py-2 text-xs text-zeya-hush"><option value="unresolved">Unresolved</option><option value="all">All states</option><option value="accepted_for_promotion">Promoted</option><option value="rejected">Rejected</option></select>
        <select aria-label="Filter candidate type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="rounded-lg bg-zeya-aubergine px-3 py-2 text-xs text-zeya-hush"><option value="all">All types</option>{Array.from(new Set(items.flatMap((item) => item.candidates.map((c) => c.candidateType)))).map((type) => <option key={type}>{type}</option>)}</select>
      </div>
      {conversations.length === 0 ? <p className="py-8 text-center text-sm text-zeya-hush/45">No captured conversations are ready for review.</p> : (
        <div className="grid gap-5 md:grid-cols-[13rem_1fr]">
          <nav aria-label="Conversations" className="space-y-2">{conversations.map((item) => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl border p-3 text-left ${selectedId === item.id ? "border-zeya-champagne/35 bg-zeya-champagne/5" : "border-zeya-graphite/25"}`}><span className="block text-sm text-zeya-ivory/80">{item.agentType} · {item.channel.replaceAll("_", " ")}</span><span className="mt-1 block text-[0.65rem] text-zeya-hush/48">{item.completedAt ? new Date(item.completedAt).toLocaleDateString() : "In progress"} · {item.candidates.length} candidates</span><span className="mt-2 block text-[0.62rem] text-zeya-champagne/60">{trustLabel[item.trustLevel]}</span></button>)}</nav>
          {selected && <div><div className="mb-4 rounded-xl border border-zeya-graphite/20 p-4"><div className="flex justify-between gap-4"><span className="text-sm text-zeya-ivory/80">Conversation briefing</span><span className="text-xs text-zeya-hush/50">Canonical context {selected.canonicalVersionId.slice(0, 8)}</span></div><p className="mt-2 text-xs leading-relaxed text-zeya-hush/58">{trustLabel[selected.trustLevel]}. Review is required before anything enters the Representation pipeline.</p><details className="mt-3"><summary className="cursor-pointer text-xs text-zeya-champagne/65">View safe transcript</summary><div className="mt-3 max-h-52 space-y-2 overflow-auto">{selected.transcript.map((turn, index) => <p key={index} className="text-xs text-zeya-hush/60"><span className="text-zeya-ivory/65">{turn.role}:</span> {turn.text}</p>)}</div></details></div>
            <div className="space-y-3">{visibleCandidates.map((candidate) => <CandidateCard key={candidate.id} candidate={candidate} busy={busyCandidate === candidate.id} onDecision={(decision, reason) => void act(candidate.id, { action: "review", decision, reason })} onPromote={(targetType, statement, reason, relatedElement) => void act(candidate.id, { action: "promote", targetType, statement, reason, relatedElementId: relatedElement?.id, elementKey: relatedElement?.key, evidenceSourceType: "conversation" })} />)}{visibleCandidates.length === 0 && <p className="py-8 text-center text-sm text-zeya-hush/45">Nothing matches these review filters.</p>}</div>
          </div>}
        </div>
      )}
    </section>
  );
}

function CandidateCard({ candidate, busy, onDecision, onPromote }: { candidate: ReviewConversation["candidates"][number]; busy: boolean; onDecision: (decision: Exclude<ReviewDecision, "accepted_for_promotion">, reason?: string) => void; onPromote: (target: PromotionTarget, statement: string, reason: string | undefined, relatedElement?: { id: string; key: string }) => void }) {
  const [promoting, setPromoting] = useState<PromotionTarget | null>(null);
  const [statement, setStatement] = useState(String(candidate.content.summary ?? ""));
  const [reason, setReason] = useState("");
  const [relatedElementId, setRelatedElementId] = useState(candidate.relatedElements[0]?.id ?? "");
  const evidenceEligible = candidate.trustLevel === "provider_attested" && !["zeya", "veya", "unknown"].includes(candidate.speakerRole);
  const targets = allowedPromotionTargets(candidate.candidateType).filter((target) => target !== "evidence" || evidenceEligible);
  const state = effectiveReviewState(candidate);
  const terminal = !["pending_review", "deferred"].includes(state);
  return <article className="rounded-xl border border-zeya-graphite/25 p-4"><div className="flex flex-wrap justify-between gap-2"><span className="text-xs uppercase tracking-wider text-zeya-champagne/65">{candidate.candidateType.replaceAll("_", " ")}</span><span className="text-xs text-zeya-hush/45">{Math.round(candidate.confidence * 100)}% · {state.replaceAll("_", " ")}</span></div><p className="mt-3 text-sm leading-relaxed text-zeya-ivory/82">{String(candidate.content.summary ?? "Candidate intelligence")}</p><p className="mt-2 text-xs text-zeya-hush/48">{candidate.rationale}</p><p className="mt-2 text-[0.65rem] text-zeya-hush/40">Said by {candidate.speakerRole} · {trustLabel[candidate.trustLevel]} · turn {(candidate.sourceReference.turnIndexes?.[0] ?? 0) + 1}</p>
    {!terminal && <><label className="mt-4 block text-xs text-zeya-hush/60">Optional review reason<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} className="mt-2 w-full rounded-lg bg-zeya-void/35 p-2 text-sm text-zeya-ivory/80" /></label><div className="mt-3 flex flex-wrap gap-2">{decisions.map(({ value, label }) => <button disabled={busy} key={value} onClick={() => onDecision(value, reason.trim() || undefined)} className="rounded-lg border border-zeya-graphite/35 px-2.5 py-1.5 text-xs text-zeya-hush/65 disabled:opacity-40">{label}</button>)}{targets.map((target) => <button disabled={busy || (target === "representation_proposal" && candidate.relatedElements.length === 0)} key={target} onClick={() => setPromoting(target)} className="rounded-lg border border-zeya-champagne/25 bg-zeya-champagne/5 px-2.5 py-1.5 text-xs text-zeya-champagne/75 disabled:opacity-40">Promote to {target.replaceAll("_", " ")}</button>)}</div>{candidate.candidateType === "candidate_evidence" && !evidenceEligible && <p className="mt-2 text-[0.65rem] text-zeya-hush/45">Evidence requires a provider-attested human transcript source.</p>}</>}
    {promoting && <div className="mt-4 rounded-lg border border-zeya-champagne/20 p-3"><label className="text-xs text-zeya-hush/60">Confirm the exact wording entering the review pipeline<textarea value={statement} onChange={(e) => setStatement(e.target.value)} className="mt-2 min-h-20 w-full rounded-lg bg-zeya-void/35 p-3 text-sm text-zeya-ivory/80" /></label>{promoting === "representation_proposal" && <label className="mt-3 block text-xs text-zeya-hush/60">Related Representation Element<select value={relatedElementId} onChange={(e) => setRelatedElementId(e.target.value)} className="mt-2 w-full rounded-lg bg-zeya-aubergine p-2 text-zeya-ivory/80">{candidate.relatedElements.map((element) => <option key={element.id} value={element.id}>{element.key}</option>)}</select></label>}<p className="mt-2 text-[0.65rem] text-zeya-hush/45">This creates a pre-canonical input. It does not approve or change canonical truth.</p><div className="mt-3 flex gap-2"><button disabled={!statement.trim() || busy || (promoting === "representation_proposal" && !relatedElementId)} onClick={() => onPromote(promoting, statement, reason.trim() || undefined, candidate.relatedElements.find((element) => element.id === relatedElementId))} className="rounded-lg bg-zeya-champagne/10 px-3 py-2 text-xs text-zeya-champagne disabled:opacity-40">Confirm promotion</button><button onClick={() => setPromoting(null)} className="px-3 py-2 text-xs text-zeya-hush/55">Cancel</button></div></div>}
  </article>;
}
