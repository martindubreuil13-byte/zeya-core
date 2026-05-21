"use client";

import { motion } from "framer-motion";
import Link from "next/link";

export function LandingNav() {
  return (
    <motion.nav
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
      className="fixed left-0 right-0 top-0 z-50 flex items-center justify-between px-7 py-6 sm:px-10"
    >
      {/* Wordmark */}
      <span className="font-serif text-lg tracking-wide text-zeya-ivory/72">
        Zeya
      </span>

      {/* Workspace link */}
      <Link
        href="/app"
        className="zeya-transition text-[11px] font-light uppercase tracking-[0.2em] text-zeya-hush/45 hover:text-zeya-hush/75"
      >
        Enter Workspace
      </Link>
    </motion.nav>
  );
}
