// Global motion philosophy: slow, intentional, emotionally resonant.
// All timings derived from a resting breath (~4.2s), scaled outward.

export const ease = {
  presence: [0.22, 1, 0.36, 1] as const,
  exhale: [0.4, 0, 0.6, 1] as const,
  settle: [0.16, 1, 0.3, 1] as const,
} as const;

export const duration = {
  instant: 0.18,
  quick: 0.38,
  calm: 0.7,
  slow: 1.2,
  cinematic: 2.0,
  breath: 4.4,
} as const;

// Reusable entrance variants
export const fadeUp = {
  hidden: { opacity: 0, y: 14, filter: "blur(10px)" },
  visible: (delay = 0) => ({
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transition: { duration: duration.slow, delay, ease: ease.presence },
  }),
};

export const fadeIn = {
  hidden: { opacity: 0, filter: "blur(8px)" },
  visible: (delay = 0) => ({
    opacity: 1,
    filter: "blur(0px)",
    transition: { duration: duration.slow, delay, ease: ease.presence },
  }),
};

export const slideFromRight = {
  hidden: { opacity: 0, x: 18, filter: "blur(8px)" },
  visible: (delay = 0) => ({
    opacity: 1,
    x: 0,
    filter: "blur(0px)",
    transition: { duration: duration.slow, delay, ease: ease.presence },
  }),
};

// Breathing loop — used for organic pulse animations
export const breathe = (delay = 0) => ({
  animate: {
    scale: [1, 1.08, 1],
    opacity: [0.5, 0.8, 0.5],
  },
  transition: {
    duration: duration.breath,
    repeat: Infinity,
    ease: "easeInOut" as const,
    delay,
  },
});
