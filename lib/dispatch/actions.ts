/**
 * Structured assistant actions
 * Machine-readable events emitted by Zeya
 * No transcript parsing anywhere
 */

export type AssistantAction =
  | { type: "transition"; next: "collect_phone" }
  | { type: "request_data"; field: "phone" }
  | { type: "dispatch"; dispatch_id: string };

/**
 * Extract structured actions from assistant message
 * Actions are JSON-formatted markers in the assistant response
 * Example: {"type":"transition","next":"collect_phone"}
 */
export function extractAssistantActions(text: string): AssistantAction[] {
  const actions: AssistantAction[] = [];

  // Look for JSON-formatted action markers
  // Format: [ACTION]{...json...}[/ACTION]
  const actionRegex = /\[ACTION\](.*?)\[\/ACTION\]/g;
  let match;

  while ((match = actionRegex.exec(text)) !== null) {
    try {
      const action = JSON.parse(match[1]);
      actions.push(action);
    } catch (error) {
      console.warn("[Action Parse Error]", match[1], error);
    }
  }

  return actions;
}

/**
 * Check if message contains a specific action
 */
export function hasAction(text: string, actionType: string): boolean {
  const actions = extractAssistantActions(text);
  return actions.some((action) => action.type === actionType);
}

/**
 * Get the next transition action
 */
export function getTransitionAction(text: string): "collect_phone" | null {
  const actions = extractAssistantActions(text);
  const transition = actions.find((action) => action.type === "transition") as any;
  return transition?.next || null;
}
