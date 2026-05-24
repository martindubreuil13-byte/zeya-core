"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import type { VoiceState } from "@/types/voice";

type PresenceCoreProps = {
  className?: string;
  state?: VoiceState;
};

const presenceByState: Record<
  VoiceState,
  {
    haloDuration: number;
    haloScale: number[];
    haloOpacity: number[];
    innerDuration: number;
    innerScale: number[];
    innerOpacity: number[];
    coreScale: number[];
    coreOpacity: number[];
    rippleOpacity: number[];
    bodyShadow: string;
  }
> = {
  idle: {
    haloDuration: 4.4,
    haloScale: [1, 1.1, 1],
    haloOpacity: [0.22, 0.4, 0.22],
    innerDuration: 4.4,
    innerScale: [0.88, 1.06, 0.88],
    innerOpacity: [0.24, 0.44, 0.24],
    coreScale: [1, 1.1, 1],
    coreOpacity: [0.72, 0.92, 0.72],
    rippleOpacity: [0.12, 0],
    bodyShadow:
      "0 0 80px rgb(215 193 155 / 0.1), 0 36px 120px rgb(10 7 9 / 0.65), inset 0 1px 0 rgb(244 238 226 / 0.1), inset 0 -1px 0 rgb(10 7 9 / 0.2)",
  },
  connecting: {
    haloDuration: 2.4,
    haloScale: [0.98, 1.06, 0.98],
    haloOpacity: [0.26, 0.5, 0.26],
    innerDuration: 2.8,
    innerScale: [0.86, 1.0, 0.86],
    innerOpacity: [0.3, 0.52, 0.3],
    coreScale: [0.96, 1.04, 0.96],
    coreOpacity: [0.62, 0.86, 0.62],
    rippleOpacity: [0.2, 0],
    bodyShadow:
      "0 0 92px rgb(215 193 155 / 0.14), 0 36px 120px rgb(10 7 9 / 0.68), inset 0 1px 0 rgb(244 238 226 / 0.12), inset 0 -1px 0 rgb(10 7 9 / 0.22)",
  },
  listening: {
    haloDuration: 3.8,
    haloScale: [1, 1.08, 1],
    haloOpacity: [0.26, 0.48, 0.26],
    innerDuration: 3.6,
    innerScale: [0.82, 0.98, 0.82],
    innerOpacity: [0.3, 0.56, 0.3],
    coreScale: [0.94, 1.02, 0.94],
    coreOpacity: [0.82, 1, 0.82],
    rippleOpacity: [0.22, 0],
    bodyShadow:
      "0 0 104px rgb(215 193 155 / 0.16), 0 36px 120px rgb(10 7 9 / 0.65), inset 0 1px 0 rgb(244 238 226 / 0.13), inset 0 -1px 0 rgb(10 7 9 / 0.2)",
  },
  thinking: {
    haloDuration: 6.4,
    haloScale: [1, 1.04, 1],
    haloOpacity: [0.16, 0.28, 0.16],
    innerDuration: 6.2,
    innerScale: [0.78, 0.92, 0.78],
    innerOpacity: [0.14, 0.26, 0.14],
    coreScale: [0.88, 0.96, 0.88],
    coreOpacity: [0.42, 0.64, 0.42],
    rippleOpacity: [0.08, 0],
    bodyShadow:
      "0 0 64px rgb(215 193 155 / 0.08), 0 36px 120px rgb(10 7 9 / 0.72), inset 0 1px 0 rgb(244 238 226 / 0.08), inset 0 -1px 0 rgb(10 7 9 / 0.28)",
  },
  speaking: {
    haloDuration: 4.8,
    haloScale: [1, 1.14, 1],
    haloOpacity: [0.24, 0.5, 0.24],
    innerDuration: 4.8,
    innerScale: [0.9, 1.12, 0.9],
    innerOpacity: [0.28, 0.56, 0.28],
    coreScale: [1, 1.14, 1],
    coreOpacity: [0.74, 0.98, 0.74],
    rippleOpacity: [0.2, 0],
    bodyShadow:
      "0 0 116px rgb(215 193 155 / 0.18), 0 36px 120px rgb(10 7 9 / 0.62), inset 0 1px 0 rgb(244 238 226 / 0.14), inset 0 -1px 0 rgb(10 7 9 / 0.2)",
  },
  interrupted: {
    haloDuration: 2.8,
    haloScale: [0.96, 1.08, 0.96],
    haloOpacity: [0.24, 0.46, 0.24],
    innerDuration: 2.8,
    innerScale: [0.8, 1.02, 0.8],
    innerOpacity: [0.26, 0.5, 0.26],
    coreScale: [0.92, 1.04, 0.92],
    coreOpacity: [0.74, 0.96, 0.74],
    rippleOpacity: [0.18, 0],
    bodyShadow:
      "0 0 102px rgb(215 193 155 / 0.15), 0 36px 120px rgb(10 7 9 / 0.66), inset 0 1px 0 rgb(244 238 226 / 0.12), inset 0 -1px 0 rgb(10 7 9 / 0.22)",
  },
  processing: {
    haloDuration: 5.2,
    haloScale: [1, 1.05, 1],
    haloOpacity: [0.18, 0.32, 0.18],
    innerDuration: 5.2,
    innerScale: [0.84, 1.0, 0.84],
    innerOpacity: [0.2, 0.34, 0.2],
    coreScale: [0.96, 1.04, 0.96],
    coreOpacity: [0.58, 0.78, 0.58],
    rippleOpacity: [0.1, 0],
    bodyShadow:
      "0 0 72px rgb(215 193 155 / 0.09), 0 36px 120px rgb(10 7 9 / 0.68), inset 0 1px 0 rgb(244 238 226 / 0.09), inset 0 -1px 0 rgb(10 7 9 / 0.24)",
  },
  disconnected: {
    haloDuration: 5.6,
    haloScale: [0.98, 1.03, 0.98],
    haloOpacity: [0.12, 0.22, 0.12],
    innerDuration: 5.6,
    innerScale: [0.82, 0.94, 0.82],
    innerOpacity: [0.12, 0.24, 0.12],
    coreScale: [0.94, 1, 0.94],
    coreOpacity: [0.48, 0.66, 0.48],
    rippleOpacity: [0.06, 0],
    bodyShadow:
      "0 0 48px rgb(215 193 155 / 0.06), 0 36px 120px rgb(10 7 9 / 0.72), inset 0 1px 0 rgb(244 238 226 / 0.08), inset 0 -1px 0 rgb(10 7 9 / 0.28)",
  },
  error: {
    haloDuration: 5.6,
    haloScale: [0.98, 1.02, 0.98],
    haloOpacity: [0.12, 0.24, 0.12],
    innerDuration: 5.6,
    innerScale: [0.8, 0.94, 0.8],
    innerOpacity: [0.12, 0.24, 0.12],
    coreScale: [0.92, 0.98, 0.92],
    coreOpacity: [0.44, 0.64, 0.44],
    rippleOpacity: [0.05, 0],
    bodyShadow:
      "0 0 44px rgb(215 193 155 / 0.06), 0 36px 120px rgb(10 7 9 / 0.75), inset 0 1px 0 rgb(244 238 226 / 0.07), inset 0 -1px 0 rgb(10 7 9 / 0.3)",
  },
};

