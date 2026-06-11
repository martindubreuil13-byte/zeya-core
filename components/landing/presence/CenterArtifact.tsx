"use client";

import { useState } from "react";

interface CenterArtifactProps {
  onExperience?: () => void;
}

export function CenterArtifact({ onExperience }: CenterArtifactProps) {
  const [isHovered, setIsHovered] = useState(false);

  const handleClick = () => {
    onExperience?.();
  };

  return (
    <div
      className="fixed inset-0 z-10 flex flex-col items-center justify-center gap-8"
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
      {/* The relic artifact - larger, more visible */}
      <div
        className="relative transition-all duration-700"
        style={{
          transform: isHovered ? "scale(1.12) rotate(1deg)" : "scale(1)",
        }}
      >
        {/* Aura on hover */}
        {isHovered && (
          <div
            className="absolute inset-0 blur-3xl opacity-25"
            style={{
              width: "90px",
              height: "90px",
              background: "radial-gradient(circle, rgba(204,182,142,0.3) 0%, transparent 80%)",
              animation: "breathe 3.5s ease-in-out infinite",
              marginLeft: "-15px",
              marginTop: "-15px",
            }}
          />
        )}

        {/* The seal/sigil - scaled up significantly */}
        <svg
          width="70"
          height="70"
          viewBox="0 0 18 18"
          className="relative z-10"
          style={{
            filter: isHovered
              ? "drop-shadow(0 0 16px rgba(204,182,142,0.5))"
              : "drop-shadow(0 0 6px rgba(204,182,142,0.25))",
            transition: "filter 0.7s ease-out",
          }}
        >
          {/* Outer circle - the seal ring */}
          <circle
            cx="9"
            cy="9"
            r="8"
            fill="none"
            stroke="url(#sealGradient)"
            strokeWidth="0.7"
            opacity={isHovered ? "0.8" : "0.5"}
            className="transition-opacity duration-700"
          />

          {/* Inner ring */}
          <circle
            cx="9"
            cy="9"
            r="6.5"
            fill="none"
            stroke="url(#sealGradient)"
            strokeWidth="0.4"
            opacity={isHovered ? "0.6" : "0.35"}
            className="transition-opacity duration-700"
          />

          {/* Center mark and curved accents */}
          <g opacity={isHovered ? "1" : "0.6"} className="transition-opacity duration-700">
            <circle cx="9" cy="9" r="0.8" fill="url(#coreSeal)" />
            <path
              d="M 9 5.5 Q 10.5 6.5 10 8.5"
              fill="none"
              stroke="url(#sealGradient)"
              strokeWidth="0.5"
              opacity="0.7"
            />
            <path
              d="M 9 5.5 Q 7.5 6.5 8 8.5"
              fill="none"
              stroke="url(#sealGradient)"
              strokeWidth="0.5"
              opacity="0.7"
            />
            <path
              d="M 9 12.5 Q 8 11.5 8.5 10"
              fill="none"
              stroke="url(#sealGradient)"
              strokeWidth="0.5"
              opacity="0.6"
            />
          </g>

          <defs>
            <radialGradient id="coreSeal" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(204,182,142,0.9)" />
              <stop offset="100%" stopColor="rgba(204,182,142,0.3)" />
            </radialGradient>
            <linearGradient id="sealGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(204,182,142,1)" />
              <stop offset="50%" stopColor="rgba(204,182,142,0.8)" />
              <stop offset="100%" stopColor="rgba(204,182,142,0.6)" />
            </linearGradient>
          </defs>
        </svg>
      </div>

      {/* CTA text below artifact */}
      <div
        className="text-center transition-all duration-700 pointer-events-none"
        style={{
          opacity: isHovered ? 0.95 : 0.6,
          transform: isHovered ? "translateY(-4px)" : "translateY(0)",
        }}
      >
        <p
          className="font-serif text-lg sm:text-xl text-zeya-ivory font-light tracking-wide"
          style={{
            letterSpacing: "0.08em",
            lineHeight: "1.4",
          }}
        >
          Experience Zeya
        </p>
      </div>

      {/* CSS animations */}
      <style>{`
        @keyframes breathe {
          0%, 100% {
            opacity: 0.15;
            transform: scale(1);
          }
          50% {
            opacity: 0.35;
            transform: scale(1.08);
          }
        }
      `}</style>
    </div>
  );
}
