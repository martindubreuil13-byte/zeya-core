/**
 * Dispatch Monitor
 * Operational visibility into dispatch lifecycle
 * For operators and business owners
 */

"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
import type { DispatchStatus } from "@/lib/dispatch/types";

interface DispatchRecord {
  dispatch_id: string;
  visitor_name: string;
  phone_number: string;
  status: DispatchStatus;
  business_offer: string;
  created_at: string;
  updated_at: string;
  execution_attempts?: number;
  last_error?: string;
}

export function DispatchMonitor({ userId }: { userId: string }) {
  const [dispatches, setDispatches] = useState<DispatchRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<DispatchStatus | "all">("all");

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    return createClient(url || "", key || "");
  }, []);

  // Load dispatches on mount and set up polling
  useEffect(() => {
    const loadDispatches = async () => {
      try {
        let query = supabase
          .from("dispatches")
          .select("*")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (filter !== "all") {
          query = query.eq("status", filter);
        }

        const { data, error } = await query;

        if (error) {
          console.error("[Monitor Load Error]", error);
          return;
        }

        setDispatches(data || []);
      } finally {
        setIsLoading(false);
      }
    };

    loadDispatches();

    // Poll for updates every 5 seconds
    const interval = setInterval(loadDispatches, 5000);

    return () => clearInterval(interval);
  }, [userId, filter]);

  const getStatusColor = (status: DispatchStatus) => {
    switch (status) {
      case "draft":
        return "text-zeya-taupe";
      case "queued":
        return "text-zeya-champagne";
      case "calling":
        return "text-zeya-champagne";
      case "answered":
        return "text-green-400";
      case "completed":
        return "text-green-400";
      case "no_answer":
        return "text-yellow-400";
      case "failed":
        return "text-red-400";
      default:
        return "text-zeya-ivory";
    }
  };

  const getStatusBg = (status: DispatchStatus) => {
    switch (status) {
      case "draft":
        return "bg-zeya-void/80 border-zeya-taupe/20";
      case "queued":
        return "bg-zeya-void/80 border-zeya-champagne/20";
      case "calling":
        return "bg-zeya-void/80 border-zeya-champagne/30";
      case "answered":
        return "bg-green-950/40 border-green-700/50";
      case "completed":
        return "bg-green-950/40 border-green-700/30";
      case "no_answer":
        return "bg-yellow-950/30 border-yellow-700/40";
      case "failed":
        return "bg-red-950/40 border-red-700/50";
      default:
        return "bg-zeya-void/80 border-zeya-hush/20";
    }
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const statusOptions: (DispatchStatus | "all")[] = [
    "all",
    "draft",
    "queued",
    "calling",
    "answered",
    "no_answer",
    "completed",
    "failed",
  ];

  return (
    <div className="w-full h-full bg-zeya-void flex flex-col">
      {/* Header */}
      <div className="border-b border-zeya-hush/20 p-6">
        <h2
          className="text-lg font-light text-zeya-ivory"
          style={{ letterSpacing: "0.08em" }}
        >
          DISPATCH MONITOR
        </h2>
        <p
          className="text-xs text-zeya-taupe mt-2"
          style={{ letterSpacing: "0.05em" }}
        >
          Operational visibility into outbound dispatch pipeline
        </p>
      </div>

      {/* Filter Bar */}
      <div className="border-b border-zeya-hush/10 px-6 py-4">
        <div className="flex gap-2 overflow-x-auto pb-2">
          {statusOptions.map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`px-3 py-1.5 text-xs font-light whitespace-nowrap border rounded transition-all ${
                filter === status
                  ? "border-zeya-champagne bg-zeya-champagne/10 text-zeya-champagne"
                  : "border-zeya-taupe/30 text-zeya-taupe hover:border-zeya-taupe"
              }`}
              style={{ letterSpacing: "0.05em" }}
            >
              {status.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zeya-taupe text-sm font-light">
              Loading dispatches...
            </p>
          </div>
        ) : dispatches.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-zeya-taupe text-sm font-light">
              No dispatches yet
            </p>
          </div>
        ) : (
          <div className="space-y-2 p-6">
            {dispatches.map((dispatch) => (
              <div
                key={dispatch.dispatch_id}
                className={`border rounded p-4 ${getStatusBg(dispatch.status)}`}
              >
                {/* Row 1: ID and Status */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <p
                      className="text-xs text-zeya-taupe opacity-60 font-light"
                      style={{ letterSpacing: "0.08em" }}
                    >
                      DISPATCH ID
                    </p>
                    <p className="text-xs font-mono text-zeya-ivory opacity-80 mt-1">
                      {dispatch.dispatch_id.slice(0, 24)}...
                    </p>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-xs font-light uppercase ${getStatusColor(dispatch.status)}`}
                      style={{ letterSpacing: "0.1em" }}
                    >
                      {dispatch.status}
                    </p>
                    {dispatch.status === "calling" && (
                      <div className="mt-1">
                        <span className="inline-block w-1.5 h-1.5 bg-zeya-champagne rounded-full animate-pulse" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Row 2: Visitor and Business */}
                <div className="grid grid-cols-2 gap-4 mb-3">
                  <div>
                    <p
                      className="text-xs text-zeya-taupe opacity-60 font-light"
                      style={{ letterSpacing: "0.05em" }}
                    >
                      Visitor
                    </p>
                    <p className="text-sm text-zeya-ivory opacity-85 mt-1">
                      {dispatch.visitor_name}
                    </p>
                  </div>
                  <div>
                    <p
                      className="text-xs text-zeya-taupe opacity-60 font-light"
                      style={{ letterSpacing: "0.05em" }}
                    >
                      Phone
                    </p>
                    <p className="text-sm text-zeya-ivory opacity-85 mt-1 font-mono">
                      {dispatch.phone_number}
                    </p>
                  </div>
                </div>

                {/* Row 3: Business Offer */}
                <div className="mb-3">
                  <p
                    className="text-xs text-zeya-taupe opacity-60 font-light"
                    style={{ letterSpacing: "0.05em" }}
                  >
                    Business
                  </p>
                  <p className="text-sm text-zeya-ivory opacity-75 mt-1 line-clamp-1">
                    {dispatch.business_offer}
                  </p>
                </div>

                {/* Row 4: Timing */}
                <div className="flex items-end justify-between text-xs text-zeya-taupe opacity-50 font-light">
                  <span>Created: {formatTime(dispatch.created_at)}</span>
                  <span>Updated: {formatTime(dispatch.updated_at)}</span>
                </div>

                {/* Row 5: Error (if any) */}
                {dispatch.last_error && (
                  <div className="mt-3 pt-3 border-t border-red-700/20">
                    <p
                      className="text-xs text-red-400 opacity-80 font-light"
                      style={{ letterSpacing: "0.02em" }}
                    >
                      {dispatch.last_error}
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
