// Merges fragmented ASR transcript turns into coherent conversational units.
// No LLM: pure timestamp-gap + same-role grouping.

export interface RawTurn {
  role: "user" | "assistant";
  content: string;
  created_at: string; // ISO 8601 timestamp
}

export interface CompactedTurn {
  role: "user" | "assistant";
  text: string;
  startAt: string; // ISO timestamp of first fragment in group
  endAt: string;   // ISO timestamp of last fragment in group
  fragmentCount: number;
}

// Merge consecutive same-role fragments within this gap.
// Voice ASR emits short bursts with ~300–800 ms inter-fragment pauses.
// 3.5 s covers natural pause-and-continue patterns without collapsing role changes.
const MERGE_GAP_MS = 3_500;

// Matches the ENTIRE trimmed string — so "uh" is filler but "uh, we sell…" is not.
const FILLER_RE =
  /^(?:uh+|um+|hmm+|ah+|er+|oh|okay|ok|yes|yeah|yep|nope?|right|sure|got\s+it|i\s+see|i\s+know|alright|great|perfect|absolutely|cool|mhm+)\.?[,!]?\s*$/i;

function isFiller(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  const wordCount = t.split(/\s+/).filter(Boolean).length;
  return wordCount <= 3 && FILLER_RE.test(t);
}

function joinFragments(a: string, b: string): string {
  const left = a.trimEnd();
  const right = b.trimStart();
  if (!right) return left;
  if (!left) return right;
  return `${left} ${right}`;
}

export function compactTranscript(turns: RawTurn[]): CompactedTurn[] {
  const meaningful = turns.filter((t) => t.content?.trim() && !isFiller(t.content));
  if (meaningful.length === 0) return [];

  const result: CompactedTurn[] = [];
  let current: CompactedTurn = {
    role: meaningful[0].role,
    text: meaningful[0].content.trim(),
    startAt: meaningful[0].created_at,
    endAt: meaningful[0].created_at,
    fragmentCount: 1,
  };

  for (let i = 1; i < meaningful.length; i++) {
    const turn = meaningful[i];
    const prevMs = new Date(current.endAt).getTime();
    const currMs = new Date(turn.created_at).getTime();
    const gapMs = currMs - prevMs;

    const shouldMerge =
      turn.role === current.role &&
      !Number.isNaN(gapMs) &&
      gapMs >= 0 &&
      gapMs <= MERGE_GAP_MS;

    if (shouldMerge) {
      current = {
        ...current,
        text: joinFragments(current.text, turn.content.trim()),
        endAt: turn.created_at,
        fragmentCount: current.fragmentCount + 1,
      };
    } else {
      result.push(current);
      current = {
        role: turn.role,
        text: turn.content.trim(),
        startAt: turn.created_at,
        endAt: turn.created_at,
        fragmentCount: 1,
      };
    }
  }

  result.push(current);
  return result.filter((t) => t.text.trim().length > 0);
}
