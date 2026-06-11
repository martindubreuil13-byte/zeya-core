"use client";

import { useState, useEffect, useRef } from "react";

interface LearnOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  onExperience: () => void;
}

type Step = "what" | "whatnot" | "cta";

export function LearnOverlay({ isOpen, onClose, onExperience }: LearnOverlayProps) {
  const [step, setStep] = useState<Step>("what");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("what");
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    } else {
      // Auto-play voice when overlay opens
      playZeyaVoice();
    }
  }, [isOpen]);

  const playZeyaVoice = async () => {
    setIsPlaying(true);
    // Voice will play automatically - this is where ElevenLabs integration happens
    if (audioRef.current) {
      try {
        audioRef.current.play();
      } catch (err) {
        console.log("Audio playback:", err);
      }
    }
  };

  const goNext = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      if (step === "what") setStep("whatnot");
      else if (step === "whatnot") setStep("cta");
      setIsTransitioning(false);
    }, 300);
  };

  const goBack = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      if (step === "whatnot") setStep("what");
      else if (step === "cta") setStep("whatnot");
      setIsTransitioning(false);
    }, 300);
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Minimal backdrop - barely perceptible */}
      <div
        className="fixed inset-0 z-40 transition-opacity duration-700"
        style={{
          backgroundColor: "rgba(0, 0, 0, 0.08)",
          backdropFilter: "blur(0px)",
        }}
        onClick={onClose}
      />

      {/* The conversation - emerges from atmosphere */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-12"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative max-w-2xl w-full"
          style={{
            animation: "fadeIn 0.8s ease-out",
          }}
        >
          {/* Audio element for Zeya voice */}
          <audio
            ref={audioRef}
            style={{ display: "none" }}
            onEnded={() => setIsPlaying(false)}
          />

          {/* Close button - minimal, top right */}
          <button
            onClick={onClose}
            className="absolute -top-16 right-0 text-zeya-hush hover:text-zeya-champagne transition-colors duration-500 text-sm tracking-widest uppercase opacity-40 hover:opacity-100"
            style={{
              fontSize: "0.65rem",
              letterSpacing: "0.15em",
            }}
          >
            Close
          </button>

          {/* Content - almost no container */}
          <div
            className="transition-opacity duration-500 space-y-6"
            style={{
              opacity: isTransitioning ? 0 : 1,
              background: "transparent",
              border: "none",
              backdropFilter: "none",
            }}
          >
            {step === "what" && (
              <div className="space-y-8 sm:space-y-12">
                <div className="space-y-4 sm:space-y-6">
                  <div className="space-y-5 sm:space-y-7">
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-85 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      A digital business partner.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-75 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      She learns your business.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      She remembers what matters.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      She acts when needed.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      She improves with every conversation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {step === "whatnot" && (
              <div className="space-y-8 sm:space-y-12">
                <div className="space-y-4 sm:space-y-6">
                  <div className="space-y-5 sm:space-y-7">
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-85 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Not a chatbot.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-75 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Not a CRM.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Not another AI tool.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Not a dashboard.
                    </p>
                    <p
                      className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-70 font-light"
                      style={{
                        lineHeight: "1.9",
                        letterSpacing: "0.01em",
                      }}
                    >
                      Not software that waits for instructions.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {step === "cta" && (
              <div className="space-y-10 sm:space-y-16">
                <div className="space-y-6 sm:space-y-8">
                  <p
                    className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-85 font-light"
                    style={{
                      lineHeight: "1.9",
                      letterSpacing: "0.01em",
                    }}
                  >
                    The only way to understand Zeya
                  </p>
                  <p
                    className="text-zeya-ivory text-base sm:text-lg leading-relaxed opacity-80 font-light"
                    style={{
                      lineHeight: "1.9",
                      letterSpacing: "0.01em",
                    }}
                  >
                    is to experience her.
                  </p>
                  <div className="space-y-3 pt-4">
                    <p
                      className="text-zeya-hush text-xs tracking-widest uppercase opacity-50 font-light"
                      style={{
                        letterSpacing: "0.15em",
                      }}
                    >
                      There is nothing more to read.
                    </p>
                    <p
                      className="text-zeya-hush text-xs tracking-widest uppercase opacity-50 font-light"
                      style={{
                        letterSpacing: "0.15em",
                      }}
                    >
                      Only an invitation.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Navigation - minimal */}
            <div className="flex items-center justify-between mt-12 sm:mt-16 pt-8 border-t border-zeya-champagne/10">
              <div className="flex gap-4">
                {step !== "what" && (
                  <button
                    onClick={goBack}
                    className="text-xs tracking-widest text-zeya-hush hover:text-zeya-champagne transition-colors duration-300 uppercase opacity-50 hover:opacity-100 font-light"
                    style={{
                      fontSize: "0.65rem",
                      letterSpacing: "0.15em",
                    }}
                  >
                    Back
                  </button>
                )}
              </div>

              {step === "cta" ? (
                <button
                  onClick={() => {
                    onClose();
                    onExperience();
                  }}
                  className="text-xs sm:text-sm tracking-widest text-zeya-ivory hover:text-zeya-champagne transition-colors duration-300 uppercase opacity-70 hover:opacity-100 font-light"
                  style={{
                    fontSize: "0.65rem",
                    letterSpacing: "0.15em",
                  }}
                >
                  Begin
                </button>
              ) : (
                <button
                  onClick={goNext}
                  className="text-xs sm:text-sm tracking-widest text-zeya-ivory hover:text-zeya-champagne transition-colors duration-300 uppercase opacity-70 hover:opacity-100 font-light"
                  style={{
                    fontSize: "0.65rem",
                    letterSpacing: "0.15em",
                  }}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </>
  );
}
