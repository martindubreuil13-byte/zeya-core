"use client";

import { motion } from "framer-motion";
import { VoiceButton } from "@/components/voice/VoiceButton";
import { VoiceStatus } from "@/components/voice/VoiceStatus";
import { VoiceTranscript } from "@/components/voice/VoiceTranscript";
import { useVoiceConversation } from "@/hooks/voice/useVoiceConversation";

const intensityByState = {
  idle: 0.18,
  connecting: 0.34,
  listening: 0.42,
  thinking: 0.5,
  speaking: 0.58,
  processing: 0.3,
  disconnected: 0.2,
  error: 0.36,
};

export function VoiceOverlay() {
  const voice = useVoiceConversation();
  const intensity = intensityByState[voice.state];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[5.25rem] z-20 flex justify-center px-6 sm:bottom-12">
      <motion.div
        initial={{ opacity: 0, y: 18, filter: "blur(18px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.6, delay: 0.9, ease: [0.22, 1, 0.36, 1] }}
        className="pointer-events-auto flex w-full max-w-[32rem] flex-col items-center gap-5"
      >
        <motion.div
          aria-hidden="true"
          animate={{
            opacity: intensity,
            scale: voice.state === "speaking" ? [1, 1.08, 1] : [1, 1.03, 1],
          }}
          transition={{ duration: 4.8, repeat: Infinity, ease: "easeInOut" }}
          className="absolute bottom-6 h-40 w-64 rounded-full bg-zeya-champagne/10 blur-[70px]"
        />

        <VoiceTranscript entries={voice.transcript} state={voice.state} />

        <div className="relative flex flex-col items-center gap-3">
          <VoiceButton
            state={voice.state}
            disabled={!voice.isConfigured}
            onStart={() => void voice.startConversation()}
            onStop={() => void voice.stopConversation()}
          />
          <VoiceStatus state={voice.state} isConfigured={voice.isConfigured} error={voice.error} />
        </div>
      </motion.div>
    </div>
  );
}
