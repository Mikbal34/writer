"use client";

import { CheckCircle, XCircle } from "lucide-react";

interface CommandSummaryProps {
  count: number;
  applied: boolean;
}

export default function CommandSummary({ count, applied }: CommandSummaryProps) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-2 pt-2 border-t border-dashed">
      {applied ? (
        <CheckCircle className="h-3.5 w-3.5 text-[#C9A84C]" />
      ) : (
        <XCircle className="h-3.5 w-3.5 text-amber-500" />
      )}
      <span>
        {count} değişiklik {applied ? "uygulandı" : "uygulanamadı"}
      </span>
    </div>
  );
}
