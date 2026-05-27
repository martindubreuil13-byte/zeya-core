"use client";

import { AnimatePresence, motion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { useAuth } from "@/components/auth/auth-provider";
import { AmbientBackground } from "@/components/layout";
import { ZeyaBriefingRoom } from "@/components/briefing-room/ZeyaBriefingRoom";
import { BusinessOnboarding } from "@/components/onboarding/business-onboarding";
import { PresenceCore } from "@/components/presence";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { VoiceStatus } from "@/components/voice/VoiceStatus";
import { VoiceTranscript } from "@/components/voice/VoiceTranscript";
import { useAppMode } from "@/hooks/useAppMode";
import { useMousePosition } from "@/hooks/useMousePosition";
import { useVoiceConversation } from "@/hooks/voice/useVoiceConversation";

const EASE = [0.22, 1, 0.36, 1] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AppPage() {
  const { openAuth } = useAuth();
  const { mode, businessId, refresh } = useAppMode();

  return (
    <AnimatePresence mode="wait">
      {mode === "loading" && <LoadingDot key="loading" />}

      {mode === "auth" && (
        <AuthGate key="auth" onSignIn={() => openAuth("sign-in")} />
      )}

      {mode === "onboarding" && (
        <motion.div
          key="onboarding"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, filter: "blur(20px)" }}
          transition={{ duration: 1.0, ease: EASE }}
          className="contents"
        >
          <BusinessOnboarding
            existingBusinessId={businessId}
            onComplete={refresh}
          />
        </motion.div>
      )}

      {mode === "workspace" && businessId && (
        <motion.div
          key="briefing"
          initial={{ opacity: 0, filter: "blur(20px)" }}
          animate={{ opacity: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, filter: "blur(20px)" }}
          transition={{ duration: 1.0, ease: EASE }}
          className="contents"
        >
          <ZeyaBriefingRoom businessId={businessId} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

// ─── Loading dot ──────────────────────────────────────────────────────────────

function LoadingDot() {
  return (
    <div
      key="loading-inner"
      className="flex min-h-dvh items-center justify-center"
      style={{ background: "#0a0709" }}
    >
      <motion.div
        animate={{ opacity: [0.3, 0.7, 0.3] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
        className="h-1 w-1 rounded-full bg-zeya-champagne/60"
      />
    </div>
  );
}

// ─── Auth gate ────────────────────────────────────────────────────────────────

function AuthGate({ onSignIn }: { onSignIn: () => void }) {
  return (
    <motion.main
      key="auth-inner"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: EASE }}
      className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-14"
    >
      <AmbientBackground />
      <motion.div
        initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.6, ease: EASE }}
        className="relative z-10 flex flex-col items-center gap-7 text-center"
      >
        <PresenceCore state="idle" />
        <p className="text-[0.9375rem] font-light tracking-wide text-zeya-hush/68">
          Sign in to continue.
        </p>
        <button
          onClick={onSignIn}
          className="rounded-presence border border-zeya-champagne/20 bg-zeya-champagne/10 px-7 py-3 text-sm font-light tracking-wide text-zeya-champagne transition-all duration-300 hover:bg-zeya-champagne/18"
        >
          Sign in
        </button>
      </motion.div>
    </motion.main>
  );
}

// ─── Workspace view ───────────────────────────────────────────────────────────
// Voice hook lives here — never mounts during onboarding

const activeVoiceStates = [
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "interrupted",
  "processing",
];

function WorkspaceView() {
  const { x, y } = useMousePosition(10, 55, 3);
  const voice = useVoiceConversation();
  const [invitationVisible, setInvitationVisible] = useState(false);
  const [hasActivated, setHasActivated] = useState(false);

  const contentY = useTransform(y, [0, 1], ["-1.2%", "1.2%"]);
  const contentX = useTransform(x, [0, 1], ["-0.6%", "0.6%"]);
  const isActive = activeVoiceStates.includes(voice.state);
  const shouldShowTranscript = hasActivated && (voice.transcript.length > 0 || isActive);

  useEffect(() => {
    const timer = window.setTimeout(() => setInvitationVisible(true), 1700);
    return () => window.clearTimeout(timer);
  }, []);

  function startVoice() {
    setHasActivated(true);
    void voice.startConversation();
  }

  function stopVoice() {
    void voice.stopConversation();
  }

  return (
    <motion.main
      key="workspace-inner"
      initial={{ opacity: 0, filter: "blur(20px)" }}
      animate={{ opacity: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(20px)" }}
      transition={{ duration: 1.2, ease: EASE }}
      className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-14 sm:px-8"
    >
      <AmbientBackground />

      <motion.section
        style={{ y: contentY, x: contentX }}
        className="relative z-10 flex w-full max-w-[36rem] flex-col items-center gap-12 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.8, ease: EASE }}
          className="flex flex-col items-center gap-9"
        >
          <PresenceCore state={voice.state} />
        </motion.div>

        <div className="flex min-h-[13rem] w-full flex-col items-center justify-start gap-7">
          <AnimatePresence mode="wait">
            {shouldShowTranscript ? (
              <motion.div
                key="transcript"
                initial={{ opacity: 0, y: 18, filter: "blur(16px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 12, filter: "blur(14px)" }}
                transition={{ duration: 1.0, ease: EASE }}
                className="w-full"
              >
                <VoiceTranscript entries={voice.transcript} state={voice.state} />
              </motion.div>
            ) : invitationVisible ? (
              <motion.div
                key="invitation"
                initial={{ opacity: 0, y: 12, filter: "blur(14px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: -8, filter: "blur(12px)" }}
                transition={{ duration: 1.2, ease: EASE }}
                className="space-y-2"
              >
                <p className="text-[0.9375rem] font-light tracking-wide text-zeya-hush/68">
                  Ready when you are.
                </p>
                <p className="text-xs font-light tracking-wide text-zeya-hush/34">
                  Tap the microphone to begin.
                </p>
              </motion.div>
            ) : (
              <motion.div key="quiet" className="h-14" />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {invitationVisible || hasActivated ? (
              <motion.div
                initial={{ opacity: 0, y: 12, filter: "blur(14px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={{ opacity: 0, y: 8, filter: "blur(10px)" }}
                transition={{ duration: 1.1, ease: EASE }}
                className="flex flex-col items-center gap-3"
              >
                <VoiceButton
                  state={voice.state}
                  disabled={!voice.isConfigured}
                  onStart={startVoice}
                  onStop={stopVoice}
                />
                <VoiceStatus
                  state={voice.state}
                  isConfigured={voice.isConfigured}
                  error={voice.error}
                />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.section>
    </motion.main>
  );
}
