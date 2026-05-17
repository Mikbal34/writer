"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";

const CONFIRM_PHRASE = "Hesabımı sil";

export default function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue("");
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const phraseMatch = value.trim() === CONFIRM_PHRASE;

  async function handleDelete() {
    if (!phraseMatch) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_PHRASE }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Silinemedi.");
        setBusy(false);
        return;
      }
      // Server cascaded the user record; sign out and bounce to home.
      await signOut({ callbackUrl: "/" });
    } catch {
      setError("Bağlantı hatası.");
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 w-full text-center px-3 py-1.5 rounded-sm font-ui text-[11px] text-ink-muted hover:bg-elevated transition-colors"
      >
        Hesabı kalıcı olarak sil
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/55"
          onClick={() => !busy && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-elevated border border-[rgba(138,58,42,0.35)] shadow-2xl p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display italic font-medium text-[22px] text-[#8a3a2a]">
              Hesabını kalıcı olarak sil
            </h2>
            <p className="mt-2 font-body text-[13px] text-ink leading-relaxed">
              Bu işlem geri alınamaz. Tüm projelerin, kütüphanen, yazım ikizi
              profillerin, sohbet geçmişin ve kredi kayıtların silinir.
            </p>

            <p className="mt-4 font-ui text-[12px] text-ink-light">
              Onaylamak için aşağıdaki kutuya{" "}
              <span className="font-mono font-semibold text-ink">
                {CONFIRM_PHRASE}
              </span>{" "}
              yaz.
            </p>

            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && phraseMatch) handleDelete();
                if (e.key === "Escape" && !busy) setOpen(false);
              }}
              placeholder={CONFIRM_PHRASE}
              className="mt-2 w-full px-3 py-2 rounded-md border border-sandy bg-panel font-mono text-[13px] text-ink focus:outline-none focus:border-[rgba(138,58,42,0.6)] transition-colors"
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            {error && (
              <p className="mt-2 font-ui text-[11.5px] text-[#a64a3a]">
                {error}
              </p>
            )}

            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="px-3 py-1.5 rounded-md font-ui text-[12.5px] text-ink-muted hover:bg-panel transition-colors disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!phraseMatch || busy}
                className="px-4 py-1.5 rounded-md font-ui text-[12.5px] font-semibold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                style={{
                  background: phraseMatch ? "#8a3a2a" : "rgba(138,58,42,0.4)",
                }}
              >
                {busy ? "Siliniyor…" : "Hesabımı sil"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
