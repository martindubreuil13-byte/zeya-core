"use client";

import { motion, useTransform } from "framer-motion";
import Link from "next/link";
import { PresenceCore } from "@/components/presence";
import { useMousePosition } from "@/hooks/useMousePosition";

export function HeroSection() {
  const { x, y } = useMousePosition(10, 55, 3);
  const contentY = useTransform(y, [0, 1], ["-1%", "1%"]);
  const contentX = useTransform(x, [0, 1], ["-0.5%", "0.5%"]);

  return (
    <section
      id="hero"
      className="relative flex min-h-dvh flex-col items-center justify-center px-6 pb-20 pt-24"
    >
      <motion.div
        style={{ y: contentY, x: contentX }}
        className="flex flex-col items-center gap-10 text-center"
      >
        {/* Entrance */}
        <motion.div
          initial={{ opacity: 0, y: 24, filter: "blur(20px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 2.0, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-9"
        >
          <PresenceCore className="size-44 sm:size-56" />

          <div className="max-w-[26rem] space-y-4">
            <h1 className="font-serif text-[2.6rem] leading-tight tracking-tight text-zeya-ivory sm:text-[3.4rem]">
              Ready to take
              <br />
              the next call.
            </h1>
            <p className="mx-auto max-w-[20rem] text-[0.9375rem] font-light leading-relaxed tracking-wide text-zeya-hush/58">
              Voice&#8209;first AI conversations designed to feel natural, calm, and human.
            </p>
          </div>
        </motion.div>

        {/* CTAs */}
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.4, delay: 0.65, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-wrap items-center justify-center gap-3.5"
        >
          <a
            href="#positioning"
            className="zeya-transition rounded-full border border-zeya-champagne/26 px-7 py-3 text-sm font-light tracking-wide text-zeya-ivory/82 backdrop-blur-xl hover:border-zeya-champagne/44 hover:text-zeya-ivory"
            style={{ background: "rgba(33,20,29,0.38)" }}
          >
            Experience Zeya
          </a>

          <Link
            href="/app"
            className="zeya-transition rounded-full border border-zeya-ivory/10 px-7 py-3 text-sm font-light tracking-wide text-zeya-hush/50 backdrop-blur-xl hover:border-zeya-ivory/18 hover:text-zeya-hush/75"
          >
            Enter Workspace
          </Link>
        </motion.div>
      </motion.div>

      {/* Scroll cue */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2.8, duration: 1.2 }}
        className="absolute bottom-10 left-1/2 -translate-x-1/2"
        aria-hidden="true"
      >
        <motion.div
          animate={{ y: [0, 6, 0], opacity: [0.4, 0.7, 0.4] }}
          transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
          className="h-8 w-px bg-gradient-to-b from-zeya-champagne/35 to-transparent"
        />
      </motion.div>
    </section>
  );
}
