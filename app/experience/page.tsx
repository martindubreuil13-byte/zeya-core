"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

type ConversationStep = "greeting" | "intro" | "question" | "response" | "cta";

interface Message {
  role: "zeya" | "visitor";
  text: string;
}

export default function ExperiencePage() {
  const router = useRouter();
  const [step, setStep] = useState<ConversationStep>("greeting");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [visitorResponses, setVisitorResponses] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Initial greeting
  useEffect(() => {
    // Delay for atmosphere
    const timer = setTimeout(() => {
      setMessages([
        {
          role: "zeya",
          text: "Hello.",
        },
      ]);
      setStep("intro");
    }, 800);

    return () => clearTimeout(timer);
  }, []);

  const handleNext = () => {
    if (step === "intro") {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "I'm Zeya.",
          },
        ]);
      }, 300);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "Most people think I'm an AI assistant.",
          },
        ]);
      }, 1200);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "That's not quite true.",
          },
        ]);
      }, 2400);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "I learn. I remember. I help people build things.",
          },
        ]);
      }, 3600);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "But before I tell you what I am... tell me something.",
          },
        ]);
      }, 5000);

      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "What are you building?",
          },
        ]);
        setStep("question");
      }, 6500);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsLoading(true);
    const visitorMessage = input.trim();
    setMessages((prev) => [...prev, { role: "visitor", text: visitorMessage }]);
    setInput("");
    setVisitorResponses((prev) => prev + 1);

    // Simulate Zeya thinking and responding
    setTimeout(() => {
      if (visitorResponses === 0) {
        setMessages((prev) => [
          ...prev,
          {
            role: "zeya",
            text: "That's interesting.",
          },
        ]);

        setTimeout(() => {
          setMessages((prev) => [
            ...prev,
            {
              role: "zeya",
              text: "I think I can help.",
            },
          ]);

          setTimeout(() => {
            setMessages((prev) => [
              ...prev,
              {
                role: "zeya",
                text: "But first I need to know who I'm speaking with.",
              },
            ]);
            setStep("cta");
            setIsLoading(false);
          }, 800);
        }, 800);
      }
    }, 1200);
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void flex flex-col">
      {/* Subtle top indicator */}
      <div
        className="fixed top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zeya-champagne to-transparent opacity-20 z-20"
        style={{}}
      />

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto p-6 sm:p-12 max-w-2xl mx-auto w-full flex flex-col justify-end">
        <div className="space-y-6 sm:space-y-8">
          {messages.map((msg, idx) => (
            <div
              key={idx}
              className={`animate-fadeIn ${
                msg.role === "zeya" ? "mr-auto" : "ml-auto"
              }`}
              style={{
                animation: "fadeIn 0.5s ease-out",
              }}
            >
              <div
                className={`${
                  msg.role === "zeya"
                    ? "text-zeya-ivory opacity-85"
                    : "text-zeya-champagne opacity-90"
                } text-base sm:text-lg leading-relaxed font-light`}
                style={{
                  maxWidth: "600px",
                  lineHeight: "1.8",
                  letterSpacing: "0.01em",
                }}
              >
                {msg.text}
              </div>
            </div>
          ))}

          {/* Show next button on intro, before questions */}
          {step === "intro" && visitorResponses === 0 && (
            <div className="mt-8">
              <button
                onClick={handleNext}
                className="text-xs sm:text-sm tracking-widest text-zeya-hush hover:text-zeya-champagne transition-colors duration-300 uppercase opacity-60 hover:opacity-100"
                style={{
                  fontSize: "0.65rem",
                  letterSpacing: "0.15em",
                }}
              >
                Continue
              </button>
            </div>
          )}

          {/* CTA when ready for account */}
          {step === "cta" && (
            <div className="mt-8 space-y-4">
              <button
                onClick={() => router.push("/auth/introduce")}
                className="text-base sm:text-lg tracking-widest text-zeya-ivory hover:text-zeya-champagne transition-colors duration-300 opacity-80 hover:opacity-100 font-light"
                style={{
                  letterSpacing: "0.08em",
                }}
              >
                Introduce yourself
              </button>
              <p
                className="text-xs text-zeya-hush opacity-50"
                style={{
                  letterSpacing: "0.1em",
                }}
              >
                This is the beginning of something
              </p>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input area - only show when in question/response stage */}
      {step === "question" && (
        <div className="border-t border-zeya-champagne/10 p-6 sm:p-8 bg-gradient-to-t from-zeya-void/50 to-transparent">
          <form onSubmit={handleSubmit} className="max-w-2xl mx-auto">
            <div className="flex gap-4">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Tell me..."
                disabled={isLoading}
                className="flex-1 bg-transparent border-b border-zeya-hush/30 text-zeya-ivory placeholder-zeya-hush/40 focus:outline-none focus:border-zeya-champagne transition-colors duration-300 py-2 text-base"
                style={{
                  letterSpacing: "0.01em",
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim()}
                className="text-zeya-ivory hover:text-zeya-champagne transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 5l7 7m0 0l-7 7m7-7H6"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(8px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 4px;
        }
        ::-webkit-scrollbar-track {
          background: transparent;
        }
        ::-webkit-scrollbar-thumb {
          background: rgba(204, 182, 142, 0.2);
          border-radius: 2px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(204, 182, 142, 0.4);
        }
      `}</style>
    </main>
  );
}
