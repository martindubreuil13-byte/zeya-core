"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function IntroducePage() {
  const router = useRouter();
  const [step, setStep] = useState<"form">("form");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    firstName: "",
    email: "",
    password: "",
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      // Sign up the user
      const { data, error: signupError } = await supabase.auth.signUp({
        email: formData.email,
        password: formData.password,
        options: {
          data: {
            first_name: formData.firstName,
          },
        },
      });

      if (signupError) throw signupError;

      if (data.user) {
        // Create user profile in public.users table
        const { error: profileError } = await supabase.from("users").insert({
          id: data.user.id,
          email: formData.email,
          first_name: formData.firstName,
          created_at: new Date().toISOString(),
        });

        if (profileError) throw profileError;

        // Redirect to onboarding
        router.push("/app");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-zeya-void">
      {/* Subtle background gradient */}
      <div
        className="fixed inset-0"
        style={{
          background: "radial-gradient(circle at 50% 50%, rgba(204, 182, 142, 0.05) 0%, rgba(0, 0, 0, 0) 70%)",
          pointerEvents: "none",
        }}
      />

      <div className="relative z-10 w-full h-full flex items-center justify-center p-4 sm:p-8">
        {(
          <div
            className="max-w-md w-full space-y-8 animate-fadeIn"
            style={{
              animation: "fadeIn 0.6s ease-out",
            }}
          >
            <div className="space-y-1 text-center">
              <h2
                className="font-serif text-xl sm:text-2xl text-zeya-ivory font-light"
                style={{
                  letterSpacing: "0.05em",
                }}
              >
                Tell her who you are
              </h2>
              <p
                className="text-zeya-hush text-xs opacity-50 tracking-widest uppercase"
                style={{
                  letterSpacing: "0.12em",
                  fontSize: "0.65rem",
                }}
              >
                Three things
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* First name */}
              <div>
                <input
                  type="text"
                  name="firstName"
                  placeholder="First name"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  required
                  className="w-full bg-transparent border-b border-zeya-hush/30 px-0 py-3 text-zeya-ivory placeholder-zeya-hush/40 text-sm focus:outline-none focus:border-zeya-champagne transition-colors duration-300"
                  style={{
                    letterSpacing: "0.02em",
                  }}
                  disabled={isLoading}
                />
              </div>

              {/* Email */}
              <div>
                <input
                  type="email"
                  name="email"
                  placeholder="Email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="w-full bg-transparent border-b border-zeya-hush/30 px-0 py-3 text-zeya-ivory placeholder-zeya-hush/40 text-sm focus:outline-none focus:border-zeya-champagne transition-colors duration-300"
                  style={{
                    letterSpacing: "0.02em",
                  }}
                  disabled={isLoading}
                />
              </div>

              {/* Password */}
              <div>
                <input
                  type="password"
                  name="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  className="w-full bg-transparent border-b border-zeya-hush/30 px-0 py-3 text-zeya-ivory placeholder-zeya-hush/40 text-sm focus:outline-none focus:border-zeya-champagne transition-colors duration-300"
                  style={{
                    letterSpacing: "0.02em",
                  }}
                  disabled={isLoading}
                />
              </div>

              {/* Error message */}
              {error && (
                <div
                  className="text-xs sm:text-sm text-red-400/80 px-0 py-2 text-center"
                  style={{
                    lineHeight: "1.5",
                  }}
                >
                  {error}
                </div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="w-full mt-6 px-6 py-3 text-xs sm:text-sm tracking-widest text-zeya-ivory border border-zeya-champagne/40 rounded-full transition-all duration-300 hover:border-zeya-champagne hover:text-zeya-champagne hover:bg-zeya-champagne hover:bg-opacity-5 uppercase disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  letterSpacing: "0.12em",
                  fontWeight: "300",
                }}
              >
                {isLoading ? "Introducing..." : "Begin"}
              </button>
            </form>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(12px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </main>
  );
}
