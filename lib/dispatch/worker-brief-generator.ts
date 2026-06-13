/**
 * Worker Brief Generation from Experience Context
 * Converts visitor experience data into worker brief for agents
 */

import { createClient } from "@supabase/supabase-js";
import type { AgentBrief } from "./types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const supabase = createClient(supabaseUrl || "", supabaseKey || "");

export interface WorkerBriefInput {
  businessId: string;
  visitorName: string;
  businessOffer: string;
  targetBuyer: string;
  agentBrief: AgentBrief;
  dispatchId: string;
}

export async function generateWorkerBrief(input: WorkerBriefInput) {
  try {
    // Generate unique brief ID
    const briefId = `brief_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

    // Create mission key (for linking to missions if needed)
    const missionKey = `experience_${input.dispatchId}`;

    // Build key questions for the agent
    const keyQuestions = [
      "What is the main challenge with getting more conversations right now?",
      "How are you currently trying to reach your ideal customers?",
      "What would change if you had more qualified conversations coming in?",
    ];

    // Build objection guidance
    const objectionGuidance = [
      {
        objection: "I'm not sure this is right for us",
        response:
          "That's fair. What would need to be true for this to be right for you?",
      },
      {
        objection: "We're happy with how things are",
        response:
          "I hear that. Even if things are working, would more qualified conversations change anything?",
      },
      {
        objection: "We need to think about it",
        response:
          "Completely fair. What would help you make a decision - any questions I can answer now?",
      },
    ];

    // Build escalation rules
    const escalationRules = [
      {
        condition: "Visitor expresses high interest",
        action: "Move toward demonstration call proposal",
      },
      {
        condition: "Budget concerns arise",
        action: "Focus on ROI - more conversations = more revenue",
      },
      {
        condition: "Technical concerns",
        action: "Defer to technical team - this is about business outcome first",
      },
    ];

    // Create tone guidance
    const toneGuidance =
      "Be warm and conversational. You're a consultant helping them think through their situation, not a salesperson. Help them visualize what it would look like if more conversations came in. Be curious about their business.";

    // Success criteria
    const successCriteria =
      "Visitor understands what representation means. Visitor can imagine Zeya working on behalf of their business. Visitor agrees to or considers a demonstration call.";

    // Build dynamic variables for runtime substitution
    const dynamicVariables = {
      visitor_name: input.visitorName,
      business_offer: input.businessOffer,
      target_buyer: input.targetBuyer,
    };

    // Insert into worker_briefs table
    const { data, error } = await supabase.from("worker_briefs").insert({
      id: briefId,
      mission_id: missionKey,
      business_id: input.businessId,
      target_name: input.visitorName,
      target_phone: "pending", // Will be filled after phone collection
      objective: input.agentBrief.outreach_objective,
      desired_outcome:
        "Visitor agrees to see a demonstration of how Zeya represents their business",
      company_context: `${input.visitorName} runs a business that ${input.businessOffer}.`,
      lead_context: `They're looking to create more conversations with ${input.targetBuyer}.`,
      key_questions: keyQuestions,
      objection_guidance: objectionGuidance,
      escalation_rules: escalationRules,
      tone_guidance: toneGuidance,
      success_criteria: successCriteria,
      dynamic_variables: dynamicVariables,
    });

    if (error) {
      console.error("[Worker Brief Creation Error]", error);
      return null;
    }

    console.log("[Worker Brief Generated]", briefId);
    return {
      id: briefId,
      mission_id: missionKey,
      business_id: input.businessId,
      objective: input.agentBrief.outreach_objective,
    };
  } catch (error) {
    console.error("[Worker Brief Generation Failed]", error);
    return null;
  }
}

/**
 * Update worker brief with phone number after collection
 */
export async function updateWorkerBriefWithPhone(
  briefId: string,
  phoneNumber: string
) {
  try {
    const { error } = await supabase
      .from("worker_briefs")
      .update({
        target_phone: phoneNumber,
        updated_at: new Date().toISOString(),
      })
      .eq("id", briefId);

    if (error) {
      console.error("[Worker Brief Update Error]", error);
      return false;
    }

    console.log("[Worker Brief Updated]", briefId, phoneNumber);
    return true;
  } catch (error) {
    console.error("[Worker Brief Update Failed]", error);
    return false;
  }
}

/**
 * Link dispatch to worker brief
 */
export async function linkDispatchToWorkerBrief(
  dispatchId: string,
  briefId: string
) {
  try {
    const { error } = await supabase
      .from("dispatches")
      .update({
        worker_brief_id: briefId,
        updated_at: new Date().toISOString(),
      })
      .eq("dispatch_id", dispatchId);

    if (error) {
      console.error("[Dispatch-Brief Link Error]", error);
      return false;
    }

    console.log("[Dispatch Linked to Brief]", dispatchId, briefId);
    return true;
  } catch (error) {
    console.error("[Dispatch-Brief Link Failed]", error);
    return false;
  }
}
