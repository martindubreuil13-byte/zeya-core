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

  devLog("conversation token environment check", {
    hasPublicAgentId: Boolean(agentId),
    hasServerApiKey: Boolean(apiKey),
    hasWorkerBriefId: Boolean(workerBriefId),
  });

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Missing ElevenLabs API key." }, { status: 400 });
  }

  try {
    // Build request body with optional userId (workerBriefId for webhook linkage)
    const requestBody: Record<string, unknown> = {
      agent_id: agentId,
    };

    if (workerBriefId) {
      requestBody.user_id = workerBriefId;
    }

    const response = await fetch(
      `${CONVERSATION_TOKEN_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}${
        workerBriefId ? `&user_id=${encodeURIComponent(workerBriefId)}` : ""
      }`,
      {
        headers: {
          "xi-api-key": apiKey,
        },
        cache: "no-store",
      },
    );

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
    });
    return NextResponse.json({
      conversationToken: data.token,
      mode: "conversation-token",
      workerBriefId: workerBriefId || undefined,
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
