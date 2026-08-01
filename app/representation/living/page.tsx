"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/auth-provider";
import { authenticatedFetch } from "@/lib/auth/authenticated-fetch";
import {
  LivingRepresentationView,
  type LivingRepresentationData,
  type LivingRepresentationState,
} from "@/components/representation/LivingRepresentationView";

export default function LivingRepresentationPage() {
  const router = useRouter();
  const { user, session, loading: authLoading } = useAuth();
  const [data, setData] = useState<LivingRepresentationData | null>(null);
  const [state, setState] = useState<LivingRepresentationState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [loadTimeout, setLoadTimeout] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [user, authLoading, router]);

  useEffect(() => {
    if (authLoading || !session) return;
    let timeoutId: ReturnType<typeof setTimeout>;
    const loadRepresentation = async () => {
      try {
        setState("loading");
        setError(null);
        setLoadTimeout(false);
        timeoutId = setTimeout(() => setLoadTimeout(true), 8000);
        const res = await authenticatedFetch("/api/representation/living", session);
        clearTimeout(timeoutId);
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: "Request failed" }));
          if (res.status === 404 && body.state === "no_business") {
            setState("no_business"); setError("No business found. Please complete onboarding first.");
          } else if (res.status === 404 && body.state === "no_representation") {
            setState("no_representation"); setError("No representation found.");
          } else if (res.status === 404 && body.state === "no_canonical_version") {
            setState("no_version"); setError("No canonical version exists yet.");
          } else if (res.status === 409 && body.state === "multiple_businesses") {
            setState("multiple_businesses"); setError("Multiple businesses found. Business selection coming soon.");
          } else {
            setState("error"); setError(body.error || "Failed to load representation");
          }
          return;
        }
        const body = await res.json();
        if (body.success && body.data) {
          setData(body.data); setState("loaded");
        } else {
          setState("error"); setError(body.error || "Failed to load representation");
        }
      } catch (caught) {
        clearTimeout(timeoutId!);
        console.error("[living-representation] Failed:", caught);
        setState("error");
        setError(caught instanceof Error ? caught.message : "Failed to load representation");
      }
    };
    void loadRepresentation();
    return () => clearTimeout(timeoutId);
  }, [session, authLoading, router]);

  return (
    <LivingRepresentationView
      state={authLoading ? "loading" : state}
      data={data}
      error={error}
      loadTimeout={loadTimeout}
      onReload={() => window.location.reload()}
      onStartOnboarding={() => router.replace("/formation/entry")}
      onSignOut={() => router.replace("/login")}
    />
  );
}
