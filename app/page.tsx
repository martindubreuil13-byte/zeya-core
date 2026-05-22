"use client";

import { AmbientBackground } from "@/components/layout";
import {
  ClosingCTA,
  ConversationalMoments,
  HeroSection,
  LandingNav,
  PositioningSection,
} from "@/components/landing";
import { VoiceOverlay } from "@/components/voice/VoiceOverlay";

export default function LandingPage() {
  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden">
      {/* Fixed atmospheric backdrop — stays behind all scrolling sections */}
      <AmbientBackground fixed />

      <LandingNav />
      <HeroSection />
      <VoiceOverlay />
      <PositioningSection />
      <ConversationalMoments />
      <ClosingCTA />
    </main>
  );
}
