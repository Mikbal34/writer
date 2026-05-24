"use client";

/**
 * Multi-volume management dialog for a single LibraryEntry.
 *
 * Multi-cilt works (Tabari Tafsir, Hadis Külliyatı, ansiklopedi) live
 * as one bibliographic entry with N physical volumes; this dialog
 * lists those volumes, lets the user upload a PDF for each as a new
 * volume (auto-numbered), and exposes per-volume actions: open the
 * PDF in a new tab, delete the volume.
 *
 * Citations target a (entry, volume, page) tuple, so each volume
 * carries its own pdfStatus and chunk set independently.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  Upload,
  ExternalLink,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  BookCopy,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";

interface VolumeRow {
  id: string;
  volumeNumber: number;
  label: string | null;
  pdfStatus: string;
  pdfError?: string | null;
  totalPages: number | null;
  hasPdf: boolean;
  fileType: string | null;
  createdAt: string;
}

interface VolumesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryId: string;
  entryTitle: string;
  onChange?: () => void;
}

export default function VolumesDialog({
  open,
  onOpenChange,
  entryId,
  entryTitle,
  onChange,
}: VolumesDialogProps) {
  const [volumes, setVolumes] = useState<VolumeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [label, setLabel] = useState("");
  const [volumeNumberInput, setVolumeNumberInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchVolumes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/library/${entryId}/volumes`);
      if (!res.ok) throw new Error("fetch failed");
      const data = (await res.json()) as { volumes: VolumeRow[] };
      setVolumes(data.volumes ?? []);
    } catch {
      toast.error("Ciltler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    if (!open) return;
    fetchVolumes();
  }, [open, fetchVolumes]);

  // Poll while any volume is still processing — same pattern as the
  // library entry table uses for primary-PDF status.
  useEffect(() => {
    if (!open) return;
    const IN_PROGRESS = new Set(["pending", "downloading", "extracting", "embedding"]);
    const anyInProgress = volumes.some((v) => IN_PROGRESS.has(v.pdfStatus));
    if (!anyInProgress) return;
    const t = setInterval(fetchVolumes, 3000);
    return () => clearInterval(t);
  }, [open, volumes, fetchVolumes]);

  async function handleUpload(file: File) {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!/\.(pdf|epub|docx)$/.test(lower)) {
      toast.error("Sadece PDF / EPUB / DOCX kabul edilir");
      return;
    }
    if (file.size > 150 * 1024 * 1024) {
      toast.error("150 MB sınırını aşıyor");
      return;
    }

    const volNumRaw = volumeNumberInput.trim();
    let volumeNumberForUpload: number | null = null;
    if (volNumRaw) {
      const parsed = parseInt(volNumRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        toast.error("Cilt numarası 1 veya daha büyük olmalı");
        return;
      }
      if (volumes.some((v) => v.volumeNumber === parsed)) {
        toast.error(`Cilt ${parsed} zaten var`);
        return;
      }
      volumeNumberForUpload = parsed;
    } else {
      // Backend default = max(existing)+1; compute the same client-side
      // so presign-volume gets a deterministic number.
      const maxExisting = volumes.reduce((m, v) => Math.max(m, v.volumeNumber), 0);
      volumeNumberForUpload = maxExisting + 1;
    }

    setUploading(true);
    try {
      // Direct-to-R2 — same 3-step flow as AddSourceDialog volume path.
      const presignRes = await fetch(`/api/library/${entryId}/presign-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          volumeNumber: volumeNumberForUpload,
          label: label.trim() || undefined,
        }),
      });
      if (!presignRes.ok) {
        const err = await presignRes.json().catch(() => ({}));
        throw new Error(err.error || `presign ${presignRes.status}`);
      }
      const { volumeId, uploadUrl, contentType } = await presignRes.json() as {
        volumeId: string; uploadUrl: string; contentType: string;
      };

      // Step 2: PUT bytes directly to R2 (no server RAM hit).
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", uploadUrl);
        // Content-Type not set (browser default + R2 ignores it).
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else reject(new Error(`R2 ${xhr.status}`));
        };
        xhr.onerror = () => reject(new Error("network error during R2 upload"));
        xhr.send(file);
      });

      // Step 3: confirm — server verifies + enqueues worker.
      const confirmRes = await fetch(`/api/library/${entryId}/confirm-volume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volumeId }),
      });
      if (!confirmRes.ok) {
        const err = await confirmRes.json().catch(() => ({}));
        throw new Error(err.error || `confirm ${confirmRes.status}`);
      }

      toast.success("Cilt eklendi, metin çıkarılıyor…");
      setLabel("");
      setVolumeNumberInput("");
      await fetchVolumes();
      onChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Yüklenemedi");
    } finally {
      setUploading(false);
    }
  }

  async function handleReprocess(vol: VolumeRow) {
    try {
      const res = await fetch(
        `/api/library/${entryId}/volumes/${vol.id}/reprocess`,
        { method: "POST" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success(`Cilt ${vol.volumeNumber} yeniden işleniyor…`);
      await fetchVolumes();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Yeniden işlenemedi");
    }
  }

  async function handleDelete(vol: VolumeRow) {
    const ok = window.confirm(
      `Cilt ${vol.volumeNumber}${vol.label ? ` — ${vol.label}` : ""} silinsin mi?`,
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/library/${entryId}/volumes/${vol.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      toast.success("Cilt silindi");
      await fetchVolumes();
      onChange?.();
    } catch {
      toast.error("Silinemedi");
    }
  }

  function statusBadge(v: VolumeRow) {
    const inProgress = ["pending", "downloading", "extracting", "embedding"].includes(
      v.pdfStatus,
    );
    if (v.pdfStatus === "ready") {
      return (
        <span className="inline-flex items-center gap-1 text-forest-light font-ui text-[10px]">
          <CheckCircle2 className="h-3 w-3" />
          Hazır
          {v.totalPages !== null && ` · ${v.totalPages} sf.`}
        </span>
      );
    }
    if (v.pdfStatus === "failed") {
      return (
        <span
          className="inline-flex items-center gap-1 text-destructive font-ui text-[10px] max-w-full"
          title={v.pdfError ?? undefined}
        >
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span className="truncate">
            Başarısız
            {v.pdfError ? ` · ${v.pdfError}` : ""}
          </span>
        </span>
      );
    }
    if (inProgress) {
      return (
        <span className="inline-flex items-center gap-1 text-ink-light font-ui text-[10px]">
          <Loader2 className="h-3 w-3 animate-spin" />
          {v.pdfStatus}
        </span>
      );
    }
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-page border-sandy">
        <DialogHeader>
          <DialogTitle className="font-display text-ink flex items-center gap-2">
            <BookCopy className="h-4 w-4 text-gold" />
            Ciltler
          </DialogTitle>
          <p className="font-body text-xs text-ink-light">{entryTitle}</p>
        </DialogHeader>
        <div className="h-px bg-sandy/50" />

        {/* Volume list */}
        <div className="flex-1 min-h-[140px] overflow-y-auto border border-sandy/40 rounded-sm bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-gold" />
            </div>
          ) : volumes.length === 0 ? (
            <div className="flex items-center justify-center py-10 font-body text-sm text-ink-light text-center px-4">
              Henüz cilt yok. Aşağıdaki kutudan PDF yükleyerek ilk cildi ekle.
            </div>
          ) : (
            <ul>
              {volumes.map((v) => (
                <li
                  key={v.id}
                  className="px-3 py-2 flex items-center gap-3 border-b border-sandy/30 last:border-0"
                >
                  <div className="font-display text-sm font-semibold text-ink shrink-0 w-12">
                    Cilt {v.volumeNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    {v.label && (
                      <div className="font-body text-sm text-ink truncate">
                        {v.label}
                      </div>
                    )}
                    <div className="mt-0.5">{statusBadge(v)}</div>
                  </div>
                  {v.hasPdf && v.fileType === "pdf" && (
                    <button
                      type="button"
                      title="PDF'i yeni sekmede aç"
                      onClick={() =>
                        window.open(
                          `/api/library/${entryId}/pdf?volume=${v.id}`,
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                      className="flex items-center justify-center h-7 w-7 rounded-sm hover:bg-gold/15"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-ink-light" />
                    </button>
                  )}
                  {v.fileType && v.fileType !== "pdf" && (
                    <span className="font-ui text-[10px] uppercase tracking-wider text-ink-light px-1.5 py-0.5 rounded-sm bg-page">
                      {v.fileType}
                    </span>
                  )}
                  {v.pdfStatus === "failed" && v.hasPdf && (
                    <button
                      type="button"
                      title="Yeniden işle (dosya diskte duruyor)"
                      onClick={() => handleReprocess(v)}
                      className="flex items-center justify-center h-7 w-7 rounded-sm hover:bg-gold/15"
                    >
                      <RotateCw className="h-3.5 w-3.5 text-ink-light" />
                    </button>
                  )}
                  <button
                    type="button"
                    title="Cildi sil"
                    onClick={() => handleDelete(v)}
                    className="flex items-center justify-center h-7 w-7 rounded-sm hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Add new volume */}
        <div className="space-y-2 pt-1">
          <div className="font-ui text-[11px] uppercase tracking-widest text-ink-light">
            Yeni cilt
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              min="1"
              placeholder="Cilt #"
              value={volumeNumberInput}
              onChange={(e) => setVolumeNumberInput(e.target.value)}
              title="Boş bırakırsan otomatik sıradaki numara atanır"
              className="w-20 px-3 py-2 rounded-sm border border-sandy/60 bg-white font-body text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold/60"
            />
            <input
              type="text"
              placeholder="Etiket (opsiyonel) — örn: Hicret Öncesi"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="flex-1 px-3 py-2 rounded-sm border border-sandy/60 bg-white font-body text-sm text-ink placeholder:text-ink-muted focus:outline-none focus:border-gold/60"
            />
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.epub,.docx"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleUpload(f);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-sm border-2 border-dashed border-gold/50 bg-page/60 text-ink-light font-ui text-sm hover:bg-page disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-gold" />
                Yükleniyor…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-gold" />
                PDF / EPUB / DOCX seç ve yeni cilt olarak ekle
              </>
            )}
          </button>
          <p className="font-body text-[10px] text-ink-muted">
            Cilt numarası otomatik atanır. Sayfa sayısı ve metin çıkarma
            arka planda yapılır.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
