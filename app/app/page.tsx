"use client";

import { motion, useTransform } from "framer-motion";
import { AmbientBackground } from "@/components/layout";
import { ConversationLayer } from "@/components/conversation";
import { ContextPanel } from "@/components/panels";
import { PresenceCore } from "@/components/presence";
import { FloatingInput } from "@/components/ui";
import { useMousePosition } from "@/hooks/useMousePosition";

export default function AppPage() {
  const { x, y } = useMousePosition(10, 55, 3);
  const contentY = useTransform(y, [0, 1], ["-1.2%", "1.2%"]);
  const contentX = useTransform(x, [0, 1], ["-0.6%", "0.6%"]);

  return (
    <main className="relative isolate flex min-h-dvh items-center justify-center overflow-hidden px-5 py-14 sm:px-8">
      <AmbientBackground />

      <motion.section
        style={{ y: contentY, x: contentX }}
        className="relative z-10 flex w-full max-w-[36rem] flex-col items-center gap-12 text-center"
      >
        <motion.div
          initial={{ opacity: 0, y: 20, filter: "blur(16px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 1.8, ease: [0.22, 1, 0.36, 1] }}
          className="flex flex-col items-center gap-9"
        >
          <PresenceCore />

          <div className="space-y-3.5">
            <p className="font-serif text-5xl leading-none tracking-tight text-zeya-ivory sm:text-[4.25rem]">
              Hi, I&apos;m Zeya.
            </p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 1.4, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}
              className="text-[0.9375rem] font-light tracking-wide text-zeya-hush/65"
            >
              What are we building today?
            </motion.p>
          </div>
        </motion.div>

        <ConversationLayer>
          <FloatingInput />
        </ConversationLayer>
      </motion.section>

      <ContextPanel />
    </main>
  );
}
