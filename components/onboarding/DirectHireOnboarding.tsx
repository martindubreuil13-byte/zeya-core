"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import {
  DIRECT_HIRE_ONBOARDING_PATH,
  type DirectHireOnboardingStatus,
  type DirectHirePreparationView,
  type DirectHirePreparationStatus,
  type DirectHireProfileErrors,
  type DirectHireProfileField,
  type DirectHireProfileInput,
} from "@/lib/onboarding/direct-hire-contract";
import { validateDirectHireProfile } from "@/lib/onboarding/direct-hire-validation";

type Surface = "loading" | "first_meeting" | "profile" | "preparation" | "error";

const EMPTY_PROFILE: DirectHireProfileInput = {
  ownerName: "",
  businessName: "",
  website: "",
  phone: "",
  growthPriority: "",
};

const EMPTY_PREPARATION: DirectHirePreparationView = {
  authorized: false,
  progress: {},
  successfulPageCount: 0,
  failedPageCount: 0,
  attemptCount: 0,
  retryAvailable: false,
  failureCode: null,
  completedAt: null,
};

const FIELD_ORDER: DirectHireProfileField[] = [
  "ownerName",
  "businessName",
  "website",
  "phone",
  "growthPriority",
];

function LoadingScreen() {
  return (
    <main className="min-h-screen bg-zeya-void text-zeya-ivory grid place-items-center px-6">
      <div className="text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-5 h-9 w-9 animate-spin rounded-full border border-zeya-champagne/25 border-t-zeya-champagne" />
        <p className="text-sm text-zeya-taupe">Preparing our first meeting…</p>
      </div>
    </main>
  );
}

