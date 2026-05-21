"use client";

import { motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useRef } from "react";
import { cn } from "@/lib/utils";

type PresenceCoreProps = {
  className?: string;
};

export function PresenceCore({ className }: PresenceCoreProps) {
  const containerRef = useRef<HTMLDivElement>(null);

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
          scale: [1, 1.1, 1],
          opacity: [0.22, 0.4, 0.22],
        }}
        transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut" }}
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
          boxShadow:
            "0 0 80px rgb(215 193 155 / 0.1), 0 36px 120px rgb(10 7 9 / 0.65), inset 0 1px 0 rgb(244 238 226 / 0.1), inset 0 -1px 0 rgb(10 7 9 / 0.2)",
        }}
      />

      {/* Inner warm atmosphere — offset from breathing */}
      <motion.div
        aria-hidden="true"
        animate={{
          scale: [0.88, 1.06, 0.88],
          opacity: [0.24, 0.44, 0.24],
        }}
        transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut", delay: 0.8 }}
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
          scale: [1, 1.1, 1],
          opacity: [0.72, 0.92, 0.72],
        }}
        transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
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
          opacity: [0.45, 0.8, 0.45],
          scale: [1, 1.22, 1],
        }}
        transition={{ duration: 4.4, repeat: Infinity, ease: "easeInOut", delay: 0.15 }}
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
          opacity: [0.18, 0],
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
