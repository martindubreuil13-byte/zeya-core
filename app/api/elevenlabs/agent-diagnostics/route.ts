import { NextResponse } from "next/server";

const AGENT_ENDPOINT = "https://api.elevenlabs.io/v1/convai/agents";

type JsonObject = Record<string, unknown>;

function devLog(message: string, details?: Record<string, unknown>) {
  if (process.env.NODE_ENV !== "development") return;
  console.info(`[Zeya voice:server] ${message}`, details ?? {});
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function findDynamicVariableNames(value: unknown, names = new Set<string>()) {
  if (Array.isArray(value)) {
    value.forEach((item) => findDynamicVariableNames(item, names));
    return names;
  }

  if (!isObject(value)) return names;

  if (value.type === "dynamic_variable" && typeof value.name === "string") {
    if (value.name.trim()) names.add(value.name);
  }

  if (typeof value.dynamic_variable === "string") {
    if (value.dynamic_variable.trim()) names.add(value.dynamic_variable);
  }

  if (isObject(value.dynamic_variable_placeholders)) {
    Object.keys(value.dynamic_variable_placeholders).forEach((name) => names.add(name));
  }

  Object.values(value).forEach((child) => findDynamicVariableNames(child, names));
  return names;
}

function summarizeAgent(agent: JsonObject) {
  const conversationConfig = isObject(agent.conversation_config)
    ? agent.conversation_config
    : {};
  const tts = isObject(conversationConfig.tts) ? conversationConfig.tts : {};
  const agentConfig = isObject(conversationConfig.agent) ? conversationConfig.agent : {};
  const prompt = isObject(agentConfig.prompt) ? agentConfig.prompt : {};
  const dynamicVariableNames = [...findDynamicVariableNames(agent)].sort();
  const tools = Array.isArray(agentConfig.tools) ? agentConfig.tools : [];
  const accessInfo = isObject(agent.access_info) ? agent.access_info : {};
  const metadata = isObject(agent.metadata) ? agent.metadata : {};
  const platformSettings = isObject(agent.platform_settings) ? agent.platform_settings : {};

  return {
    agentId: typeof agent.agent_id === "string" ? agent.agent_id : undefined,
    name: typeof agent.name === "string" ? agent.name : undefined,
    hasVoiceId: typeof tts.voice_id === "string" && tts.voice_id.length > 0,
    voiceIdSuffix:
      typeof tts.voice_id === "string" ? `...${tts.voice_id.slice(-6)}` : undefined,
    ttsModel: typeof tts.model_id === "string" ? tts.model_id : undefined,
    outputAudioFormat:
      typeof tts.agent_output_audio_format === "string"
        ? tts.agent_output_audio_format
        : undefined,
    hasFirstMessage:
      typeof agentConfig.first_message === "string" && agentConfig.first_message.trim().length > 0,
    hasPrompt:
      typeof prompt.prompt === "string"
        ? prompt.prompt.trim().length > 0
        : typeof agentConfig.prompt === "string" && agentConfig.prompt.trim().length > 0,
    dynamicVariables: dynamicVariableNames,
    toolCount: tools.length,
    toolNames: tools
      .map((tool) => (isObject(tool) && typeof tool.name === "string" ? tool.name : undefined))
      .filter(Boolean),
    accessLevel: typeof accessInfo.access_level === "string" ? accessInfo.access_level : undefined,
    isAuthenticated:
      typeof platformSettings.auth_enabled === "boolean"
        ? platformSettings.auth_enabled
        : undefined,
    createdAt: typeof metadata.created_at_unix_secs === "number" ? metadata.created_at_unix_secs : undefined,
    platformKeys: Object.keys(platformSettings).sort(),
    rawKeys: Object.keys(agent).sort(),
  };
}

export async function GET() {
  const agentId = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID;
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!agentId) {
    return NextResponse.json({ error: "Missing ElevenLabs agent ID." }, { status: 400 });
  }

  try {
    const response = await fetch(`${AGENT_ENDPOINT}/${encodeURIComponent(agentId)}`, {
      headers: apiKey
        ? {
            "xi-api-key": apiKey,
          }
        : undefined,
      cache: "no-store",
    });

    if (!response.ok) {
      const body = await response.text();
      devLog("agent diagnostics request failed", {
        status: response.status,
        body: body.slice(0, 500),
      });

      return NextResponse.json(
        { error: "Unable to inspect ElevenLabs agent." },
        { status: response.status },
      );
    }

    const agent = (await response.json()) as JsonObject;
    const diagnostics = summarizeAgent(agent);
    devLog("agent diagnostics", diagnostics);

    return NextResponse.json(diagnostics);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    devLog("agent diagnostics request threw", { message });

    return NextResponse.json(
      { error: "ElevenLabs agent diagnostics failed." },
      { status: 502 },
    );
  }
}
