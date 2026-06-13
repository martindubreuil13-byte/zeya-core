import type { DispatchRecord, DispatchPayload, AgentBrief, DispatchStatus } from "./types";

const DISPATCH_STORAGE_KEY = "zeya_dispatches";

/**
 * Store dispatch record in localStorage
 * In production, this would persist to Supabase
 */
export function persistDispatch(payload: DispatchPayload, brief: AgentBrief): DispatchRecord {
  const record: DispatchRecord = {
    dispatch_id: payload.id,
    payload,
    brief,
    status: "queued",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Get existing dispatches
  const existing = getAllDispatches();
  existing.push(record);

  // Store in localStorage
  localStorage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(existing));

  // Log for visibility
  console.log("[Dispatch Persisted]", record);

  return record;
}

/**
 * Retrieve all dispatch records
 */
export function getAllDispatches(): DispatchRecord[] {
  try {
    const stored = localStorage.getItem(DISPATCH_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch (error) {
    console.error("Error reading dispatches", error);
    return [];
  }
}

/**
 * Get dispatch by ID
 */
export function getDispatch(dispatchId: string): DispatchRecord | null {
  const all = getAllDispatches();
  return all.find((d) => d.dispatch_id === dispatchId) || null;
}

/**
 * Update dispatch status
 */
export function updateDispatchStatus(dispatchId: string, status: DispatchStatus): DispatchRecord | null {
  const all = getAllDispatches();
  const index = all.findIndex((d) => d.dispatch_id === dispatchId);

  if (index < 0) return null;

  all[index].status = status;
  all[index].updated_at = new Date().toISOString();

  localStorage.setItem(DISPATCH_STORAGE_KEY, JSON.stringify(all));
  console.log(`[Dispatch Updated] ${dispatchId} → ${status}`);

  return all[index];
}

/**
 * Get dispatches by status
 */
export function getDispatchesByStatus(status: DispatchStatus): DispatchRecord[] {
  return getAllDispatches().filter((d) => d.status === status);
}

/**
 * Clear all dispatches (development only)
 */
export function clearAllDispatches(): void {
  localStorage.removeItem(DISPATCH_STORAGE_KEY);
  console.log("[Dispatches Cleared]");
}
