"use client";

import { motion } from "framer-motion";

interface ConversionPromptProps {
  onShowPlans: () => void;
  onFollowUp: () => void;
  disabled?: boolean;
}

export function ConversionPrompt({ onShowPlans, onFollowUp, disabled = false }: ConversionPromptProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.1 }}
      className="space-y-6 text-center"
    >
      <div className="space-y-4 max-w-2xl mx-auto">
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em", lineHeight: "1.35" }}
        >
          Would you like to make this real?
        </p>

        <p
          className="text-sm sm:text-base font-light text-zeya-taupe"
          style={{ letterSpacing: "0.02em", lineHeight: "1.8" }}
        >
          Let me show you what it would look like to have Zeya representing your business every day.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.3 }}
        className="flex flex-col sm:flex-row gap-3 justify-center"
      >
        <button
          onClick={onShowPlans}
          disabled={disabled}
          className="px-6 py-3 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors disabled:opacity-50 text-sm font-light rounded"
          style={{ letterSpacing: "0.08em" }}
        >
          Show Me
        </button>

        <button
          onClick={onFollowUp}
          disabled={disabled}
          className="px-6 py-3 border border-zeya-taupe/30 text-zeya-ivory hover:border-zeya-champagne hover:text-zeya-champagne transition-colors disabled:opacity-50 text-sm font-light rounded"
          style={{ letterSpacing: "0.08em" }}
        >
          Not Right Now
        </button>
      </motion.div>
    </motion.div>
  );
}
