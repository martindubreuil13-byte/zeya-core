"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type ContextPanelProps = {
  className?: string;
};

export function ContextPanel({ className }: ContextPanelProps) {
  return (
    <motion.aside
      aria-label="Context layer"
      initial={{ opacity: 0, x: 18, filter: "blur(10px)" }}
      animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
      transition={{ duration: 1.4, delay: 4.2, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "absolute right-5 top-5 z-10 hidden max-w-[13.5rem] rounded-[1.25rem] border border-zeya-ivory/7 p-5 text-left backdrop-blur-2xl md:block",
        className,
      )}
      style={{
        background:
          "linear-gradient(145deg, rgb(33 20 29 / 0.38) 0%, rgb(10 7 9 / 0.28) 100%)",
        boxShadow:
          "inset 0 1px 0 rgb(244 238 226 / 0.07), inset 0 -1px 0 rgb(10 7 9 / 0.12), 0 20px 80px rgb(10 7 9 / 0.4)",
      }}
    >
      {/* Top accent */}
      <div className="mb-4 h-px w-full bg-gradient-to-r from-transparent via-zeya-champagne/22 to-transparent" />

      {/* State indicator */}
      <div className="flex items-center gap-2.5">
        <motion.div
          animate={{ opacity: [0.42, 0.88, 0.42] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
          className="size-1.5 rounded-full bg-zeya-champagne/55"
        />
        <span className="text-[10px] font-light uppercase tracking-[0.18em] text-zeya-hush/50">
          Listening
        </span>
      </div>

      {/* Contextual copy */}
      <div className="mt-4 space-y-2.5">
        <p className="text-[11px] font-light leading-[1.6] text-zeya-hush/38">
          Presence initialized.
        </p>
        <p className="text-[11px] font-light leading-[1.6] text-zeya-hush/26">
          Ready when you are.
        </p>
      </div>

      {/* Bottom accent */}
      <div className="mt-5 h-px w-full bg-gradient-to-r from-transparent via-zeya-champagne/12 to-transparent" />
    </motion.aside>
  );
}
