import { ACADEMY_OPERATIONAL_CONCEPTS, ACADEMY_PROFILE } from "@/lib/testing/fixtures/academy";

export type OperationalConceptPhase =
  | "empty_workspace"
  | "document_upload"
  | "connectors"
  | "lead_list"
  | "agent_activity"
  | "daily_brief";

const COPY: Record<OperationalConceptPhase, { title: string; description: string }> = {
  empty_workspace: { title: "Workspace", description: "No operational work has been delegated yet." },
  document_upload: { title: "Sources", description: "Candidate documents awaiting review and ingestion." },
  connectors: { title: "Connectors", description: "Possible source connections and their illustrative health." },
  lead_list: { title: "Lead sources", description: "Example prospects for testing information hierarchy only." },
  agent_activity: { title: "Specialist activity", description: "A possible view of delegated work and approval boundaries." },
  daily_brief: { title: "Daily brief", description: "A possible reporting surface for priorities, confidence, and approvals." },
};

export function OperationalConceptView({ phase }: { phase: OperationalConceptPhase }) {
  const copy = COPY[phase];
  return (
    <div className="min-h-screen bg-zeya-void px-5 py-24 text-zeya-ivory">
      <div className="mx-auto max-w-3xl space-y-8">
        <div className="rounded border border-amber-300/45 bg-amber-300/10 px-4 py-3 text-xs font-semibold tracking-[0.16em] text-amber-200">
          CONCEPT — NOT YET OPERATIONAL
        </div>
        <header><p className="text-xs uppercase tracking-[0.2em] text-zeya-champagne">{ACADEMY_PROFILE.businessName}</p><h1 className="mt-3 font-serif text-4xl">{copy.title}</h1><p className="mt-3 max-w-xl text-sm leading-6 text-zeya-hush/65">{copy.description}</p></header>
        {phase === "empty_workspace" && <div className="rounded-presence border border-zeya-graphite/40 p-8 text-center text-zeya-hush/55">No missions, sources, or approvals to show.</div>}
        {phase === "document_upload" && <div className="grid gap-3 sm:grid-cols-2">{ACADEMY_OPERATIONAL_CONCEPTS.documents.map((document) => <div key={document.id} className="rounded-presence border border-zeya-graphite/40 p-4"><p>{document.name}</p><p className="mt-2 text-xs uppercase text-zeya-hush/45">{document.state}</p></div>)}</div>}
        {phase === "connectors" && <div className="grid gap-3 sm:grid-cols-2">{ACADEMY_OPERATIONAL_CONCEPTS.connectors.map((connector) => <div key={connector.id} className="rounded-presence border border-zeya-graphite/40 p-4"><p>{connector.name}</p><p className="mt-2 text-xs uppercase text-zeya-hush/45">{connector.state}</p></div>)}</div>}
        {phase === "lead_list" && <div className="overflow-hidden rounded-presence border border-zeya-graphite/40">{ACADEMY_OPERATIONAL_CONCEPTS.leads.map((lead) => <div key={lead.id} className="flex items-center justify-between border-b border-zeya-graphite/30 p-4 last:border-0"><div><p>{lead.company}</p><p className="text-xs text-zeya-hush/45">{lead.source}</p></div><p className="text-xs text-zeya-champagne">{lead.fit}</p></div>)}</div>}
        {phase === "agent_activity" && <div className="rounded-presence border border-zeya-graphite/40 p-5"><p className="text-sm">Research specialist</p><p className="mt-2 text-zeya-hush/55">Drafting a small-business AI readiness research brief. No outreach authority granted.</p><div className="mt-4 rounded bg-zeya-aubergine/50 p-3 text-xs text-amber-200">Approval required before external action</div></div>}
        {phase === "daily_brief" && <div className="space-y-3 rounded-presence border border-zeya-graphite/40 p-5"><p>Today</p><p className="text-sm leading-6 text-zeya-hush/60">Review the Academy’s trust evidence before preparing its first partner outreach brief.</p><p className="text-sm leading-6 text-zeya-hush/60">Representation confidence: 82%. Objection evidence remains the priority gap.</p></div>}
      </div>
    </div>
  );
}
