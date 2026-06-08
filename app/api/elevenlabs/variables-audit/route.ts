// POST /api/elevenlabs/variables-audit
// Diagnostic endpoint to audit dynamic variables sent to ElevenLabs

import { NextRequest, NextResponse } from "next/server";
import {
  buildWorkerBrief,
  selectWorkerForBrief,
  dispatchWorkerBrief,
} from "@/lib/workers";

interface AuditRequest {
  missionId: string;
  companyContext: string;
  leadContext?: string;
  objective: string;
  desiredOutcome: string;
  targetPhone: string;
  targetName?: string;
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as AuditRequest;

    console.log("[variables-audit] 🔵 Audit request received", {
      objective: body.objective,
      targetPhone: body.targetPhone,
    });

    // Build WorkerBrief with all standard variables
    const brief = buildWorkerBrief({
      missionId: body.missionId,
      workerType: "CALLER",
      companyContext: body.companyContext,
      leadContext: body.leadContext || body.targetName,
      objective: body.objective,
      desiredOutcome: body.desiredOutcome,
      keyQuestions: [
        "What are your current challenges?",
        "How can we help?",
      ],
      objectionGuidance: ["Address concerns with data"],
      escalationRules: ["Escalate if interested"],
      successCriteria: "User expressed interest",
      toneGuidance: "Professional and warm",
      // Add comprehensive dynamic variables
      dynamicVariables: {
        planId: `plan_${Date.now()}` as string | number | boolean | null,
        stepId: `step_${Date.now()}` as string | number | boolean | null,
        stepNumber: 1,
        target: body.targetName || body.companyContext,
        targetPhone: body.targetPhone,
        mode: "OPERATIONAL",
        priority: "NORMAL",
        intent: "initial_contact",
        confidence: 0.85,
        inferredTrigger: "outbound_campaign",
        inferredAudience: "business_owner",
        inferredBusinessModel: "saas",
        keyTalkingPoints: "Help businesses grow | Easy to use | Proven results",
        inferredPainPoints: "Time constraints | Limited resources | Need efficiency",
        leadContext: body.leadContext || body.targetName,
        companyContext: body.companyContext,
        businessSummary: "Modern AI platform for business automation",
        missionObjective: body.objective,
      } as Record<string, string | number | boolean | null>,
    });

    console.log("[variables-audit] 📊 WorkerBrief created", {
      briefId: brief.id,
      workerName: brief.workerName,
      variableCount: Object.keys(brief.dynamicVariables).length,
    });

    // Log all variables with types
    const variablesWithTypes = Object.entries(brief.dynamicVariables).map(
      ([key, value]) => ({
        key,
        value,
        type: typeof value,
      })
    );

    console.log("[variables-audit] 📋 All dynamic variables", {
      variables: variablesWithTypes,
    });

    // Build the payload that would be sent to ElevenLabs
    const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_test";
    const agentBranchId = process.env.ELEVENLABS_AGENT_BRANCH_ID || "agtbrch_test";
    const webhookUrl =
      process.env.ELEVENLABS_WEBHOOK_URL || "https://zeya.app/api/webhooks/elevenlabs";

    const elevenlabsPayload = {
      agent_id: agentId,
      agent_phone_number_id: "phnum_test",
      to_number: body.targetPhone,
      conversation_initiation_client_data: {
        user_id: brief.id,
        branch_id: agentBranchId,
        dynamic_variables: brief.dynamicVariables,
        webhook_url: webhookUrl,
      },
    };

    console.log("[variables-audit] 🔵 ElevenLabs payload to be sent", {
      payload: elevenlabsPayload,
    });

    // Analyze which variables would be visible in ElevenLabs UI
    const uiVisibleVariables = [
      "target",
      "missionObjective",
      "objective",
      "workerName",
      "companyContext",
      "leadContext",
      "targetPhone",
      "businessSummary",
    ];

    const actualVariables = Object.keys(brief.dynamicVariables);
    const visibleInUI = actualVariables.filter((v) =>
      uiVisibleVariables.includes(v)
    );
    const notVisibleInUI = actualVariables.filter(
      (v) => !uiVisibleVariables.includes(v)
    );

    const analysis = {
      totalVariables: actualVariables.length,
      variablesList: actualVariables,
      visibleInUI: visibleInUI.length,
      visibleVariables: visibleInUI,
      notVisibleInUI: notVisibleInUI.length,
      notVisibleVariables: notVisibleInUI,
      notes: {
        whyNotVisible:
          "ElevenLabs UI only shows variables that are referenced in the agent prompt or match common naming patterns (like variables starting with 'target', 'mission', or 'objective'). All variables ARE sent to the agent via conversation_initiation_client_data.dynamic_variables, but ElevenLabs may only display known/referenced ones.",
        allVariablesSent:
          "YES - All variables in conversation_initiation_client_data.dynamic_variables are accessible to the agent during the call, even if not shown in UI.",
        agentAccess: "Veya receives ALL variables via the ElevenLabs SDK context",
      },
    };

    console.log("[variables-audit] 📊 Analysis complete", {
      totalVariables: analysis.totalVariables,
      visibleInUI: analysis.visibleInUI,
      notVisibleInUI: analysis.notVisibleInUI,
    });

    const response = {
      success: true,
      brief: {
        id: brief.id,
        workerName: brief.workerName,
        workerType: brief.workerType,
        objective: brief.objective,
        desiredOutcome: brief.desiredOutcome,
        companyContext: brief.companyContext,
        leadContext: brief.leadContext,
      },
      dynamicVariables: brief.dynamicVariables,
      elevenlabsPayload: {
        description: "Exact payload sent to ElevenLabs SIP trunk API",
        payload: elevenlabsPayload,
      },
      analysis: analysis,
      recommendations: {
        minimumContextVariables: [
          "target",
          "missionObjective", // or objective
          "leadContext",
          "companyContext",
          "desiredOutcome",
          "workerName",
          "businessSummary",
          "missionId",
        ],
        enhanced: [
          "keyTalkingPoints",
          "inferredPainPoints",
          "intent",
          "confidence",
          "priority",
          "mode",
        ],
        advanced: [
          "inferredTrigger",
          "inferredAudience",
          "inferredBusinessModel",
          "escalationRules",
          "objectionGuidance",
        ],
      },
      howToMakeVeyaContextAware: {
        step1: "All variables in dynamic_variables are sent to ElevenLabs",
        step2:
          "ElevenLabs stores them in conversation context during the call",
        step3:
          "Your agent prompt in ElevenLabs must explicitly reference these variables to use them",
        step4:
          "Edit Veya's system prompt to say something like: 'Use {{target}} as the prospect name, {{companyContext}} for business background, {{desiredOutcome}} as the call goal'",
        step5: "Double-bracket syntax {{variableName}} is standard for ElevenLabs variable substitution",
      },
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[variables-audit] 🔴 Error", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
