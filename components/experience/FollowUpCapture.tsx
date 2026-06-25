"use client";

import { useState } from "react";
import { motion } from "framer-motion";

interface FollowUpCaptureProps {
  onSubmit: (data: { name: string; email: string }) => Promise<void>;
  onBack: () => void;
}

export function FollowUpCapture({ onSubmit, onBack }: FollowUpCaptureProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;

    setIsSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim() });
      setSubmitted(true);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
        className="text-center space-y-6 py-12"
      >
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em" }}
        >
          Thank you.
        </p>
        <p className="text-sm text-zeya-taupe font-light max-w-md mx-auto">
          I'll stay in touch and share ideas that could help your business grow. You'll hear from
          me soon.
        </p>
        <button
          onClick={onBack}
          className="mt-8 border border-zeya-taupe/30 text-zeya-taupe hover:text-zeya-champagne hover:border-zeya-champagne px-6 py-3 text-sm font-light transition-colors rounded"
          style={{ letterSpacing: "0.08em" }}
        >
          Back to Demo
        </button>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="space-y-8 max-w-md mx-auto px-4 sm:px-0"
    >
      <div className="text-center space-y-4">
        <p
          className="font-serif text-2xl sm:text-3xl text-zeya-ivory font-light"
          style={{ letterSpacing: "0.06em" }}
        >
          Stay in Touch
        </p>
        <p className="text-sm text-zeya-taupe font-light">
          Most founders aren't ready to commit after a single conversation. That's completely fair.
          But I'd like to stay connected. I'll share ideas specific to your business when something
          relevant comes up.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label className="text-xs text-zeya-taupe font-light uppercase" style={{ letterSpacing: "0.1em" }}>
            Name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            disabled={isSubmitting}
            className="w-full bg-transparent border-b border-zeya-hush/30 text-zeya-ivory placeholder-zeya-hush/40 focus:outline-none focus:border-zeya-champagne transition-colors py-2 text-sm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs text-zeya-taupe font-light uppercase" style={{ letterSpacing: "0.1em" }}>
            Email
          </label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            disabled={isSubmitting}
            className="w-full bg-transparent border-b border-zeya-hush/30 text-zeya-ivory placeholder-zeya-hush/40 focus:outline-none focus:border-zeya-champagne transition-colors py-2 text-sm"
          />
        </div>

        <div className="flex gap-3 pt-4">
          <button
            type="submit"
            disabled={isSubmitting || !name.trim() || !email.trim()}
            className="flex-1 border border-zeya-champagne/60 text-zeya-champagne hover:bg-zeya-champagne/5 py-3 text-sm font-light transition-colors disabled:opacity-50 rounded"
            style={{ letterSpacing: "0.08em" }}
          >
            {isSubmitting ? "Saving…" : "Keep in Touch"}
          </button>
          <button
            type="button"
            onClick={onBack}
            disabled={isSubmitting}
            className="flex-1 border border-zeya-taupe/30 text-zeya-taupe hover:text-zeya-champagne hover:border-zeya-champagne py-3 text-sm font-light transition-colors disabled:opacity-50 rounded"
            style={{ letterSpacing: "0.08em" }}
          >
            Back
          </button>
        </div>
      </form>
    </motion.div>
  );
}
