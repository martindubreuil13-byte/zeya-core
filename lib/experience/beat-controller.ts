/**
 * Beat Controller: State Machine for Experience Beats
 *
 * Manages transitions between beats, triggers script delivery,
 * and coordinates extraction attempts.
 */

import {
  ExperienceBeat,
  BEAT_SCRIPTS,
  getBeatScript,
  getNextBeat,
  isBeatWithPhone,
  isBeatWithDecision,
} from "./experience-beats";
import {
  ExperienceSession,
  recordExtraction,
  updateVisitorData,
  getBestExtraction,
  completeSession,
  failSession,
} from "./experience-state";

export interface BeatControllerConfig {
  onBeatStart?: (beat: ExperienceBeat, script: string) => Promise<void>;
  onBeatComplete?: (beat: ExperienceBeat, extractedValue: string | null) => void;
  onSessionComplete?: (session: ExperienceSession) => void;
  onSessionFail?: (session: ExperienceSession, reason: string) => void;
}

export class BeatController {
  private session: ExperienceSession;
  private config: BeatControllerConfig;

  constructor(session: ExperienceSession, config: BeatControllerConfig = {}) {
    this.session = session;
    this.config = config;
  }

  /**
   * Start the current beat: speak the script and prepare for extraction
   */
  async startBeat(): Promise<void> {
    const beatStartTimestamp = performance.now();
    console.log("[BEAT] startBeat() called", {
      currentBeat: this.session.currentBeat,
      timestamp: beatStartTimestamp,
      millisecondsSincePageLoad: Math.round(beatStartTimestamp),
      hasOnBeatStartCallback: Boolean(this.config.onBeatStart),
    });

    const beat = this.session.currentBeat;
    const beatConfig = BEAT_SCRIPTS[beat];

    if (!beatConfig) {
      console.error("[BEAT] Unknown beat:", beat);
      throw new Error(`Unknown beat: ${beat}`);
    }

    console.log("[BEAT] Beat config found", { beat });

    this.session.beatStartedAt = new Date();
    this.session.beatAttempts = 0;

    // Generate the script (may interpolate visitor name)
    const script = getBeatScript(beat, {
      visitorName: this.session.visitor.name,
    });

    console.log("[BEAT] Script generated", { beat, scriptLength: script.length, firstChars: script.slice(0, 50) });

    // Notify handler to speak the script
    if (this.config.onBeatStart) {
      console.log("[BEAT] About to call onBeatStart callback", {
        callbackExists: true,
        timestamp: Math.round(performance.now()),
      });
      await this.config.onBeatStart(beat, script);
      console.log("[BEAT] onBeatStart callback returned successfully", {
        timestamp: Math.round(performance.now()),
      });
    } else {
      console.error("[BEAT] No onBeatStart callback configured!");
    }
  }

  /**
   * Record an extraction attempt and decide whether to advance or retry
   */
  async processExtraction(
    extractedValue: string | null,
    confidence: number,
    needsClarification: boolean
  ): Promise<"advance" | "retry" | "timeout"> {
    const beat = this.session.currentBeat;
    const beatConfig = BEAT_SCRIPTS[beat];

    if (!beatConfig) {
      throw new Error(`Unknown beat: ${beat}`);
    }

    // Record the extraction attempt
    recordExtraction(
      this.session,
      beat,
      extractedValue,
      confidence,
      needsClarification
    );

    this.session.beatAttempts++;

    // Decision logic
    const hasHighConfidence = confidence > 0.7;
    const maxAttemptsReached = this.session.beatAttempts >= beatConfig.maxAttempts;
    const timeoutReached =
      Date.now() - this.session.beatStartedAt.getTime() > beatConfig.timeout;

    // ADVANCE conditions
    if (hasHighConfidence) {
      // Confidence is high enough to proceed
      await this.advanceBeat(extractedValue);
      return "advance";
    }

    if (maxAttemptsReached || timeoutReached) {
      // Out of attempts/time. Move forward with what we have (even if partial)
      await this.advanceBeat(extractedValue);
      return "timeout";
    }

    // RETRY: Ask for clarification
    if (beatConfig.fallback) {
      // Notify handler to speak fallback
      if (this.config.onBeatStart) {
        await this.config.onBeatStart(beat, beatConfig.fallback);
      }
    }

    return "retry";
  }

