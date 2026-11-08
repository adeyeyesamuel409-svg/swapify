"use client";

import { useEffect, useState, Suspense } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Lock, KeyRound } from "lucide-react";
import SwapIcon from "@/components/SwapIcon";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;
const RESEND_COOLDOWN_SECONDS = 60;

// The API base for the browser (signup/verification). Server-side sign-in goes
// through NextAuth's authorize() which uses API_URL at runtime.
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Mode = "signin" | "signup" | "verify" | "forgot" | "reset";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState("");
  const [info, setInfo] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [resendIn]);

  const startCooldown = () => setResendIn(RESEND_COOLDOWN_SECONDS);

  const doSignIn = async () => {
    const result = await signIn("credentials", {
      email: email.trim(),
      password,
      callbackUrl,
      redirect: false,
    });
    if (result?.error) {
      setValidationError("We couldn't sign you in. Please try again.");
      setSubmitting(false);
      return;
    }
    window.location.assign(result?.url ?? callbackUrl);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    const trimmedName = name.trim();

    setValidationError("");
    setInfo("");

    if (!EMAIL_RE.test(trimmedEmail)) {
      setValidationError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        if (password.length < MIN_PASSWORD_LENGTH) {
          setValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
          setSubmitting(false);
          return;
        }
        if (!trimmedName) {
          setValidationError("Enter your name.");
          setSubmitting(false);
          return;
        }
        const res = await fetch(`${API_BASE}/auth/signup`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, password, name: trimmedName }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setValidationError(data?.error ?? "We couldn't create your account. Please try again.");
          setSubmitting(false);
          return;
        }
        setCode("");
        setMode("verify");
        setInfo(`We sent a 6-digit code to ${trimmedEmail}.`);
        startCooldown();
        setSubmitting(false);
        return;
      }

      if (mode === "verify") {
        if (code.trim().length !== 6) {
          setValidationError("Enter the 6-digit code from your email.");
          setSubmitting(false);
          return;
        }
        const res = await fetch(`${API_BASE}/auth/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, code: code.trim() }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setValidationError(data?.error ?? "Verification failed. Please try again.");
          setSubmitting(false);
          return;
        }
        await doSignIn();
        return;
      }

      if (mode === "forgot") {
        await fetch(`${API_BASE}/auth/forgot-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail }),
        });
        setCode("");
        setMode("reset");
        setInfo(`If an account exists for ${trimmedEmail}, a reset code is on its way.`);
        startCooldown();
        setSubmitting(false);
        return;
      }

      if (mode === "reset") {
        if (code.trim().length !== 6) {
          setValidationError("Enter the 6-digit code from your email.");
          setSubmitting(false);
          return;
        }
        if (newPassword.length < MIN_PASSWORD_LENGTH) {
          setValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
          setSubmitting(false);
          return;
        }
        const res = await fetch(`${API_BASE}/auth/reset-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmedEmail, code: code.trim(), newPassword }),
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          setValidationError(data?.error ?? "Reset failed. Please try again.");
          setSubmitting(false);
          return;
        }
        setPassword("");
        setNewPassword("");
        setCode("");
        setMode("signin");
        setInfo("Password updated — sign in with your new password.");
        setSubmitting(false);
        return;
      }

      // signin: probe the API first so unverified accounts get the code screen.
      const probe = await fetch(`${API_BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      if (!probe.ok) {
        const data = (await probe.json().catch(() => null)) as { error?: string } | null;
        if (data?.error === "EMAIL_NOT_VERIFIED") {
          setMode("verify");
          setInfo(`Verify your email to continue — we sent a code to ${trimmedEmail}.`);
          startCooldown();
          setSubmitting(false);
          return;
        }
        setValidationError("Incorrect email or password.");
        setSubmitting(false);
        return;
      }
      await doSignIn();
    } catch {
      setValidationError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setValidationError("");
    try {
      await fetch(`${API_BASE}/auth/resend-verification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      setInfo(`A new code is on its way to ${email.trim()}.`);
      startCooldown();
    } catch {
      setValidationError("Couldn't resend the code. Please try again.");
    }
  };

  const titles: Record<Mode, string> = {
    signin: "Welcome back to Swapify",
    signup: "Join Swapify",
    verify: "Verify your email",
    forgot: "Reset your password",
    reset: "Choose a new password",
  };
  const subtitles: Record<Mode, string> = {
    signin: "Sign in to swap, chat, and settle value gaps.",
    signup: "Join the neighbourhood. List something, start swapping.",
    verify: "Enter the 6-digit code we emailed you to activate your account.",
    forgot: "We'll email you a 6-digit code to reset your password.",
    reset: "Enter the code and choose a new password.",
  };

  return (
    <main className="flex min-h-[calc(100dvh-4rem)] w-full items-center justify-center px-4 py-12 sm:px-6">
      <div className="w-full max-w-md">
        <div className="rounded-card border border-line bg-surface p-6 shadow-card sm:p-8">
          <div className="flex flex-col items-center text-center">
            <Link href="/" aria-label="Swapify home" className="inline-flex">
              <SwapIcon className="h-12 w-12" />
            </Link>
            <h1 className="mt-4 text-2xl font-bold tracking-tight text-navy">{titles[mode]}</h1>
            <p className="mt-1 text-sm text-muted">{subtitles[mode]}</p>
          </div>

          {(mode === "signin" || mode === "signup") && (
            <div className="mt-6 grid grid-cols-2 rounded-btn border border-line bg-surface-2 p-1 text-sm font-medium" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signin"}
                onClick={() => { setMode("signin"); setValidationError(""); setInfo(""); }}
                className={`flex min-h-[44px] items-center justify-center rounded-md px-3 py-1.5 transition-colors ${mode === "signin" ? "bg-surface text-navy shadow-card" : "text-muted hover:text-foreground"}`}
              >
                Sign in
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === "signup"}
                onClick={() => { setMode("signup"); setValidationError(""); setInfo(""); }}
                className={`flex min-h-[44px] items-center justify-center rounded-md px-3 py-1.5 transition-colors ${mode === "signup" ? "bg-surface text-navy shadow-card" : "text-muted hover:text-foreground"}`}
              >
                Create account
              </button>
            </div>
          )}

          {validationError && (
            <p className="mt-4 rounded-btn border border-rose-500/40 bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950 dark:text-rose-200">
              {validationError}
            </p>
          )}
          {info && (
            <p className="mt-4 rounded-btn border border-emerald-500/40 bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-200">
              {info}
            </p>
          )}

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3" noValidate>
            {(mode === "verify" || mode === "forgot" || mode === "reset") && (
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
                  onChange={(e) => { setEmail(e.target.value); setValidationError(""); }}
                  placeholder="you@example.com"
                  className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                />
              </div>
            )}

            {(mode === "verify" || mode === "reset") && (
              <div>
                <label htmlFor="code" className="text-xs font-semibold text-muted">
                  6-digit code
                </label>
                <input
                  id="code"
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setValidationError(""); }}
                  placeholder="123456"
                  className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-center text-lg font-semibold tracking-[0.4em] text-foreground placeholder:tracking-normal placeholder:font-normal placeholder:text-muted focus:border-primary/60 focus:outline-none"
                />
                {mode === "verify" && (
                  <button
                    type="button"
                    onClick={resend}
                    disabled={resendIn > 0}
                    className="mt-2 text-xs font-semibold text-primary-soft underline disabled:text-muted disabled:no-underline"
                  >
                    {resendIn > 0 ? `Resend code in ${resendIn}s` : "Resend code"}
                  </button>
                )}
              </div>
            )}

            {(mode === "signin" || mode === "signup") && (
              <>
                {mode === "signup" && (
                  <div>
                    <label htmlFor="name" className="text-xs font-semibold text-muted">
                      Your name
                    </label>
                    <input
                      id="name"
                      name="name"
                      type="text"
                      autoComplete="name"
                      required
                      value={name}
                      onChange={(e) => { setName(e.target.value); setValidationError(""); }}
                      placeholder="Alex Smith"
                      className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                    />
                  </div>
                )}
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
                    onChange={(e) => { setEmail(e.target.value); setValidationError(""); }}
                    placeholder="you@example.com"
                    className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                  />
                </div>
                <div>
                  <label htmlFor="password" className="text-xs font-semibold text-muted">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={mode === "signin" ? "current-password" : "new-password"}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setValidationError(""); }}
                    placeholder={mode === "signin" ? "Your password" : "At least 8 characters"}
                    className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                  />
                </div>
                {mode === "signin" && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => { setMode("forgot"); setValidationError(""); setInfo(""); }}
                      className="text-xs font-semibold text-primary-soft underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}
              </>
            )}

            {mode === "reset" && (
              <div>
                <label htmlFor="new-password" className="text-xs font-semibold text-muted">
                  New password
                </label>
                <input
                  id="new-password"
                  name="new-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  value={newPassword}
                  onChange={(e) => { setNewPassword(e.target.value); setValidationError(""); }}
                  placeholder="At least 8 characters"
                  className="mt-1.5 h-11 w-full rounded-btn border border-line bg-surface-2 px-3 text-base text-foreground placeholder:text-muted focus:border-primary/60 focus:outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-btn bg-brand px-4 font-semibold text-white shadow-glow transition-all hover:brightness-110 disabled:opacity-50"
            >
              {submitting ? (
                "Please wait…"
              ) : (
                <>
                  {mode === "signin" && "Sign in"}
                  {mode === "signup" && "Create account"}
                  {mode === "verify" && "Verify email"}
                  {mode === "forgot" && "Send reset code"}
                  {mode === "reset" && "Update password"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </>
              )}
            </button>
          </form>

          <p className="mt-4 text-center text-xs text-muted">
            {mode === "signin" && (
              <>
                New to Swapify?{" "}
                <button type="button" onClick={() => { setMode("signup"); setValidationError(""); setInfo(""); }} className="font-semibold text-primary-soft underline">
                  Create an account
                </button>
              </>
            )}
            {mode === "signup" && (
              <>
                Already have an account?{" "}
                <button type="button" onClick={() => { setMode("signin"); setValidationError(""); setInfo(""); }} className="font-semibold text-primary-soft underline">
                  Sign in
                </button>
              </>
            )}
            {(mode === "verify" || mode === "forgot" || mode === "reset") && (
              <>
                <button type="button" onClick={() => { setMode("signin"); setValidationError(""); setInfo(""); }} className="font-semibold text-primary-soft underline">
                  Back to sign in
                </button>
              </>
            )}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-primary-soft" aria-hidden />
            Secure &amp; Encrypted Sign-In
          </span>
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

