"use client";

import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import type { PostCallExecutiveBriefV1 } from "@/lib/work/post-call-executive-brief";

export function PostCallExecutiveBriefCard({ missionId, session }: { missionId: string; session: Session | null }) {
  const [brief, setBrief] = useState<PostCallExecutiveBriefV1 | null>(null);
  const [notReady, setNotReady] = useState(false);
  useEffect(() => {
    if (!session?.access_token) return;
    const controller = new AbortController();
    void fetch(`/api/work/missions/${encodeURIComponent(missionId)}/executive-brief`, { headers: { Authorization: `Bearer ${session.access_token}` }, signal: controller.signal })
      .then(async response => ({ response, body: await response.json() as { data?: PostCallExecutiveBriefV1 } }))
      .then(({ response, body }) => { if (response.ok && body.data) setBrief(body.data); else setNotReady(true); })
      .catch(error => { if (error instanceof Error && error.name !== "AbortError") setNotReady(true); });
    return () => controller.abort();
  }, [missionId, session?.access_token]);
  if (!brief) return notReady ? null : <section aria-label="Executive brief" className="py-5 text-sm text-zeya-hush/50">Preparing the executive brief…</section>;
  return <section aria-label="Executive brief" className="w-full rounded-2xl border border-zeya-champagne/20 bg-zeya-aubergine/20 p-5 sm:p-7">
    <div className="flex items-center justify-between gap-4"><div><p className="text-[0.55rem] uppercase tracking-[0.24em] text-zeya-hush/42">Post-call intelligence</p><h2 className="mt-1 text-xl font-light text-zeya-ivory/90">How the call went</h2></div><span className="rounded-full border border-zeya-champagne/25 px-3 py-1 text-xs capitalize text-zeya-champagne/80">{brief.ownerAttention.level}</span></div>
    <div className="mt-6 grid gap-6 md:grid-cols-2"><div><h3 className="text-xs uppercase tracking-wider text-zeya-champagne/65">What happened</h3><p className="mt-2 text-sm leading-6 text-zeya-ivory/78">{brief.whatHappened}</p></div><div><h3 className="text-xs uppercase tracking-wider text-zeya-champagne/65">What matters</h3><ul className="mt-2 space-y-1 text-sm text-zeya-hush/70">{brief.prospectState.map(item => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="text-xs uppercase tracking-wider text-zeya-champagne/65">What remains unknown</h3><ul className="mt-2 space-y-1 text-sm text-zeya-hush/70">{brief.whatWeDidNotLearn.map(item => <li key={item}>• {item}</li>)}</ul></div><div><h3 className="text-xs uppercase tracking-wider text-zeya-champagne/65">What I recommend</h3><p className="mt-2 text-sm text-zeya-ivory/78">{brief.recommendedNextAction}</p>{brief.followUp.obligation && <p className="mt-2 text-xs text-zeya-hush/55">{brief.followUp.obligation}</p>}</div></div>
    <div className="mt-6 border-t border-zeya-graphite/25 pt-4"><p className="text-xs text-zeya-hush/55">Owner attention · {brief.ownerAttention.reasons.join(" ") || "No immediate action required."}</p></div>
  </section>;
}
