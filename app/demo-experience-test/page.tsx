"use client";

import { useMemo, useState } from "react";

import type {
  AllowedExperienceTransition,
  ExperienceEvent,
  ExperienceSession,
  ExperienceState,
} from "@/lib/demo-experience";

interface ExperienceApiResponse {
  success?: boolean;
  session?: ExperienceSession;
  currentState?: ExperienceState;
  nextState?: ExperienceState;
  message?: string;
  allowedTransitions?: AllowedExperienceTransition[];
  error?: string;
}

const STATE_SEQUENCE: ExperienceState[] = [
  "LANDING",
  "INTRODUCTION",
  "DISCOVERY",
  "EXPERIMENT_INVITATION",
  "CONTACT_CAPTURE",
  "PREPARING_BRIEF",
  "WAITING_FOR_CALL",
  "CALL_IN_PROGRESS",
  "RETURNING",
  "DEBRIEF",
  "NEXT_STEP",
  "COMPLETED",
];

export default function DemoExperienceTestPage() {
  const [session, setSession] = useState<ExperienceSession | null>(null);
  const [message, setMessage] = useState("");
  const [allowedTransitions, setAllowedTransitions] = useState<AllowedExperienceTransition[]>([]);
  const [visitedStates, setVisitedStates] = useState<ExperienceState[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const currentState = session?.state;
  const currentIndex = useMemo(
    () => (currentState ? STATE_SEQUENCE.indexOf(currentState) : -1),
    [currentState]
  );

  async function postExperience(body: object): Promise<ExperienceApiResponse> {
    const response = await fetch("/api/demo-experience/test-experience", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as ExperienceApiResponse;

    if (!response.ok) {
      throw new Error(data.error ?? "Experience request failed");
    }

    return data;
  }

  function applyResponse(data: ExperienceApiResponse) {
    if (!data.session) {
      throw new Error("Response did not include an experience session");
    }

    setSession(data.session);
    setMessage(data.message ?? "");
    setAllowedTransitions(data.allowedTransitions ?? []);
    setVisitedStates((previous) =>
      previous.includes(data.session!.state)
        ? previous
        : [...previous, data.session!.state]
    );
  }

  async function start() {
    setLoading(true);
    setError("");

    try {
      const data = await postExperience({ action: "start" });
      applyResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start experience");
    } finally {
      setLoading(false);
    }
  }

  async function advance(event: ExperienceEvent) {
    if (!session) return;

    setLoading(true);
    setError("");

    try {
      const data = await postExperience({
        sessionId: session.id,
        event,
      });
      applyResponse(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not advance experience");
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setSession(null);
    setMessage("");
    setAllowedTransitions([]);
    setVisitedStates([]);
    setError("");
  }

  return (
    <main className="min-h-dvh bg-[#0a0709] px-6 py-8 text-zeya-hush sm:px-10">
      <section className="mx-auto flex w-full max-w-4xl flex-col gap-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.18em] text-zeya-champagne/60">
            DX-UI-1
          </p>
          <h1 className="text-2xl font-light text-zeya-champagne">
            Demo Experience Test
          </h1>
        </header>

        <section className="rounded-lg border border-zeya-champagne/15 bg-white/[0.03] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-zeya-hush/45">
                Current State
              </p>
              <p className="mt-2 text-xl text-zeya-champagne">
                {currentState ?? "NOT_STARTED"}
              </p>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={start}
                disabled={loading}
                className="rounded-md border border-zeya-champagne/20 px-4 py-2 text-sm text-zeya-champagne disabled:opacity-45"
              >
                Start experience
              </button>
              <button
                type="button"
                onClick={reset}
                disabled={loading}
                className="rounded-md border border-zeya-hush/15 px-4 py-2 text-sm text-zeya-hush/70 disabled:opacity-45"
              >
                Reset
              </button>
            </div>
          </div>

          <div className="mt-6 rounded-md border border-zeya-hush/10 bg-black/20 p-4">
            <p className="whitespace-pre-line text-lg font-light leading-relaxed text-zeya-hush">
              {message || "Start the experience to load the first backend message."}
            </p>
          </div>

          {error && (
            <p className="mt-4 rounded-md border border-red-400/25 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
        </section>

        <section className="rounded-lg border border-zeya-champagne/15 bg-white/[0.03] p-5">
          <h2 className="text-sm uppercase tracking-[0.16em] text-zeya-hush/50">
            Allowed Transitions
          </h2>

          <div className="mt-4 flex flex-wrap gap-3">
            {allowedTransitions.length > 0 ? (
              allowedTransitions.map((transition) => (
                <button
                  key={`${transition.event}-${transition.nextState}`}
                  type="button"
                  onClick={() => advance(transition.event)}
                  disabled={loading || !session}
                  className="rounded-md border border-zeya-champagne/20 bg-zeya-champagne/10 px-4 py-2 text-sm text-zeya-champagne disabled:opacity-45"
                >
                  {transition.event} to {transition.nextState}
                </button>
              ))
            ) : (
              <p className="text-sm text-zeya-hush/55">
                No transitions available.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-zeya-champagne/15 bg-white/[0.03] p-5">
          <h2 className="text-sm uppercase tracking-[0.16em] text-zeya-hush/50">
            State Progression
          </h2>

          <ol className="mt-5 grid gap-2 sm:grid-cols-2">
            {STATE_SEQUENCE.map((state, index) => {
              const isCurrent = state === currentState;
              const hasVisited = visitedStates.includes(state);
              const isPast = currentIndex >= 0 && index < currentIndex;

              return (
                <li
                  key={state}
                  className={[
                    "rounded-md border px-3 py-2 text-sm",
                    isCurrent
                      ? "border-zeya-champagne bg-zeya-champagne/12 text-zeya-champagne"
                      : hasVisited || isPast
                        ? "border-zeya-champagne/25 text-zeya-hush"
                        : "border-zeya-hush/10 text-zeya-hush/40",
                  ].join(" ")}
                >
                  <span className="mr-2 text-zeya-hush/35">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  {state}
                </li>
              );
            })}
          </ol>
        </section>
      </section>
    </main>
  );
}
