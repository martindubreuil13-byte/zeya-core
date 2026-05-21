"use client";

import { motion, useTransform } from "framer-motion";
import { useMousePosition } from "@/hooks/useMousePosition";
import { cn } from "@/lib/utils";

type AmbientBackgroundProps = {
  className?: string;
  fixed?: boolean;
};

export function AmbientBackground({ className, fixed = false }: AmbientBackgroundProps) {
  const { x, y } = useMousePosition(12, 40, 2);

  // Gentle parallax — each layer drifts in opposing directions at different rates
  const blob1X = useTransform(x, [0, 1], ["-7%", "7%"]);
  const blob1Y = useTransform(y, [0, 1], ["-5%", "5%"]);
  const blob2X = useTransform(x, [0, 1], ["5%", "-5%"]);
  const blob2Y = useTransform(y, [0, 1], ["4%", "-4%"]);
  const blob3X = useTransform(x, [0, 1], ["-3%", "3%"]);
  const blob3Y = useTransform(y, [0, 1], ["6%", "-6%"]);

  return (
    <div
      className={cn(
        "-z-10 overflow-hidden",
        fixed ? "fixed inset-0" : "absolute inset-0",
        className,
      )}
      aria-hidden="true"
    >
      {/* Foundation gradient */}
      <div className="absolute inset-0 bg-midnight-vellum" />

      {/* Atmospheric overlay */}
      <div className="absolute inset-0 bg-atmosphere-radial opacity-90" />

      {/* Primary warm bloom — parallax layer 1 */}
      <motion.div
        style={{
          x: blob1X,
          y: blob1Y,
          background:
            "radial-gradient(circle, rgb(215 193 155 / 0.22) 0%, rgb(215 193 155 / 0.06) 50%, transparent 75%)",
        }}
        animate={{
          scale: [1, 1.09, 0.96, 1],
          opacity: [0.16, 0.26, 0.14, 0.16],
        }}
        transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        className="absolute left-[44%] top-[30%] size-[44rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px]"
      />

      {/* Deep plum bloom — parallax layer 2, opposite drift */}
      <motion.div
        style={{
          x: blob2X,
          y: blob2Y,
          background: "radial-gradient(circle, rgb(78 55 70 / 0.62) 0%, transparent 70%)",
        }}
        animate={{
          scale: [0.92, 1.1, 0.92],
          opacity: [0.28, 0.44, 0.28],
        }}
        transition={{ duration: 24, repeat: Infinity, ease: "easeInOut", delay: 4 }}
        className="absolute left-[15%] top-[62%] size-[32rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-[100px]"
      />

      {/* Graphite taupe bloom — far right */}
      <motion.div
        style={{
          x: blob3X,
          y: blob3Y,
          background: "radial-gradient(circle, rgb(76 69 66 / 0.5) 0%, transparent 72%)",
        }}
        animate={{
          scale: [1, 1.06, 0.94, 1],
          opacity: [0.2, 0.34, 0.2],
        }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut", delay: 9 }}
        className="absolute right-[8%] top-[38%] size-[28rem] -translate-y-1/2 rounded-full blur-[90px]"
      />

      {/* Secondary champagne highlight — upper center, slow oscillation */}
      <motion.div
        animate={{
          x: ["-4%", "3%", "-4%"],
          y: ["0%", "-5%", "0%"],
          opacity: [0.1, 0.18, 0.1],
        }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        className="absolute left-1/2 top-[12%] size-[22rem] -translate-x-1/2 rounded-full blur-[70px]"
        style={{
          background:
            "radial-gradient(circle, rgb(215 193 155 / 0.16) 0%, transparent 65%)",
        }}
      />

      {/* Film grain texture */}
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{
          opacity: 0.06,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.78' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='512' height='512' filter='url(%23noise)' opacity='1'/%3E%3C/svg%3E")`,
          backgroundRepeat: "repeat",
          backgroundSize: "160px 160px",
        }}
      />

      {/* Bottom vignette to void */}
      <div className="absolute inset-x-0 bottom-0 h-[40%] bg-gradient-to-t from-zeya-void via-zeya-void/65 to-transparent" />

      {/* Radial edge vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 85% 80% at 50% 48%, transparent 0%, rgb(10 7 9 / 0.55) 65%, rgb(10 7 9 / 0.82) 100%)",
        }}
      />
    </div>
  );
}
