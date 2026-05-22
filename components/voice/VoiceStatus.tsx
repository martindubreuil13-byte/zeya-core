"use client";

import { motion } from "framer-motion";
import type { VoiceState } from "@/types/voice";

type VoiceStatusProps = {
  state: VoiceState;
  isConfigured?: boolean;
  error?: string;
};

const statusCopy: Record<VoiceState, string> = {
  idle: "Ready when you are.",
  connecting: "Opening the line.",
  listening: "Speak whenever you are ready.",
  thinking: "Holding that for a moment.",
  speaking: "Zeya is speaking.",
  processing: "Letting the moment settle.",
  disconnected: "The line is closed.",
  error: "Connection interrupted. Let’s try again.",
};

export function VoiceStatus({ state, isConfigured = true, error }: VoiceStatusProps) {
  const text = isConfigured
    ? state === "error"
      ? statusCopy.error
      : error ?? statusCopy[state]
    : "Add an ElevenLabs agent ID to begin.";

  return (
    <motion.p
      key={text}
      initial={{ opacity: 0, y: 6, filter: "blur(8px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, y: -6, filter: "blur(8px)" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="max-w-[18rem] text-center text-[0.78rem] font-light leading-relaxed tracking-wide text-zeya-hush/58"
    >
      {text}
    </motion.p>
  );
}
