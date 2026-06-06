import { NextRequest, NextResponse } from "next/server";

import {
  advanceExperience,
  buildExperienceSummary,
  createExperienceSession,
  type ExperienceEvent,
  type ExperienceSession,
} from "@/lib/demo-experience";

type TestExperienceRequest =
  | {
      action: "start";
      demoSessionId?: string;
    }
  | {
      sessionId: string;
      event: ExperienceEvent;
    };

const testExperienceSessions = new Map<string, ExperienceSession>();

export async function POST(req: NextRequest) {
  let activeSession: ExperienceSession | undefined;

  try {
    const body = (await req.json()) as TestExperienceRequest;

    if ("action" in body && body.action === "start") {
      const session = createExperienceSession(body.demoSessionId);
      const summary = buildExperienceSummary(session);
      testExperienceSessions.set(session.id, session);

      return NextResponse.json({
        success: true,
        session,
        currentState: session.state,
        nextState: summary.allowedTransitions[0]?.nextState ?? session.state,
        message: summary.message,
        allowedTransitions: summary.allowedTransitions,
        summary,
      });
    }

    if (!("sessionId" in body) || !body.sessionId) {
      return NextResponse.json({ error: "sessionId is required" }, { status: 400 });
    }
    if (!("event" in body) || !body.event) {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    activeSession = testExperienceSessions.get(body.sessionId);
    if (!activeSession) {
      return NextResponse.json({ error: "Experience session not found" }, { status: 404 });
    }

    const advanced = advanceExperience(activeSession, body.event);
    testExperienceSessions.set(advanced.session.id, advanced.session);

    return NextResponse.json({
      success: true,
      session: advanced.session,
      currentState: advanced.currentState,
      nextState: advanced.nextState,
      message: advanced.message,
      allowedTransitions: advanced.allowedTransitions,
      summary: buildExperienceSummary(advanced.session),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    const status = message.startsWith("Invalid transition") ? 400 : 500;

    return NextResponse.json(
      {
        error: message,
        allowedTransitions: activeSession
          ? buildExperienceSummary(activeSession).allowedTransitions
          : undefined,
      },
      { status }
    );
  }
}
