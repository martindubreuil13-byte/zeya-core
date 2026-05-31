// Zeya Operating View
// Composes the orchestration stack (Phase 1, 2, 3) into a unified operating view
// that the Briefing Room consumes

import {
  deriveBusinessState,
  deriveExecutiveGuidance,
  determineNextConversationObjective,
  buildBusinessStateInput,
  getFullBusinessContext,
} from "@/lib/workflow";
import type { BusinessState } from "@/lib/workflow/types";
import type { ExecutiveGuidance } from "@/lib/workflow/derive-executive-guidance";
import type { ConversationObjective } from "@/lib/workflow/conversation-objective-types";

export interface ZeyaOperatingView {
  businessState: BusinessState;
  executiveGuidance: ExecutiveGuidance;
  conversationObjective: ConversationObjective;
}

// ─── Composition Function ───────────────────────────────────────────────────

export async function composeZeyaOperatingView(
  supabase: any,
  businessId: string,
): Promise<ZeyaOperatingView | null> {
  try {
    // Get context from database
    const context = await getFullBusinessContext(supabase, businessId);

    // Phase 1: Derive business state
    const businessState = deriveBusinessState(buildBusinessStateInput(context));

    // Phase 2: Derive executive guidance
    const executiveGuidance = deriveExecutiveGuidance(businessState);

    // Phase 3: Determine conversation objective
    const conversationObjective = determineNextConversationObjective({
      businessState,
      executiveGuidance,
    });

    return {
      businessState,
      executiveGuidance,
      conversationObjective,
    };
  } catch (error) {
    console.error("[Zeya Operating View] Composition failed:", error);
    return null;
  }
}

// ─── Display Helper: Format Urgency Badge ──────────────────────────────────

export function formatUrgencyBadge(urgency: "LOW" | "MEDIUM" | "HIGH"): string {
  switch (urgency) {
    case "HIGH":
      return "Urgent";
    case "MEDIUM":
      return "In Progress";
    case "LOW":
      return "Watch";
  }
}

// ─── Display Helper: Format Readiness as Category ──────────────────────────

export function formatReadinessCategory(score: number): string {
  if (score < 20) return "Initial";
  if (score < 40) return "Establishing";
  if (score < 60) return "Developing";
  if (score < 80) return "Advanced";
  return "Complete";
}

// Round percentage to nearest 5% for human-readable display
export function roundPercentage(value: number): number {
  return Math.round(value / 5) * 5;
}

// Time-aware greeting based on user's local time
export function getTimeAwareGreeting(userName: string | null): string {
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 12) {
    return `Good morning${userName ? `, ${userName}` : ""}.`;
  } else if (hour >= 12 && hour < 18) {
    return `Good afternoon${userName ? `, ${userName}` : ""}.`;
  } else {
    return `Good evening${userName ? `, ${userName}` : ""}.`;
  }
}

// ─── Display Helper: Format Missing Info for UI ────────────────────────────

export function formatMissingInfoForBriefing(missing: string[]): string {
  if (missing.length === 0) return "All set.";

  const formatted = missing
    .slice(0, 3)
    .map((item) => {
      // Convert kebab-case to readable form
      return item
        .split("_")
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    })
    .join(", ");

  const suffix = missing.length > 3 ? ` and ${missing.length - 3} more` : "";
  return `I need: ${formatted}${suffix}.`;
}
