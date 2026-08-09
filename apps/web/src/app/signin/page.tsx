"use client";

import { useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Repeat, ArrowRight, ShieldCheck, Lock, KeyRound } from "lucide-react";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const error = searchParams.get("error");

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) {
      setValidationError("Enter your email address.");
      return;
    }
    if (!EMAIL_RE.test(trimmed)) {
      setValidationError("That doesn't look like a valid email address.");
      return;
    }
    setValidationError("");
    setSubmitting(true);
    // The actual sign-in/sign-up happens in Cognito's hosted UI. We pre-fill the
    // email with login_hint so the user doesn't type it twice. Callback keeps
    // the user on the page they were trying to reach.
    await signIn("cognito", { callbackUrl }, { login_hint: trimmed });
  };

  return (
    <main className="flex min-h-[calc(100vh-4rem)] w-full items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
          <div className="flex flex-col items-center text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-btn bg-brand text-white shadow-glow">
              <Repeat className="h-6 w-6" aria-hidden />
            </span>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-foreground">
              {mode === "signin" ? "Welcome back to Swapify" : "Join Swapify"}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {mode === "signin"
                ? "Sign in to offer swaps, chat, and balance gaps with tokens."
                : "Create an account to list items and start swapping."}
            </p>
          </div>

          <div className="mt-6 grid grid-cols-2 rounded-btn border border-line bg-surface-2 p-1 text-sm font-medium" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signin"}
              onClick={() => setMode("signin")}
              className={`rounded-md px-3 py-1.5 transition-colors ${mode === "signin" ? "bg-surface-3 text-foreground shadow-card" : "text-muted hover:text-foreground"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "signup"}
              onClick={() => setMode("signup")}
              className={`rounded-md px-3 py-1.5 transition-colors ${mode === "signup" ? "bg-surface-3 text-foreground shadow-card" : "text-muted hover:text-foreground"}`}
            >
              Create account
            </button>
          </div>

          {error && (
            <p className="mt-4 rounded-btn border border-rose-500/40 bg-rose-950 p-3 text-sm text-rose-200">
              Sign-in didn&apos;t complete. Please try again.
            </p>
          )}

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3" noValidate>
            <div>
              <label htmlFor="email" className="text-xs font-semibold text-muted">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setValidationError("");
                }}
                placeholder="you@example.com"
                className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-sm text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
              />
            </div>

            {validationError && <p className="text-xs text-rose-400">{validationError}</p>}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-brand px-4 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? (
                "Redirecting..."
              ) : (
                <>
                  {mode === "signin" ? "Continue" : "Create account"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted">
            {mode === "signin" ? (
              <>
                New to Swapify?{" "}
                <button type="button" onClick={() => setMode("signup")} className="font-semibold text-primary-soft underline">
                  Create an account
                </button>
              </>
            ) : (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => setMode("signin")} className="font-semibold text-primary-soft underline">
                  Sign in
                </button>
              </>
            )}
          </p>
          <p className="mt-1 text-center text-xs text-muted">
            Forgot your password?{" "}
            <button type="button" onClick={() => setMode("signin")} className="font-semibold text-primary-soft underline">
              It&apos;s handled on the next screen
            </button>
          </p>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
          <ShieldCheck className="h-4 w-4 text-primary-soft" aria-hidden />
          Sign-in secured by AWS Cognito
        </div>
        <div className="mt-6 flex justify-center gap-5 text-xs text-muted">
          <Link href="/browse" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <KeyRound className="h-3.5 w-3.5" aria-hidden />
            Browse listings
          </Link>
          <Link href="/" className="inline-flex items-center gap-1.5 hover:text-foreground">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Back to home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
