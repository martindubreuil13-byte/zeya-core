"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
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

  return (
    <div className="w-full max-w-4xl mx-auto space-y-16 overflow-y-auto">
      <AnimatePresence mode="wait">
        {phase === "returns" && (
          <motion.div
            key="returns"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
            onAnimationComplete={() => setTimeout(() => setPhase("insights"), 3500)}
          >
            <ZeyaReturns />
          </motion.div>
        )}

        {phase === "insights" && (
          <motion.div
            key="insights"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            onAnimationComplete={() => setTimeout(() => setPhase("plan"), 4000)}
          >
            <BusinessInsightsSection insights={insights} />
          </motion.div>
        )}

        {phase === "plan" && (
          <motion.div
            key="plan"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            onAnimationComplete={() => setTimeout(() => setPhase("vision"), 4000)}
          >
            <OperationalPlan />
          </motion.div>
        )}

        {phase === "vision" && (
          <motion.div
            key="vision"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
            onAnimationComplete={() => setTimeout(() => setPhase("conversion"), 3000)}
          >
            <VisionSection />
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

      {/* Manual navigation between sections */}
      {(phase === "insights" || phase === "plan" || phase === "vision") && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="flex justify-center gap-4"
        >
          <button
            onClick={() => {
              const order = ["insights", "plan", "vision"];
              const currentIndex = order.indexOf(phase);
              if (currentIndex > 0) setPhase(order[currentIndex - 1] as PostCallPhase);
            }}
            className="text-xs text-zeya-taupe/60 hover:text-zeya-taupe transition-colors font-light"
          >
            ← Back
          </button>
          <button
            onClick={() => {
              const order = ["insights", "plan", "vision"];
              const currentIndex = order.indexOf(phase);
              if (currentIndex < order.length - 1) setPhase(order[currentIndex + 1] as PostCallPhase);
            }}
            className="text-xs text-zeya-taupe/60 hover:text-zeya-taupe transition-colors font-light"
          >
            Continue →
          </button>
        </motion.div>
      )}
    </div>
  );
}
