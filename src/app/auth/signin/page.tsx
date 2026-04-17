"use client";

import { FormEvent, useState, useRef, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";

import { ArrowRight, Mail, Loader2, ArrowLeft } from "lucide-react";
import { FadeUpLarge, FadeRight } from "@/components/shared/Animations";

const LOGIN_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/login-side-SFmLk8yLoL8wNDe9MAbpDm.webp";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

type Step = "email" | "code";

export default function SignInPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCountdown, setResendCountdown] = useState(0);
  const codeInputRef = useRef<HTMLInputElement | null>(null);

  // Countdown tick for "resend code"
  useEffect(() => {
    if (resendCountdown <= 0) return;
    const t = setTimeout(() => setResendCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCountdown]);

  // Auto-focus code input when entering step 2
  useEffect(() => {
    if (step === "code") codeInputRef.current?.focus();
  }, [step]);

  async function requestCode(targetEmail: string) {
    const res = await fetch("/api/auth/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: targetEmail }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error ?? "Kod gonderilemedi");
    }
  }

  async function handleRequest(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await requestCode(email);
      setStep("code");
      setResendCountdown(30);
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Baglanti hatasi");
    } finally {
      setLoading(false);
    }
  }

  async function handleVerify(e: FormEvent) {
    e.preventDefault();
    if (code.length !== 6) return;
    setError(null);
    setLoading(true);
    try {
      const res = await signIn("email-code", {
        email,
        code,
        redirect: false,
      });
      if (!res || res.error) {
        setError("Kod yanlis veya suresi dolmus. Tekrar dene.");
      } else {
        router.replace("/");
        router.refresh();
      }
    } catch {
      setError("Baglanti hatasi");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (resendCountdown > 0) return;
    setError(null);
    try {
      await requestCode(email);
      setResendCountdown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kod gonderilemedi");
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
      }}
    >
      {/* LEFT: Atmospheric Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${LOGIN_BG})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1a0f05]/20 to-[#1a0f05]/60" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a0f05]/70 via-transparent to-transparent" />

        <div className="relative z-10 flex flex-col justify-end p-12 w-full">
          {/* Bottom quote */}
          <FadeUpLarge delay={0.5}>
            <div className="h-px w-12 bg-[#C9A84C] mb-6" />
            <blockquote className="font-body text-2xl italic text-[#FAF7F0]/90 leading-relaxed mb-4">
              &ldquo;Writing a book is the most lasting mark you can leave on the world.&rdquo;
            </blockquote>
            <p className="font-ui text-sm text-[#C9A84C]">— Quilpen</p>
          </FadeUpLarge>
        </div>
      </div>

      {/* RIGHT: Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <FadeRight delay={0.2} className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <img src="/images/quilpen-icon.png" alt="Quilpen" className="w-8 h-8" />
            <span className="font-display text-lg font-bold text-ink">Quilpen</span>
          </div>

          {/* Card */}
          <div className="bg-[#FAF7F0]/90 border border-[#d4c9b5]/70 rounded-sm shadow-[0_4px_30px_rgba(60,36,21,0.12)] p-8">
            {/* Top ornament */}
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#d4c9b5]" />
              <svg viewBox="0 0 40 20" className="w-8 text-[#C9A84C]/60" fill="currentColor">
                <circle cx="20" cy="10" r="3" />
                <circle cx="8" cy="10" r="1.5" />
                <circle cx="32" cy="10" r="1.5" />
              </svg>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#d4c9b5]" />
            </div>

            {/* Icon */}
            <div className="flex justify-center mb-5">
              <img src="/images/quilpen-logo-monogram.png" alt="Quilpen" className="h-14 w-14" />
            </div>

            <h1 className="font-display text-3xl font-bold text-ink mb-2 text-center">
              Welcome Back
            </h1>
            <p className="font-body text-ink-light text-center mb-8">
              Sign in to your account and continue writing.
            </p>

            {/* Google Sign In */}
            <button
              onClick={() => signIn("google", { callbackUrl: "/" })}
              type="button"
              className="w-full flex items-center justify-center gap-3 px-4 py-3.5 rounded-sm border border-[#d4c9b5] bg-white/80 font-ui text-sm text-ink hover:bg-[#F5F0E6] transition-all duration-200 group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
              </svg>
              Sign in with Google
              <ArrowRight className="w-4 h-4 text-[#c9bfad] group-hover:text-ink group-hover:translate-x-0.5 transition-all" />
            </button>

            {/* Divider */}
            <div className="flex items-center gap-3 my-5">
              <div className="h-px flex-1 bg-[#d4c9b5]/60" />
              <span className="font-ui text-[11px] text-[#a89a82] tracking-wider uppercase">veya</span>
              <div className="h-px flex-1 bg-[#d4c9b5]/60" />
            </div>

            {/* Email + 6-digit code flow */}
            {step === "email" ? (
              <form onSubmit={handleRequest} className="space-y-2">
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#a89a82]" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="eposta@adresin.com"
                    required
                    autoComplete="email"
                    className="w-full pl-10 pr-3 py-3 rounded-sm border border-[#d4c9b5] bg-white/80 font-ui text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-sm bg-ink text-[#FAF7F0] font-ui text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loading ? "Gonderiliyor..." : "Giris kodu gonder"}
                </button>
                {error && (
                  <p className="font-ui text-xs text-[#c44] text-center">{error}</p>
                )}
              </form>
            ) : (
              <form onSubmit={handleVerify} className="space-y-3">
                <div className="text-center">
                  <p className="font-ui text-xs text-ink-light mb-1">
                    <strong className="text-ink">{email}</strong> adresine
                  </p>
                  <p className="font-ui text-xs text-ink-light">
                    6 haneli giris kodu gonderildi.
                  </p>
                </div>
                <input
                  ref={codeInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  required
                  className="w-full px-3 py-3 text-center rounded-sm border border-[#d4c9b5] bg-white/80 font-mono text-2xl tracking-[0.5em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#C9A84C]/60"
                />
                <button
                  type="submit"
                  disabled={loading || code.length !== 6}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-sm bg-ink text-[#FAF7F0] font-ui text-sm hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {loading ? "Dogrulaniyor..." : "Giris yap"}
                </button>
                {error && (
                  <p className="font-ui text-xs text-[#c44] text-center">{error}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError(null);
                    }}
                    className="flex items-center gap-1 font-ui text-xs text-[#8a7a65] hover:text-ink transition-colors"
                  >
                    <ArrowLeft className="h-3 w-3" />
                    E-postayi degistir
                  </button>
                  <button
                    type="button"
                    onClick={handleResend}
                    disabled={resendCountdown > 0}
                    className="font-ui text-xs text-[#C9A84C] hover:underline disabled:text-[#a89a82] disabled:no-underline disabled:cursor-not-allowed"
                  >
                    {resendCountdown > 0 ? `Kodu tekrar gonder (${resendCountdown}s)` : "Kodu tekrar gonder"}
                  </button>
                </div>
              </form>
            )}

            {/* Bottom ornament */}
            <div className="flex items-center gap-3 mt-6">
              <div className="h-px flex-1 bg-gradient-to-r from-transparent to-[#d4c9b5]" />
              <svg viewBox="0 0 40 20" className="w-8 text-[#C9A84C]/60" fill="currentColor">
                <circle cx="20" cy="10" r="3" />
                <circle cx="8" cy="10" r="1.5" />
                <circle cx="32" cy="10" r="1.5" />
              </svg>
              <div className="h-px flex-1 bg-gradient-to-l from-transparent to-[#d4c9b5]" />
            </div>
          </div>

          {/* Page number */}
          <p className="font-ui text-xs text-muted-foreground text-center mt-6 tracking-widest">
            — ix —
          </p>

          {/* Terms */}
          <p className="text-center font-ui text-xs mt-3 text-muted-foreground/60">
            By continuing, you agree to our Terms of Service and Privacy Policy.
          </p>
        </FadeRight>
      </div>
    </div>
  );
}
