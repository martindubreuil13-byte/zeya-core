"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type FloatingInputProps = {
  className?: string;
};

export function FloatingInput({ className }: FloatingInputProps) {
  const [focused, setFocused] = useState(false);
  const [value, setValue] = useState("");

  const hasContent = value.trim().length > 0;

  return (
    <motion.div
      animate={{
        boxShadow: focused
          ? "0 0 0 1px rgba(215,193,155,0.24), 0 0 52px rgba(215,193,155,0.09), 0 20px 80px rgba(10,7,9,0.58)"
          : "0 20px 80px rgba(10,7,9,0.42)",
      }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        "relative flex min-h-14 w-full items-center gap-3 rounded-full border px-5 backdrop-blur-2xl transition-colors duration-700",
        focused
          ? "border-zeya-champagne/22 bg-zeya-aubergine/32"
          : "border-zeya-ivory/10 bg-zeya-void/38",
        className,
      )}
    >
      {/* Inset highlight line */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px rounded-full bg-gradient-to-r from-transparent via-zeya-ivory/16 to-transparent" />

      {/* Subtle inner glow on focus */}
      <motion.div
        aria-hidden="true"
        animate={{ opacity: focused ? 1 : 0 }}
        transition={{ duration: 0.8 }}
        className="pointer-events-none absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(ellipse 60% 100% at 50% 0%, rgb(215 193 155 / 0.08) 0%, transparent 100%)",
        }}
      />

      {/* Mic icon */}
      <motion.div
        animate={{
          opacity: hasContent ? 0.38 : 0.72,
          scale: hasContent ? 0.85 : 1,
        }}
        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className="shrink-0"
      >
        <Mic
          className="size-[1.05rem] text-zeya-champagne/80"
          strokeWidth={1.5}
          aria-hidden="true"
        />
      </motion.div>

      {/* Text input */}
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Speak, type, or simply begin."
        aria-label="Speak with Zeya"
        className="min-w-0 flex-1 bg-transparent text-sm font-light tracking-wide text-zeya-ivory outline-none placeholder:text-zeya-hush/52"
      />

      {/* Send — appears when there is content */}
      <AnimatePresence>
        {hasContent && (
          <motion.button
            key="send"
            initial={{ opacity: 0, scale: 0.65, x: 10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.65, x: 10 }}
            transition={{ duration: 0.38, ease: [0.22, 1, 0.36, 1] }}
            whileHover={{
              scale: 1.08,
              backgroundColor: "rgba(215,193,155,0.22)",
              transition: { duration: 0.3 },
            }}
            whileTap={{ scale: 0.94 }}
            aria-label="Send"
            style={{ backgroundColor: "rgba(215,193,155,0.12)" }}
            className="flex size-8 shrink-0 items-center justify-center rounded-full border border-zeya-champagne/25 text-zeya-champagne/80"
          >
            <ArrowUp className="size-3.5" strokeWidth={2} />
          </motion.button>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
