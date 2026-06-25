"use client";

import { motion } from "framer-motion";

export function VisionSection() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.8, delay: 0.2 }}
      className="space-y-6 text-center"
    >
      <div className="space-y-4 max-w-2xl mx-auto">
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em", lineHeight: "1.35" }}
        >
          Imagine This Every Day
        </p>

        <p
          className="text-base sm:text-lg font-light text-zeya-ivory/85 leading-relaxed"
          style={{ letterSpacing: "0.01em", lineHeight: "1.8" }}
        >
          Imagine I was doing this every single day. Researching prospects. Contacting them. Having
          real conversations. Qualifying leads. Following up intelligently. Learning what works.
        </p>

        <p
          className="text-base sm:text-lg font-light text-zeya-ivory/75 leading-relaxed"
          style={{ letterSpacing: "0.01em", lineHeight: "1.8" }}
        >
          All while you focus on closing deals and running your business. That's what this becomes
          when it's not a demo. That's the actual work.
        </p>
      </div>
    </motion.div>
  );
}
