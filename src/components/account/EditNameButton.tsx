"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";

interface Props {
  currentName: string;
}

export default function EditNameButton({ currentName }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setValue(currentName);
      setError(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, currentName]);

  async function handleSave() {
    const next = value.trim();
    if (next.length < 1 || next.length > 80) {
      setError("İsim 1–80 karakter olmalı.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(data.error ?? "Güncellenemedi.");
        setSaving(false);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch {
      setError("Bağlantı hatası.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <button
        type="button"
        title="İsmi düzenle"
        onClick={() => setOpen(true)}
        className="h-5 w-5 inline-flex items-center justify-center rounded-sm text-ink-muted hover:bg-panel hover:text-ink transition-colors"
      >
        <Pencil className="h-3 w-3" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/50"
          onClick={() => !saving && setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-elevated border border-sandy/60 shadow-2xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-display italic font-medium text-[20px] text-forest-deep">
              İsmini düzenle
            </h2>
            <p className="mt-1 font-body text-[12.5px] text-ink-light">
              Bu isim hesap ve yapıtlarında görünecek.
            </p>

            <input
              ref={inputRef}
              type="text"
              value={value}
              maxLength={80}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape" && !saving) setOpen(false);
              }}
              placeholder="İsmin"
              className="mt-4 w-full px-3 py-2 rounded-md border border-sandy bg-panel font-ui text-[13px] text-ink focus:outline-none focus:border-gold transition-colors"
              disabled={saving}
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
                disabled={saving}
                className="px-3 py-1.5 rounded-md font-ui text-[12.5px] text-ink-muted hover:bg-panel transition-colors disabled:opacity-50"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-4 py-1.5 rounded-md bg-gold text-white font-ui text-[12.5px] font-semibold hover:bg-gold-hover transition-colors disabled:opacity-60"
              >
                {saving ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
