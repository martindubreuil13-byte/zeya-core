"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";
import { AmbientBackground } from "@/components/layout";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

function friendlyResetError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("session")) {
    return "This reset link has gone quiet. Ask for a fresh one.";
  }

  if (normalized.includes("password")) {
    return "Choose a password with a little more strength.";
  }

  return "The reset did not settle. Try once more.";
}

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!isSupabaseConfigured) {
      setError("Zeya auth is not connected yet.");
      return;
    }

    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    if (password !== confirmPassword) {
      setError("The two passwords are not matching yet.");
      return;
    }

    setProcessing(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess("Your password has been renewed.");
      setPassword("");
      setConfirmPassword("");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(friendlyResetError(message));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <main className="relative isolate grid min-h-dvh place-items-center overflow-hidden px-5 py-12">
      <AmbientBackground fixed />

      <motion.section
        initial={{ opacity: 0, y: 18, filter: "blur(16px)" }}
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        transition={{ duration: 1.0, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 w-full max-w-[27rem] overflow-hidden rounded-[1.35rem] border border-zeya-ivory/10 bg-zeya-aubergine/52 p-6 text-zeya-ivory shadow-[0_32px_140px_rgb(10_7_9/0.72)] backdrop-blur-2xl sm:p-8"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-zeya-champagne/42 to-transparent"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full bg-zeya-champagne/10 blur-[70px]"
        />

        <div className="relative space-y-7">
          <div className="space-y-3">
            <p className="text-[10px] font-light uppercase tracking-[0.22em] text-zeya-hush/45">
              Zeya
            </p>
            <h1 className="font-serif text-[2.2rem] leading-none tracking-tight">
              Renew your key.
            </h1>
            <p className="max-w-[20rem] text-sm font-light leading-relaxed tracking-wide text-zeya-hush/58">
              Set a new password and return quietly.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <PasswordField
              label="New password"
              value={password}
              visible={showPassword}
              onChange={setPassword}
              onToggle={() => setShowPassword((visible) => !visible)}
            />
            <PasswordField
              label="Confirm password"
              value={confirmPassword}
              visible={showConfirmPassword}
              onChange={setConfirmPassword}
              onToggle={() => setShowConfirmPassword((visible) => !visible)}
            />

            <AnimatePresence mode="wait">
              {error ? (
                <motion.p
                  key="error"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-full border border-zeya-champagne/12 bg-zeya-void/28 px-4 py-2 text-center text-xs font-light text-zeya-hush/68"
                >
                  {error}
                </motion.p>
              ) : success ? (
                <motion.p
                  key="success"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-full border border-zeya-champagne/18 bg-zeya-champagne/8 px-4 py-2 text-center text-xs font-light text-zeya-ivory/76"
                >
                  {success}
                </motion.p>
              ) : null}
            </AnimatePresence>

            <button
              type="submit"
              disabled={processing}
              className="zeya-transition flex min-h-12 w-full items-center justify-center gap-2 rounded-full border border-zeya-champagne/24 bg-zeya-champagne/12 px-5 text-sm font-light tracking-wide text-zeya-ivory/86 shadow-[0_0_70px_rgb(215_193_155/0.08)] hover:border-zeya-champagne/42 hover:bg-zeya-champagne/16 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {processing ? <Loader2 className="size-4 animate-spin" strokeWidth={1.5} /> : null}
              Save new password
            </button>

            <Link
              href="/"
              className="zeya-transition block text-center text-xs font-light tracking-wide text-zeya-hush/42 hover:text-zeya-hush/72"
            >
              Return to Zeya
            </Link>
          </form>
        </div>
      </motion.section>
    </main>
  );
}

function PasswordField({
  label,
  value,
  visible,
  onChange,
  onToggle,
}: {
  label: string;
  value: string;
  visible: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  const Icon = visible ? EyeOff : Eye;

  return (
    <label className="block space-y-2">
      <span className="px-1 text-[11px] font-light uppercase tracking-[0.18em] text-zeya-hush/40">
        {label}
      </span>
      <span className="flex min-h-12 items-center rounded-full border border-zeya-ivory/10 bg-zeya-void/32 px-4 backdrop-blur-xl focus-within:border-zeya-champagne/26">
        <input
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete="new-password"
          className="min-w-0 flex-1 bg-transparent text-sm font-light tracking-wide text-zeya-ivory outline-none placeholder:text-zeya-hush/28"
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          onClick={onToggle}
          className="zeya-transition ml-3 text-zeya-hush/42 hover:text-zeya-ivory/70"
        >
          <Icon className="size-4" strokeWidth={1.5} />
        </button>
      </span>
    </label>
  );
}
