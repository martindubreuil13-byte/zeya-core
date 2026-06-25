"use client";

import { motion } from "framer-motion";

export function OperationalPlan() {
  const steps = [
    "Represent your business consistently.",
    "Speak with interested prospects.",
    "Qualify which opportunities matter.",
    "Guide conversations toward the next step.",
    "Learn from every interaction.",
    "Improve the approach based on what works.",
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.1 }}
      className="space-y-8"
    >
      <div className="space-y-4 text-center max-w-2xl mx-auto">
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em", lineHeight: "1.35" }}
        >
          If We Worked Together
        </p>
        <p
          className="text-sm sm:text-base font-light text-zeya-taupe"
          style={{ letterSpacing: "0.02em", lineHeight: "1.8" }}
        >
          Based on what you've told me, here's where I would begin.
        </p>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2 }}
        className="max-w-2xl mx-auto space-y-4"
      >
        {steps.map((step, index) => (
          <motion.div
            key={step}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 + index * 0.05 }}
            className="flex gap-4 items-start"
          >
            <div className="flex-shrink-0 mt-1">
              <div className="flex items-center justify-center h-6 w-6 rounded-full border border-zeya-champagne/40 text-zeya-champagne">
                <span className="text-xs font-light">{index + 1}</span>
              </div>
            </div>
            <p className="text-base sm:text-lg font-light text-zeya-ivory/85 pt-0.5">
              {step}
            </p>
          </motion.div>
        ))}
      </motion.div>
    </motion.div>
  );
}
