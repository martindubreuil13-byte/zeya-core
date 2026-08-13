"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import type { InductionMaterial } from "@/lib/onboarding/direct-hire-contract";

type InductionSurface =
  | "employment_accepted"
  | "material_requested"
  | "material_received"
  | "preparation_pending"
  | "error";

type LinkInput = {
  label: string;
  url: string;
};

type LoadedMaterial = {
  induction_material_type: string;
  induction_material_label?: string;
  induction_material_url?: string;
  raw_statement: string;
};

export function DirectHireInduction({
  onReadyForScheduling,
}: {
  onReadyForScheduling?: () => void;
} = {}) {
  const { session, user } = useAuth();
  const [surface, setSurface] = useState<InductionSurface>("employment_accepted");
  const [materials, setMaterials] = useState<LoadedMaterial[]>([]);
  const [draftKey, setDraftKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [businessContext, setBusinessContext] = useState({
    sells: "",
    target_customer: "",
    priority: "",
  });
  const [notes, setNotes] = useState("");
  const [links, setLinks] = useState<LinkInput[]>([]);
  const [newLink, setNewLink] = useState({ label: "", url: "" });

  const loadStatus = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/induction",
        session,
      );
      if (!response.ok) {
        setError("Could not load induction status. Try again.");
        return;
      }
      const body = (await response.json()) as {
        success?: boolean;
        data?: {
          onboarding_session_id: string;
          induction_state: string;
          materials_count: number;
          materials: Array<{
            induction_material_type: string;
            induction_material_label?: string;
            induction_material_url?: string;
            raw_statement: string;
          }>;
        };
      };
      if (body.success && body.data) {
        const nextDraftKey = user
          ? `zeya:direct-hire-induction-draft:${user.id}:${body.data.onboarding_session_id}`
          : null;
        setDraftKey(nextDraftKey);
        if (nextDraftKey && body.data.induction_state === "material_requested") {
          try {
            const stored = window.localStorage.getItem(nextDraftKey);
            const draft = stored ? JSON.parse(stored) as {
              businessContext?: typeof businessContext;
              notes?: string;
              links?: LinkInput[];
            } : null;
            if (draft?.businessContext) setBusinessContext(draft.businessContext);
            if (typeof draft?.notes === "string") setNotes(draft.notes);
            if (Array.isArray(draft?.links)) setLinks(draft.links);
          } catch {
            window.localStorage.removeItem(nextDraftKey);
          }
        }
        setMaterials(body.data.materials || []);
        setSurface(
          body.data.induction_state === "not_started"
            ? "employment_accepted"
            : body.data.induction_state === "material_requested"
              ? "material_requested"
              : body.data.induction_state === "material_received"
                ? "material_received"
                : "preparation_pending",
        );
      }
    } catch {
      setError("Could not load induction status.");
    } finally {
      setLoading(false);
    }
  }, [session, user]);

  useEffect(() => {
    queueMicrotask(() => void loadStatus());
  }, [loadStatus]);

  const handleAddLink = () => {
    if (!newLink.label.trim() || !newLink.url.trim()) {
      setError("Please enter both a label and a URL.");
      return;
    }
    try {
      new URL(newLink.url);
    } catch {
      setError("Please enter a valid URL.");
      return;
    }
    if (links.some((l) => l.url === newLink.url)) {
      setError("You've already added this URL.");
      return;
    }
    setLinks([...links, newLink]);
    setNewLink({ label: "", url: "" });
    setError(null);
  };

  const handleRemoveLink = (index: number) => {
    setLinks(links.filter((_, i) => i !== index));
  };

  useEffect(() => {
    if (!draftKey || surface !== "material_requested") return;
    window.localStorage.setItem(draftKey, JSON.stringify({
      businessContext,
      notes,
      links,
    }));
  }, [businessContext, draftKey, links, notes, surface]);

  const handleBeginInduction = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/induction",
        session,
        { method: "PATCH" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error || "induction_start_failed");
        return;
      }
      setSurface("material_requested");
    } catch {
      setError("induction_start_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitMaterials = async () => {
    if (!session) return;

    // Check minimum requirement: at least one material
    const hasContext =
      businessContext.sells.trim() ||
      businessContext.target_customer.trim() ||
      businessContext.priority.trim();
    if (!hasContext && !notes.trim() && links.length === 0) {
      setError(
        "Please provide at least one material: context, notes, or a link.",
      );
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Submit materials one by one
      const materialsToSubmit: InductionMaterial[] = [];

      if (businessContext.sells.trim()) {
        materialsToSubmit.push({
          type: "description",
          label: "What the business sells",
          content: businessContext.sells.trim(),
        });
      }
      if (businessContext.target_customer.trim()) {
        materialsToSubmit.push({
          type: "description",
          label: "Target customer",
          content: businessContext.target_customer.trim(),
        });
      }
      if (businessContext.priority.trim()) {
        materialsToSubmit.push({
          type: "description",
          label: "Business-development priority",
          content: businessContext.priority.trim(),
        });
      }
      if (notes.trim()) {
        materialsToSubmit.push({
          type: "note",
          label: "Owner notes",
          content: notes.trim(),
        });
      }
      for (const link of links) {
        materialsToSubmit.push({
          type: "link",
          label: link.label,
          url: link.url,
        });
      }

      for (const material of materialsToSubmit) {
        const response = await authenticatedFetch(
          "/api/onboarding/direct-hire/induction",
          session,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(material),
          },
        );

        const body = await response.json().catch(() => ({}));
        if (!response.ok || !body.success) {
          setError(body.error || "material_persistence_failed");
          setSubmitting(false);
          return;
        }
      }

      if (draftKey) window.localStorage.removeItem(draftKey);
      await loadStatus();
      setSurface("material_received");
    } catch {
      setError("induction_material_save_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteInduction = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/induction",
        session,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "complete" }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error || "induction_completion_failed");
        return;
      }
      setSurface("preparation_pending");
      onReadyForScheduling?.();
    } catch {
      setError("induction_completion_failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-zeya-void text-zeya-ivory grid place-items-center px-6">
        <div className="text-center" role="status" aria-live="polite">
          <div className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border border-zeya-champagne/25 border-t-zeya-champagne" />
          <p className="text-sm text-zeya-taupe">Loading…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-zeya-void px-5 py-12 text-zeya-ivory sm:px-8 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(197,164,126,0.12),transparent_42%)]" />

      <div className="relative mx-auto max-w-2xl">
        {surface === "employment_accepted" && (
          <section className="w-full text-center">
            <p className="mb-7 text-xs uppercase tracking-[0.28em] text-zeya-champagne">
              Employment accepted
            </p>
            <h1 className="text-balance font-serif text-5xl leading-tight sm:text-6xl">
              Thank you for trusting me with this role.
            </h1>
            <div className="mx-auto mt-8 max-w-xl space-y-6 text-base leading-8 text-zeya-taupe sm:text-lg">
              <p>
                Before our first formal meeting, I&apos;d like to study your
                business properly.
              </p>
              <p>
                Give me anything you would normally share with a new Business
                Development Executive before their first day.
              </p>
              <p className="text-sm italic">
                You do not need to have everything ready today. Start with what
                you have.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleBeginInduction()}
              disabled={submitting}
              className="mt-10 rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void transition-colors hover:bg-zeya-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory focus-visible:ring-offset-4 focus-visible:ring-offset-zeya-void"
            >
              {submitting ? "Beginning induction…" : "Begin My Induction"}
            </button>
          </section>
        )}

        {surface === "material_requested" && (
          <section className="w-full">
            <p className="mb-4 text-xs uppercase tracking-[0.28em] text-zeya-champagne">
              What I should know
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl">
              Help me prepare for our first meeting.
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-zeya-taupe">
              Share any material that would help me understand your business.
            </p>

            <form className="mt-9 space-y-8">
              {/* Business Context */}
              <div className="space-y-4">
                <h2 className="font-medium text-zeya-ivory">Business context</h2>
                <div>
                  <label className="block text-sm text-zeya-ivory">
                    What does the business sell?
                  </label>
                  <textarea
                    value={businessContext.sells}
                    onChange={(e) =>
                      setBusinessContext({
                        ...businessContext,
                        sells: e.target.value,
                      })
                    }
                    placeholder="Product or service description"
                    className="mt-2 w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                    rows={3}
                    maxLength={500}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zeya-ivory">
                    Who are your target customers?
                  </label>
                  <textarea
                    value={businessContext.target_customer}
                    onChange={(e) =>
                      setBusinessContext({
                        ...businessContext,
                        target_customer: e.target.value,
                      })
                    }
                    placeholder="Customer profile or market"
                    className="mt-2 w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                    rows={2}
                    maxLength={500}
                  />
                </div>
                <div>
                  <label className="block text-sm text-zeya-ivory">
                    What&apos;s your immediate business-development priority?
                  </label>
                  <textarea
                    value={businessContext.priority}
                    onChange={(e) =>
                      setBusinessContext({
                        ...businessContext,
                        priority: e.target.value,
                      })
                    }
                    placeholder="What should I focus on first?"
                    className="mt-2 w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                    rows={2}
                    maxLength={500}
                  />
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-zeya-ivory">
                  Tell me anything I should know before I begin studying
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any additional context or background"
                  className="mt-2 w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                  rows={4}
                  maxLength={2000}
                />
                <p className="mt-1 text-xs text-zeya-taupe">
                  {notes.length}/2000
                </p>
              </div>

              {/* Links */}
              <div className="space-y-3">
                <h2 className="font-medium text-zeya-ivory">Useful links</h2>
                <p className="text-sm text-zeya-taupe">
                  Company website, LinkedIn, presentations, or other public
                  sources
                </p>
                <div className="space-y-2">
                  {links.map((link, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between gap-3 rounded-lg border border-zeya-ivory/10 bg-zeya-ivory/[0.02] px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-zeya-ivory truncate">
                          {link.label}
                        </p>
                        <p className="text-xs text-zeya-taupe truncate">
                          {link.url}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveLink(idx)}
                        className="text-xs text-zeya-taupe hover:text-zeya-ivory transition-colors"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                <div className="space-y-2">
                  <input
                    type="text"
                    placeholder="Label (e.g., Company website)"
                    value={newLink.label}
                    onChange={(e) =>
                      setNewLink({ ...newLink, label: e.target.value })
                    }
                    className="w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                  />
                  <input
                    type="url"
                    placeholder="https://example.com"
                    value={newLink.url}
                    onChange={(e) =>
                      setNewLink({ ...newLink, url: e.target.value })
                    }
                    className="w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-sm text-zeya-ivory outline-none transition-colors focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50"
                  />
                  <button
                    type="button"
                    onClick={handleAddLink}
                    className="w-full rounded-xl border border-zeya-ivory/25 px-4 py-2.5 text-sm text-zeya-ivory transition-colors hover:border-zeya-champagne/50 hover:text-zeya-champagne focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-champagne"
                  >
                    Add link
                  </button>
                </div>
              </div>

              {error && (
                <p role="alert" className="text-sm text-red-200">
                  {error}
                </p>
              )}

              <button
                type="button"
                onClick={handleSubmitMaterials}
                disabled={submitting}
                className="w-full rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void transition-colors hover:bg-zeya-ivory disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory focus-visible:ring-offset-4 focus-visible:ring-offset-zeya-void"
              >
                {submitting ? "Saving…" : "Continue to review"}
              </button>
            </form>
          </section>
        )}

        {surface === "material_received" && (
          <section className="w-full">
            <p className="mb-4 text-xs uppercase tracking-[0.28em] text-zeya-champagne">
              Review
            </p>
            <h1 className="font-serif text-3xl sm:text-4xl">
              Here&apos;s what you&apos;ve shared.
            </h1>
            <p className="mt-4 max-w-xl leading-7 text-zeya-taupe">
              Review your induction material before we schedule our first working session.
            </p>

            <div className="mt-9 space-y-6">
              {materials.map((m, idx) => (
                <div
                  key={idx}
                  className="rounded-lg border border-zeya-ivory/10 bg-zeya-ivory/[0.02] px-6 py-4"
                >
                  <p className="text-xs uppercase tracking-[0.1em] text-zeya-champagne">
                    {m.induction_material_type === "link" ? "Link" : "Notes"}
                  </p>
                  {m.induction_material_label && (
                    <p className="mt-1 font-medium text-zeya-ivory">
                      {m.induction_material_label}
                    </p>
                  )}
                  {m.induction_material_url ||
                  (m.induction_material_type === "link" && m.raw_statement) ? (
                    <p className="mt-2 text-sm text-zeya-taupe break-all">
                      {m.induction_material_url || m.raw_statement}
                    </p>
                  ) : (
                    <p className="mt-2 text-sm leading-6 text-zeya-taupe whitespace-pre-wrap">
                      {m.raw_statement}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-9 space-y-3">
              <button
                type="button"
                onClick={handleCompleteInduction}
                disabled={submitting}
                className="w-full rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void transition-colors hover:bg-zeya-ivory disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory focus-visible:ring-offset-4 focus-visible:ring-offset-zeya-void"
              >
                {submitting ? "Continuing…" : "I've reviewed this. Let's proceed."}
              </button>
            </div>
          </section>
        )}

        {surface === "preparation_pending" && (
          <section className="w-full text-center">
            <p className="mb-6 text-xs uppercase tracking-[0.28em] text-zeya-champagne">
              Preparation awaits
            </p>
            <h1 className="text-balance font-serif text-5xl leading-tight sm:text-6xl">
              I have what I need to begin preparing.
            </h1>
            <div className="mx-auto mt-8 max-w-xl space-y-6 text-base leading-8 text-zeya-taupe sm:text-lg">
              <p>
                I&apos;ll review the material you shared before our first formal
                meeting.
              </p>
              <p>
                I&apos;ll return with a clear summary of what I understand, the
                areas where I&apos;m uncertain, and the questions I need to ask.
              </p>
              <p className="text-xs italic">
                Representation is governed, not generated.
              </p>
            </div>
          </section>
        )}

        {surface === "error" && (
          <section className="w-full text-center">
            <h1 className="font-serif text-3xl">
              Something went wrong.
            </h1>
            <p role="alert" className="mx-auto mt-5 max-w-lg leading-7 text-zeya-taupe">
              {error || "We couldn't load your induction materials."}
            </p>
            <button
              type="button"
              onClick={() => void loadStatus()}
              className="mt-8 rounded-full border border-zeya-champagne/50 px-6 py-3 text-sm text-zeya-ivory hover:border-zeya-champagne focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-champagne"
            >
              Try again
            </button>
          </section>
        )}
      </div>
    </main>
  );
}
