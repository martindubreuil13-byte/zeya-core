import { NextRequest, NextResponse } from "next/server";
import { createAuthenticatedRepresentationContext, isUuid } from "../../../../../../lib/representation/api-auth";
import { ConversationInterpretationError, createInterpretationServiceClient, interpretAndProjectConversationOutput } from "../../../../../../lib/work/conversation-interpretation";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ conversationOutputId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;
  const { conversationOutputId } = await context.params;
  if (!isUuid(conversationOutputId)) return NextResponse.json({ success: false, error: "conversation_output_not_found" }, { status: 404 });
  try {
    const result = await interpretAndProjectConversationOutput({ db: createInterpretationServiceClient(), ownerId: auth.user.id, conversationOutputId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const code = error instanceof ConversationInterpretationError ? error.code : "persistence_failed";
    const status = code === "not_found" ? 404 : code === "not_finalized" || code === "conflict" ? 409 : 500;
    console.error("[conversation-interpretation] request failed", { code });
    return NextResponse.json({ success: false, error: `conversation_interpretation_${code}` }, { status });
  }
}
