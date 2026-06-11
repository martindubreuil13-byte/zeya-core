"use client";

import { useRouter } from "next/navigation";
import { SpatialPresence } from "@/components/landing/presence/SpatialPresence";
import { MinimalNav } from "@/components/landing/presence/MinimalNav";
import { CenterArtifact } from "@/components/landing/presence/CenterArtifact";

export default function LandingPage() {
  const router = useRouter();

  const handleExperience = () => {
    router.push("/experience");
  };

  const handleSignIn = () => {
    router.push("/auth/login");
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void">
      <SpatialPresence />
      <MinimalNav onEnterClick={handleSignIn} />
      <CenterArtifact onExperience={handleExperience} />
    </main>
  );
}
