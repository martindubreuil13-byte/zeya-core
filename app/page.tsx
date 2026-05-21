"use client";

import { AmbientBackground } from "@/components/layout";
import {
  ClosingCTA,
  ConversationalMoments,
  HeroSection,
  LandingNav,
  PositioningSection,
} from "@/components/landing";

export default function LandingPage() {
  return (
    <main className="relative isolate min-h-dvh overflow-x-hidden">
      {/* Fixed atmospheric backdrop — stays behind all scrolling sections */}
      <AmbientBackground fixed />

      <LandingNav />
      <HeroSection />
      <PositioningSection />
      <ConversationalMoments />
      <ClosingCTA />
    </main>
  );
}