  /**
   * Handle special extraction for yes/no decisions
   */
  async processYesNoDecision(decision: "yes" | "no"): Promise<void> {
    this.session.decision = decision;

    // Record as extraction
    recordExtraction(
      this.session,
      "experiment",
      decision,
      0.95, // High confidence for binary decision
      false
    );

    // Advance to next beat
    const nextBeat = getNextBeat(ExperienceBeat.EXPERIMENT, null, decision);
    this.session.currentBeat = nextBeat;

    if (this.config.onBeatComplete) {
      this.config.onBeatComplete(ExperienceBeat.EXPERIMENT, decision);
    }

    // Start next beat
    await this.startBeat();
  }

  /**
   * Handle phone number extraction with validation
   */
  async processPhoneNumber(
    rawPhone: string,
    confidence: number
  ): Promise<"advance" | "retry" | "timeout"> {
    const isValidPhone = this.validatePhoneNumber(rawPhone);

    if (isValidPhone) {
      // Valid phone - advance
      await this.advanceBeat(rawPhone);
      return "advance";
    }

    if (this.session.beatAttempts >= BEAT_SCRIPTS[ExperienceBeat.PHONE].maxAttempts) {
      // Out of attempts - advance anyway
      await this.advanceBeat(rawPhone);
      return "timeout";
    }

    // Retry - ask for phone again
    if (this.config.onBeatStart) {
      const fallback = BEAT_SCRIPTS[ExperienceBeat.PHONE].fallback || "";
      await this.config.onBeatStart(ExperienceBeat.PHONE, fallback);
    }

    return "retry";
  }

  /**
   * Advance to the next beat
   */
  async advanceBeat(extractedValue: string | null): Promise<void> {
    const currentBeat = this.session.currentBeat;
    const beatConfig = BEAT_SCRIPTS[currentBeat];

    console.log("[BEAT] advanceBeat() called", {
      currentBeat,
      extractedValue: extractedValue?.slice(0, 30),
      timestamp: Math.round(performance.now()),
    });

    // Update visitor data with extraction
    if (beatConfig.extractField && extractedValue) {
      updateVisitorData(this.session, currentBeat, extractedValue);
    }

    // Notify handler of beat completion
    if (this.config.onBeatComplete) {
      console.log("[BEAT] Calling onBeatComplete callback", { currentBeat });
      this.config.onBeatComplete(currentBeat, extractedValue);
    }

    // Determine next beat
    let nextBeat: ExperienceBeat;

    if (isBeatWithDecision(currentBeat)) {
      // Decision was made - use it to determine next beat
      nextBeat = getNextBeat(currentBeat, extractedValue, this.session.decision);
    } else {
      // Normal progression
      nextBeat = getNextBeat(currentBeat, extractedValue);
    }

    console.log("[BEAT] Moving to next beat", { nextBeat });
    this.session.currentBeat = nextBeat;

    // Check if we're done
    if (nextBeat === ExperienceBeat.CLOSED) {
      console.log("[BEAT] Session complete - reached CLOSED beat");
      completeSession(this.session, "Reached final beat");
      if (this.config.onSessionComplete) {
        this.config.onSessionComplete(this.session);
      }
      return;
    }

    // Start next beat
    console.log("[BEAT] Starting next beat", { nextBeat });
    await this.startBeat();
  }

  /**
   * Validate phone number format
   */
  private validatePhoneNumber(phone: string): boolean {
    // Very permissive validation - accepts anything that looks like a phone number
    const cleanPhone = phone.replace(/\D/g, "");
    return cleanPhone.length >= 10 && cleanPhone.length <= 15;
  }

  /**
   * Get current session state
   */
  getSession(): ExperienceSession {
    return this.session;
  }

  /**
   * End session early with failure
   */
  async failSession(reason: string): Promise<void> {
    failSession(this.session, reason);
    if (this.config.onSessionFail) {
      this.config.onSessionFail(this.session, reason);
    }
  }
}
