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
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      toast.error("Sadece PDF kabul edilir");
      return;
    }
    if (file.size > 50 * 1024 * 1024) {
      toast.error("50MB sınırını aşıyor");
      return;
    }

    const fd = new FormData();
    fd.append("file", file);
    if (label.trim()) fd.append("label", label.trim());

    setUploading(true);
    try {
      const res = await fetch(`/api/library/${entryId}/volumes`, {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      toast.success("Cilt eklendi, metin çıkarılıyor…");
      setLabel("");
      await fetchVolumes();
      onChange?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Yüklenemedi");
    } finally {
      setUploading(false);
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
        <span className="inline-flex items-center gap-1 text-[#2D8B4E] font-ui text-[10px]">
          <CheckCircle2 className="h-3 w-3" />
          Hazır
          {v.totalPages !== null && ` · ${v.totalPages} sf.`}
        </span>
      );
    }
    if (v.pdfStatus === "failed") {
      return (
        <span
          className="inline-flex items-center gap-1 text-[#c44] font-ui text-[10px]"
          title={v.pdfError ?? undefined}
        >
          <AlertTriangle className="h-3 w-3" />
          Başarısız
        </span>
      );
    }
    if (inProgress) {
      return (
        <span className="inline-flex items-center gap-1 text-[#8a7a65] font-ui text-[10px]">
          <Loader2 className="h-3 w-3 animate-spin" />
          {v.pdfStatus}
        </span>
      );
    }
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col bg-[#FAF7F0] border-[#d4c9b5]">
        <DialogHeader>
          <DialogTitle className="font-display text-[#2D1F0E] flex items-center gap-2">
            <BookCopy className="h-4 w-4 text-[#C9A84C]" />
            Ciltler
          </DialogTitle>
          <p className="font-body text-xs text-[#6b5a45]">{entryTitle}</p>
        </DialogHeader>
        <div className="h-px bg-[#d4c9b5]/50" />

        {/* Volume list */}
        <div className="flex-1 min-h-[140px] overflow-y-auto border border-[#d4c9b5]/40 rounded-sm bg-white">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
            </div>
          ) : volumes.length === 0 ? (
            <div className="flex items-center justify-center py-10 font-body text-sm text-[#8a7a65] text-center px-4">
              Henüz cilt yok. Aşağıdaki kutudan PDF yükleyerek ilk cildi ekle.
            </div>
          ) : (
            <ul>
              {volumes.map((v) => (
                <li
                  key={v.id}
                  className="px-3 py-2 flex items-center gap-3 border-b border-[#d4c9b5]/30 last:border-0"
                >
                  <div className="font-display text-sm font-semibold text-[#2D1F0E] shrink-0 w-12">
                    Cilt {v.volumeNumber}
                  </div>
                  <div className="flex-1 min-w-0">
                    {v.label && (
                      <div className="font-body text-sm text-[#2D1F0E] truncate">
                        {v.label}
                      </div>
                    )}
                    <div className="mt-0.5">{statusBadge(v)}</div>
                  </div>
                  {v.hasPdf && (
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
                      className="flex items-center justify-center h-7 w-7 rounded-sm hover:bg-[#C9A84C]/15"
                    >
                      <ExternalLink className="h-3.5 w-3.5 text-[#5C4A32]" />
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
          <div className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]">
            Yeni cilt
          </div>
          <input
            type="text"
            placeholder="Etiket (opsiyonel) — örn: Hicret Öncesi"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="w-full px-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89a82] focus:outline-none focus:border-[#C9A84C]/60"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
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
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-sm border-2 border-dashed border-[#C9A84C]/50 bg-[#FAF7F0]/60 text-[#5C4A32] font-ui text-sm hover:bg-[#FAF7F0] disabled:opacity-60"
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
                Yükleniyor…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-[#C9A84C]" />
                PDF seç ve yeni cilt olarak ekle
              </>
            )}
          </button>
          <p className="font-body text-[10px] text-[#a89a82]">
            Cilt numarası otomatik atanır. Sayfa sayısı ve metin çıkarma
            arka planda yapılır.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
