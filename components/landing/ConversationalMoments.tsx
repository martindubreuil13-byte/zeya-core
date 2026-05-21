"use client";

import { motion } from "framer-motion";

const moments = [
  {
    text: "I followed up with them this morning.",
    offset: "sm:mr-auto sm:ml-8",
  },
  {
    text: "The conversation felt hesitant near pricing.",
    offset: "sm:mx-auto",
  },
  {
    text: "They sounded ready to move forward.",
    offset: "sm:ml-auto sm:mr-8",
  },
];

export function ConversationalMoments() {
  return (
    <section className="relative flex min-h-[55vh] flex-col items-center justify-center px-6 py-20">
      {/* Section separator */}
      <div className="absolute inset-x-0 top-0 flex justify-center">
        <div className="h-px w-16 bg-gradient-to-r from-transparent via-zeya-champagne/14 to-transparent" />
      </div>

      <div className="flex w-full max-w-sm flex-col gap-4 sm:max-w-md">
        {moments.map((moment, i) => (
          <motion.div
            key={moment.text}
            initial={{ opacity: 0, y: 16, filter: "blur(8px)" }}
            whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            viewport={{ once: true, margin: "-60px" }}
            transition={{
              duration: 1.2,
              delay: i * 0.22,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={moment.offset}
          >
            <div
              className="rounded-[1.1rem] border border-zeya-ivory/8 px-6 py-4 backdrop-blur-xl"
              style={{
                background: "rgba(33,20,29,0.22)",
                boxShadow:
                  "inset 0 1px 0 rgba(244,238,226,0.06), 0 8px 48px rgba(10,7,9,0.28)",
              }}
            >
              <p className="text-[0.875rem] font-light italic leading-[1.85] tracking-wide text-zeya-hush/60">
                &ldquo;{moment.text}&rdquo;
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
