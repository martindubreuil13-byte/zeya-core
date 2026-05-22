"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, LogOut, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";

type AuthTriggerProps = {
  className?: string;
  compact?: boolean;
};

export function AuthTrigger({ className, compact = false }: AuthTriggerProps) {
  const { user, loading, openAuth, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!wrapperRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  if (user) {
    const email = user.email ?? "Signed in";
    const initial = email.slice(0, 1).toUpperCase();

    return (
      <div ref={wrapperRef} className={cn("relative", className)}>
        <button
          type="button"
          onClick={() => setMenuOpen((open) => !open)}
          className="zeya-transition flex items-center gap-2 rounded-full border border-zeya-ivory/10 bg-zeya-void/32 px-2.5 py-2 text-zeya-hush/62 backdrop-blur-2xl hover:border-zeya-champagne/20 hover:text-zeya-ivory/78"
          aria-label="Open account menu"
        >
          <span className="grid size-7 place-items-center rounded-full border border-zeya-champagne/18 bg-zeya-champagne/8 font-serif text-sm text-zeya-ivory/78">
            {initial}
          </span>
          {!compact ? (
            <ChevronDown className="size-3.5" strokeWidth={1.5} aria-hidden="true" />
          ) : null}
        </button>

        <AnimatePresence>
          {menuOpen ? (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.98, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: 6, scale: 0.98, filter: "blur(8px)" }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="absolute right-0 top-[calc(100%+0.6rem)] w-64 overflow-hidden rounded-xl border border-zeya-ivory/10 bg-zeya-void/78 p-2 text-left shadow-[0_24px_90px_rgb(10_7_9/0.7)] backdrop-blur-2xl"
            >
              <div className="flex items-center gap-3 border-b border-zeya-ivory/8 px-3 py-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-zeya-champagne/16 bg-zeya-champagne/8 text-zeya-ivory/78">
                  <UserRound className="size-4" strokeWidth={1.5} />
                </span>
                <p className="min-w-0 truncate text-xs font-light tracking-wide text-zeya-hush/70">
                  {email}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  void signOut();
                }}
                className="zeya-transition mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-xs font-light tracking-wide text-zeya-hush/54 hover:bg-zeya-champagne/8 hover:text-zeya-ivory/76"
              >
                <LogOut className="size-3.5" strokeWidth={1.5} />
                Sign out
              </button>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    );
  }

  return (
    <motion.button
      type="button"
      disabled={loading}
      onClick={() => openAuth("sign-in")}
      whileHover={{ scale: loading ? 1 : 1.015 }}
      whileTap={{ scale: loading ? 1 : 0.985 }}
      className={cn(
        "zeya-transition rounded-full border border-zeya-champagne/22 bg-zeya-aubergine/34 px-5 py-2.5 text-[11px] font-light uppercase tracking-[0.18em] text-zeya-ivory/74 shadow-[0_0_58px_rgb(215_193_155/0.07)] backdrop-blur-2xl hover:border-zeya-champagne/38 hover:bg-zeya-champagne/10 hover:text-zeya-ivory disabled:cursor-wait disabled:opacity-50",
        className,
      )}
    >
      Continue with Zeya
    </motion.button>
  );
}
