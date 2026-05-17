"use client";

import { useState } from "react";
import { Archive, ChevronRight, Loader2 } from "lucide-react";

export default function ExportDataButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleExport() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account/export");
      if (!res.ok) {
        setError("Verileri çekemedik.");
        setBusy(false);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `quilpen-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={handleExport}
        disabled={busy}
        className="w-full flex items-center gap-2.5 px-2 py-1.5 rounded-md text-ink font-ui text-[12.5px] hover:bg-panel transition-colors text-left disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 text-ink-light animate-spin" />
        ) : (
          <Archive className="h-3.5 w-3.5 text-ink-light" />
        )}
        <span className="flex-1">
          {busy ? "Hazırlanıyor…" : "Verileri ihraç et"}
        </span>
        <ChevronRight className="h-3 w-3 text-ink-muted" />
      </button>
      {error && (
        <p className="px-2 mt-1 font-ui text-[11px] text-[#a64a3a]">{error}</p>
      )}
    </>
  );
}
