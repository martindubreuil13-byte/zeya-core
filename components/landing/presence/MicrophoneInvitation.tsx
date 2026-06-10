"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

export function MicrophoneInvitation() {
  const router = useRouter();
  const [isMounted, setIsMounted] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  const handleClick = () => {
    router.push("/app");
  };

  if (!isMounted) return null;

  return (
    <div
      className="fixed inset-0 z-10 flex items-center justify-center"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick();
        }
      }}
      style={{ cursor: isHovered ? "pointer" : "default" }}
    >
      {/* Minimal, discovered text - part of the material, not overlay */}
      <div
        className="text-center pointer-events-none transition-opacity duration-700"
        style={{
          opacity: isMounted ? (isHovered ? 0.8 : 0.3) : 0,
        }}
      >
        <div
          className="font-serif text-base font-light text-zeya-ivory mb-4"
          style={{
            letterSpacing: '0.08em',
            lineHeight: '1.4',
            textRendering: 'optimizeLegibility',
          }}
        >
          Experience
        </div>
        <div
          className="text-xs text-zeya-hush tracking-widest uppercase"
          style={{
            letterSpacing: '0.12em',
            fontWeight: '300',
          }}
        >
          Zeya
        </div>
      </div>

      {/* Invisible interaction zone */}
      <div
        className="absolute rounded-full pointer-events-auto"
        style={{
          width: '220px',
          height: '220px',
          opacity: 0,
        }}
      />
    </div>
  );
}
