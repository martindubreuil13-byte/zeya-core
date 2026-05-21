"use client";

import { motion } from "framer-motion";

export function ClosingCTA() {
  return (
    <section className="relative flex min-h-[52vh] flex-col items-center justify-center px-6 py-28">
      {/* Section separator */}
      <div className="absolute inset-x-0 top-0 flex justify-center">
        <div className="h-px w-16 bg-gradient-to-r from-transparent via-zeya-champagne/14 to-transparent" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, filter: "blur(10px)" }}
        whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-col items-center gap-9 text-center"
      >
        <p className="font-serif text-[2rem] leading-tight tracking-tight text-zeya-ivory/68 sm:text-[2.5rem]">
          Ready when you are.
        </p>

        <motion.button
          type="button"
          whileHover={{
            borderColor: "rgba(215,193,155,0.38)",
            color: "rgba(244,238,226,0.72)",
            transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] },
          }}
          style={{ backgroundColor: "rgba(33,20,29,0.28)" }}
          className="zeya-transition rounded-full border border-zeya-champagne/20 px-9 py-3.5 text-[11px] font-light uppercase tracking-[0.22em] text-zeya-hush/55 backdrop-blur-xl"
        >
          Request Early Access
        </motion.button>
      </motion.div>

      {/* Footer wordmark */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.4, delay: 0.5 }}
        className="absolute bottom-8 left-0 right-0 flex justify-center"
      >
        <p className="type-eyebrow">
          Zeya · AI Voice Presence
        </p>
      </motion.div>
    </section>
  );
}
