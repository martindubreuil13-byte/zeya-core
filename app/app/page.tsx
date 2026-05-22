"use client";

import { AnimatePresence, motion, useTransform } from "framer-motion";
import { useEffect, useState } from "react";
import { AmbientBackground } from "@/components/layout";
import { PresenceCore } from "@/components/presence";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { VoiceStatus } from "@/components/voice/VoiceStatus";
import { VoiceTranscript } from "@/components/voice/VoiceTranscript";
import { useMousePosition } from "@/hooks/useMousePosition";
import { useVoiceConversation } from "@/hooks/voice/useVoiceConversation";

const activeStates = ["connecting", "listening", "thinking", "speaking", "processing"];

export default function AppPage() {
  const { x, y } = useMousePosition(10, 55, 3);
  const voice = useVoiceConversation();
  const [invitationVisible, setInvitationVisible] = useState(false);
  const [hasActivated, setHasActivated] = useState(false);
  const contentY = useTransform(y, [0, 1], ["-1.2%", "1.2%"]);
  const contentX = useTransform(x, [0, 1], ["-0.6%", "0.6%"]);
  const isActive = activeStates.includes(voice.state);
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
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-14 sm:px-8">
      <AmbientBackground />

      <motion.section
        style={{ y: contentY, x: contentX }}
        className="relative z-10 flex w-full max-w-[36rem] flex-col items-center gap-12 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
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
                transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
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
                transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
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
                transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col items-center gap-3"
              >
                <VoiceButton
                  state={voice.state}
                  disabled={!voice.isConfigured}
                  onStart={startVoice}
                  onStop={stopVoice}
                />
                <VoiceStatus state={voice.state} isConfigured={voice.isConfigured} error={voice.error} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.section>
    </main>
  );
}