export function DirectHireOnboarding() {
  const router = useRouter();
  const { loading: authLoading, session, signOut, user } = useAuth();
  const [surface, setSurface] = useState<Surface>("loading");
  const [profile, setProfile] = useState<DirectHireProfileInput>(EMPTY_PROFILE);
  const [errors, setErrors] = useState<DirectHireProfileErrors>({});
  const [requestError, setRequestError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [preparationStatus, setPreparationStatus] = useState<DirectHirePreparationStatus>("not_started");
  const [preparation, setPreparation] = useState<DirectHirePreparationView>(EMPTY_PREPARATION);
  const [preparing, setPreparing] = useState(false);
  const fieldRefs = useRef<Partial<Record<DirectHireProfileField, HTMLInputElement | HTMLTextAreaElement | null>>>({});

  const loadStatus = useCallback(async () => {
    if (!session) return;
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire",
        session,
      );
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(DIRECT_HIRE_ONBOARDING_PATH)}`);
        return;
      }
      if (response.status === 409) {
        router.replace("/formation/entry");
        return;
      }
      if (!response.ok) {
        setRequestError("I couldn’t load our first meeting. Try again when you’re ready.");
        setSurface("error");
        return;
      }
      const body = await response.json() as {
        success?: boolean;
        data?: DirectHireOnboardingStatus;
      };
      if (!body.success || !body.data) {
        setRequestError("I couldn’t load our first meeting. Try again when you’re ready.");
        setSurface("error");
        return;
      }
      setPreparationStatus(body.data.preparationStatus);
      setPreparation(body.data.preparation);
      setSurface(body.data.state === "preparation" ? "preparation" : "first_meeting");
    } catch {
      setRequestError("I couldn’t load our first meeting. Try again when you’re ready.");
      setSurface("error");
    }
  }, [router, session]);

  useEffect(() => {
    if (surface !== "preparation" || preparationStatus !== "running") return;
    const interval = window.setInterval(() => void loadStatus(), 3_000);
    return () => window.clearInterval(interval);
  }, [loadStatus, preparationStatus, surface]);

  const startPreparation = useCallback(async () => {
    if (!session || preparing || preparation.attemptCount >= 3) return;
    setPreparing(true);
    setPreparationStatus("running");
    setPreparation((current) => ({
      ...current,
      authorized: true,
      progress: { ...current.progress, validating_destination: "running" },
      retryAvailable: false,
    }));
    setRequestError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire/preparation",
        session,
        { method: "POST" },
      );
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(DIRECT_HIRE_ONBOARDING_PATH)}`);
        return;
      }
      const body = await response.json().catch(() => ({})) as {
        success?: boolean;
        data?: {
          preparationStatus?: DirectHirePreparationStatus;
          progress?: DirectHirePreparationView["progress"];
          attemptCount?: number;
          retryAvailable?: boolean;
          successfulPageCount?: number;
          failedPageCount?: number;
          failureCode?: DirectHirePreparationView["failureCode"];
          completedAt?: string | null;
        };
      };
      if (!response.ok || !body.success || !body.data?.preparationStatus) {
        await loadStatus();
        setRequestError("I couldn’t confirm the preparation result yet. Your progress is still preserved.");
        return;
      }
      setPreparationStatus(body.data.preparationStatus);
      setPreparation((current) => ({
        authorized: true,
        progress: body.data?.progress ?? current.progress,
        attemptCount: body.data?.attemptCount ?? current.attemptCount,
        retryAvailable: body.data?.retryAvailable ?? false,
        successfulPageCount: body.data?.successfulPageCount ?? current.successfulPageCount,
        failedPageCount: body.data?.failedPageCount ?? current.failedPageCount,
        failureCode: body.data?.failureCode ?? null,
        completedAt: body.data?.completedAt ?? current.completedAt,
      }));
    } catch {
      await loadStatus();
      setRequestError("I couldn’t confirm the preparation result yet. Your progress is still preserved.");
    } finally {
      setPreparing(false);
    }
  }, [loadStatus, preparation.attemptCount, preparing, router, session]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !session) {
      router.replace(`/login?next=${encodeURIComponent(DIRECT_HIRE_ONBOARDING_PATH)}`);
      return;
    }
    queueMicrotask(() => void loadStatus());
  }, [authLoading, loadStatus, router, session, user]);

  const updateField = (field: DirectHireProfileField, value: string) => {
    setProfile((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setRequestError(null);
  };

  const focusFirstError = (nextErrors: DirectHireProfileErrors) => {
    const first = FIELD_ORDER.find((field) => nextErrors[field]);
    if (first) fieldRefs.current[first]?.focus();
  };

  const submitProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!session || submitting) return;

    const validated = validateDirectHireProfile(profile);
    if (!validated.success) {
      setErrors(validated.errors);
      focusFirstError(validated.errors);
      return;
    }

    setSubmitting(true);
    setErrors({});
    setRequestError(null);
    try {
      const response = await authenticatedFetch(
        "/api/onboarding/direct-hire",
        session,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(validated.data),
        },
      );
      const body = await response.json().catch(() => ({})) as {
        success?: boolean;
        error?: string;
        details?: DirectHireProfileErrors;
        data?: DirectHireOnboardingStatus;
      };
      if (response.status === 401) {
        router.replace(`/login?next=${encodeURIComponent(DIRECT_HIRE_ONBOARDING_PATH)}`);
        return;
      }
      if (response.status === 409) {
        router.replace("/formation/entry");
        return;
      }
      if (!response.ok || !body.success || body.data?.state !== "preparation") {
        if (body.error === "validation_failed" && body.details) {
          setErrors(body.details);
          focusFirstError(body.details);
        } else {
          setRequestError("I couldn’t save this yet. Your answers are still here. Try again when you’re ready.");
        }
        return;
      }
      setSurface("preparation");
      setPreparationStatus(body.data.preparationStatus);
      setPreparation(body.data.preparation ?? EMPTY_PREPARATION);
      await startPreparation();
    } catch {
      setRequestError("I couldn’t save this yet. Your answers are still here. Try again when you’re ready.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    router.replace("/login");
  };

  if (authLoading || surface === "loading" || !user) return <LoadingScreen />;

  return (
    <main className="relative min-h-screen overflow-hidden bg-zeya-void px-5 py-12 text-zeya-ivory sm:px-8 sm:py-16">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_15%,rgba(197,164,126,0.12),transparent_42%)]" />
      <button
        type="button"
        onClick={handleSignOut}
        className="absolute right-5 top-5 z-10 rounded-md px-3 py-2 text-xs text-zeya-taupe transition-colors hover:text-zeya-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-champagne"
      >
        Sign out
      </button>

      <div className="relative mx-auto flex min-h-[calc(100vh-8rem)] w-full max-w-2xl items-center">
        {surface === "first_meeting" && (
          <section aria-labelledby="direct-hire-title" className="w-full text-center">
            <p className="mb-7 text-xs uppercase tracking-[0.28em] text-zeya-champagne">Our first meeting</p>
            <h1 id="direct-hire-title" className="text-balance font-serif text-4xl leading-tight sm:text-5xl">
              I noticed we’ve never spoken before.
            </h1>
            <div className="mx-auto mt-8 max-w-xl space-y-4 text-base leading-8 text-zeya-taupe sm:text-lg">
              <p>Before my first day, I’d like to understand the essentials of the business and begin preparing for our first working session.</p>
              <p>I’ll keep this brief. I need five things to begin.</p>
            </div>
            <button
              type="button"
              onClick={() => setSurface("profile")}
              className="mt-10 rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void transition-colors hover:bg-zeya-ivory focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory focus-visible:ring-offset-4 focus-visible:ring-offset-zeya-void"
            >
              Start our first meeting
            </button>
          </section>
        )}

        {surface === "profile" && (
          <section aria-labelledby="profile-title" className="w-full py-8">
            <p className="mb-4 text-xs uppercase tracking-[0.28em] text-zeya-champagne">Our first meeting</p>
            <h1 id="profile-title" className="font-serif text-3xl sm:text-4xl">The essentials</h1>
            <p className="mt-4 max-w-xl leading-7 text-zeya-taupe">
              Give me the basic context I should have before I begin preparing.
            </p>

            <form className="mt-9 space-y-6" onSubmit={submitProfile} noValidate>
              <ProfileField
                id="ownerName"
                label="Owner name"
                explanation="The name I should use when we work together."
                value={profile.ownerName}
                error={errors.ownerName}
                autoComplete="name"
                inputRef={(element) => { fieldRefs.current.ownerName = element; }}
                onChange={(value) => updateField("ownerName", value)}
              />
              <ProfileField
                id="businessName"
                label="Business name"
                explanation="The business I’m joining."
                value={profile.businessName}
                error={errors.businessName}
                autoComplete="organization"
                inputRef={(element) => { fieldRefs.current.businessName = element; }}
                onChange={(value) => updateField("businessName", value)}
              />
              <ProfileField
                id="website"
                label="Website"
                explanation="I’ll use this as preliminary public evidence while I prepare."
                value={profile.website}
                error={errors.website}
                autoComplete="url"
                inputMode="url"
                inputRef={(element) => { fieldRefs.current.website = element; }}
                onChange={(value) => updateField("website", value)}
              />
              <ProfileField
                id="phone"
                label="Best phone number"
                explanation="A number for our work together. I won’t call anyone from this step."
                value={profile.phone}
                error={errors.phone}
                autoComplete="tel"
                inputMode="tel"
                inputRef={(element) => { fieldRefs.current.phone = element; }}
                onChange={(value) => updateField("phone", value)}
              />
              <ProfileField
                id="growthPriority"
                label="Product or service you most want to sell or grow"
                explanation="This gives me a practical place to begin."
                value={profile.growthPriority}
                error={errors.growthPriority}
                multiline
                inputRef={(element) => { fieldRefs.current.growthPriority = element; }}
                onChange={(value) => updateField("growthPriority", value)}
              />

              {requestError && (
                <p role="alert" className="rounded-lg border border-red-300/25 bg-red-950/20 px-4 py-3 text-sm leading-6 text-red-200">
                  {requestError}
                </p>
              )}

              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void transition-colors hover:bg-zeya-ivory disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory focus-visible:ring-offset-4 focus-visible:ring-offset-zeya-void sm:w-auto"
              >
                {submitting ? "Saving…" : "Begin preparation"}
              </button>
            </form>
          </section>
        )}

        {surface === "preparation" && (
          <section aria-labelledby="preparation-title" className="w-full">
            <p className="mb-6 text-xs uppercase tracking-[0.28em] text-zeya-champagne">Before my first day</p>
            <h1 id="preparation-title" className="font-serif text-4xl leading-tight sm:text-5xl">
              {preparationStatus === "ready"
                ? "I’ve completed a preliminary public review."
                : preparationStatus === "partial"
                  ? "I found useful public material, with some gaps."
                  : preparationStatus === "failed"
                    ? "I couldn’t safely complete the website review."
                    : preparationStatus === "running"
                      ? "I’m preparing now."
                      : "I have what I need to begin preparing."}
            </h1>
            <div className="mt-7 max-w-xl space-y-4 leading-7 text-zeya-taupe">
              {preparationStatus === "queued" && (
                <p>Preparation has not started. When you begin, I’ll review only the public website you provided.</p>
              )}
              {preparationStatus === "running" && (
                <p>I’m reviewing a small number of public pages and preserving only sourced, preliminary evidence.</p>
              )}
              {preparationStatus === "ready" && (
                <p>I found usable public evidence. It remains preliminary until we review it together.</p>
              )}
              {preparationStatus === "partial" && (
                <p>Some useful public evidence is preserved, but one or more optional pages or extraction steps could not be completed.</p>
              )}
              {preparationStatus === "failed" && (
                <p>{preparationFailureMessage(preparation.failureCode)}</p>
              )}
              <p>Nothing I find becomes the truth about your business until we review it together.</p>
            </div>

            <dl className="mt-10 divide-y divide-zeya-ivory/10 border-y border-zeya-ivory/10">
              <PreparationItem label="Business profile" status="Received" />
              <PreparationItem
                label="Preparation"
                status={preparing && preparation.attemptCount > 0
                  ? "Retrying"
                  : displayStatus(preparationStatus)}
              />
              <PreparationItem label="Website destination" status={displayProgress(preparation.progress.validating_destination)} />
              <PreparationItem label="Homepage" status={displayProgress(preparation.progress.homepage)} />
              <PreparationItem label="About page" status={displayProgress(preparation.progress.about)} />
              <PreparationItem label="Products or services page" status={displayProgress(preparation.progress.products_services)} />
              <PreparationItem label="Sourced evidence" status={displayProgress(preparation.progress.evidence)} />
              <PreparationItem label="Cautious observations" status={displayProgress(preparation.progress.observations)} />
            </dl>

            {requestError && <p role="alert" className="mt-6 text-sm leading-6 text-red-200">{requestError}</p>}
            {preparationStatus === "queued" && (
              <button type="button" onClick={() => void startPreparation()} disabled={preparing}
                className="mt-8 rounded-full bg-zeya-champagne px-7 py-3.5 text-sm font-medium text-zeya-void disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-ivory">
                Begin preparation
              </button>
            )}
            {(preparationStatus === "failed" || preparationStatus === "partial") && preparation.attemptCount < 3 && (
              <button type="button" onClick={() => void startPreparation()} disabled={preparing}
                className="mt-8 rounded-full border border-zeya-champagne/50 px-6 py-3 text-sm text-zeya-ivory disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-champagne">
                {preparing ? "Retrying…" : "Try preparation again"}
              </button>
            )}
            {preparationStatus === "running" && preparation.retryAvailable && (
              <button type="button" onClick={() => void startPreparation()} disabled={preparing}
                className="mt-8 rounded-full border border-zeya-champagne/50 px-6 py-3 text-sm text-zeya-ivory disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zeya-champagne">
                Retry expired preparation
              </button>
            )}
            {preparation.attemptCount >= 3 && preparationStatus !== "ready" && (
              <p className="mt-8 max-w-xl text-sm leading-6 text-zeya-taupe">The safe retry limit has been reached. Your profile and any sourced evidence remain preserved.</p>
            )}
          </section>
        )}

        {surface === "error" && (
          <section aria-labelledby="onboarding-error-title" className="w-full text-center">
            <h1 id="onboarding-error-title" className="font-serif text-3xl">Our first meeting is still here.</h1>
            <p role="alert" className="mx-auto mt-5 max-w-lg leading-7 text-zeya-taupe">{requestError}</p>
            <button
              type="button"
              onClick={() => {
                setSurface("loading");
                setRequestError(null);
                void loadStatus();
              }}
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

type ProfileFieldProps = {
  id: DirectHireProfileField;
  label: string;
  explanation: string;
  value: string;
  error?: string;
  autoComplete?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  multiline?: boolean;
  inputRef: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onChange: (value: string) => void;
};

function ProfileField({
  id,
  label,
  explanation,
  value,
  error,
  autoComplete,
  inputMode,
  multiline = false,
  inputRef,
  onChange,
}: ProfileFieldProps) {
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;
  const common = {
    id,
    name: id,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value),
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${descriptionId} ${errorId}` : descriptionId,
    className: "mt-2 w-full rounded-xl border border-zeya-ivory/15 bg-zeya-ivory/[0.04] px-4 py-3 text-base text-zeya-ivory outline-none transition-colors placeholder:text-zeya-taupe/50 focus:border-zeya-champagne/70 focus:ring-1 focus:ring-zeya-champagne/50",
  };

  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-zeya-ivory">{label}</label>
      <p id={descriptionId} className="mt-1 text-sm leading-6 text-zeya-taupe">{explanation}</p>
      {multiline ? (
        <textarea
          {...common}
          ref={inputRef}
          rows={4}
          maxLength={500}
        />
      ) : (
        <input
          {...common}
          ref={inputRef}
          type={id === "phone" ? "tel" : id === "website" ? "url" : "text"}
          autoComplete={autoComplete}
          inputMode={inputMode}
          maxLength={id === "website" ? 2048 : id === "businessName" ? 160 : 120}
        />
      )}
      {error && <p id={errorId} role="alert" className="mt-2 text-sm text-red-200">{error}</p>}
    </div>
  );
}

function PreparationItem({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-center justify-between gap-6 py-4">
      <dt className="text-sm text-zeya-ivory">{label}</dt>
      <dd className="text-xs uppercase tracking-[0.18em] text-zeya-taupe">{status}</dd>
    </div>
  );
}

function displayStatus(status: DirectHirePreparationStatus): string {
  return status === "not_started" ? "Not started" : status[0].toUpperCase() + status.slice(1);
}

function displayProgress(status: DirectHirePreparationView["progress"][keyof DirectHirePreparationView["progress"]]): string {
  if (!status) return "Pending";
  return status[0].toUpperCase() + status.slice(1);
}

function preparationFailureMessage(code: DirectHirePreparationView["failureCode"]): string {
  switch (code) {
    case "unsupported_site": return "The website could not be reached safely over HTTPS.";
    case "unsafe_destination": return "The website destination did not pass the public-network safety checks.";
    case "unsupported_content_type": return "The website did not return a supported HTML page.";
    case "response_too_large": return "The public page was larger than the safe review limit.";
    case "request_timeout": return "The public website did not respond within the safe review time.";
    default: return "I could not safely obtain usable public website evidence. I have not filled the gaps with guesses.";
  }
}
