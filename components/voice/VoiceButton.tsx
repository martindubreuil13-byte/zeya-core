"use client";

import { Mic, PhoneOff } from "lucide-react";
import { motion } from "framer-motion";
import type { VoiceState } from "@/types/voice";

type VoiceButtonProps = {
  state: VoiceState;
  disabled?: boolean;
  onStart: () => void;
  onStop: () => void;
};

const activeStates: VoiceState[] = [
  "connecting",
  "listening",
  "thinking",
  "speaking",
  "interrupted",
  "processing",
];

export function VoiceButton({ state, disabled = false, onStart, onStop }: VoiceButtonProps) {
  const isActive = activeStates.includes(state);
  const label = isActive ? "Close the voice session" : "Open a voice session";

  return (
    <motion.button
      type="button"
      aria-label={label}
      disabled={disabled || state === "connecting" || state === "processing"}
      onClick={isActive ? onStop : onStart}
      whileHover={{ scale: disabled ? 1 : 1.025 }}
      whileTap={{ scale: disabled ? 1 : 0.98 }}
      className="zeya-transition group relative grid size-16 place-items-center rounded-full border border-zeya-champagne/18 text-zeya-ivory/78 backdrop-blur-2xl disabled:cursor-not-allowed disabled:opacity-45 sm:size-[4.5rem]"
      style={{
        background: isActive
          ? "radial-gradient(circle at 45% 35%, rgb(215 193 155 / 0.2), rgb(33 20 29 / 0.58) 58%, rgb(10 7 9 / 0.56))"
          : "rgb(33 20 29 / 0.42)",
        boxShadow: isActive
          ? "0 0 52px rgb(215 193 155 / 0.16), inset 0 1px 0 rgb(244 238 226 / 0.12)"
          : "0 22px 70px rgb(10 7 9 / 0.36), inset 0 1px 0 rgb(244 238 226 / 0.07)",
      }}
    >
      <motion.span
        aria-hidden="true"
        animate={{
          scale: isActive ? [1, 1.34, 1] : 1,
          opacity: isActive ? [0.2, 0.02, 0.2] : 0,
        }}
        transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-[-26%] rounded-full border border-zeya-champagne/22"
      />
      {isActive ? <PhoneOff className="size-5" /> : <Mic className="size-5" />}
    </motion.button>
  );
}
