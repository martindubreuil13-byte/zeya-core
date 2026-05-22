import { NextResponse } from "next/server";

const SIGNED_URL_ENDPOINT = "https://api.elevenlabs.io/v1/convai/conversation/get-signed-url";

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice:server] ${message}`, details ?? {});
}

export async function GET() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  devLog("environment check", {
    hasPublicAgentId: Boolean(agentId),
    hasServerApiKey: Boolean(apiKey),
  });

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  if (!apiKey) {
    return NextResponse.json({ signedUrl: null, mode: "public-agent" });
  }

  try {
    const response = await fetch(`${SIGNED_URL_ENDPOINT}?agent_id=${encodeURIComponent(agentId)}`, {
      headers: {
        "xi-api-key": apiKey,
      },
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      devLog("signed URL request failed", {
        status: response.status,
        body: body.slice(0, 160),
      });

      return NextResponse.json(
        { error: "Unable to create ElevenLabs signed URL." },
        { status: response.status },
      );
    }

    const data = (await response.json()) as { signed_url?: string; signedUrl?: string };
    const signedUrl = data.signed_url ?? data.signedUrl;

    if (!signedUrl) {
      devLog("signed URL response missing URL");
      return NextResponse.json(
        { error: "ElevenLabs signed URL response was incomplete." },
        { status: 502 },
      );
    }

    devLog("signed URL created");
    return NextResponse.json({ signedUrl, mode: "signed-url" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLog("signed URL request threw", { message });

    return NextResponse.json(
      { error: "ElevenLabs connection could not be prepared." },
      { status: 502 },
    );
  }
}
