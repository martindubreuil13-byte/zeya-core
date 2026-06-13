/**
 * Dispatch Monitor Page
 * Operational dashboard for dispatch pipeline
 */

"use client";

import { useAuth } from "@/components/auth/auth-provider";
import { DispatchMonitor } from "@/components/dispatch/DispatchMonitor";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function MonitorPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push("/");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="w-full h-screen bg-zeya-void flex items-center justify-center">
        <p className="text-zeya-taupe text-sm font-light">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <main className="w-full h-screen bg-zeya-void">
      <DispatchMonitor userId={user.id} />
    </main>
  );
}
