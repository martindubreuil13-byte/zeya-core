export interface LivingRepresentationData {
  businessId: string;
  representationId: string;
  version: {
    id: string;
    number: number;
    confidenceScore: number;
    createdAt: string;
    isCanonical: boolean;
    elementValues: Record<string, unknown>;
  };
}

export type LivingRepresentationState =
  | "loading"
  | "loaded"
  | "error"
  | "no_business"
  | "no_representation"
  | "no_version"
  | "multiple_businesses";

type Props = {
  state: LivingRepresentationState;
  data: LivingRepresentationData | null;
  error: string | null;
  loadTimeout?: boolean;
  actionsDisabled?: boolean;
  onReload?: () => void;
  onStartOnboarding?: () => void;
  onSignOut?: () => void;
};

const TITLES: Record<string, string> = {
  business_identity: "What the business is",
  offer: "What it provides",
  customer: "Who it represents itself to",
  market: "Market context",
  positioning: "How it positions itself",
  differentiation: "What makes it different",
  objections: "Common objections",
  trust: "Building trust",
  qualification: "Who is a good fit",
  commercial_objectives: "Business goals",
  operational_constraints: "Boundaries and constraints",
  channel_expression: "Communication character",
};

export function LivingRepresentationView({
  state,
  data,
  error,
  loadTimeout = false,
  actionsDisabled = false,
  onReload,
  onStartOnboarding,
  onSignOut,
}: Props) {
  const buttonDisabled = actionsDisabled;

  if (state === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="space-y-4 text-center">
          <div className="inline-flex"><div className="h-12 w-12 animate-spin rounded-full border border-slate-300 border-t-blue-600" /></div>
          <p className="text-slate-600">Loading your Representation...</p>
          {loadTimeout && <div className="pt-4"><p className="mb-2 text-sm text-slate-500">This is taking longer than expected.</p><button disabled={buttonDisabled} onClick={onReload} className="rounded bg-blue-600 px-4 py-2 text-sm text-white disabled:opacity-50">Reload</button></div>}
        </div>
      </div>
    );
  }

  const emptyConfig = state === "no_business"
    ? { title: "No business found", action: "Start Onboarding", onAction: onStartOnboarding }
    : state === "multiple_businesses"
      ? { title: "Multiple businesses", action: "Retry", onAction: onReload }
      : state === "no_representation" || state === "no_version"
        ? { title: "Representation not yet ready", action: "Refresh", onAction: onReload }
        : null;

  if (emptyConfig) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="mx-auto w-full max-w-lg px-6 text-center">
          <p className="text-slate-700">{emptyConfig.title}</p>
          <p className="mt-4 text-sm text-slate-500">{error}</p>
          <button disabled={buttonDisabled} onClick={emptyConfig.onAction} className="mt-6 rounded bg-blue-600 px-6 py-3 text-white disabled:opacity-50">{emptyConfig.action}</button>
        </div>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
        <div className="mx-auto w-full max-w-lg px-6 text-center">
          <p className="text-slate-700">Unable to load Representation</p>
          <p className="mt-4 text-sm text-slate-500">{error}</p>
          <div className="flex justify-center gap-3 pt-4">
            <button disabled={buttonDisabled} onClick={onReload} className="rounded bg-blue-600 px-6 py-2 text-sm text-white disabled:opacity-50">Try again</button>
            <button disabled={buttonDisabled} onClick={onSignOut} className="rounded border border-slate-300 px-6 py-2 text-sm text-slate-700 disabled:opacity-50">Sign out</button>
          </div>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const date = new Date(data.version.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto w-full max-w-2xl px-6 py-12">
        <div className="mb-12 space-y-2"><h1 className="text-4xl font-light tracking-tight text-slate-900">Welcome back.</h1><p className="text-lg text-slate-600">Your Representation is ready.</p></div>
        <div className="mb-8 text-sm text-slate-500"><div className="flex items-center gap-4 border-b border-slate-200 pb-4"><span>Version 0.{data.version.number}</span><span>•</span><span>Confidence {data.version.confidenceScore}%</span><span>•</span><span>{date}</span></div></div>
        <div className="mb-12 space-y-10">
          <div><h2 className="mb-3 text-sm uppercase tracking-wider text-slate-500">What we understand about your business</h2>
            <div className="space-y-8">{Object.entries(data.version.elementValues).map(([key, element]) => {
              if (!element || typeof element !== "object") return null;
              const record = element as Record<string, unknown>;
              const value = record.value ?? record.current_value ?? element;
              if (!value) return null;
              return <div key={key}><p className="mb-2 text-xs uppercase tracking-wider text-slate-400">{TITLES[key] ?? key}</p><p className="leading-relaxed text-slate-700">{typeof value === "string" ? value : JSON.stringify(value)}</p></div>;
            })}</div>
          </div>
        </div>
        <div className="border-t border-slate-200 pt-8"><p className="mb-4 text-sm text-slate-500">Continue developing your Representation</p><button disabled={buttonDisabled} className="w-full rounded bg-blue-600 px-6 py-4 font-medium text-white disabled:opacity-50">Talk with Zeya</button><p className="mt-3 text-xs text-slate-400">Use this action to have ongoing conversations that deepen and evolve your Representation.</p></div>
      </div>
    </div>
  );
}
