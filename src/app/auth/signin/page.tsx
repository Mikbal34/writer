"use client";

import { signIn } from "next-auth/react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { FadeUpLarge, FadeRight } from "@/components/shared/Animations";

const LOGIN_BG =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/login-side-SFmLk8yLoL8wNDe9MAbpDm.webp";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";

export default function SignInPage() {
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

        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2.5 w-fit">
            <img src="/images/quillon-logo-horizontal.png" alt="Quillon" className="h-12 brightness-0 invert" />
          </Link>

          {/* Bottom quote */}
          <FadeUpLarge delay={0.5}>
            <div className="h-px w-12 bg-[#C9A84C] mb-6" />
            <blockquote className="font-body text-2xl italic text-[#FAF7F0]/90 leading-relaxed mb-4">
              &ldquo;Bir kitap yazmak, dünyaya bırakabileceğiniz en kalıcı izdir.&rdquo;
            </blockquote>
            <p className="font-ui text-sm text-[#C9A84C]">— Quillon</p>
          </FadeUpLarge>
        </div>
      </div>

      {/* RIGHT: Login Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <FadeRight delay={0.2} className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-8 lg:hidden">
            <img src="/images/quillon-icon.png" alt="Quillon" className="w-8 h-8" />
            <span className="font-display text-lg font-bold text-ink">Quillon</span>
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
              <img src="/images/quillon-logo-monogram.png" alt="Quillon" className="h-14 w-14" />
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

            {/* Sign up hint */}
            <p className="font-ui text-sm text-center text-ink-light mt-6">
              Don&apos;t have an account?{" "}
              <span className="text-forest font-medium">
                Sign up automatically with Google
              </span>
            </p>

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
            Devam ederek Kullanım Koşulları ve Gizlilik Politikamızı kabul etmiş olursunuz.
          </p>
        </FadeRight>
      </div>
    </div>
  );
}
