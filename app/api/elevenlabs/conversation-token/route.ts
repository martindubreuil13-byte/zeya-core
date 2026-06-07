import { NextRequest, NextResponse } from "next/server";

const CONVERSATION_TOKEN_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/token";

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice:server] ${message}`, details ?? {});
}

export async function GET(req: NextRequest) {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  // Extract optional workerBriefId for webhook context linking
  const workerBriefId = req.nextUrl.searchParams.get("workerBriefId");

  // Task 2: Extract dynamic variables for context injection to Veya
  // Format: ?dynamicVariable[key1]=value1&dynamicVariable[key2]=value2
  const dynamicVariablesParams = req.nextUrl.searchParams.getAll("dynamicVariable");
  const dynamicVariables: Record<string, string> = {};

  // Parse dynamic variables from query params
  // Each param should be key=value
  for (const param of dynamicVariablesParams) {
    const [key, value] = param.split("=", 2);
    if (key && value) {
      dynamicVariables[key] = decodeURIComponent(value);
    }
  }

  devLog("conversation token environment check", {
    hasPublicAgentId: Boolean(agentId),
    hasServerApiKey: Boolean(apiKey),
    hasWorkerBriefId: Boolean(workerBriefId),
    dynamicVariableCount: Object.keys(dynamicVariables).length,
  });

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Missing ElevenLabs API key." }, { status: 400 });
  }

  try {
    // Build URL query parameters for ElevenLabs API
    const urlParams = new URLSearchParams();
    urlParams.set("agent_id", agentId);

    if (workerBriefId) {
      urlParams.set("user_id", workerBriefId);
    }

    // Task 2: Pass dynamic variables to ElevenLabs
    // ElevenLabs Conversations API supports dynamic_variables parameter
    if (Object.keys(dynamicVariables).length > 0) {
      // dynamic_variables is passed as JSON-encoded query parameter
      urlParams.set("dynamic_variables", JSON.stringify(dynamicVariables));
      devLog("dynamic variables included in request", {
        variables: Object.keys(dynamicVariables),
      });
    }

    const response = await fetch(`${CONVERSATION_TOKEN_ENDPOINT}?${urlParams.toString()}`, {
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      devLog("conversation token request failed", {
        status: response.status,
        body: body.slice(0, 500),
      });

      return NextResponse.json(
        { error: "Unable to create ElevenLabs conversation token." },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { token?: string };

    if (!data.token) {
      devLog("conversation token response missing token");
      return NextResponse.json(
        { error: "ElevenLabs conversation token response was incomplete." },
        { status: 502 },
      );
    }

    devLog("conversation token created", {
      hasWorkerBriefId: Boolean(workerBriefId),
      hasDynamicVariables: Object.keys(dynamicVariables).length > 0,
    });

    return NextResponse.json({
      conversationToken: data.token,
      mode: "conversation-token",
      workerBriefId: workerBriefId || undefined,
      dynamicVariablesPassedCount: Object.keys(dynamicVariables).length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLog("conversation token request threw", { message });

    return NextResponse.json(
      { error: "ElevenLabs WebRTC connection could not be prepared." },
      { status: 502 },
    );
  }
}
