import { NextResponse } from "next/server";

const CONVERSATION_TOKEN_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/token";

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice:server] ${message}`, details ?? {});
}

export async function GET() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  devLog("conversation token environment check", {
    hasPublicAgentId: Boolean(agentId),
    hasServerApiKey: Boolean(apiKey),
  });

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ error: "Missing ElevenLabs API key." }, { status: 400 });
  }

  try {
    const response = await fetch(
      `${CONVERSATION_TOKEN_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`,
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

    devLog("conversation token created");
    return NextResponse.json({ conversationToken: data.token, mode: "conversation-token" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLog("conversation token request threw", { message });

    return NextResponse.json(
      { error: "ElevenLabs WebRTC connection could not be prepared." },
      { status: 502 },
    );
  }
}
