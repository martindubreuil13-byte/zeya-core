// POST /api/operational-intelligence/test-persistence
// Diagnostic endpoint to test persistence functions in isolation

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { saveWorkerBrief } from "@/lib/workers/worker-brief-repository";
import { saveBriefConversationMapping } from "@/lib/voice/persistence/brief-conversation-mapping-repository";
import type { WorkerBrief } from "@/lib/workers";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

interface TestPersistenceRequest {
  businessId: string;
  missionId: string;
}

export async function POST(req: NextRequest) {
  const errors: string[] = [];

  try {
    const body = (await req.json()) as TestPersistenceRequest;

    console.log("[test-persistence] 🔵 Diagnostic endpoint called", {
      businessId: body.businessId,
      missionId: body.missionId,
    });

    // Validate input
    if (!body.businessId || !body.missionId) {
      return NextResponse.json(
        { error: "Missing businessId or missionId" },
        { status: 400 }
      );
    }

    const businessId = body.businessId;
    const missionId = body.missionId;
    const workerBriefId = `test_brief_${Date.now()}`;

    console.log("[test-persistence] 📝 businessId received", { businessId });

    // Create minimal test WorkerBrief
    const testBrief: WorkerBrief = {
      id: workerBriefId,
      missionId,
      executionRequestId: `exec_${Date.now()}`,
      workerType: "CALLER",
      workerName: "TestCaller",
      status: "READY",
      objective: "Test persistence",
      desiredOutcome: "Verify database writes",
      companyContext: "Test company",
      leadContext: "Test lead",
      keyQuestions: ["Test question?"],
      objectionGuidance: ["Test objection"],
      escalationRules: ["Test escalation"],
      toneGuidance: "Friendly",
      successCriteria: "Persistence succeeds",
      dynamicVariables: {
        target: "Test Target",
        targetPhone: "+11234567890",
        missionId,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Test 1: saveWorkerBrief()
    console.log("[test-persistence] 🔵 Calling saveWorkerBrief()", {
      briefId: workerBriefId,
      businessId,
    });

    const saveResult = await saveWorkerBrief(
      testBrief,
      businessId,
      "Test Target",
      "+11234567890"
    );

    console.log("[test-persistence] 📊 saveWorkerBrief result", {
      success: saveResult.success,
      error: saveResult.error?.message,
      code: saveResult.error?.code,
    });

    if (!saveResult.success) {
      errors.push(`saveWorkerBrief failed: ${saveResult.error?.message}`);
    }

    // Test 2: saveBriefConversationMapping()
    console.log("[test-persistence] 🔵 Calling saveBriefConversationMapping()", {
      briefId: workerBriefId,
      missionId,
      businessId,
    });

    const mappingResult = await saveBriefConversationMapping(
      workerBriefId,
      missionId,
      businessId
    );

    console.log("[test-persistence] 📊 saveBriefConversationMapping result", {
      success: mappingResult.success,
      error: mappingResult.error?.message,
      code: mappingResult.error?.code,
    });

    if (!mappingResult.success) {
      errors.push(
        `saveBriefConversationMapping failed: ${mappingResult.error?.message}`
      );
    }

    // Verify reads (if persistence succeeded)
    let workerBriefRecord: any = null;
    let mappingRecord: any = null;

    if (saveResult.success && supabase) {
      console.log("[test-persistence] 🔵 Verifying worker_briefs insert", {
        briefId: workerBriefId,
      });

      const { data: briefData, error: briefError } = await supabase
        .from("worker_briefs")
        .select("*")
        .eq("id", workerBriefId)
        .single();

      if (briefError) {
        console.error("[test-persistence] 🔴 Failed to verify worker_briefs", {
          error: briefError.message,
          code: briefError.code,
        });
      } else if (briefData) {
        console.log("[test-persistence] 🟢 worker_briefs record found", {
          id: briefData.id,
          mission_id: briefData.mission_id,
          business_id: briefData.business_id,
        });
        workerBriefRecord = briefData;
      } else {
        console.warn(
          "[test-persistence] ⚠️  worker_briefs record not found after insert"
        );
        errors.push("worker_briefs record not found after insert");
      }
    }

    if (mappingResult.success && supabase) {
      console.log("[test-persistence] 🔵 Verifying brief_conversation_mappings insert", {
        briefId: workerBriefId,
      });

      const { data: mapData, error: mapError } = await supabase
        .from("brief_conversation_mappings")
        .select("*")
        .eq("worker_brief_id", workerBriefId)
        .single();

      if (mapError) {
        console.error(
          "[test-persistence] 🔴 Failed to verify brief_conversation_mappings",
          {
            error: mapError.message,
            code: mapError.code,
          }
        );
      } else if (mapData) {
        console.log(
          "[test-persistence] 🟢 brief_conversation_mappings record found",
          {
            worker_brief_id: mapData.worker_brief_id,
            mission_id: mapData.mission_id,
            business_id: mapData.business_id,
          }
        );
        mappingRecord = mapData;
      } else {
        console.warn(
          "[test-persistence] ⚠️  brief_conversation_mappings record not found after insert"
        );
        errors.push("brief_conversation_mappings record not found after insert");
      }
    }

    // Check Supabase client status
    if (!supabase) {
      const msg = "Supabase service-role client not initialized (missing env vars)";
      console.error("[test-persistence] 🔴 " + msg);
      errors.push(msg);
    }

    const response = {
      success: saveResult.success && mappingResult.success && errors.length === 0,
      workerBriefSaved: saveResult.success,
      mappingSaved: mappingResult.success,
      supabaseClientInitialized: !!supabase,
      workerBriefId,
      businessId,
      missionId,
      workerBriefRecord,
      mappingRecord,
      errors,
      saveWorkerBriefError: saveResult.error,
      saveMappingError: mappingResult.error,
    };

    console.log("[test-persistence] 📋 Final response", {
      success: response.success,
      workerBriefSaved: response.workerBriefSaved,
      mappingSaved: response.mappingSaved,
      errorCount: errors.length,
    });

    return NextResponse.json(response, {
      status: errors.length === 0 ? 200 : 207,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[test-persistence] 🔴 Unexpected error", {
      error: message,
      stack: error instanceof Error ? error.stack : undefined,
    });

    return NextResponse.json(
      {
        success: false,
        error: message,
        errors: [`Unexpected error: ${message}`],
      },
      { status: 500 }
    );
  }
}
