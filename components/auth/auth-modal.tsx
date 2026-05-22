"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Eye, EyeOff, Loader2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type AuthMode = "sign-in" | "create-account" | "forgot-password";

type AuthModalProps = {
  open: boolean;
  initialMode?: AuthMode;
  onClose: () => void;
};

const copyByMode: Record<AuthMode, { title: string; line: string; submit: string }> = {
  "sign-in": {
    title: "Welcome back.",
    line: "Return to the memory you are building.",
    submit: "Continue with Zeya",
  },
  "create-account": {
    title: "Begin quietly.",
    line: "Let’s build your business memory together.",
    submit: "Create your space",
  },
  "forgot-password": {
    title: "Find your way back.",
    line: "A quiet reset link will meet you in your inbox.",
    submit: "Send reset link",
  },
};

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "That email and password did not open the door.";
  }

  if (normalized.includes("already registered") || normalized.includes("already exists")) {
    return "That email already belongs to a Zeya space.";
  }

  if (normalized.includes("password")) {
    return "The password needs a little more strength.";
  }

  if (normalized.includes("rate limit")) {
    return "A few too many attempts. Give it a quiet moment.";
  }

  return "Something did not settle correctly. Try once more.";
}

function passwordHint(password: string) {
  if (!password) return "Use at least 8 characters.";
  if (password.length < 8) return "A little longer will feel safer.";
  if (!/[0-9]/.test(password) || !/[a-z]/i.test(password)) {
    return "Add a number or letter mix for more strength.";
  }
  return "This feels strong enough.";
}

