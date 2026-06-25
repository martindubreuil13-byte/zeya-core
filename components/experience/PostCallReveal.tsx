"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { speakText, stopSpeaking } from "@/lib/voice/text-to-speech";
import { ZeyaReturns } from "./ZeyaReturns";
import { BusinessInsightsSection } from "./BusinessInsights";
import { OperationalPlan } from "./OperationalPlan";
import { VisionSection } from "./VisionSection";
import { ConversionPrompt } from "./ConversionPrompt";
import { PlansDisplay } from "./PlansDisplay";
import { FollowUpCapture } from "./FollowUpCapture";
import type { BusinessInsights, PostCallState } from "@/types/experience";

type PostCallPhase = "returns" | "insights" | "plan" | "vision" | "conversion" | "plans" | "follow_up";

interface PostCallRevealProps {
  insights: BusinessInsights;
  onPlansPurchase?: () => void;
  onFollowUpCapture?: (data: { name: string; email: string }) => Promise<void>;
}

export function PostCallReveal({
  insights,
  onPlansPurchase,
  onFollowUpCapture,
}: PostCallRevealProps) {
  const [phase, setPhase] = useState<PostCallPhase>("returns");
  const [state, setState] = useState<PostCallState>({ conversionAction: null });
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Narrate each phase when it appears
  useEffect(() => {
    const narrationMap: Record<PostCallPhase, string> = {
      returns:
        "I've returned. A few minutes ago, you told me about your business. I understood. I sent someone to represent you on the call. Now I'm back with what I learned.",
      insights:
        "Here's what I understood about your business based on our conversation.",
      plan: "If we worked together, here's how I would begin.",
      vision:
        "Imagine every inquiry receiving a response. Every opportunity followed up on. Your business represented consistently, even when you're unavailable.",
      conversion:
        "Would you like to explore what it would look like if I represented your business every day?",
      plans: "", // No narration for plans (user exploring options)
      follow_up: "", // No narration for follow-up form
    };

    const narration = narrationMap[phase];
    if (narration) {
      setIsSpeaking(true);
      speakText(narration).finally(() => {
        setIsSpeaking(false);
      });
    }

    return () => {
      stopSpeaking();
    };
  }, [phase]);

  const handleShowPlans = () => {
    setState((prev) => ({ ...prev, conversionAction: "show_plans" }));
    setPhase("plans");
  };

  const handleFollowUp = () => {
    setState((prev) => ({ ...prev, conversionAction: "follow_up" }));
    setPhase("follow_up");
  };

  const handleBackToConversion = () => {
    setState((prev) => ({ ...prev, conversionAction: null }));
    setPhase("conversion");
  };

  const handleFollowUpSubmit = async (data: { name: string; email: string }) => {
    setState((prev) => ({ ...prev, followUpName: data.name, followUpEmail: data.email }));
    if (onFollowUpCapture) {
      await onFollowUpCapture(data);
    }
  };

  const handleContinue = (current: PostCallPhase) => {
    const order: PostCallPhase[] = ["returns", "insights", "plan", "vision", "conversion"];
    const currentIndex = order.indexOf(current);
    if (currentIndex < order.length - 1) {
      setPhase(order[currentIndex + 1]);
    }
  };

  const handleBack = (current: PostCallPhase) => {
    const order: PostCallPhase[] = ["returns", "insights", "plan", "vision", "conversion"];
    const currentIndex = order.indexOf(current);
    if (currentIndex > 0) {
      setPhase(order[currentIndex - 1]);
    }
  };

  return (
    <div className="w-full max-w-4xl mx-auto space-y-12 overflow-y-auto">
      <AnimatePresence mode="wait">
        {phase === "returns" && (
          <motion.div
            key="returns"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-8"
          >
            <ZeyaReturns />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 }}
              className="flex justify-center"
            >
              <button
                onClick={() => handleContinue("returns")}
                className="px-6 py-3 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}

        {phase === "insights" && (
          <motion.div
            key="insights"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <BusinessInsightsSection insights={insights} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="flex justify-center gap-3"
            >
              <button
                onClick={() => handleBack("insights")}
                className="px-6 py-3 border border-zeya-taupe/30 text-zeya-taupe hover:border-zeya-champagne hover:text-zeya-champagne transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Back
              </button>
              <button
                onClick={() => handleContinue("insights")}
                className="px-6 py-3 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}

        {phase === "plan" && (
          <motion.div
            key="plan"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <OperationalPlan />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="flex justify-center gap-3"
            >
              <button
                onClick={() => handleBack("plan")}
                className="px-6 py-3 border border-zeya-taupe/30 text-zeya-taupe hover:border-zeya-champagne hover:text-zeya-champagne transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Back
              </button>
              <button
                onClick={() => handleContinue("plan")}
                className="px-6 py-3 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}

        {phase === "vision" && (
          <motion.div
            key="vision"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            className="space-y-8"
          >
            <VisionSection />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.5 }}
              className="flex justify-center gap-3"
            >
              <button
                onClick={() => handleBack("vision")}
                className="px-6 py-3 border border-zeya-taupe/30 text-zeya-taupe hover:border-zeya-champagne hover:text-zeya-champagne transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Back
              </button>
              <button
                onClick={() => handleContinue("vision")}
                className="px-6 py-3 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 transition-colors text-sm font-light rounded"
                style={{ letterSpacing: "0.08em" }}
              >
                Continue
              </button>
            </motion.div>
          </motion.div>
        )}

        {phase === "conversion" && (
          <motion.div
            key="conversion"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          >
            <ConversionPrompt onShowPlans={handleShowPlans} onFollowUp={handleFollowUp} />
          </motion.div>
        )}

        {phase === "plans" && (
          <motion.div
            key="plans"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <PlansDisplay onBack={handleBackToConversion} />
          </motion.div>
        )}

        {phase === "follow_up" && (
          <motion.div
            key="follow_up"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <FollowUpCapture onSubmit={handleFollowUpSubmit} onBack={handleBackToConversion} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
