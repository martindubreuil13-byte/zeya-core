import { NextRequest, NextResponse } from "next/server";

const TTS_BASE = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

let cachedVoiceId: string | null = null;

async function resolveVoiceId(apiKey: string): Promise<string> {
  if (cachedVoiceId) return cachedVoiceId;

  const envId = process.env.ELEVENLABS_VOICE_ID;
  if (envId) {
    cachedVoiceId = envId;
    return envId;
  }

  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  if (agentId) {
    try {
      const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${agentId}`, {
        headers: { "xi-api-key": apiKey },
        cache: "no-store",
      });
      if (res.ok) {
        const data = (await res.json()) as {
          conversation_config?: { tts?: { voice_id?: string } };
        };
        const voiceId = data.conversation_config?.tts?.voice_id;
        if (voiceId) {
          cachedVoiceId = voiceId;
          return voiceId;
        }
      }
    } catch {
      // fall through to default
    }
  }

  cachedVoiceId = DEFAULT_VOICE_ID;
  return DEFAULT_VOICE_ID;
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ElevenLabs not configured." }, { status: 500 });
  }

  let text: string;
  try {
    const body = (await req.json()) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) {
      return NextResponse.json({ error: "Missing text." }, { status: 400 });
    }
    text = body.text.trim();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const voiceId = await resolveVoiceId(apiKey);

  const upstream = await fetch(`${TTS_BASE}/${voiceId}/stream`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_turbo_v2_5",
      voice_settings: { stability: 0.5, similarity_boost: 0.8 },
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const msg = await upstream.text().catch(() => "TTS request failed");
    return NextResponse.json({ error: msg }, { status: upstream.status });
  }

  return new Response(upstream.body, {
    headers: {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    },
  });
}
