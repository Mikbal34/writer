"use client";

/**
 * Bulk upload dialog for the library.
 *
 * Users pick several files at once and decide which ones are
 * standalone books and which belong to a multi-volume work. The
 * single uploader path goes through /api/library/upload-pdf
 * (Haiku enrichment), while each multi-volume group becomes one
 * parent entry (POST /api/library) + N volume rows
 * (POST /api/library/[parentId]/volumes). All requests fire in
 * parallel; the dialog reports per-file success/failure on close.
 *
 * Grouping flow:
 *   1. User ticks 2+ files → "Grupla"
 *   2. Frontend posts the first ticked file to /extract-metadata so
 *      Haiku / DC / core_properties prefill the group form
 *   3. User reviews + sets per-cilt volume numbers manually (5, 12, …
 *      are valid — sequential is not assumed)
 *   4. "Grup oluştur" pushes it onto the group list
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Upload,
  Plus,
  X,
  BookCopy,
  Loader2,
  ArrowLeft,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

interface BulkUploadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional initial file set — e.g. files dropped on /library that
   *  triggered a 2+ open. */
  initialFiles?: File[];
  onUploaded: () => void;
}

interface PendingFile {
  /** Stable id so React keys + checkbox selection survive reorders. */
  id: string;
  file: File;
}

interface GroupForm {
  authorSurname: string;
  authorName: string;
  title: string;
  year: string;
  publisher: string;
}

interface Group {
  id: string;
  form: GroupForm;
  /** fileId → cilt numarası (kullanıcı yazdığı sayı). */
  volumeNumbers: Record<string, string>;
  fileIds: string[];
  labels: Record<string, string>;
}

const ALLOWED_EXTS = [".pdf", ".epub", ".docx"];
const MAX_BYTES = 50 * 1024 * 1024;

function nextId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function fileIsAllowed(f: File): boolean {
  const lower = f.name.toLowerCase();
  return ALLOWED_EXTS.some((ext) => lower.endsWith(ext));
}

function emptyForm(): GroupForm {
  return {
    authorSurname: "",
    authorName: "",
    title: "",
    year: "",
    publisher: "",
  };
}

