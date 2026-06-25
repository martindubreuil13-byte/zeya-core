"use client";

import { motion } from "framer-motion";
import { PresenceCore } from "@/components/presence";

export function ZeyaReturns() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
      className="flex flex-col items-center text-center space-y-6"
    >
      <PresenceCore state="idle" />

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-2xl space-y-4"
      >
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em", lineHeight: "1.35" }}
        >
          I've returned.
        </p>

        <p
          className="text-sm sm:text-base font-light text-zeya-taupe"
          style={{ letterSpacing: "0.02em", lineHeight: "1.8" }}
        >
          A few minutes ago, you told me about your business. I understood. I sent someone to
          represent you on the call. Now I'm back with what I learned.
        </p>
      </motion.div>
    </motion.div>
  );
}
