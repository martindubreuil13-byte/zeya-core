import type { NextConfig } from "next";
import { isExperienceDebugEnabled } from "./lib/experience/experience-debug-guard";

const experienceDebugActive = isExperienceDebugEnabled({
  publicFlag: process.env.NEXT_PUBLIC_EXPERIENCE_DEBUG,
  vercelEnv: process.env.VERCEL_ENV,
  nodeEnv: process.env.NODE_ENV,
});

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_EXPERIENCE_DEBUG_ACTIVE: experienceDebugActive ? "true" : "false",
  },
};

export default nextConfig;
