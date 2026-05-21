"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Role = "presence" | "user";

type ConversationLine = {
  role: Role;
  text: string;
};

// Atmospheric placeholder lines — illustrate the conversational feel of the interface.
const lines: ConversationLine[] = [
  { role: "presence", text: "I'm here. Take your time." },
  { role: "user", text: "Tell me about what you sense right now." },
  { role: "presence", text: "A stillness. And something beginning." },
];

type ConversationLayerProps = {
  children?: ReactNode;
  className?: string;
};

export function ConversationLayer({ children, className }: ConversationLayerProps) {
  return (
    <div
      className={cn(
        "relative flex w-full max-w-xl flex-col items-center gap-7",
        className,
      )}
    >
      {/* Separator with champagne glow */}
      <div className="relative w-full">
        <div className="h-px w-full bg-zeya-champagne/12" />
        <div className="absolute inset-x-0 top-0 mx-auto h-px w-44 -translate-y-0 bg-gradient-to-r from-transparent via-zeya-champagne/32 to-transparent" />
      </div>

      {/* Conversation transcript */}
      <div className="flex w-full flex-col gap-5 px-0.5">
        {lines.map((line, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12, filter: "blur(8px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{
              duration: 1.1,
              delay: 2.0 + i * 0.75,
              ease: [0.22, 1, 0.36, 1],
            }}
            className={cn(
              "flex",
              line.role === "user" ? "justify-end" : "justify-start",
            )}
          >
            <p
              className={cn(
                "max-w-[78%] text-sm leading-7 tracking-wide",
                line.role === "presence"
                  ? "font-light italic text-zeya-champagne/60"
                  : "font-light text-zeya-ivory/50",
              )}
            >
              {line.text}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Floating input slot */}
      {children}
    </div>
  );
}
