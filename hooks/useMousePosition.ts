"use client";

import { useEffect } from "react";
import { type MotionValue, useMotionValue, useSpring } from "framer-motion";

type UseMousePositionReturn = {
  x: MotionValue<number>;
  y: MotionValue<number>;
};

export function useMousePosition(
  stiffness = 18,
  damping = 45,
  mass = 1.5,
): UseMousePositionReturn {
  const rawX = useMotionValue(0.5);
  const rawY = useMotionValue(0.5);

  const x = useSpring(rawX, { stiffness, damping, mass });
  const y = useSpring(rawY, { stiffness, damping, mass });

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      rawX.set(e.clientX / window.innerWidth);
      rawY.set(e.clientY / window.innerHeight);
    };
    window.addEventListener("mousemove", handle, { passive: true });
    return () => window.removeEventListener("mousemove", handle);
  }, [rawX, rawY]);

  return { x, y };
}
