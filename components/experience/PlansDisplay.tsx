"use client";

import { motion } from "framer-motion";

interface PlansDisplayProps {
  onBack: () => void;
}

export function PlansDisplay({ onBack }: PlansDisplayProps) {
  const plans = [
    {
      id: "starter",
      name: "Starter",
      description: "For testing representation",
      features: ["One business", "Up to 20 conversations/month", "Basic reporting"],
      recommended: false,
    },
    {
      id: "growth",
      name: "Growth",
      description: "For scaling outreach",
      features: ["One business", "Unlimited conversations", "Daily summaries", "Trend analysis"],
      recommended: true,
    },
    {
      id: "business",
      name: "Business",
      description: "For serious volume",
      features: ["Multiple businesses", "Unlimited conversations", "Team features", "Custom agents"],
      recommended: false,
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8"
    >
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="text-center space-y-4"
      >
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em" }}
        >
          How Zeya Works
        </p>
        <p className="text-sm text-zeya-taupe font-light max-w-2xl mx-auto">
          Choose the plan that fits where you are today. You can upgrade anytime as you grow.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="grid gap-5 sm:gap-6 md:grid-cols-3 max-w-4xl mx-auto px-2 sm:px-0"
      >
        {plans.map((plan, index) => (
          <motion.div
            key={plan.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.05 + index * 0.05 }}
            className={`rounded border px-6 py-6 space-y-4 transition-all ${
              plan.recommended
                ? "border-zeya-champagne/40 bg-zeya-champagne/5"
                : "border-zeya-taupe/20 hover:border-zeya-taupe/40"
            }`}
          >
            {plan.recommended && (
              <p
                className="text-xs font-light text-zeya-champagne uppercase"
                style={{ letterSpacing: "0.12em" }}
              >
                Most Popular
              </p>
            )}

            <div>
              <p
                className="font-serif text-lg text-zeya-ivory font-light"
                style={{ letterSpacing: "0.04em" }}
              >
                {plan.name}
              </p>
              <p className="text-xs text-zeya-taupe font-light mt-1">{plan.description}</p>
            </div>

            <div className="space-y-2">
              {plan.features.map((feature) => (
                <div key={feature} className="flex gap-2 text-sm">
                  <span className="text-zeya-champagne/70 text-xs">✓</span>
                  <span className="text-zeya-ivory/75 font-light">{feature}</span>
                </div>
              ))}
            </div>

            <div className="pt-4">
              <button className="w-full border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 py-2 text-sm font-light transition-colors rounded">
                Get Started
              </button>
            </div>
          </motion.div>
        ))}
      </motion.div>

      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }}>
        <button
          onClick={onBack}
          className="w-full border border-zeya-taupe/30 text-zeya-taupe hover:text-zeya-champagne hover:border-zeya-champagne py-3 text-sm font-light transition-colors rounded"
          style={{ letterSpacing: "0.08em" }}
        >
          Back
        </button>
      </motion.div>
    </motion.div>
  );
}
