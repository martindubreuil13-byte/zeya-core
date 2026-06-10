"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

export function AbstractPresence() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const animationRef = useRef<number>();
  const particlesRef = useRef<Particle[]>([]);

  interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    maxLife: number;
    radius: number;
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Set canvas size
    const updateSize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    updateSize();
    window.addEventListener("resize", updateSize);

    // Track mouse position
    const handleMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    window.addEventListener("mousemove", handleMouseMove);

    // Create particles
    class Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      life: number;
      maxLife: number;
      radius: number;

      constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 1.5;
        this.vy = (Math.random() - 0.5) * 1.5;
        this.life = 1;
        this.maxLife = Math.random() * 2 + 1.5;
        this.radius = Math.random() * 1.5 + 0.5;
      }

      update() {
        this.x += this.vx;
        this.y += this.vy;
        this.life -= 0.016 / this.maxLife;
        // Clamp life to [0, 1] to prevent negative values
        this.life = Math.max(0, Math.min(1, this.life));
        this.vy += 0.04;
      }

      draw(ctx: CanvasRenderingContext2D) {
        // Normalize life to ensure it's in [0, 1] (defensive against edge cases)
        const normalizedLife = Math.max(0, Math.min(1, this.life));

        // Calculate radius with defensive guard against negative values
        const radiusScalar = 1 - Math.pow(1 - normalizedLife, 2);
        const displayRadius = Math.max(0, this.radius * radiusScalar);

        // Skip rendering if radius is effectively invisible
        if (displayRadius < 0.01) return;

        ctx.save();
        ctx.globalAlpha = normalizedLife * 0.6;
        ctx.fillStyle = "#d7c19b";
        ctx.beginPath();
        ctx.arc(this.x, this.y, displayRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      isAlive() {
        // Small threshold (0.001) accounts for floating-point precision
        return this.life > 0.001;
      }
    }

    // Core mesh animation
    const time = { value: 0 };
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    const animate = () => {
      time.value += 1;

      // Clear canvas with gradient
      const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
      gradient.addColorStop(0, "#0a0709");
      gradient.addColorStop(0.5, "#21141d");
      gradient.addColorStop(1, "#0a0709");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Distance from mouse to center
      const distToMouse = Math.sqrt(
        Math.pow(mousePos.x - centerX, 2) + Math.pow(mousePos.y - centerY, 2)
      );
      const influence = Math.max(0, 1 - distToMouse / 400);

      // Draw core mesh
      ctx.strokeStyle = `rgba(215, 193, 155, ${0.15 + influence * 0.1})`;
      ctx.lineWidth = 1;

      const meshSize = 60;
      for (let i = -2; i <= 2; i++) {
        for (let j = -2; j <= 2; j++) {
          const x =
            centerX +
            i * meshSize +
            Math.sin(time.value * 0.003 + i) * 15 * (1 + influence * 0.5);
          const y =
            centerY +
            j * meshSize +
            Math.cos(time.value * 0.004 + j) * 15 * (1 + influence * 0.5);

          if (i < 2) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            const nextX =
              centerX +
              (i + 1) * meshSize +
              Math.sin(time.value * 0.003 + i + 1) * 15 * (1 + influence * 0.5);
            ctx.lineTo(nextX, y + meshSize / 2);
            ctx.stroke();
          }
          if (j < 2) {
            ctx.beginPath();
            ctx.moveTo(x, y);
            const nextY =
              centerY +
              (j + 1) * meshSize +
              Math.cos(time.value * 0.004 + j + 1) * 15 * (1 + influence * 0.5);
            ctx.lineTo(x + meshSize / 2, nextY);
            ctx.stroke();
          }
        }
      }

      // Draw core orb-adjacent form
      ctx.save();
      const pulsePhase = Math.sin(time.value * 0.005) * 0.3 + 0.7;
      const coreSize = 40 + influence * 20;

      // Inner glow
      const glowGradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreSize * 2);
      glowGradient.addColorStop(0, `rgba(215, 193, 155, ${0.2 * pulsePhase + 0.1 * influence})`);
      glowGradient.addColorStop(0.5, `rgba(215, 193, 155, ${0.08 * pulsePhase})`);
      glowGradient.addColorStop(1, "rgba(215, 193, 155, 0)");
      ctx.fillStyle = glowGradient;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreSize * 2, 0, Math.PI * 2);
      ctx.fill();

      // Core point
      ctx.fillStyle = `rgba(215, 193, 155, ${0.4 + influence * 0.2})`;
      ctx.beginPath();
      ctx.arc(centerX, centerY, coreSize * 0.3, 0, Math.PI * 2);
      ctx.fill();

      // Breathing rings
      ctx.strokeStyle = `rgba(215, 193, 155, ${(0.15 + influence * 0.15) * pulsePhase})`;
      ctx.lineWidth = 0.8;
      for (let ring = 1; ring <= 3; ring++) {
        ctx.beginPath();
        ctx.arc(
          centerX,
          centerY,
          coreSize + ring * 15 * pulsePhase,
          0,
          Math.PI * 2
        );
        ctx.stroke();
      }

      ctx.restore();

      // Spawn particles near core on interaction
      if (influence > 0.3) {
        for (let i = 0; i < 2; i++) {
          const angle = Math.random() * Math.PI * 2;
          const distance = coreSize + Math.random() * 20;
          particlesRef.current.push(
            new Particle(
              centerX + Math.cos(angle) * distance,
              centerY + Math.sin(angle) * distance
            )
          );
        }
      }

      // Update and draw particles
      // Remove dead particles before processing
      particlesRef.current = particlesRef.current.filter((p) => p.isAlive());

      particlesRef.current.forEach((p) => {
        p.update();
        p.draw(ctx);
      });

      // Remove particles that died during this frame
      particlesRef.current = particlesRef.current.filter((p) => p.isAlive());

      animationRef.current = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("resize", updateSize);
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [mousePos]);

  return (
    <motion.canvas
      ref={canvasRef}
      className="fixed inset-0 w-full h-full"
      style={{ touchAction: "none" }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, ease: "easeOut" }}
    />
  );
}
