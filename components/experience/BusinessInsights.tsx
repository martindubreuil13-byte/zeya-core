"use client";

import { motion } from "framer-motion";
import type { BusinessInsights } from "@/types/experience";

interface BusinessInsightsProps {
  insights: BusinessInsights;
}

export function BusinessInsightsSection({ insights }: BusinessInsightsProps) {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.1,
        delayChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="visible"
      className="space-y-6"
    >
      <motion.div variants={itemVariants} className="space-y-2 text-center">
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em", lineHeight: "1.35" }}
        >
          What I Learned About Your Business
        </p>
        <p className="text-sm text-zeya-taupe font-light" style={{ letterSpacing: "0.02em" }}>
          Here's what I understood.
        </p>
      </motion.div>

      <motion.div variants={itemVariants} className="grid gap-4 sm:gap-5 md:grid-cols-2 max-w-3xl mx-auto px-2 sm:px-0">
        {/* Business Type & Offer */}
        <div className="space-y-4 rounded border border-zeya-taupe/20 px-4 sm:px-5 py-4 sm:py-5">
          <p
            className="text-xs font-light uppercase text-zeya-taupe"
            style={{ letterSpacing: "0.12em" }}
          >
            What You Do
          </p>
          <div className="space-y-3">
            {insights.businessType && (
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">Business Type</p>
                <p className="mt-2 text-sm text-zeya-ivory/85 font-light">
                  {insights.businessType}
                </p>
              </div>
            )}
            {insights.offer && (
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">What You Offer</p>
                <p className="mt-2 text-sm text-zeya-ivory/85 font-light">{insights.offer}</p>
              </div>
            )}
            {insights.targetCustomer && (
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">Who You Serve</p>
                <p className="mt-2 text-sm text-zeya-ivory/85 font-light">
                  {insights.targetCustomer}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Goal & Challenge */}
        <div className="space-y-4 rounded border border-zeya-taupe/20 px-4 sm:px-5 py-4 sm:py-5">
          <p
            className="text-xs font-light uppercase text-zeya-taupe"
            style={{ letterSpacing: "0.12em" }}
          >
            Your Challenge
          </p>
          <div className="space-y-3">
            {insights.goal && (
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">Primary Goal</p>
                <p className="mt-2 text-sm text-zeya-ivory/85 font-light capitalize">
                  Growing{" "}
                  {insights.goal === "leads"
                    ? "customer conversations"
                    : insights.goal === "revenue"
                      ? "revenue"
                      : insights.goal === "retention"
                        ? "customer retention"
                        : "your business"}
                </p>
              </div>
            )}
            {insights.challenge && (
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">The Block</p>
                <p className="mt-2 text-sm text-zeya-ivory/85 font-light">{insights.challenge}</p>
              </div>
            )}
          </div>
        </div>

        {/* Opportunity & Fit */}
        <div className="space-y-4 rounded border border-zeya-taupe/20 px-4 sm:px-5 py-4 sm:py-5 md:col-span-2">
          <p
            className="text-xs font-light uppercase text-zeya-taupe"
            style={{ letterSpacing: "0.12em" }}
          >
            The Opportunity
          </p>
          <div className="space-y-3">
            {insights.opportunity && (
              <p className="text-sm text-zeya-ivory/85 font-light leading-relaxed">
                {insights.opportunity}
              </p>
            )}
            <div className="mt-4 pt-4 border-t border-zeya-taupe/10 flex items-start justify-between">
              <div>
                <p className="text-xs text-zeya-taupe/60 font-light">Representation Fit</p>
                {insights.confidence === "low" ? (
                  <p className="mt-2 text-sm text-zeya-taupe/70 font-light leading-relaxed">
                    I don't have enough context yet to judge fit properly.
                  </p>
                ) : (
                  <p
                    className="mt-2 text-sm font-light capitalize"
                    style={{
                      color:
                        insights.representationFit === "high"
                          ? "rgb(215, 193, 155)"
                          : insights.representationFit === "medium"
                            ? "rgb(184, 173, 160)"
                            : "rgb(156, 148, 142)",
                    }}
                  >
                    {insights.representationFit}
                  </p>
                )}
              </div>
              <div className="text-right">
                <p className="text-xs text-zeya-taupe/60 font-light">Next Step</p>
                <p className="mt-2 text-xs text-zeya-ivory/75 font-light max-w-xs">
                  {insights.recommendedNextStep}
                </p>
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
