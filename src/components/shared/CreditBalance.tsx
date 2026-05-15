"use client";

/**
 * Sidebar footer credit card.
 *
 * V3 layout: a small icon tile + 2-line text block with the current
 * balance in display-serif type, and "Bu ay N kullanıldı" in the UI
 * font underneath. Renders as a self-contained card so the sidebar
 * footer reads as a complete piece of furniture rather than a stray
 * number on top of a divider.
 *
 * Refreshes every 30 s. Low (<100) and empty states tint the icon
 * tile red/amber respectively without disrupting the layout.
 */

import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import Link from "next/link";

interface CreditState {
  balance: number;
  monthUsage: number;
}

export default function CreditBalance() {
  const [state, setState] = useState<CreditState | null>(null);

  useEffect(() => {
    async function fetchBalance() {
      try {
        const res = await fetch("/api/credits");
        if (res.ok) {
          const data = await res.json();
          setState({
            balance: data.balance ?? 0,
            monthUsage: data.monthUsage ?? 0,
          });
        }
      } catch {
        // silently ignore — sidebar shows nothing rather than a broken state
      }
    }
    fetchBalance();
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  if (state === null) return null;

  const { balance, monthUsage } = state;
  const isLow = balance > 0 && balance < 100;
  const isEmpty = balance === 0;

  const iconTileClass = isEmpty
    ? "bg-red-100 text-red-700"
    : isLow
      ? "bg-amber-100 text-amber-700"
      : "bg-[#C9A84C]/15 text-[#8a5a1a]";

  return (
    <Link
      href="/account"
      className="block px-3 py-2.5 hover:bg-[#FAF7F0]/50 transition-colors"
      title="Hesabıma git"
    >
      <div className="flex items-center gap-2.5">
        <div
          className={`h-9 w-9 rounded-sm flex items-center justify-center shrink-0 ${iconTileClass}`}
        >
          <Zap className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="font-display text-base font-semibold text-ink tabular-nums leading-tight">
            {balance.toLocaleString("tr-TR")}{" "}
            <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
              credits
            </span>
          </div>
          <div className="font-ui text-[10px] text-[#8a7a65] mt-0.5 truncate">
            Bu ay {monthUsage.toLocaleString("tr-TR")} kullanıldı
          </div>
        </div>
      </div>
    </Link>
  );
}
