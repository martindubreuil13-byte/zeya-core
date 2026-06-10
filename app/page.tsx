"use client";

import { SpatialPresence } from "@/components/landing/presence/SpatialPresence";
import { MinimalNav } from "@/components/landing/presence/MinimalNav";
import { MicrophoneInvitation } from "@/components/landing/presence/MicrophoneInvitation";

export default function LandingPage() {
  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void">
      <SpatialPresence />
      <MinimalNav />
      <MicrophoneInvitation />
    </main>
  );
}
