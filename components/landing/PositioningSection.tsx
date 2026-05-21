"use client";

import { motion } from "framer-motion";

export function PositioningSection() {
  return (
    <section
      id="positioning"
      className="relative flex min-h-[60vh] flex-col items-center justify-center px-6 py-28"
    >
      {/* Section separator */}
      <div className="absolute inset-x-0 top-0 mx-auto flex justify-center">
        <div className="h-px w-20 bg-gradient-to-r from-transparent via-zeya-champagne/18 to-transparent" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 22, filter: "blur(10px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-[32rem] space-y-6 text-center"
      >
        <p className="font-serif text-[1.85rem] leading-snug tracking-tight text-zeya-ivory/78 sm:text-[2.25rem]">
          Most AI voice systems sound automated.
        </p>

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.4, delay: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="font-serif text-[1.85rem] italic leading-snug tracking-tight text-zeya-champagne/55 sm:text-[2.25rem]"
        >
          Zeya was designed to feel present.
        </motion.p>

        <motion.div
          initial={{ scaleX: 0, opacity: 0 }}
          whileInView={{ scaleX: 1, opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto mt-8 h-px w-14 origin-left bg-gradient-to-r from-transparent via-zeya-champagne/22 to-transparent"
        />

        <motion.p
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 1.2, delay: 0.8 }}
          className="mx-auto max-w-[22rem] text-[0.875rem] font-light leading-[1.9] tracking-wide text-zeya-hush/45"
        >
          Every conversation shaped by calm intelligence.
          <br />
          Not urgency. Not scripts.
        </motion.p>
      </motion.div>
    </section>
  );
}
