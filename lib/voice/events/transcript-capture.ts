// Transcript capture — stores call transcripts in memory

export interface TranscriptSegment {
  speaker: "agent" | "customer";
  text: string;
  timestamp?: number;
}

export interface CapturedTranscript {
  sessionId: string;
  fullText: string;
  segments: TranscriptSegment[];
  capturedAt: string;
}

class TranscriptStore {
  private transcripts: Map<string, CapturedTranscript> = new Map();

  captureTranscript(
    sessionId: string,
    fullText: string,
    segments: TranscriptSegment[]
  ): CapturedTranscript {
    const transcript: CapturedTranscript = {
      sessionId,
      fullText,
      segments,
      capturedAt: new Date().toISOString(),
    };
    this.transcripts.set(sessionId, transcript);
    return transcript;
  }

  getTranscript(sessionId: string): CapturedTranscript | null {
    return this.transcripts.get(sessionId) ?? null;
  }

  hasTranscript(sessionId: string): boolean {
    return this.transcripts.has(sessionId);
  }

  getAllTranscripts(): CapturedTranscript[] {
    return Array.from(this.transcripts.values());
  }

  clear(): void {
    this.transcripts.clear();
  }
}

const transcriptStore = new TranscriptStore();

export {
  transcriptStore,
  TranscriptStore,
};
