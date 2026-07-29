"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { SpatialPresence } from "@/components/landing/presence/SpatialPresence";
import { MinimalNav } from "@/components/landing/presence/MinimalNav";
import { CenterArtifact } from "@/components/landing/presence/CenterArtifact";

export default function LandingPage() {
  const router = useRouter();
  const { openAuth, user, loading } = useAuth();

  // Redirect authenticated users to Formation entry
  // Use router.replace to avoid history stack issues with auth flow
  useEffect(() => {
    if (user && !loading) {
      router.replace("/formation/entry");
    }
  }, [user, loading, router]);

  const handleExperience = () => {
    router.push("/experience");
  };

  const handleSignIn = () => {
    openAuth("sign-in");
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void">
      <SpatialPresence />
      <MinimalNav onEnterClick={handleSignIn} />
      <CenterArtifact onExperience={handleExperience} />
    </main>
  );
}
