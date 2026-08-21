"use client";

import Link from "next/link";
import { useAuth } from "@/components/auth/auth-provider";
import { PostCallExecutiveBriefCard } from "@/components/briefing-room/PostCallExecutiveBriefCard";

export function MissionExecutiveBriefPage({ missionId }: { missionId: string }) {
  const { session } = useAuth();
  return <main className="min-h-dvh bg-[#0a0709] px-4 py-12 text-zeya-ivory sm:py-16">
    <div className="mx-auto max-w-4xl">
      <Link href="/app" className="text-xs text-zeya-hush/55">← Back to Zeya</Link>
      <div className="mt-8"><PostCallExecutiveBriefCard missionId={missionId} session={session} /></div>
    </div>
  </main>;
}
