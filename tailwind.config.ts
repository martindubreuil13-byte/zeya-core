import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        zeya: {
          void: "#0a0709",
          aubergine: "#21141d",
          plum: "#2d232b",
          graphite: "#3a3437",
          taupe: "#4c4542",
          mineral: "#8e8980",
          champagne: "#d7c19b",
          ivory: "#f4eee2",
          hush: "#b8ada0",
        },
      },
      borderRadius: {
        calm: "0.75rem",
        presence: "1.5rem",
        vessel: "2rem",
      },
      boxShadow: {
        hush: "0 20px 80px rgb(10 7 9 / 0.42)",
        presence: "0 0 80px rgb(215 193 155 / 0.12), 0 36px 120px rgb(10 7 9 / 0.62)",
        insetGlow: "inset 0 1px 0 rgb(244 238 226 / 0.08), inset 0 -24px 80px rgb(10 7 9 / 0.25)",
      },
      backgroundImage: {
        "atmosphere-radial":
          "radial-gradient(circle at 50% 42%, rgb(215 193 155 / 0.13), transparent 28%), radial-gradient(circle at 20% 18%, rgb(78 55 70 / 0.58), transparent 34%), radial-gradient(circle at 78% 72%, rgb(76 69 66 / 0.42), transparent 38%)",
        "midnight-vellum":
          "linear-gradient(145deg, #0a0709 0%, #21141d 44%, #3a3437 100%)",
        "champagne-line":
          "linear-gradient(90deg, transparent, rgb(215 193 155 / 0.38), transparent)",
      },
      blur: {
        atmosphere: "72px",
      },
      spacing: {
        cinematic: "clamp(4rem, 12vw, 10rem)",
        breath: "clamp(1.5rem, 4vw, 3.5rem)",
      },
      transitionTimingFunction: {
        presence: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    },
  },
  plugins: [],
};

export default config;
