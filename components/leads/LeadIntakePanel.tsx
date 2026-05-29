"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { classifyLeadFit } from "@/lib/leads/classify-lead-fit";
import { parseCSV, parsePastedText } from "@/lib/leads/parse-leads";
import type { ClassifiedLead, FitStatus, Lead, LeadInput, LeadSummary } from "@/lib/leads/types";
import type { MissionDetail } from "@/lib/briefing-room/briefing-room-data";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Props {
  businessId: string;
  missionDetail: MissionDetail | null;
  businessIcp: string | null;
  onClose: () => void;
  onImported: (summary: LeadSummary) => void;
}

type Tab = "paste" | "csv" | "manual";
type ViewState = "intake" | "review" | "done";

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

// ─── Manual form default ──────────────────────────────────────────────────────

const EMPTY_MANUAL: LeadInput = {
  company_name: "",
  contact_name: "",
  email:        "",
  phone:        "",
  website:      "",
  industry:     "",
  city:         "",
  country:      "",
  notes:        "",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function LeadIntakePanel({ businessId, missionDetail, businessIcp, onClose, onImported }: Props) {
  const { session } = useAuth();

  const [tab, setTab]             = useState<Tab>("paste");
  const [view, setView]           = useState<ViewState>("intake");
  const [pasteText, setPasteText] = useState("");
  const [manualLead, setManualLead] = useState<LeadInput>({ ...EMPTY_MANUAL });
  const [parsed, setParsed]       = useState<ClassifiedLead[]>([]);
  const [filterFit, setFilterFit] = useState<FitStatus | "all">("all");
  const [loading, setLoading]     = useState(false);
  const [importResult, setImportResult] = useState<{ imported: number; likelyMatch: number; possibleMatch: number; weakMatch: number } | null>(null);
  const [savedLeads, setSavedLeads] = useState<ClassifiedLead[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Classification helper ───────────────────────────────────────────────────

  function classify(leads: LeadInput[]): ClassifiedLead[] {
    return leads
      .filter((l) => Object.values(l).some(Boolean))
      .map((l) => ({ ...l, fit_status: classifyLeadFit(l, missionDetail, businessIcp) }));
  }

  // ── Parse handlers ──────────────────────────────────────────────────────────

  function handleParsePaste() {
    const leads = parsePastedText(pasteText);
    const classified = classify(leads);
    if (classified.length === 0) return;
    setParsed(classified);
    setView("review");
  }

  function handleCSVFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const leads = parseCSV(text);
      const classified = classify(leads);
      if (classified.length === 0) return;
      setParsed(classified);
      setView("review");
    };
    reader.readAsText(file);
  }

  function handleManualAdd() {
    const lead = { ...manualLead };
    if (!Object.values(lead).some((v) => v?.trim())) return;
    const classified = classify([lead]);
    setParsed(classified);
    setView("review");
    setManualLead({ ...EMPTY_MANUAL });
  }

  // ── Import ───────────────────────────────────────────────────────────────────

  const handleImport = useCallback(async () => {
    if (loading || parsed.length === 0) return;
    setLoading(true);

    const source: "paste" | "csv" | "manual" = tab === "paste" ? "paste" : tab === "csv" ? "csv" : "manual";

    try {
      const res = await fetch("/api/zeya/mission-leads/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          businessId,
          missionKey: missionDetail?.name ?? null,
          leads: parsed,
          source,
        }),
      });

      if (!res.ok) throw new Error("Import failed");

      const result = await res.json() as { imported: number; likelyMatch: number; possibleMatch: number; weakMatch: number };
      setImportResult(result);
      setSavedLeads(parsed);
      setView("done");

      onImported({
        total:         result.imported,
        likelyMatch:   result.likelyMatch,
        possibleMatch: result.possibleMatch,
        weakMatch:     result.weakMatch,
        selected:      0,
      });
    } catch (err) {
      console.error("[Zeya] import failed:", err);
    } finally {
      setLoading(false);
    }
  }, [loading, parsed, tab, session, businessId, missionDetail, onImported]);

  // ── Lead status toggle ───────────────────────────────────────────────────────

  async function toggleLeadStatus(leadId: string, currentStatus: string) {
    const next = currentStatus === "selected" ? "new" : "selected";
    try {
      await fetch(`/api/zeya/mission-leads/${leadId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ status: next }),
      });
    } catch { /* silent */ }
  }

  // ── Visible leads ────────────────────────────────────────────────────────────

  const visibleLeads =
    filterFit === "all" ? parsed : parsed.filter((l) => l.fit_status === filterFit);

  const countByFit = (f: FitStatus) => parsed.filter((l) => l.fit_status === f).length;

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <>
      {/* Backdrop */}
      <motion.div
        key="lead-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        className="fixed inset-0 z-40 bg-zeya-void/52 backdrop-blur-[2px]"
        onClick={onClose}
      />

      {/* Panel */}
      <motion.div
        key="lead-panel"
        initial={{ opacity: 0, y: 32, filter: "blur(12px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, y: 20, filter: "blur(10px)" }}
        transition={{ duration: 0.38, ease: EASE }}
        className={[
          "fixed z-50 flex flex-col overflow-hidden",
          "inset-x-3 bottom-3 max-h-[82vh] rounded-[1.5rem]",
          "sm:inset-x-6 sm:bottom-6 sm:max-h-[78vh]",
          "border border-zeya-graphite/35 bg-zeya-aubergine/96 shadow-presence backdrop-blur-sm",
        ].join(" ")}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zeya-graphite/20 px-5 py-4">
          <div>
            <p className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/86">
              Add prospects
            </p>
            {missionDetail && (
              <p className="mt-0.5 text-[0.7rem] font-light tracking-wide text-zeya-hush/42">
                {missionDetail.name}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-sm leading-none text-zeya-hush/35 transition-colors hover:text-zeya-hush/62"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
          <AnimatePresence mode="wait">

            {/* ── Intake view ──────────────────────────────────────────────── */}
            {view === "intake" && (
              <motion.div
                key="intake"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                {/* Tabs */}
                <div className="flex border-b border-zeya-graphite/18 px-5">
                  {(["paste", "csv", "manual"] as Tab[]).map((t) => (
                    <button
                      key={t}
                      onClick={() => setTab(t)}
                      className={[
                        "mr-5 py-3 text-[0.72rem] font-light tracking-wide transition-colors duration-200",
                        tab === t
                          ? "border-b border-zeya-champagne/45 text-zeya-champagne/82 -mb-px"
                          : "text-zeya-hush/40 hover:text-zeya-hush/62",
                      ].join(" ")}
                    >
                      {t === "paste" ? "Paste" : t === "csv" ? "CSV" : "Manual"}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="px-5 py-5">
                  {tab === "paste" && (
                    <div className="space-y-4">
                      <p className="text-[0.75rem] font-light leading-relaxed text-zeya-hush/48">
                        Paste any list — company names, emails, URLs, or mixed CRM export.
                        One entry per line works. CSV format also detected automatically.
                      </p>
                      <textarea
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder={"Acme SEO Agency · john@acme.com\nBright Digital · +1 555 0123\nWebflow Studio"}
                        rows={8}
                        className="w-full resize-none rounded-presence border border-zeya-graphite/35 bg-zeya-aubergine/40 px-3.5 py-3 text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-ivory/80 placeholder:text-zeya-hush/22 focus:border-zeya-graphite/55 focus:outline-none"
                        style={{ scrollbarWidth: "none" }}
                      />
                      <button
                        onClick={handleParsePaste}
                        disabled={!pasteText.trim()}
                        className="rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 px-5 py-2.5 text-[0.8125rem] font-light tracking-wide text-zeya-champagne transition-all duration-200 hover:bg-zeya-champagne/14 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Parse and classify
                      </button>
                    </div>
                  )}

                  {tab === "csv" && (
                    <div className="space-y-4">
                      <p className="text-[0.75rem] font-light leading-relaxed text-zeya-hush/48">
                        Upload a CSV file. Column headers are mapped automatically — common names like
                        company, name, email, phone, website, industry, city, country are recognised.
                      </p>
                      <div
                        className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-presence border border-dashed border-zeya-graphite/40 px-6 py-10 transition-colors hover:border-zeya-graphite/62"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <p className="text-[0.8125rem] font-light tracking-wide text-zeya-hush/45">
                          Click to select a CSV file
                        </p>
                        <p className="text-[0.68rem] font-light tracking-wide text-zeya-hush/28">
                          .csv · tab-separated also works
                        </p>
                      </div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.txt,.tsv"
                        onChange={handleCSVFile}
                        className="hidden"
                      />
                    </div>
                  )}

                  {tab === "manual" && (
                    <div className="space-y-3">
                      <p className="text-[0.75rem] font-light tracking-wide text-zeya-hush/45">
                        Add one contact at a time.
                      </p>
                      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                        {(
                          [
                            ["company_name", "Company name"],
                            ["contact_name", "Contact name"],
                            ["email",        "Email"],
                            ["phone",        "Phone"],
                            ["website",      "Website"],
                            ["industry",     "Industry"],
                            ["city",         "City"],
                            ["country",      "Country"],
                          ] as [keyof LeadInput, string][]
                        ).map(([field, label]) => (
                          <div key={field}>
                            <label className="mb-1 block text-[0.65rem] font-light tracking-widest text-zeya-hush/35 uppercase">
                              {label}
                            </label>
                            <input
                              type="text"
                              value={String(manualLead[field] ?? "")}
                              onChange={(e) => setManualLead((prev) => ({ ...prev, [field]: e.target.value }))}
                              className="w-full rounded-sm border border-zeya-graphite/35 bg-zeya-aubergine/40 px-3 py-2 text-[0.8125rem] font-light tracking-wide text-zeya-ivory/80 placeholder:text-zeya-hush/20 focus:border-zeya-graphite/55 focus:outline-none"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="mb-1 block text-[0.65rem] font-light tracking-widest text-zeya-hush/35 uppercase">
                          Notes
                        </label>
                        <textarea
                          value={String(manualLead.notes ?? "")}
                          onChange={(e) => setManualLead((prev) => ({ ...prev, notes: e.target.value }))}
                          rows={2}
                          className="w-full resize-none rounded-sm border border-zeya-graphite/35 bg-zeya-aubergine/40 px-3 py-2 text-[0.8125rem] font-light tracking-wide text-zeya-ivory/80 placeholder:text-zeya-hush/20 focus:border-zeya-graphite/55 focus:outline-none"
                          style={{ scrollbarWidth: "none" }}
                        />
                      </div>
                      <button
                        onClick={handleManualAdd}
                        disabled={!Object.values(manualLead).some((v) => v?.trim())}
                        className="rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 px-5 py-2.5 text-[0.8125rem] font-light tracking-wide text-zeya-champagne transition-all duration-200 hover:bg-zeya-champagne/14 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        Add and classify
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ── Review view ───────────────────────────────────────────────── */}
            {view === "review" && (
              <motion.div
                key="review"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="flex flex-col"
              >
                {/* Summary bar */}
                <div className="border-b border-zeya-graphite/18 px-5 py-3">
                  <p className="text-[0.8125rem] font-light tracking-wide text-zeya-ivory/75">
                    {parsed.length} lead{parsed.length !== 1 ? "s" : ""} parsed
                    {missionDetail && (
                      <span className="text-zeya-hush/45">
                        {" "}&mdash; {countByFit("likely_match")} likely, {countByFit("possible_match")} possible, {countByFit("weak_match")} weak
                      </span>
                    )}
                  </p>

                  {/* Fit filter */}
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {(["all", "likely_match", "possible_match", "weak_match"] as const).map((f) => {
                      const count = f === "all" ? parsed.length : countByFit(f);
                      const label = f === "all" ? "All" : FIT_LABEL[f];
                      return (
                        <button
                          key={f}
                          onClick={() => setFilterFit(f)}
                          className={[
                            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.65rem] font-light tracking-wide transition-all duration-200",
                            filterFit === f
                              ? "border-zeya-champagne/28 bg-zeya-champagne/7 text-zeya-champagne/80"
                              : "border-zeya-graphite/28 text-zeya-hush/42 hover:border-zeya-graphite/45",
                          ].join(" ")}
                        >
                          {f !== "all" && (
                            <span className={["h-1.5 w-1.5 rounded-full", FIT_DOT[f]].join(" ")} />
                          )}
                          {label} {count > 0 && <span className="opacity-60">({count})</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Lead list */}
                <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2" style={{ scrollbarWidth: "none" }}>
                  {visibleLeads.map((lead, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-presence border border-zeya-graphite/22 bg-zeya-aubergine/30 px-3.5 py-3"
                    >
                      <span className={["mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", FIT_DOT[lead.fit_status]].join(" ")} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8125rem] font-light tracking-wide text-zeya-ivory/78">
                          {lead.company_name ?? lead.contact_name ?? "(unnamed)"}
                        </p>
                        <p className="truncate text-[0.72rem] font-light tracking-wide text-zeya-hush/42">
                          {[lead.contact_name && lead.company_name ? lead.contact_name : null, lead.email, lead.phone]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <span className="shrink-0 text-[0.62rem] font-light tracking-widest text-zeya-hush/30 uppercase">
                        {FIT_LABEL[lead.fit_status]}
                      </span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* ── Done view ─────────────────────────────────────────────────── */}
            {view === "done" && importResult && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4, ease: EASE }}
                className="flex flex-col items-center gap-6 px-5 py-10 text-center"
              >
                <div className="space-y-2">
                  <p className="text-[0.9375rem] font-light tracking-wide text-zeya-ivory/78">
                    {importResult.imported} leads imported.
                  </p>
                  <p className="text-[0.8125rem] font-light leading-relaxed tracking-wide text-zeya-hush/52">
                    {importResult.likelyMatch} likely match this mission
                    {importResult.possibleMatch > 0 && `, ${importResult.possibleMatch} possible`}
                    {importResult.weakMatch > 0 && `, ${importResult.weakMatch} weak`}.
                  </p>
                </div>
                <button
                  onClick={onClose}
                  className="rounded-presence border border-zeya-graphite/40 px-6 py-2.5 text-[0.8125rem] font-light tracking-wide text-zeya-hush/62 transition-all duration-200 hover:text-zeya-hush/82"
                >
                  Close
                </button>
              </motion.div>
            )}

          </AnimatePresence>
        </div>

        {/* Footer — only in review state */}
        {view === "review" && (
          <div className="shrink-0 border-t border-zeya-graphite/20 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <button
                onClick={() => { setParsed([]); setView("intake"); }}
                className="rounded-presence border border-zeya-graphite/38 px-4 py-2 text-[0.75rem] font-light tracking-wide text-zeya-hush/55 transition-all duration-200 hover:text-zeya-hush/78"
              >
                Back
              </button>
              <button
                onClick={() => void handleImport()}
                disabled={loading || parsed.length === 0}
                className="flex-1 rounded-presence border border-zeya-champagne/22 bg-zeya-champagne/8 py-2 text-[0.75rem] font-light tracking-wide text-zeya-champagne transition-all duration-200 hover:bg-zeya-champagne/15 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? "Importing…" : `Import ${parsed.length} leads`}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </>
  );
}
