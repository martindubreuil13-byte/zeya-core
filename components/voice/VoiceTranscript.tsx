"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { VoiceState, VoiceTranscriptEntry } from "@/types/voice";

type VoiceTranscriptProps = {
  entries: VoiceTranscriptEntry[];
  state: VoiceState;
};

export function VoiceTranscript({ entries, state }: VoiceTranscriptProps) {
  const visibleEntries = entries.slice(-3);
  const isVisible = visibleEntries.length > 0 || state === "listening" || state === "thinking";

  return (
    <AnimatePresence>
      {isVisible ? (
        <motion.div
          initial={{ opacity: 0, y: 18, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 10, filter: "blur(14px)" }}
          transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-[27rem] space-y-3 text-left"
        >
          {visibleEntries.length === 0 ? (
            <p className="text-center text-sm font-light leading-relaxed tracking-wide text-zeya-hush/44">
              Speak when you are ready.
            </p>
          ) : (
            visibleEntries.map((entry) => (
              <motion.div
                key={entry.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: entry.isFinal ? 0.82 : 0.48, y: 0 }}
                className="border-l border-zeya-champagne/18 pl-4"
              >
                <p className="text-[0.64rem] font-light uppercase tracking-[0.18em] text-zeya-champagne/38">
                  {entry.role === "agent" ? "Zeya" : "You"}
                </p>
                <p className="mt-1 text-sm font-light leading-relaxed text-zeya-ivory/72">
                  {entry.text}
                </p>
              </motion.div>
            ))
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