export function PresenceCore({ className, state = "idle" }: PresenceCoreProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const presence = presenceByState[state];

  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);

  const springX = useSpring(rawX, { stiffness: 22, damping: 65, mass: 2 });
  const springY = useSpring(rawY, { stiffness: 22, damping: 65, mass: 2 });

  const rotateX = useTransform(springY, [-0.5, 0.5], [6, -6]);
  const rotateY = useTransform(springX, [-0.5, 0.5], [-6, 6]);

  function onMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    rawX.set((e.clientX - rect.left) / rect.width - 0.5);
    rawY.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  function onMouseLeave() {
    rawX.set(0);
    rawY.set(0);
  }

  return (
    <motion.div
      ref={containerRef}
      aria-label="Zeya presence"
      role="img"
      initial={{ scale: 0.82, opacity: 0, filter: "blur(24px)" }}
      animate={{ scale: 1, opacity: 1, filter: "blur(0px)" }}
      transition={{ duration: 2.2, ease: [0.22, 1, 0.36, 1] }}
      style={{
        rotateX,
        rotateY,
        transformPerspective: 900,
        transformStyle: "preserve-3d",
      }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={cn(
        "relative grid size-56 place-items-center sm:size-72",
        className,
      )}
    >
      {/* Distant outer aurora — very slow conic rotation */}
      <motion.div
        aria-hidden="true"
        animate={{
          rotate: [0, 360],
          scale: [1, 1.05, 0.97, 1],
          opacity: [0.35, 0.55, 0.35],
        }}
        transition={{
          rotate: { duration: 90, repeat: Infinity, ease: "linear" },
          scale: { duration: 10, repeat: Infinity, ease: "easeInOut" },
          opacity: { duration: 10, repeat: Infinity, ease: "easeInOut" },
        }}
        className="absolute inset-[-36%] rounded-full"
        style={{
          background:
            "conic-gradient(from 0deg, transparent 0%, rgb(215 193 155 / 0.05) 22%, transparent 44%, rgb(45 35 43 / 0.12) 66%, transparent 84%, rgb(215 193 155 / 0.04) 100%)",
          filter: "blur(32px)",
        }}
      />

      {/* Breathing halo — primary pulse rhythm, ~4s */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: presence.haloScale,
          opacity: presence.haloOpacity,
        }}
        transition={{ duration: presence.haloDuration, repeat: Infinity, ease: "easeInOut" }}
        className="absolute inset-[-14%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgb(215 193 155 / 0.14) 0%, rgb(215 193 155 / 0.04) 55%, transparent 75%)",
          filter: "blur(28px)",
        }}
      />

      {/* Secondary halo — offset rhythm for organic feel */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: [0.95, 1.06, 0.95],
          opacity: [0.15, 0.28, 0.15],
        }}
        transition={{ duration: 6.8, repeat: Infinity, ease: "easeInOut", delay: 1.2 }}
        className="absolute inset-[-6%] rounded-full border border-zeya-champagne/8"
        style={{ filter: "blur(1px)" }}
      />

      {/* Main orb body — glass vessel */}
      <motion.div
        aria-hidden="true"
        whileHover={{
          scale: 1.025,
          transition: { duration: 1.4, ease: [0.22, 1, 0.36, 1] },
        }}
        className="absolute inset-0 rounded-full border border-zeya-champagne/14 backdrop-blur-2xl"
        style={{
          background:
            "radial-gradient(circle at 36% 32%, rgb(58 52 55 / 0.75) 0%, rgb(33 20 29 / 0.78) 48%, rgb(10 7 9 / 0.72) 100%)",
          boxShadow: presence.bodyShadow,
        }}
      />

      {/* Inner warm atmosphere — offset from breathing */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: presence.innerScale,
          opacity: presence.innerOpacity,
        }}
        transition={{ duration: presence.innerDuration, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
        className="absolute inset-[18%] rounded-full"
        style={{
          background:
            "radial-gradient(circle at 42% 38%, rgb(215 193 155 / 0.26) 0%, rgb(215 193 155 / 0.06) 60%, transparent 80%)",
          filter: "blur(22px)",
        }}
      />

      {/* Central vessel — inner sphere */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: presence.coreScale,
          opacity: presence.coreOpacity,
        }}
        transition={{ duration: presence.haloDuration, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
        className="relative size-[4.5rem] rounded-full border border-zeya-ivory/10 sm:size-24"
        style={{
          background:
            "radial-gradient(circle at 38% 32%, rgb(58 52 55 / 0.6) 0%, rgb(10 7 9 / 0.78) 100%)",
          boxShadow:
            "inset 0 1px 0 rgb(244 238 226 / 0.16), inset 0 -16px 32px rgb(10 7 9 / 0.28), 0 0 22px rgb(215 193 155 / 0.09)",
        }}
      />

      {/* Focal luminant point — soft slow pulse */}
      <motion.div
        aria-hidden="true"
        animate={{
          opacity: presence.coreOpacity,
          scale: presence.coreScale,
        }}
        transition={{ duration: presence.haloDuration, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
        className="absolute size-3 rounded-full sm:size-4"
        style={{
          background:
            "radial-gradient(circle, rgb(244 238 226 / 0.65) 0%, rgb(215 193 155 / 0.2) 55%, transparent 100%)",
          filter: "blur(2.5px)",
        }}
      />

      {/* Listening ripple — slow outward ring, subtle */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: [1, 1.35],
          opacity: presence.rippleOpacity,
        }}
        transition={{
          duration: 3.5,
          repeat: Infinity,
          ease: "easeOut",
          delay: 2.2,
          repeatDelay: 1.5,
        }}
        className="absolute inset-[-4%] rounded-full border border-zeya-champagne/18"
      />
    </motion.div>
  );
}
