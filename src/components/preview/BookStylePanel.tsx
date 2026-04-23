"use client";

import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { BOOK_STYLES, detectBundleId } from "@/lib/book-styles";
import type { BookStyleBundle, BookDesign } from "@/lib/book-styles";

interface BookStylePanelProps {
  projectId: string;
  currentArtStyle: string | null;
  currentDesign: Partial<BookDesign> | null;
  onApplied?: (bundle: BookStyleBundle) => void;
  /**
   * Compact variant renders a single-column list instead of a 2-column grid.
   * Useful when embedding in a narrow sidebar.
   */
  variant?: "default" | "compact";
}

export default function BookStylePanel({
  projectId,
  currentArtStyle,
  currentDesign,
  onApplied,
  variant = "default",
}: BookStylePanelProps) {
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const selectedId = detectBundleId(currentArtStyle, currentDesign);

  async function handleApply(bundle: BookStyleBundle) {
    if (applyingId) return;
    setApplyingId(bundle.id);

    try {
      // Merge artStyle into existing writingGuidelines rather than replacing
      // the whole object — other keys (e.g. AI research notes) must survive.
      const projRes = await fetch(`/api/projects/${projectId}`);
      const project = projRes.ok ? await projRes.json() : {};
      const existingGuidelines =
        (project.writingGuidelines as Record<string, unknown> | null) ?? {};

      const patchRes = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          writingGuidelines: { ...existingGuidelines, artStyle: bundle.artStyle },
          bookDesign: bundle.design,
        }),
      });

      if (!patchRes.ok) {
        const err = await patchRes.json().catch(() => ({}));
        throw new Error(err.error ?? "Stil uygulanamadı");
      }

      toast.success(`"${bundle.label}" stili uygulandı`);
      onApplied?.(bundle);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bir hata oluştu";
      toast.error(msg);
    } finally {
      setApplyingId(null);
    }
  }

  const gridCols = variant === "compact" ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2";

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-3.5 w-3.5 text-forest" />
        <p className="font-ui text-xs text-muted-foreground">
          Kitap stilini seç — sanat stili, tipografi, sayfa düzeni ve renk paleti hepsi
          birlikte güncellensin.
        </p>
      </div>

      <div className={`grid gap-2 ${gridCols}`}>
        {BOOK_STYLES.map((bundle) => {
          const isSelected = selectedId === bundle.id;
          const isApplying = applyingId === bundle.id;
          return (
            <button
              key={bundle.id}
              onClick={() => handleApply(bundle)}
              disabled={Boolean(applyingId)}
              className={`relative text-left rounded-md border px-3 py-2.5 transition-colors disabled:opacity-50 ${
                isSelected
                  ? "border-forest/40 bg-forest/5 shadow-sm"
                  : "border-[#d4c9b5] hover:bg-muted/40"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="font-ui text-xs font-medium block text-ink">
                    {bundle.label}
                  </span>
                  <span className="font-body text-[10px] text-muted-foreground block leading-snug mt-0.5">
                    {bundle.desc}
                  </span>
                </div>
                {isApplying ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-forest shrink-0" />
                ) : isSelected ? (
                  <Check className="h-3.5 w-3.5 text-forest shrink-0" />
                ) : null}
              </div>

              {/* Tiny swatch row: body font + accent color + page size */}
              <div className="mt-2 flex items-center gap-1.5 text-[9px] font-ui text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full border border-black/10"
                  style={{ backgroundColor: bundle.design.accentColor }}
                  aria-hidden
                />
                <span className="uppercase tracking-wide">
                  {bundle.design.pageSize}
                </span>
                <span>·</span>
                <span className="truncate">{bundle.design.bodyFont}</span>
              </div>
            </button>
          );
        })}
      </div>

      {selectedId === null && (currentArtStyle || currentDesign) && (
        <p className="font-body text-[10px] text-muted-foreground italic pt-1">
          Şu an özel ayarların var — hazır stile dönmek için bir kart seç.
        </p>
      )}
    </div>
  );
}