export default function BulkUploadDialog({
  open,
  onOpenChange,
  initialFiles,
  onUploaded,
}: BulkUploadDialogProps) {
  // ---- File list state ----
  const [files, setFiles] = useState<PendingFile[]>(() =>
    (initialFiles ?? []).map((f) => ({ id: nextId(), file: f })),
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---- Group state ----
  const [groups, setGroups] = useState<Group[]>([]);

  // ---- "Grupla" mini-form overlay ----
  const [groupFormOpen, setGroupFormOpen] = useState(false);
  const [groupFormState, setGroupFormState] = useState<GroupForm>(emptyForm);
  const [groupFormFileIds, setGroupFormFileIds] = useState<string[]>([]);
  const [groupFormVolumes, setGroupFormVolumes] = useState<Record<string, string>>(
    {},
  );
  const [groupFormLabels, setGroupFormLabels] = useState<Record<string, string>>(
    {},
  );
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [extractingMeta, setExtractingMeta] = useState(false);

  // ---- Submit state ----
  const [submitting, setSubmitting] = useState(false);

  const fileById = useMemo(() => {
    const m = new Map<string, PendingFile>();
    for (const f of files) m.set(f.id, f);
    return m;
  }, [files]);

  const ungroupedFiles = useMemo(() => {
    const taken = new Set<string>();
    for (const g of groups) for (const fid of g.fileIds) taken.add(fid);
    return files.filter((f) => !taken.has(f.id));
  }, [files, groups]);

  function appendFiles(incoming: FileList | File[]) {
    const list = Array.from(incoming);
    const additions: PendingFile[] = [];
    for (const f of list) {
      if (!fileIsAllowed(f)) {
        toast.error(`${f.name}: sadece PDF / EPUB / DOCX kabul edilir`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        toast.error(`${f.name}: 50MB sınırı aşıldı`);
        continue;
      }
      if (f.size === 0) continue;
      additions.push({ id: nextId(), file: f });
    }
    if (additions.length > 0) {
      setFiles((prev) => [...prev, ...additions]);
    }
  }

  function removeFile(id: string) {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setGroups((prev) =>
      prev
        .map((g) => ({
          ...g,
          fileIds: g.fileIds.filter((fid) => fid !== id),
        }))
        .filter((g) => g.fileIds.length > 0),
    );
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function openGroupFormForSelection() {
    const ids = ungroupedFiles
      .filter((f) => selectedIds.has(f.id))
      .map((f) => f.id);
    if (ids.length < 2) {
      toast.error("Grup için en az 2 dosya seç");
      return;
    }
    setEditingGroupId(null);
    setGroupFormState(emptyForm());
    setGroupFormFileIds(ids);
    // Default volume numbers: 1, 2, 3 in pick order. User can edit.
    const vols: Record<string, string> = {};
    ids.forEach((fid, idx) => {
      vols[fid] = String(idx + 1);
    });
    setGroupFormVolumes(vols);
    setGroupFormLabels({});
    setGroupFormOpen(true);

    // Fire-and-forget metadata extraction from the first selected
    // file. If it succeeds the form pre-fills; if not, user types.
    const firstFile = fileById.get(ids[0])?.file;
    if (firstFile) {
      setExtractingMeta(true);
      try {
        const fd = new FormData();
        fd.append("file", firstFile);
        const res = await fetch("/api/library/extract-metadata", {
          method: "POST",
          body: fd,
        });
        if (res.ok) {
          const meta = (await res.json()) as {
            authorSurname: string | null;
            authorName: string | null;
            title: string | null;
            year: string | null;
            publisher: string | null;
          };
          // Only fill empty fields — don't clobber whatever the user
          // might have typed during the ~10s extraction window.
          setGroupFormState((s) => ({
            authorSurname: s.authorSurname || meta.authorSurname || "",
            authorName: s.authorName || meta.authorName || "",
            title: s.title || meta.title || "",
            year: s.year || meta.year || "",
            publisher: s.publisher || meta.publisher || "",
          }));
        }
      } catch (err) {
        console.error("[bulk-upload] metadata extraction failed:", err);
      } finally {
        setExtractingMeta(false);
      }
    }
  }

  function openGroupFormForEdit(group: Group) {
    setEditingGroupId(group.id);
    setGroupFormState({ ...group.form });
    setGroupFormFileIds([...group.fileIds]);
    setGroupFormVolumes({ ...group.volumeNumbers });
    setGroupFormLabels({ ...group.labels });
    setGroupFormOpen(true);
  }

  function commitGroupForm() {
    if (!groupFormState.authorSurname.trim()) {
      toast.error("Yazar soyadı zorunlu");
      return;
    }
    if (!groupFormState.title.trim()) {
      toast.error("Ana eser başlığı zorunlu");
      return;
    }
    if (groupFormFileIds.length < 2) {
      toast.error("Grupta en az 2 cilt olmalı");
      return;
    }
    // Validate every file has a numeric cilt and no duplicates.
    const seen = new Set<number>();
    for (const fid of groupFormFileIds) {
      const raw = groupFormVolumes[fid];
      const n = parseInt(raw ?? "", 10);
      if (!Number.isFinite(n) || n < 1) {
        toast.error(
          `Cilt numarası geçersiz: ${fileById.get(fid)?.file.name ?? "?"}`,
        );
        return;
      }
      if (seen.has(n)) {
        toast.error(`Aynı cilt numarası iki kez kullanıldı: Cilt ${n}`);
        return;
      }
      seen.add(n);
    }

    if (editingGroupId) {
      setGroups((prev) =>
        prev.map((g) =>
          g.id === editingGroupId
            ? {
                ...g,
                form: { ...groupFormState },
                fileIds: [...groupFormFileIds],
                volumeNumbers: { ...groupFormVolumes },
                labels: { ...groupFormLabels },
              }
            : g,
        ),
      );
    } else {
      setGroups((prev) => [
        ...prev,
        {
          id: nextId(),
          form: { ...groupFormState },
          fileIds: [...groupFormFileIds],
          volumeNumbers: { ...groupFormVolumes },
          labels: { ...groupFormLabels },
        },
      ]);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const fid of groupFormFileIds) next.delete(fid);
        return next;
      });
    }

    setGroupFormOpen(false);
    setEditingGroupId(null);
    setGroupFormState(emptyForm());
    setGroupFormFileIds([]);
    setGroupFormVolumes({});
    setGroupFormLabels({});
  }

  function dissolveGroup(groupId: string) {
    setGroups((prev) => prev.filter((g) => g.id !== groupId));
  }

  // ---- Submit ----
  async function handleUpload() {
    if (files.length === 0) {
      toast.error("Yüklenecek dosya yok");
      return;
    }
    if (groupFormOpen) {
      toast.error("Önce grup formunu kaydet ya da iptal et");
      return;
    }

    setSubmitting(true);
    const errors: string[] = [];

    const standaloneUploads = ungroupedFiles.map(async (pf) => {
      const fd = new FormData();
      fd.append("file", pf.file);
      const res = await fetch("/api/library/upload-pdf", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`${pf.file.name}: ${err.error || res.status}`);
      }
    });

    const groupUploads = groups.map(async (g) => {
      const parentRes = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorSurname: g.form.authorSurname.trim(),
          authorName: g.form.authorName.trim() || undefined,
          title: g.form.title.trim(),
          year: g.form.year.trim() || undefined,
          publisher: g.form.publisher.trim() || undefined,
          importSource: "multi-volume",
        }),
      });
      if (!parentRes.ok) {
        const err = await parentRes.json().catch(() => ({}));
        throw new Error(
          `Ana eser oluşturulamadı (${g.form.title}): ${err.error || parentRes.status}`,
        );
      }
      const parent = (await parentRes.json()) as { id: string };

      await Promise.all(
        g.fileIds.map(async (fid) => {
          const pf = fileById.get(fid);
          if (!pf) return;
          const volNumber = parseInt(g.volumeNumbers[fid] ?? "1", 10);
          const label = g.labels[fid]?.trim();
          const fd = new FormData();
          fd.append("file", pf.file);
          fd.append("volumeNumber", String(volNumber));
          if (label) fd.append("label", label);
          const volRes = await fetch(
            `/api/library/${parent.id}/volumes`,
            { method: "POST", body: fd },
          );
          if (!volRes.ok) {
            const err = await volRes.json().catch(() => ({}));
            throw new Error(
              `${pf.file.name} (cilt ${volNumber}): ${err.error || volRes.status}`,
            );
          }
        }),
      );
    });

    const results = await Promise.allSettled([
      ...standaloneUploads,
      ...groupUploads,
    ]);
    for (const r of results) {
      if (r.status === "rejected") {
        errors.push(
          r.reason instanceof Error ? r.reason.message : String(r.reason),
        );
      }
    }

    setSubmitting(false);
    if (errors.length === 0) {
      const standaloneCount = ungroupedFiles.length;
      const groupCount = groups.length;
      const volumeCount = groups.reduce((acc, g) => acc + g.fileIds.length, 0);
      const parts: string[] = [];
      if (standaloneCount > 0) parts.push(`${standaloneCount} tek kitap`);
      if (groupCount > 0)
        parts.push(`${groupCount} multi-volume eser (${volumeCount} cilt)`);
      toast.success(`Yüklendi: ${parts.join(" + ")}`);
      setFiles([]);
      setSelectedIds(new Set());
      setGroups([]);
      onOpenChange(false);
      onUploaded();
    } else {
      toast.error(`${errors.length} hata: ${errors[0].slice(0, 120)}`);
      onUploaded();
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col bg-[#FAF7F0] border-[#d4c9b5]">
        <DialogHeader>
          <DialogTitle className="font-display text-[#2D1F0E] flex items-center gap-2">
            <Upload className="h-4 w-4 text-[#C9A84C]" />
            Yeni kaynak ekle
          </DialogTitle>
        </DialogHeader>

        {/* ====================================================== */}
        {/* Group form overlay                                      */}
        {/* ====================================================== */}
        {groupFormOpen ? (
          <div className="space-y-3 border border-[#C9A84C]/40 bg-[#C9A84C]/8 rounded-sm p-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setGroupFormOpen(false);
                  setEditingGroupId(null);
                }}
                className="text-[#5C4A32] hover:text-[#2D1F0E]"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <h3 className="font-display text-sm font-semibold text-[#2D1F0E]">
                {editingGroupId
                  ? "Çok ciltli eseri düzenle"
                  : "Bu dosyalar bir multi-volume eserin parçası"}
              </h3>
              {extractingMeta && (
                <span className="ml-auto inline-flex items-center gap-1.5 font-ui text-[10px] text-[#8a5a1a]">
                  <Sparkles className="h-3 w-3" />
                  Künye çıkarılıyor…
                </span>
              )}
            </div>

            <p className="font-body text-[11px] text-[#6b5a45] leading-snug">
              Ana esere ait künye bilgilerini gir. Yüklediğin ilk dosyadan
              otomatik çıkarmayı denedik; eksikleri tamamla, yanlışları düzelt.
            </p>

            <div className="grid grid-cols-2 gap-2">
              <input
                dir="auto"
                placeholder="Yazar soyadı *"
                value={groupFormState.authorSurname}
                onChange={(e) =>
                  setGroupFormState((s) => ({
                    ...s,
                    authorSurname: e.target.value,
                  }))
                }
                className="px-2 py-1.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
              />
              <input
                dir="auto"
                placeholder="Yazar adı"
                value={groupFormState.authorName}
                onChange={(e) =>
                  setGroupFormState((s) => ({
                    ...s,
                    authorName: e.target.value,
                  }))
                }
                className="px-2 py-1.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
              />
            </div>
            <input
              dir="auto"
              placeholder="Ana eser başlığı * (örn: et-Tahrir ve't-Tenvir)"
              value={groupFormState.title}
              onChange={(e) =>
                setGroupFormState((s) => ({ ...s, title: e.target.value }))
              }
              className="w-full px-2 py-1.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                dir="auto"
                placeholder="Yıl"
                value={groupFormState.year}
                onChange={(e) =>
                  setGroupFormState((s) => ({ ...s, year: e.target.value }))
                }
                className="px-2 py-1.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
              />
              <input
                dir="auto"
                placeholder="Yayınevi"
                value={groupFormState.publisher}
                onChange={(e) =>
                  setGroupFormState((s) => ({
                    ...s,
                    publisher: e.target.value,
                  }))
                }
                className="px-2 py-1.5 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
              />
            </div>

            <div>
              <div className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65] pt-1 pb-1">
                Hangi dosya hangi cilt?
              </div>
              <p className="font-body text-[11px] text-[#6b5a45] mb-2 leading-snug">
                Her dosya için cilt numarasını sen yaz — sıralı olmak
                zorunda değil. Örnek: elinde Cilt 5 ve Cilt 12 olabilir.
              </p>
              <ul className="space-y-1">
                {groupFormFileIds.map((fid) => {
                  const pf = fileById.get(fid);
                  if (!pf) return null;
                  return (
                    <li
                      key={fid}
                      className="flex items-center gap-2 px-2 py-1.5 rounded-sm bg-white border border-[#d4c9b5]/40"
                    >
                      <span className="font-ui text-[10px] uppercase tracking-wider text-[#8a7a65] shrink-0">
                        Cilt
                      </span>
                      <input
                        type="number"
                        min="1"
                        value={groupFormVolumes[fid] ?? ""}
                        onChange={(e) =>
                          setGroupFormVolumes((v) => ({
                            ...v,
                            [fid]: e.target.value,
                          }))
                        }
                        className="w-14 px-1.5 py-0.5 rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/60 font-body text-xs text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
                      />
                      <span
                        dir="auto"
                        className="font-body text-xs text-[#2D1F0E] flex-1 truncate"
                      >
                        {pf.file.name}
                      </span>
                      <input
                        dir="auto"
                        placeholder="etiket"
                        value={groupFormLabels[fid] ?? ""}
                        onChange={(e) =>
                          setGroupFormLabels((l) => ({
                            ...l,
                            [fid]: e.target.value,
                          }))
                        }
                        className="w-20 px-1.5 py-0.5 rounded-sm border border-[#d4c9b5]/60 bg-[#FAF7F0]/60 font-body text-[10px] text-[#2D1F0E] focus:outline-none focus:border-[#C9A84C]/60"
                      />
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setGroupFormOpen(false);
                  setEditingGroupId(null);
                }}
                className="px-3 py-1.5 rounded-sm border border-[#d4c9b5] font-ui text-xs text-[#5C4A32] hover:bg-[#FAF7F0]"
              >
                Vazgeç
              </button>
              <button
                type="button"
                onClick={commitGroupForm}
                className="px-3 py-1.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] font-ui text-xs hover:opacity-90"
              >
                {editingGroupId ? "Değişiklikleri kaydet" : "Grubu oluştur"}
              </button>
            </div>
          </div>
        ) : (
          /* ==================================================== */
          /* Main: file list + groups                              */
          /* ==================================================== */
          <>
            {/* Helper paragraph */}
            <p className="font-body text-xs text-[#6b5a45] leading-snug">
              Tek kitapları olduğu gibi yükle — birden fazla cilt aynı eserin
              parçasıysa <strong>seç + Grupla</strong> diyerek tek bir
              multi-volume kaynağa dönüştür.
            </p>

            {/* Toolbar: add files + grupla */}
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-[#d4c9b5] font-ui text-xs text-[#5C4A32] hover:bg-[#FAF7F0]"
              >
                <Plus className="h-3.5 w-3.5" />
                Dosya ekle
              </button>
              {ungroupedFiles.length > 0 && (
                <button
                  type="button"
                  onClick={openGroupFormForSelection}
                  disabled={selectedIds.size < 2}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-[#C9A84C] text-[#1A0F05] font-ui text-xs font-semibold hover:bg-[#d4b85a] disabled:opacity-40"
                >
                  <BookCopy className="h-3.5 w-3.5" />
                  Seçili {selectedIds.size > 0 ? `${selectedIds.size} ` : ""}dosyayı grupla
                </button>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.epub,.docx"
              multiple
              className="sr-only"
              onChange={(e) => {
                if (e.target.files) appendFiles(e.target.files);
                e.target.value = "";
              }}
            />

            {/* Existing groups + ungrouped */}
            <div className="space-y-2 max-h-[44vh] overflow-y-auto pr-1">
              {groups.map((g) => (
                <div
                  key={g.id}
                  className="rounded-sm border border-[#C9A84C]/40 bg-[#C9A84C]/8 p-2.5"
                >
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <div className="min-w-0 flex-1">
                      <div
                        dir="auto"
                        className="font-display text-sm font-semibold text-[#2D1F0E] truncate"
                      >
                        📚 {g.form.title || "(başlıksız)"}
                      </div>
                      <div
                        dir="auto"
                        className="font-ui text-[11px] text-[#6b5a45] truncate"
                      >
                        {g.form.authorSurname}
                        {g.form.authorName ? `, ${g.form.authorName}` : ""}
                        {g.form.year ? ` · ${g.form.year}` : ""}
                        {" · "}
                        {g.fileIds.length} cilt
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => openGroupFormForEdit(g)}
                        className="font-ui text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border border-[#d4c9b5] text-[#5C4A32] hover:bg-white"
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        onClick={() => dissolveGroup(g.id)}
                        className="font-ui text-[10px] uppercase tracking-wider px-2 py-1 rounded-sm border border-[#d4c9b5] text-[#5C4A32] hover:bg-white"
                      >
                        Grubu çöz
                      </button>
                    </div>
                  </div>

                  <ul className="space-y-1">
                    {g.fileIds.map((fid) => {
                      const pf = fileById.get(fid);
                      if (!pf) return null;
                      const volNum = g.volumeNumbers[fid] ?? "?";
                      return (
                        <li
                          key={fid}
                          className="flex items-center gap-2 px-2 py-1 rounded-sm bg-white border border-[#d4c9b5]/40"
                        >
                          <span className="font-display text-[11px] font-semibold text-[#2D1F0E] w-12 shrink-0">
                            Cilt {volNum}
                          </span>
                          <span
                            dir="auto"
                            className="font-body text-[11px] text-[#2D1F0E] flex-1 truncate"
                          >
                            {pf.file.name}
                          </span>
                          {g.labels[fid] && (
                            <span
                              dir="auto"
                              className="font-ui text-[10px] text-[#8a5a1a] italic"
                            >
                              {g.labels[fid]}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => removeFile(fid)}
                            className="text-[#a89a82] hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {ungroupedFiles.length > 0 && (
                <div className="rounded-sm border border-[#d4c9b5]/40 bg-white">
                  <div className="px-2.5 py-1.5 border-b border-[#d4c9b5]/40 flex items-center justify-between">
                    <span className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65]">
                      Tek kitap olarak yüklenecek ({ungroupedFiles.length})
                    </span>
                    {selectedIds.size > 0 && (
                      <span className="font-ui text-[10px] text-[#8a5a1a]">
                        {selectedIds.size} seçili — Grupla'ya basabilirsin
                      </span>
                    )}
                  </div>
                  <ul>
                    {ungroupedFiles.map((pf) => {
                      const isSelected = selectedIds.has(pf.id);
                      return (
                        <li
                          key={pf.id}
                          className="flex items-center gap-2 px-2.5 py-1.5 border-b border-[#d4c9b5]/30 last:border-0"
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(pf.id)}
                            className="h-3 w-3 accent-[#C9A84C]"
                          />
                          <span
                            dir="auto"
                            className="font-body text-xs text-[#2D1F0E] flex-1 truncate"
                          >
                            {pf.file.name}
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(pf.id)}
                            className="text-[#a89a82] hover:text-red-600"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {files.length === 0 && (
                <div className="rounded-sm border border-dashed border-[#d4c9b5] bg-[#FAF7F0]/40 px-4 py-8 text-center">
                  <p className="font-body text-sm text-[#8a7a65] mb-1">
                    Henüz dosya yok.
                  </p>
                  <p className="font-ui text-[11px] text-[#a89a82]">
                    Yukarıdaki <strong>Dosya ekle</strong>&apos;ye bas ya da
                    bu kutuyu kapatıp drop zone&apos;a sürükle.
                  </p>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#d4c9b5]/40 mt-2">
              <span className="font-body text-[11px] text-[#8a7a65]">
                Toplam:{" "}
                {ungroupedFiles.length +
                  groups.reduce((a, g) => a + g.fileIds.length, 0)}{" "}
                dosya
                {groups.length > 0 && ` · ${groups.length} multi-volume eser`}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => onOpenChange(false)}
                  disabled={submitting}
                  className="px-3 py-1.5 rounded-sm border border-[#d4c9b5] font-ui text-xs text-[#5C4A32] hover:bg-[#FAF7F0]"
                >
                  İptal
                </button>
                <button
                  type="button"
                  onClick={handleUpload}
                  disabled={submitting || files.length === 0}
                  className="px-3 py-1.5 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] font-ui text-xs hover:opacity-90 disabled:opacity-40 flex items-center gap-1.5"
                >
                  {submitting && <Loader2 className="h-3 w-3 animate-spin" />}
                  Yükle
                </button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
