"use client";

import { useEffect, useRef } from "react";

export function SpatialPresence() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef({
    mouseX: 0,
    mouseY: 0,
    mouseHistory: [] as Array<{ x: number; y: number; age: number }>,
    time: 0,
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    const handleMouseMove = (e: MouseEvent) => {
      stateRef.current.mouseX = e.clientX;
      stateRef.current.mouseY = e.clientY;
      stateRef.current.mouseHistory.push({
        x: e.clientX,
        y: e.clientY,
        age: 0,
      });
    };
    window.addEventListener("mousemove", handleMouseMove);

    const animate = () => {
      stateRef.current.time += 0.016;

      // Clean background
      const bg = ctx.createLinearGradient(0, 0, 0, canvas.height);
      bg.addColorStop(0, "#0a0709");
      bg.addColorStop(0.5, "#110a0e");
      bg.addColorStop(1, "#090508");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render grain traces at cursor history points
      for (let i = stateRef.current.mouseHistory.length - 1; i >= 0; i--) {
        const point = stateRef.current.mouseHistory[i];
        point.age += 0.016;

        // Fade over 1 second
        const fade = Math.max(0, 1 - point.age / 1);
        if (fade <= 0) {
          stateRef.current.mouseHistory.splice(i, 1);
          continue;
        }

        // Render grain texture at this point
        const radius = 50;
        const grainDensity = fade * 0.6;

        // Draw grainy texture using small random circles
        ctx.globalAlpha = grainDensity;
        for (let g = 0; g < 80; g++) {
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * radius;
          const x = point.x + Math.cos(angle) * dist;
          const y = point.y + Math.sin(angle) * dist;
          const size = Math.random() * 1.5 + 0.5;

          ctx.fillStyle = `rgba(215, 193, 155, ${Math.random() * 0.4})`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }

      requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", updateSize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ touchAction: "none" }}
    />
  );
}
