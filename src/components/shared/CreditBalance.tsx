"use client";

import { useState, useEffect } from "react";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export default function CreditBalance() {
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    async function fetchBalance() {
      try {
        const res = await fetch("/api/credits");
        if (res.ok) {
          const data = await res.json();
          setBalance(data.balance);
        }
      } catch {
        // silently ignore
      }
    }
    fetchBalance();

    // Refresh every 30 seconds
    const interval = setInterval(fetchBalance, 30000);
    return () => clearInterval(interval);
  }, []);

  if (balance === null) return null;

  const isLow = balance > 0 && balance < 10;
  const isEmpty = balance === 0;

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1 rounded-md font-ui text-xs",
        isEmpty
          ? "text-red-600 bg-red-50"
          : isLow
            ? "text-amber-600 bg-amber-50"
            : "text-muted-foreground"
      )}
    >
      <Zap className="w-3.5 h-3.5" />
      <span className="font-medium">{balance} credits</span>
    </div>
  );
}
