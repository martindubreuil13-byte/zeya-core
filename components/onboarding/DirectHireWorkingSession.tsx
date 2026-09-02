"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import {
  localDateTimeInTimezoneToIso,
  canStartDirectHireWorkingSession,
  type DirectHireWorkingSession,
} from "@/lib/onboarding/direct-hire-working-session";
import {
  shouldAllowExplicitPreparationRetry,
  shouldAutoTriggerPreparation,
  createPreparationRequestGuard,
} from "@/lib/onboarding/preparation-retry-policy";

function localInputDefault() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function DirectHireWorkingSessionScheduler() {
  const { session } = useAuth();
  const router = useRouter();
  const [workingSession, setWorkingSession] = useState<DirectHireWorkingSession | null>(null);
  const [localDateTime, setLocalDateTime] = useState(localInputDefault);
  const [timezone, setTimezone] = useState(() =>
    Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  );
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [renderedAt] = useState(() => Date.now());
  const preparationRequestGuard = useRef(createPreparationRequestGuard());

  const triggerPreparationIfNeeded = useCallback(async (workingSession: DirectHireWorkingSession, authSession: any, isExplicitRetry: boolean = false) => {
    if (!workingSession?.id || !workingSession.preparationStatus || !authSession) return;

    const shouldTrigger = isExplicitRetry
      ? shouldAllowExplicitPreparationRetry(
          workingSession.preparationStatus,
          workingSession.preparationFailureCode,
          workingSession.preparationAttemptCount ?? 0,
        )
      : shouldAutoTriggerPreparation(
          workingSession.preparationStatus,
          workingSession.preparationFailureCode,
          workingSession.preparationAttemptCount ?? 0,
          10,
          workingSession.preparationCurrent,
        );
    if (!shouldTrigger) return;
    if (!preparationRequestGuard.current.tryStart(workingSession.id, isExplicitRetry)) return;

    setPreparing(true);
    try {
      const response = await authenticatedFetch(
        `/api/onboarding/direct-hire/working-session/${workingSession.id}/prepare`,
        authSession,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      const body = await response.json().catch(() => ({}));
      const refreshedResponse = await authenticatedFetch(
        "/api/onboarding/direct-hire/working-session",
        authSession,
      );
      const refreshedBody = await refreshedResponse.json().catch(() => ({}));
      if (refreshedResponse.ok && refreshedBody.success) {
        setWorkingSession(refreshedBody.data ?? null);
      } else {
        setError(refreshedBody.error || "working_session_lookup_failed");
      }
      if (!response.ok || !body.success) setError(body.error || "preparation_failed");
    } catch (error) {
      console.debug("[DirectHireWorkingSession] preparation trigger failed", error);
    } finally {
      preparationRequestGuard.current.finish(workingSession.id);
      setPreparing(false);
    }
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/working-session",
        session,
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error || "working_session_lookup_failed");
        return;
      }
      const loadedSession = body.data ?? null;
      setWorkingSession(loadedSession);
      setLoading(false);

      // Pending sessions start automatically; running sessions may safely reclaim.
      if (loadedSession) {
        void triggerPreparationIfNeeded(loadedSession, session);
      }
    } catch {
      setError("working_session_lookup_failed");
    } finally {
      setLoading(false);
    }
  }, [session, triggerPreparationIfNeeded]);

  useEffect(() => { queueMicrotask(() => void load()); }, [load]);

  const formattedSchedule = useMemo(() => {
    if (!workingSession) return "";
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeStyle: "short",
        timeZone: workingSession.schedulingTimezone,
      }).format(new Date(workingSession.scheduledAt));
    } catch {
      return workingSession.scheduledAt;
    }
  }, [workingSession]);

  const canRetryFailedPreparation = workingSession
    ? shouldAllowExplicitPreparationRetry(
        workingSession.preparationStatus,
        workingSession.preparationFailureCode,
        workingSession.preparationAttemptCount ?? 0,
      )
    : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!session || submitting) return;
    const scheduledAt = localDateTimeInTimezoneToIso(localDateTime, timezone);
    if (!scheduledAt) {
      setError("Choose a valid date, time, and IANA timezone.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/working-session",
        session,
        {
          method: workingSession ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scheduledAt,
            schedulingTimezone: timezone,
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success || !body.data) {
        setError(body.error || "working_session_persistence_failed");
        return;
      }
      const scheduledSession = body.data;
      setWorkingSession(scheduledSession);
      setEditing(false);

      // Use the same guarded, authoritative preparation path as page re-entry.
      if (scheduledSession?.id) void triggerPreparationIfNeeded(scheduledSession, session);
    } catch {
      setError("working_session_persistence_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!session || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/working-session",
        session,
        { method: "DELETE" },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error || "working_session_cancellation_failed");
        return;
      }
      setWorkingSession(null);
      setEditing(false);
    } catch {
      setError("working_session_cancellation_failed");
    } finally {
      setSubmitting(false);
    }
  };

  const startWorkingSession = async () => {
    if (!session || !workingSession?.id || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/formation",
        session,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workingSessionId: workingSession.id }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.success) {
        setError(body.error || "formation_initiation_failed");
        return;
      }
      router.push(`/formation/sessions/${body.data.formationSessionId}`);
    } catch {
      setError("formation_initiation_failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="text-zeya-taupe" role="status">Loading our schedule…</p>;

  if (workingSession && !editing) {
    const isReady = workingSession.preparationStatus === "ready" && workingSession.preparationCurrent;
    const isStaleReady = workingSession.preparationStatus === "ready" && !workingSession.preparationCurrent;
    const staleAtAttemptCap = isStaleReady && (workingSession.preparationAttemptCount ?? 0) >= 10;
    const isPartial = workingSession.preparationStatus === "partial";
    const isFailed = workingSession.preparationStatus === "failed";
    const isPending = workingSession.preparationStatus === "pending";
    const isRunning = workingSession.preparationStatus === "running";
    const canStart = canStartDirectHireWorkingSession(workingSession);

    let preparationHeadline: string;
    if (isReady || isPartial) {
      preparationHeadline = "I’m ready for our first working session.";
    } else if (staleAtAttemptCap) {
      preparationHeadline = "My preparation needs attention before we begin.";
    } else if (isStaleReady) {
      preparationHeadline = "I’m preparing before we speak.";
    } else if (isFailed) {
      preparationHeadline = "I encountered a problem during preparation.";
    } else if (new Date(workingSession.scheduledAt).getTime() <= renderedAt) {
      preparationHeadline = "I’m still preparing for our working session.";
    } else {
      preparationHeadline = "I’m preparing before we speak.";
    }

    return (
      <section className="mx-auto max-w-2xl text-center" aria-labelledby="scheduled-title">
        <p className="mb-5 text-xs uppercase tracking-[0.28em] text-zeya-champagne">First working session</p>
        <h1 id="scheduled-title" className="font-serif text-4xl leading-tight sm:text-5xl">
          {preparationHeadline}
        </h1>
        <p className="mt-7 text-lg text-zeya-ivory">Our first working session is scheduled for:</p>
        <p className="mt-2 font-medium text-zeya-champagne">{formattedSchedule}</p>
        <p className="mt-1 text-sm text-zeya-taupe">{workingSession.schedulingTimezone}</p>
        <p className="mx-auto mt-7 max-w-xl leading-7 text-zeya-taupe">
          I’ll review your business, the material you provided, and the things I need to clarify with you.
        </p>

        {(isReady || isPartial) && (
          <p className="mx-auto mt-5 max-w-xl text-sm text-zeya-champagne">
            {isPartial ? "My preparation is complete with some uncertainties I’ll clarify during our session." : ""}
          </p>
        )}

        <div className="mt-9 flex flex-col gap-3">
          {canStart && (
            <button
              type="button"
              onClick={() => void startWorkingSession()}
              disabled={submitting || preparing}
              className="rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void disabled:opacity-60"
            >
              {submitting ? "Starting…" : preparing ? "Preparing…" : "Start working session"}
            </button>
          )}

          {isFailed && (
            <div className="space-y-3">
              <p className="text-sm text-red-300">
                Preparation encountered an issue. Please contact support if the problem persists.
              </p>
              <div className="flex justify-center gap-4">
                {canRetryFailedPreparation && (
                  <button
                    type="button"
                    onClick={() => workingSession && void triggerPreparationIfNeeded(workingSession, session, true)}
                    disabled={submitting || preparing}
                    className="rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void disabled:opacity-60"
                  >
                    {preparing ? "Trying again…" : "Try preparation again"}
                  </button>
                )}
                <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-zeya-champagne/50 px-6 py-3 text-sm">Reschedule</button>
                <button type="button" onClick={() => void cancel()} disabled={submitting} className="rounded-full px-6 py-3 text-sm text-zeya-taupe">Cancel session</button>
              </div>
            </div>
          )}

          {!isFailed && (
            <div className="flex justify-center gap-4">
              {!isRunning && !isPending && (
                <>
                  <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-zeya-champagne/50 px-6 py-3 text-sm">Reschedule</button>
                  <button type="button" onClick={() => void cancel()} disabled={submitting} className="rounded-full px-6 py-3 text-sm text-zeya-taupe">Cancel session</button>
                </>
              )}
            </div>
          )}
        </div>
        {error && <p role="alert" className="mt-5 text-sm text-red-200">{error}</p>}
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-2xl" aria-labelledby="schedule-title">
      <p className="mb-5 text-xs uppercase tracking-[0.28em] text-zeya-champagne">Your first working session</p>
      <h1 id="schedule-title" className="font-serif text-4xl leading-tight sm:text-5xl">Let’s schedule our first working session.</h1>
      <div className="mt-7 space-y-4 leading-7 text-zeya-taupe">
        <p>I have enough to get started.</p>
        <p>Before we meet, I’m going to spend some time understanding your business and reviewing what you’ve given me.</p>
      </div>
      <form onSubmit={submit} className="mt-9 space-y-6">
        <label className="block text-sm text-zeya-ivory">
          Date and time
          <input type="datetime-local" required value={localDateTime} onChange={(event) => setLocalDateTime(event.target.value)} className="mt-2 block w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3" />
        </label>
        <label className="block text-sm text-zeya-ivory">
          Timezone
          <input type="text" required value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Asia/Bangkok" className="mt-2 block w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3" />
        </label>
        {error && <p role="alert" className="text-sm text-red-200">{error}</p>}
        <div className="flex gap-4">
          <button type="submit" disabled={submitting} className="rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void disabled:opacity-60">
            {submitting ? "Scheduling…" : workingSession ? "Save new time" : "Schedule session"}
          </button>
          {workingSession && <button type="button" onClick={() => setEditing(false)} className="px-5 text-sm text-zeya-taupe">Keep current time</button>}
        </div>
      </form>
    </section>
  );
}