export function AuthModal({ open, initialMode = "sign-in", onClose }: AuthModalProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const activeCopy = copyByMode[mode];
  const showPasswordFields = mode !== "forgot-password";
  const showConfirmField = mode === "create-account";
  const hint = useMemo(() => passwordHint(password), [password]);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError("");
    setSuccess("");
    setPassword("");
    setConfirmPassword("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");

    if (!isSupabaseConfigured) {
      setError("Zeya auth is not connected yet.");
      return;
    }

    if (!email.trim()) {
      setError("Tell Zeya where to find you.");
      return;
    }

    if (showPasswordFields && password.length < 8) {
      setError("Choose a password with at least 8 characters.");
      return;
    }

    if (mode === "create-account" && password !== confirmPassword) {
      setError("The two passwords are not matching yet.");
      return;
    }

    setProcessing(true);

    try {
      if (mode === "sign-in") {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        setSuccess("You’re in.");
      }

      if (mode === "create-account") {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
        });
        if (signUpError) throw signUpError;
        setSuccess("Your Zeya space is ready. Check your inbox if confirmation is needed.");
      }

      if (mode === "forgot-password") {
        const redirectTo =
          typeof window !== "undefined"
            ? `${window.location.origin}/auth/reset-password`
            : undefined;
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo,
        });
        if (resetError) throw resetError;
        setSuccess("A reset link is on its way.");
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(friendlyAuthError(message));
    } finally {
      setProcessing(false);
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] grid place-items-center px-4 py-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.35 }}
          role="dialog"
          aria-modal="true"
          aria-label={activeCopy.title}
        >
          <motion.button
            type="button"
            aria-label="Close authentication"
            className="absolute inset-0 cursor-default bg-zeya-void/68 backdrop-blur-xl"
            onClick={onClose}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 18, filter: "blur(18px)" }}
            animate={{ opacity: 1, scale: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.97, y: 12, filter: "blur(14px)" }}
            transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-[27rem] overflow-hidden rounded-[1.35rem] border border-zeya-ivory/10 bg-zeya-aubergine/54 p-5 text-zeya-ivory shadow-[0_32px_140px_rgb(10_7_9/0.72)] backdrop-blur-2xl sm:p-7"
          >
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-zeya-champagne/42 to-transparent"
            />
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -top-24 left-1/2 h-52 w-52 -translate-x-1/2 rounded-full bg-zeya-champagne/10 blur-[70px]"
            />

            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="zeya-transition absolute right-4 top-4 grid size-9 place-items-center rounded-full border border-zeya-ivory/8 text-zeya-hush/56 hover:border-zeya-champagne/20 hover:text-zeya-ivory/80"
            >
              <X className="size-4" strokeWidth={1.5} />
            </button>

            <div className="relative space-y-7">
              <div className="space-y-4 pr-9">
                <div className="flex items-center gap-3">
                  <div className="grid size-9 place-items-center rounded-full border border-zeya-champagne/18 bg-zeya-void/34 shadow-[0_0_36px_rgb(215_193_155/0.08)]">
                    <span className="font-serif text-lg text-zeya-champagne/78">Z</span>
                  </div>
                  <span className="text-[10px] font-light uppercase tracking-[0.22em] text-zeya-hush/45">
                    Zeya
                  </span>
                </div>

                <div className="space-y-2">
                  <motion.h2
                    key={mode}
                    initial={{ opacity: 0, y: 8, filter: "blur(8px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                    className="font-serif text-[2rem] leading-none tracking-tight text-zeya-ivory"
                  >
                    {activeCopy.title}
                  </motion.h2>
                  <p className="max-w-[20rem] text-sm font-light leading-relaxed tracking-wide text-zeya-hush/58">
                    {activeCopy.line}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 rounded-full border border-zeya-ivory/8 bg-zeya-void/28 p-1">
                {(["sign-in", "create-account"] as const).map((nextMode) => (
                  <button
                    key={nextMode}
                    type="button"
                    onClick={() => switchMode(nextMode)}
                    className={cn(
                      "zeya-transition rounded-full px-4 py-2 text-xs font-light tracking-wide",
                      mode === nextMode
                        ? "bg-zeya-champagne/12 text-zeya-ivory"
                        : "text-zeya-hush/44 hover:text-zeya-hush/72",
                    )}
                  >
                    {nextMode === "sign-in" ? "Sign in" : "New space"}
                  </button>
                ))}
              </div>

              <form onSubmit={submit} className="space-y-4">
                <AuthInput
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="you@company.com"
                />

                {showPasswordFields ? (
                  <div className="space-y-2">
                    <AuthInput
                      label="Password"
                      type={showPassword ? "text" : "password"}
                      autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                      value={password}
                      onChange={setPassword}
                      placeholder="Your private key"
                      rightSlot={
                        <PasswordToggle
                          visible={showPassword}
                          onClick={() => setShowPassword((visible) => !visible)}
                        />
                      }
                    />
                    {mode === "create-account" ? (
                      <p className="px-1 text-[11px] font-light text-zeya-hush/40">{hint}</p>
                    ) : null}
                  </div>
                ) : null}

                {showConfirmField ? (
                  <AuthInput
                    label="Confirm password"
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    placeholder="Once more"
                    rightSlot={
                      <PasswordToggle
                        visible={showConfirmPassword}
                        onClick={() => setShowConfirmPassword((visible) => !visible)}
                      />
                    }
                  />
                ) : null}

                {mode === "sign-in" ? (
                  <button
                    type="button"
                    onClick={() => switchMode("forgot-password")}
                    className="zeya-transition text-xs font-light tracking-wide text-zeya-hush/42 hover:text-zeya-champagne/72"
                  >
                    Forgot password?
                  </button>
                ) : null}

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
                  {activeCopy.submit}
                </button>

                {mode === "forgot-password" ? (
                  <button
                    type="button"
                    onClick={() => switchMode("sign-in")}
                    className="zeya-transition w-full text-center text-xs font-light tracking-wide text-zeya-hush/42 hover:text-zeya-hush/72"
                  >
                    Return to sign in
                  </button>
                ) : null}
              </form>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

type AuthInputProps = {
  label: string;
  type: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  rightSlot?: ReactNode;
};

function AuthInput({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  rightSlot,
}: AuthInputProps) {
  return (
    <label className="block space-y-2">
      <span className="px-1 text-[11px] font-light uppercase tracking-[0.18em] text-zeya-hush/40">
        {label}
      </span>
      <span className="flex min-h-12 items-center rounded-full border border-zeya-ivory/10 bg-zeya-void/32 px-4 backdrop-blur-xl focus-within:border-zeya-champagne/26">
        <input
          type={type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="min-w-0 flex-1 bg-transparent text-sm font-light tracking-wide text-zeya-ivory outline-none placeholder:text-zeya-hush/28"
        />
        {rightSlot}
      </span>
    </label>
  );
}

function PasswordToggle({ visible, onClick }: { visible: boolean; onClick: () => void }) {
  const Icon = visible ? EyeOff : Eye;

  return (
    <button
      type="button"
      aria-label={visible ? "Hide password" : "Show password"}
      onClick={onClick}
      className="zeya-transition ml-3 text-zeya-hush/42 hover:text-zeya-ivory/70"
    >
      <Icon className="size-4" strokeWidth={1.5} />
    </button>
  );
}
