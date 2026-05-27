import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
  role: "zeya" | "user";
  text: string;
}

interface RequestBody {
  messages: ChatMessage[];
  business_context: string;
  progress_percent: number;
}

// ─── System prompt ────────────────────────────────────────────────────────────

function buildSystemPrompt(context: string, progressPercent: number): string {
  const state =
    progressPercent >= 80
      ? "The business profile is substantially complete. The first mission is ready to prepare."
      : progressPercent >= 40
        ? "The business profile is partially established. Key gaps remain before the first mission can begin."
        : "The business profile is in early formation. Core context is still being gathered.";

  return `You are Zeya — persistent operational intelligence for this business.

Language: Always respond in English.

${state}

Business context established so far:
${context}

Your role in this session:
You are in a workspace session — not onboarding. The founder is continuing a discussion.
Your job is to be a strategic sounding board: help think through missions, surface
observations, work through priorities, and absorb any new information offered.

Voice:
- Maximum three sentences per response. Usually one or two is enough.
- Operational. Direct. Calm. No enthusiasm markers.
- No "That's a great point." No "Absolutely." No validation phrases.
- If the user corrects something, accept it immediately and continue.
- Challenge vague thinking once, briefly, then accept the second answer.
- When asked what to focus on, give one specific recommendation — not a list.

If this is the opening of a session (message is "[Begin session]"):
Open with one precise statement about the most immediately relevant aspect of the
current state, then ask the single most useful question for moving the business
forward right now. Not a recap. Not a summary. One forward-looking question.

You are not explaining your process. You are the process.`.trim();
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ error: "OpenAI not configured." }, { status: 500 });
  }

  let body: RequestBody;
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { messages, business_context, progress_percent } = body;

  const input: Array<{ role: "user" | "assistant"; content: string }> = messages
    .slice(-12)
    .map((m) => ({
      role: m.role === "zeya" ? "assistant" : "user",
      content: m.text,
    }));

  // No prior messages = request an opener
  if (input.length === 0) {
    input.push({ role: "user", content: "[Begin session]" });
  }

  try {
    const openai = new OpenAI();

    const response = await openai.responses.create({
      model: "gpt-4o",
      instructions: buildSystemPrompt(business_context, progress_percent),
      input,
    });

    const reply = response.output_text?.trim() ?? "";
    if (!reply) throw new Error("Empty response from model.");

    return NextResponse.json({ reply });
  } catch (err) {
    console.error("[Zeya] briefing-chat failed:", err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
