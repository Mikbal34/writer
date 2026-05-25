'use client'

/**
 * Unified "Yeni kaynak ekle" modal — three ways to add a source:
 *
 *   1. ISBN / DOI   → GET /api/library/biblio-lookup  →  POST /api/library
 *   2. Manuel       → form                            →  POST /api/library
 *   3. Dosya        → POST /api/library/upload-pdf  (worker enrich runs)
 *
 * Implements the v13 design (dark olive hero, parchment body, gold
 * accents, Newsreader italic eyebrows). Existing Tailwind tokens
 * (--color-parchment / --color-ink / --color-gold / --color-forest)
 * already match the design tokens 1:1, so no new theme is needed.
 */

import { useMemo, useRef, useState } from 'react'
import {
  Plus, X, Sparkles, Upload, BookCopy, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { parseFilenameForMetadata } from '@/lib/filename-meta'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  onAdded?: (entryId: string) => void
}

export function AddSourceDialog({ open, onOpenChange, onAdded }: Props) {

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[1100px] w-[92vw] max-h-[92vh] p-0 gap-0 overflow-hidden border-0 bg-parchment"
      >
        {/* Dark olive hero header */}
        <div
          className="px-6 pt-5 text-gold-soft relative overflow-hidden"
          style={{ background: 'linear-gradient(135deg, #2a3d28 0%, #1a2818 100%)' }}
        >
          {/* Watermark */}
          <div
            className="absolute -top-2 right-5 opacity-[0.14] font-serif italic leading-none pointer-events-none select-none"
            style={{ fontSize: 110, color: 'var(--color-gold-soft)' }}
          >+</div>

          <div className="flex items-start gap-3">
            <div className="flex-1">
              <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-gold-soft/65 mb-1">
                <Plus size={11} /> Kütüphaneye ekle
              </div>
              <h2 className="font-serif italic text-2xl font-medium text-white leading-tight m-0">
                Yeni kaynak ekle
              </h2>
            </div>
            <button
              onClick={() => onOpenChange(false)}
              className="w-[30px] h-[30px] rounded-full bg-white/12 border-0 text-gold-soft flex items-center justify-center hover:bg-white/20 transition"
              aria-label="Kapat"
            >
              <X size={15} />
            </button>
          </div>

        </div>

        {/* Body */}
        <div className="flex-1 px-6 pt-[22px] pb-1 max-h-[65vh] overflow-auto">
          <FileTab onClose={() => onOpenChange(false)} onAdded={onAdded} />
        </div>
      </DialogContent>
    </Dialog>
  )
}


// ── shared bits ───────────────────────────────────────────────────────
function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10.5px] tracking-[0.14em] uppercase font-semibold text-forest mb-2 flex items-center gap-2">
      {children}
      <span className="flex-1 h-px bg-forest/20" />
    </div>
  )
}

function FooterBar({
  hint, primary, primaryLabel, onCancel, loading,
}: {
  hint: string; primary: () => void; primaryLabel: string;
  onCancel: () => void; loading?: boolean
}) {
  return (
    <div className="flex items-center gap-2.5 px-6 py-3.5 border-t border-ink-muted/15 bg-parchment-dark/30 -mx-6 mt-5">
      <span className="text-[11.5px] text-ink-muted inline-flex items-center gap-1.5">
        <Sparkles size={11} className="text-gold" />
        {hint}
      </span>
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={onCancel}>İptal</Button>
      <Button size="sm" onClick={primary} disabled={loading} className="bg-forest hover:bg-forest/90 text-white">
        {loading ? <Loader2 className="animate-spin" size={13} /> : <Plus size={13} />}
        {primaryLabel}
      </Button>
    </div>
  )
}

// ═══════════════════════════ TAB 1 — ISBN / DOI ═══════════════════════

function Chip({ children, variant }: { children: React.ReactNode; variant?: 'olive' }) {
  const base = 'inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded'
  if (variant === 'olive') return <span className={`${base} bg-forest/15 text-forest`}>{children}</span>
  return <span className={`${base} bg-ink/8 text-ink-light`}>{children}</span>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] text-ink-light font-medium">
        {label} {required && <span className="text-[#c14a3a]">*</span>}
      </span>
      {children}
    </label>
  )
}

function Divider() {
  return <div className="h-px bg-ink-muted/15 my-[18px]" />
}

// ═══════════════════════════ TAB 3 — DOSYA (with cilt-gruplama) ═══════
// Standalone uploads AND multi-volume grouping in one tab. Tick 2+
// files → "Grupla" → fill parent metadata + per-file cilt number →
// the group lands on a list. "Yükle ve ekle" fires standalone
// uploads (POST /upload-pdf) and group uploads (parent POST /library
// + N × POST /[id]/volumes) in parallel.
type EntryType = 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'
type FileMeta = {
  entryType: EntryType
  authorSurname: string
  authorName: string
  title: string
  shortTitle: string
  editor: string
  translator: string
  publisher: string
  publishPlace: string
  year: string
  volume: string
  edition: string
  journalName: string
  journalVolume: string
  journalIssue: string
  pageRange: string
  doi: string
  url: string
}
const emptyFileMeta = (): FileMeta => ({
  entryType: 'kitap',
  authorSurname: '', authorName: '', title: '', shortTitle: '',
  editor: '', translator: '',
  publisher: '', publishPlace: '', year: '',
  volume: '', edition: '',
  journalName: '', journalVolume: '', journalIssue: '', pageRange: '',
  doi: '', url: '',
})

const ENTRY_TYPE_OPTIONS: { value: EntryType; label: string }[] = [
  { value: 'kitap', label: 'Kitap' },
  { value: 'makale', label: 'Makale' },
  { value: 'nesir', label: 'Nesir / Klasik Metin' },
  { value: 'ceviri', label: 'Çeviri' },
  { value: 'tez', label: 'Tez' },
  { value: 'ansiklopedi', label: 'Ansiklopedi Maddesi' },
  { value: 'web', label: 'Web Kaynağı' },
]

const FILE_META_FIELDS: (keyof FileMeta)[] = [
  'authorSurname', 'authorName', 'title', 'shortTitle', 'editor', 'translator',
  'publisher', 'publishPlace', 'year', 'volume', 'edition',
  'journalName', 'journalVolume', 'journalIssue', 'pageRange', 'doi', 'url',
]

/** Strip empty strings → undefined; pass entryType through always. */
function metaToPayload(m: FileMeta): Record<string, string> {
  const out: Record<string, string> = { entryType: m.entryType }
  for (const k of FILE_META_FIELDS) {
    const v = m[k]?.trim()
    if (v) out[k] = v
  }
  return out
}

/** Same payload + importSource for the /api/library POST (manual entry). */
function formToPayload(m: FileMeta, importSource: string): Record<string, string> {
  return { ...metaToPayload(m), importSource }
}
type PendingFile = { id: string; file: File; meta: FileMeta }
type Group = {
  id: string
  form: { authorSurname: string; authorName: string; title: string; year: string; publisher: string }
  fileIds: string[]
  volumeNumbers: Record<string, string>
  labels: Record<string, string>
}
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
const emptyGroupForm = () => ({ authorSurname: '', authorName: '', title: '', year: '', publisher: '' })

function FileTab({ onClose, onAdded }: { onClose: () => void; onAdded?: (id: string) => void }) {
  const [files, setFiles] = useState<PendingFile[]>([])
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groups, setGroups] = useState<Group[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // REQUIRED inline metadata — the worker no longer auto-enriches, so
  // every upload must carry author surname + title at submit time. For
  // single-file uploads the form below is the source. For multi-file
  // uploads we auto-derive per-file metadata from the filename (no LLM)
  // and the user reviews via the library edit dialog afterward.
  const [form, setForm] = useState<FileMeta>(emptyFileMeta())

  // Group-form overlay state.
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [gForm, setGForm] = useState(emptyGroupForm())
  const [gFileIds, setGFileIds] = useState<string[]>([])
  const [gVolumes, setGVolumes] = useState<Record<string, string>>({})
  const [gLabels, setGLabels] = useState<Record<string, string>>({})

  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const ungrouped = useMemo(() => {
    const taken = new Set<string>()
    for (const g of groups) for (const fid of g.fileIds) taken.add(fid)
    return files.filter((f) => !taken.has(f.id))
  }, [files, groups])

  const addFiles = (incoming: FileList | File[]) => {
    const fresh: PendingFile[] = Array.from(incoming)
      .filter((f) => /\.(pdf|epub|docx)$/i.test(f.name) && f.size > 0 && f.size <= 150 * 1024 * 1024)
      .map((file) => {
        // Each file gets its own metadata pre-filled from its filename.
        // Deterministic — user reviews/edits inline before submit.
        const hint = parseFilenameForMetadata(file.name)
        return {
          id: newId(),
          file,
          meta: {
            ...emptyFileMeta(),
            authorSurname: hint.authorSurname ?? '',
            title: hint.title ?? '',
            year: hint.year ?? '',
          },
        }
      })
    if (fresh.length === 0) return
    setFiles((prev) => {
      const next = [...prev, ...fresh]
      // Mirror the first file's metadata into the shared form when we
      // go from 0 → 1 (so the user sees the form filled in even before
      // they expand the inline row).
      if (next.length === 1 && prev.length === 0) {
        const m = fresh[0].meta
        setForm((s) => ({
          ...s,
          authorSurname: s.authorSurname || m.authorSurname,
          title: s.title || m.title,
          year: s.year || m.year,
        }))
      }
      return next
    })
  }

  const removeFile = (id: string) => {
    setFiles((p) => p.filter((f) => f.id !== id))
    setSelectedIds((p) => { const n = new Set(p); n.delete(id); return n })
    setGroups((p) => p.map((g) => ({ ...g, fileIds: g.fileIds.filter((fid) => fid !== id) }))
      .filter((g) => g.fileIds.length > 0))
  }

  const toggleSelect = (id: string) => setSelectedIds((p) => {
    const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const openGroupForSelection = () => {
    const ids = ungrouped.filter((f) => selectedIds.has(f.id)).map((f) => f.id)
    if (ids.length < 2) { toast.error('Grup için en az 2 dosya seç'); return }
    setEditingGroupId(null)
    // Pre-fill the group's parent metadata from either the main form
    // (if user filled it) OR the first selected file's filename hint.
    // Deterministic — no LLM.
    const firstFile = files.find((f) => f.id === ids[0])
    const hint = firstFile ? parseFilenameForMetadata(firstFile.file.name) : null
    setGForm({
      authorSurname: form.authorSurname || hint?.authorSurname || '',
      authorName: form.authorName || '',
      title: form.title || hint?.title || '',
      year: form.year || hint?.year || '',
      publisher: form.publisher || '',
    })
    setGFileIds(ids)
    // Pre-fill each cilt's volumeNumber from the filename's _c\d+ marker
    // when present; otherwise sequentially 1, 2, 3...
    const vols: Record<string, string> = {}
    ids.forEach((fid, idx) => {
      const f = files.find((x) => x.id === fid)
      const fh = f ? parseFilenameForMetadata(f.file.name) : null
      vols[fid] = String(fh?.volumeNumber ?? idx + 1)
    })
    setGVolumes(vols); setGLabels({}); setGroupFormOpen(true)
  }

  const openGroupForEdit = (g: Group) => {
    setEditingGroupId(g.id)
    setGForm({ ...g.form }); setGFileIds([...g.fileIds])
    setGVolumes({ ...g.volumeNumbers }); setGLabels({ ...g.labels })
    setGroupFormOpen(true)
  }

  const commitGroup = () => {
    // Çok-ciltli eserin parent künyesi de zorunlu — yazar soyadı + başlık.
    if (!gForm.authorSurname.trim() || !gForm.title.trim()) {
      toast.error('Çok-ciltli eser için yazar soyadı + başlık zorunlu')
      return
    }
    const seen = new Set<number>()
    for (const fid of gFileIds) {
      const n = parseInt(gVolumes[fid] ?? '', 10)
      if (!Number.isFinite(n) || n < 1) { toast.error(`Cilt numarası geçersiz`); return }
      if (seen.has(n)) { toast.error(`Cilt ${n} iki kez kullanıldı`); return }
      seen.add(n)
    }
    if (editingGroupId) {
      setGroups((p) => p.map((g) => g.id === editingGroupId
        ? { ...g, form: { ...gForm }, fileIds: [...gFileIds], volumeNumbers: { ...gVolumes }, labels: { ...gLabels } }
        : g))
    } else {
      setGroups((p) => [...p, { id: newId(), form: { ...gForm }, fileIds: [...gFileIds], volumeNumbers: { ...gVolumes }, labels: { ...gLabels } }])
      setSelectedIds((p) => { const n = new Set(p); for (const fid of gFileIds) n.delete(fid); return n })
    }
    setGroupFormOpen(false); setEditingGroupId(null)
    setGForm(emptyGroupForm()); setGFileIds([]); setGVolumes({}); setGLabels({})
  }

  // What does the CTA do, given current state?
  //   - 0 files + form (author+title) → "Künye kaydet" (no-PDF entry)
  //   - 0 files + 0 form              → disabled
  //   - 1 standalone file              → upload with form values (or auto)
  //   - 2+ standalone files            → upload each; form values shared
  //                                      across them isn't meaningful, so
  //                                      we skip form fields entirely
  //   - 1+ groups (± standalone)       → group parents use group's own
  //                                      form, standalone files auto
  const hasFormMin = form.authorSurname.trim() && form.title.trim()
  const standaloneCount = ungrouped.length
  const useFormForStandalone = standaloneCount === 1  // form applies only when exactly one standalone file
  const showFormSection = files.length <= 1 && groups.length === 0  // hide once we're in bulk territory
  // Künye form is REQUIRED for: pure-manual (no file), and single-file
  // upload. Multi-file uploads derive per-file metadata from filenames
  // (parseFilenameForMetadata) — the user reviews via library edit
  // dialog afterward. Group form has its own required-field guard.
  const formRequired = (files.length === 0 || (files.length === 1 && groups.length === 0))

  const handleUpload = async () => {
    if (groupFormOpen) { toast.error('Önce grubu kaydet veya iptal et'); return }

    // Künye zorunluluğu:
    //   - 0 dosya (pure manual): üstteki form zorunlu
    //   - 1 dosya: üstteki form zorunlu
    //   - 2+ dosya / gruplar var: her dosyanın inline künyesi zorunlu
    if (formRequired && !hasFormMin) {
      toast.error('Yazar soyadı ve başlık zorunlu')
      return
    }
    if (!formRequired && ungrouped.length > 0) {
      const missing = ungrouped.filter((pf) =>
        !pf.meta.authorSurname.trim() || !pf.meta.title.trim()
      )
      if (missing.length > 0) {
        toast.error(`${missing.length} dosyada yazar/başlık eksik — "Künye" ile aç ve doldur`)
        return
      }
    }

    // No files at all → pure metadata entry (the old Manuel use case).
    if (files.length === 0) {
      setUploading(true)
      try {
        const res = await fetch('/api/library', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formToPayload(form, 'manual')),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const entry = await res.json()
        toast.success('Kütüphaneye eklendi')
        onAdded?.(entry.id)
        onClose()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Kaydedilemedi')
      } finally { setUploading(false) }
      return
    }

    // Optimistic close: kick off uploads in the background and let the
    // user get on with their day. Toasts report each file's result;
    // the library page polls the in-flight feed so entries appear in
    // real-time as they finish. Big PDF batches (5 × 30 MB) previously
    // froze the dialog for 2-3 min, which felt broken.
    const totalFiles = files.length
    toast.success(`${totalFiles} dosya yüklemeye başlandı — kütüphanede ilerlemeyi görebilirsin`)
    onClose()
    const errors: string[] = []

    const standalonePromises = ungrouped.map(async (pf) => {
      // 2-step direct-to-R2 upload — file bytes never touch our server,
      // so neither RAM nor request-body limits apply. See
      // /api/library/presign-upload + /api/library/confirm-upload.
      // Single-file → shared form (REQUIRED — gated above).
      // Multi-file → per-file inline editor (also pre-validated above).
      const source: FileMeta = useFormForStandalone ? form : pf.meta
      const meta = metaToPayload(source)

      // Step 1: get signed upload URL
      const presignRes = await fetch('/api/library/presign-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: pf.file.name, size: pf.file.size, ...meta }),
      })
      if (!presignRes.ok) throw new Error(`${pf.file.name}: presign ${presignRes.status}`)
      const { entryId, uploadUrl, contentType } = await presignRes.json() as {
        entryId: string; uploadUrl: string; contentType: string
      }

      // Step 2: PUT bytes directly to R2 (with progress via XHR so big
      // files don't look frozen — fetch lacks upload progress events)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('PUT', uploadUrl)
        // Content-Type intentionally not set — browser sends the file's
        // detected type but R2 ignores it (we removed it from the signed
        // URL). Avoids signature mismatch when browser appends charset.
        xhr.upload.onprogress = (evt) => {
          if (evt.lengthComputable && evt.loaded === evt.total) {
            // (optional UI hook for per-file progress later)
          }
        }
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve()
          else reject(new Error(`R2 upload ${xhr.status}`))
        }
        xhr.onerror = () => reject(new Error('network error during R2 upload'))
        xhr.send(pf.file)
      })

      // Step 3: compute SHA-256 client-side for server-side dedup check
      const buf = await pf.file.arrayBuffer()
      const hashBytes = await crypto.subtle.digest('SHA-256', buf)
      const fileHash = Array.from(new Uint8Array(hashBytes))
        .map((b) => b.toString(16).padStart(2, '0')).join('')

      // Step 4: confirm with server (dedup + enqueue)
      const confirmRes = await fetch('/api/library/confirm-upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, fileHash }),
      })
      if (confirmRes.status === 409) {
        const body = await confirmRes.json().catch(() => ({})) as {
          existingId?: string; existingTitle?: string; existingAuthor?: string
        }
        toast.info(
          `${pf.file.name} zaten kütüphanende`,
          { description: body.existingTitle ? `${body.existingAuthor ?? ''} — ${body.existingTitle}` : undefined },
        )
        if (body.existingId) onAdded?.(body.existingId)
        return
      }
      if (!confirmRes.ok) throw new Error(`${pf.file.name}: confirm ${confirmRes.status}`)
      onAdded?.(entryId)
    })

    const groupPromises = groups.map(async (g) => {
      // Parent entry — group's own form fields. commitGroup gates
      // author/title as required so these are always populated by
      // the time we get here (no more placeholders / worker enrich).
      const parentRes = await fetch('/api/library', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorSurname: g.form.authorSurname.trim(),
          authorName: g.form.authorName.trim() || undefined,
          title: g.form.title.trim(),
          year: g.form.year.trim() || undefined,
          publisher: g.form.publisher.trim() || undefined,
          importSource: 'multi-volume',
        }),
      })
      if (!parentRes.ok) throw new Error(`Ana eser oluşturulamadı: ${parentRes.status}`)
      const parent = await parentRes.json() as { id: string }
      onAdded?.(parent.id)
      await Promise.all(g.fileIds.map(async (fid) => {
        const pf = fileById.get(fid); if (!pf) return
        const volNumber = parseInt(g.volumeNumbers[fid] ?? '1', 10)
        const label = g.labels[fid]?.trim()

        // Step 1: presign — creates volume row + returns signed URL
        const presignRes = await fetch(`/api/library/${parent.id}/presign-volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            filename: pf.file.name,
            size: pf.file.size,
            volumeNumber: volNumber,
            label,
          }),
        })
        if (!presignRes.ok) {
          throw new Error(`${pf.file.name} (cilt ${volNumber}): presign ${presignRes.status}`)
        }
        const { volumeId, uploadUrl, contentType } = await presignRes.json() as {
          volumeId: string; uploadUrl: string; contentType: string
        }

        // Step 2: PUT bytes directly to R2 (XHR for progress events)
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open('PUT', uploadUrl)
          xhr.setRequestHeader('Content-Type', contentType)
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve()
            else reject(new Error(`R2 ${xhr.status}`))
          }
          xhr.onerror = () => reject(new Error('network error during R2 upload'))
          xhr.send(pf.file)
        })

        // Step 3: confirm with server (enqueue worker)
        const confirmRes = await fetch(`/api/library/${parent.id}/confirm-volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ volumeId }),
        })
        if (!confirmRes.ok) {
          throw new Error(`${pf.file.name} (cilt ${volNumber}): confirm ${confirmRes.status}`)
        }
      }))
    })

    // Fire-and-forget — dialog already closed. We still wait so we
    // can surface per-file failures as toasts after the fact.
    const results = await Promise.allSettled([...standalonePromises, ...groupPromises])
    for (const r of results) if (r.status === 'rejected')
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    const successCount = totalFiles - errors.length
    if (errors.length === 0) {
      // Already toasted "X dosya başladı" at the top — quiet success.
      return
    }
    toast.error(
      `${successCount}/${totalFiles} yüklendi — ${errors.length} hata`,
      {
        description: errors.join('\n'),
        duration: 30000,
      },
    )
  }

  if (groupFormOpen) return (
    <GroupForm
      form={gForm} setForm={setGForm}
      fileIds={gFileIds} fileById={fileById}
      volumes={gVolumes} setVolumes={setGVolumes}
      labels={gLabels} setLabels={setGLabels}
      onCancel={() => setGroupFormOpen(false)}
      onCommit={commitGroup}
      editing={!!editingGroupId}
    />
  )

  const selectedCount = ungrouped.filter((f) => selectedIds.has(f.id)).length

  return (
    <div>
      {/* Banner — the deal */}
      <div className="mb-3 px-3 py-2 rounded-lg bg-gold-soft/20 border border-gold/30 text-[12px] text-ink-light flex items-start gap-2.5">
        <Sparkles size={14} className="text-gold-dark flex-shrink-0 mt-0.5" />
        <div>
          <span className="font-semibold text-ink">Yazar/başlık doldurursan canonical.</span>{' '}
          Boş bırakırsan dosya işlenirken otomatik dolar (~1-2 dk). Sadece künye eklemek için aşağıdaki formu doldurup gönderebilirsin (dosya gerek yok).
        </div>
      </div>

      {/* Dropzone — shrinks once files are added so the file list dominates */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files) }}
        onClick={() => inputRef.current?.click()}
        className={[
          'rounded-[12px] text-center cursor-pointer transition border-2 border-dashed',
          files.length === 0 ? 'py-[34px] px-6' : 'py-3.5 px-4',
          dragging ? 'border-forest bg-forest/5' : 'border-ink-muted/30',
        ].join(' ')}
        style={dragging || files.length > 0 ? undefined : {
          background: 'repeating-linear-gradient(135deg, var(--color-parchment-dark) 0px, var(--color-parchment-dark) 12px, var(--color-parchment) 12px, var(--color-parchment) 24px)',
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.epub,.docx" className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)} />
        {files.length === 0 ? (
          <>
            <div className="w-[52px] h-[52px] mx-auto mb-2.5 rounded-full bg-forest/15 flex items-center justify-center">
              <Upload size={22} className="text-forest" />
            </div>
            <div className="font-serif italic text-[18px] font-semibold" style={{ color: 'oklch(0.31 0.040 145)' }}>
              Dosyayı buraya bırak
            </div>
            <div className="mt-1 text-[12.5px] text-ink-light">
              veya <span className="text-forest underline font-semibold">bilgisayardan seç</span>
            </div>
            <div className="mt-3 flex gap-1.5 justify-center flex-wrap">
              {['PDF', 'EPUB', 'DOCX'].map((f) => <Chip key={f}>{f}</Chip>)}
            </div>
            <div className="mt-2.5 text-[11px] text-ink-muted">
              maks. 150 MB · birden fazla dosya · çoklu seçip "Grupla" ile cilt yapabilirsin
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center gap-2 text-[12px] text-ink-light">
            <Upload size={14} className="text-forest" />
            Başka dosya eklemek için <span className="text-forest underline font-semibold">tıkla veya sürükle</span>
          </div>
        )}
      </div>

      {/* Action bar — appears when 2+ ungrouped selected */}
      {selectedCount >= 2 && (
        <div className="mt-3 flex items-center gap-2 px-3 py-2 bg-forest/10 border border-forest/30 rounded-lg text-[12px]">
          <BookCopy size={14} className="text-forest" />
          <span className="flex-1 text-forest font-semibold">
            {selectedCount} dosya seçili — çok ciltli bir esere ait mi?
          </span>
          <Button size="sm" onClick={openGroupForSelection}
            className="bg-forest hover:bg-forest/90 text-white h-7 px-2.5 text-[11.5px]">
            <BookCopy size={11} /> Grupla
          </Button>
        </div>
      )}

      {/* Groups list */}
      {groups.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Cilt grupları</Eyebrow>
          {groups.map((g) => (
            <div key={g.id} className="flex items-center gap-3 px-3 py-2.5 bg-forest/8 border border-forest/25 rounded-lg mb-1.5">
              <BookCopy size={16} className="text-forest flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">{g.form.title || '(başlıksız)'}</div>
                <div className="text-[11px] text-ink-muted mt-0.5">
                  {g.form.authorSurname || '?'} {g.form.year ? `· ${g.form.year}` : ''} · {g.fileIds.length} cilt
                </div>
              </div>
              <button onClick={() => openGroupForEdit(g)} className="text-[11px] text-forest underline px-2">Düzenle</button>
              <button onClick={() => setGroups((p) => p.filter((x) => x.id !== g.id))}
                className="p-1 text-ink-muted hover:text-ink"><X size={12} /></button>
            </div>
          ))}
        </div>
      )}

      {/* Ungrouped files with checkboxes */}
      {ungrouped.length > 0 && (
        <div className="mt-4">
          <Eyebrow>{groups.length > 0 ? 'Tek başına yüklenecek' : 'Dosyalar'}</Eyebrow>
          {ungrouped.map((pf) => (
            <FileRow
              key={pf.id}
              pf={pf}
              selected={selectedIds.has(pf.id)}
              onToggle={() => toggleSelect(pf.id)}
              onRemove={() => removeFile(pf.id)}
              onMetaChange={(next) => setFiles((p) => p.map((f) => f.id === pf.id ? { ...f, meta: { ...f.meta, ...next } } : f))}
              showMetaEditor={files.length > 1 || groups.length > 0}
            />
          ))}
        </div>
      )}

      {/* Single-file (and 0-file manual) shared form. Multi-file uses
          the per-row inline form on each FileRow. */}
      {showFormSection && (
        <div className="mt-4">
          <Eyebrow>
            {files.length === 0 ? 'Künye (PDF eklemeden kaydet)' : 'Künye'}
            {formRequired && <span className="text-red-600 ml-1">*</span>}
          </Eyebrow>

          <FullKunyeForm value={form} onChange={setForm} required={formRequired} />
        </div>
      )}

      {!showFormSection && files.length > 1 && groups.length === 0 && (
        <div className="mt-3 text-[11.5px] text-ink-muted italic">
          Çoklu dosya — her dosyanın yanındaki <strong>Künye</strong> butonuna basıp
          yazar/başlık/yıl bilgisini gözden geçir. Dosya adından
          (örn. <code className="font-mono not-italic">EN_Donner_MuhammadAndBelievers.pdf</code>)
          ön doldurma yapıldı; eksikleri tamamla.
        </div>
      )}

      <FooterBar
        hint={
          files.length === 0
            ? (hasFormMin ? 'Sadece künye eklenecek (PDF yok)' : 'Yazar + başlık doldur veya dosya seç')
            : formRequired && !hasFormMin
              ? 'Yazar soyadı + başlık zorunlu'
              : `${ungrouped.length} tek · ${groups.length} grup`
        }
        primary={handleUpload}
        primaryLabel={
          uploading ? 'Yükleniyor…'
          : files.length === 0 ? 'Künye kaydet'
          : 'Yükle ve ekle'
        }
        onCancel={onClose}
        loading={uploading || (formRequired && !hasFormMin)}
      />
    </div>
  )
}

// File-size heuristic for the upload-time estimate. We can't run pdfjs
// here without parsing the file — but bytes/page ratio is a strong
// signal in the real corpus: native-text PDFs run ~0.05-0.3 MB/page,
// scanned image-only books run 1-3+ MB/page. With just total size:
//   <2 MB     → almost always native text (single article or small book)
//   2-10 MB   → text or thin scan
//   10-25 MB  → likely scan
//   >25 MB    → definitely scanned book; OCR will dominate the wait
function estimateProcessing(file: File): { label: string; suspect: boolean } {
  const mb = file.size / 1024 / 1024
  if (mb < 2) return { label: '~30 sn', suspect: false }
  if (mb < 10) return { label: '~1-2 dk', suspect: false }
  if (mb < 25) return { label: '~5-15 dk · taranmış olabilir', suspect: true }
  return { label: '~15-30 dk · taranmış kitap', suspect: true }
}

function FileRow({ pf, selected, onToggle, onRemove, onMetaChange, showMetaEditor }: {
  pf: PendingFile
  selected: boolean
  onToggle: () => void
  onRemove: () => void
  onMetaChange: (next: Partial<FileMeta>) => void
  showMetaEditor: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const sizeMB = (pf.file.size / 1024 / 1024).toFixed(1)
  const ext = pf.file.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'
  const est = estimateProcessing(pf.file)
  const hasMin = pf.meta.authorSurname.trim() && pf.meta.title.trim()
  return (
    <div className={[
      'rounded-lg mb-1.5 border transition overflow-hidden',
      selected ? 'bg-forest/8 border-forest/40' : 'bg-parchment-dark/40 border-ink-muted/15',
    ].join(' ')}>
      <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
        <input type="checkbox" checked={selected} onChange={onToggle}
          className="w-4 h-4 accent-forest cursor-pointer" />
        <div className="w-8 h-10 rounded-sm flex items-end justify-center pb-1 text-white text-[9px] font-bold tracking-wider flex-shrink-0"
          style={{ background: '#8a6a3d' }}>{ext}</div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-ink truncate">{pf.file.name}</div>
          <div className="text-[11px] text-ink-muted mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{sizeMB} MB</span>
            <span className="text-ink-muted/60">·</span>
            <span className={est.suspect ? 'text-gold-dark font-medium' : 'text-ink-muted'}>
              {est.label}
            </span>
            {showMetaEditor && (
              <>
                <span className="text-ink-muted/60">·</span>
                {hasMin ? (
                  <span className="text-forest font-medium">
                    {pf.meta.authorSurname} — {pf.meta.title.slice(0, 30)}{pf.meta.title.length > 30 ? '…' : ''}
                  </span>
                ) : (
                  <span className="text-red-600">künye eksik</span>
                )}
              </>
            )}
          </div>
        </div>
        {showMetaEditor && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); setExpanded((v) => !v) }}
            className="text-[11px] px-2 py-1 rounded border border-ink-muted/30 hover:bg-forest/10"
          >
            {expanded ? 'Kapat' : 'Künye'}
          </button>
        )}
        <button onClick={(e) => { e.preventDefault(); onRemove() }}
          className="p-1 text-ink-muted hover:text-ink" aria-label="Çıkar"><X size={12} /></button>
      </label>

      {showMetaEditor && expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-ink-muted/15 bg-parchment/60">
          <FullKunyeForm
            value={pf.meta}
            onChange={(next) => onMetaChange(typeof next === 'function' ? next(pf.meta) : next)}
            required
            compact
          />
        </div>
      )}
    </div>
  )
}

/** Full bibliographic form with sections (Yazarlar / Başlık / Yayın /
 *  Cilt-Baskı / Dergi / Bağlantı). Used by both the single-file shared
 *  form AND the per-file inline editor; compact mode tightens spacing
 *  for the inline case. */
function FullKunyeForm({
  value, onChange, required, compact,
}: {
  value: FileMeta
  onChange: (next: FileMeta | ((prev: FileMeta) => FileMeta)) => void
  required?: boolean
  compact?: boolean
}) {
  const set = <K extends keyof FileMeta>(k: K, v: FileMeta[K]) => {
    if (typeof onChange === 'function') {
      onChange((prev) => ({ ...prev, [k]: v }))
    }
  }
  const gap = compact ? 'gap-2' : 'gap-3'
  const space = compact ? 'h-2' : 'h-3'
  const isArticle = value.entryType === 'makale' || value.entryType === 'ansiklopedi'

  return (
    <>
      {/* Tür + tam başlık */}
      <div className={`grid grid-cols-[180px_1fr] ${gap}`}>
        <Field label="Tür">
          <Select value={value.entryType} onValueChange={(v) => set('entryType', v as EntryType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {ENTRY_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Başlık" required={required}>
          <Input value={value.title} onChange={(e) => set('title', e.target.value)} placeholder="Eserin tam başlığı" />
        </Field>
      </div>

      <div className={space} />

      {/* Yazar / Editör / Mütercim */}
      <div className={`grid grid-cols-2 ${gap}`}>
        <Field label="Yazar soyadı" required={required}>
          <Input value={value.authorSurname} onChange={(e) => set('authorSurname', e.target.value)} placeholder="örn. Wolfson" />
        </Field>
        <Field label="Yazar adı">
          <Input value={value.authorName} onChange={(e) => set('authorName', e.target.value)} placeholder="örn. Harry Austryn" />
        </Field>
      </div>
      <div className={space} />
      <div className={`grid grid-cols-3 ${gap}`}>
        <Field label="Editör / Tahkik">
          <Input value={value.editor} onChange={(e) => set('editor', e.target.value)} placeholder="" />
        </Field>
        <Field label="Mütercim">
          <Input value={value.translator} onChange={(e) => set('translator', e.target.value)} />
        </Field>
        <Field label="Kısa başlık">
          <Input value={value.shortTitle} onChange={(e) => set('shortTitle', e.target.value)} placeholder="atıflarda" />
        </Field>
      </div>

      <div className={space} />

      {/* Yayın */}
      <div className={`grid grid-cols-3 ${gap}`}>
        <Field label="Yayıncı">
          <Input value={value.publisher} onChange={(e) => set('publisher', e.target.value)} />
        </Field>
        <Field label="Yer">
          <Input value={value.publishPlace} onChange={(e) => set('publishPlace', e.target.value)} />
        </Field>
        <Field label="Yıl">
          <Input value={value.year} onChange={(e) => set('year', e.target.value)} placeholder="1976" className="font-mono" />
        </Field>
      </div>

      <div className={space} />

      {/* Cilt + Baskı */}
      <div className={`grid grid-cols-2 ${gap}`}>
        <Field label="Cilt (parent olmayan eserlerde)">
          <Input value={value.volume} onChange={(e) => set('volume', e.target.value)} placeholder="örn. 3" />
        </Field>
        <Field label="Baskı">
          <Input value={value.edition} onChange={(e) => set('edition', e.target.value)} placeholder="örn. 2. baskı" />
        </Field>
      </div>

      {/* Makale/ansiklopedi alanları (sadece ilgili türlerde) */}
      {isArticle && (
        <>
          <div className={space} />
          <div className={`grid grid-cols-2 ${gap}`}>
            <Field label="Dergi / Ansiklopedi adı">
              <Input value={value.journalName} onChange={(e) => set('journalName', e.target.value)} />
            </Field>
            <Field label="Sayfa aralığı">
              <Input value={value.pageRange} onChange={(e) => set('pageRange', e.target.value)} placeholder="125-148" />
            </Field>
          </div>
          <div className={space} />
          <div className={`grid grid-cols-2 ${gap}`}>
            <Field label="Cilt (dergi)">
              <Input value={value.journalVolume} onChange={(e) => set('journalVolume', e.target.value)} />
            </Field>
            <Field label="Sayı">
              <Input value={value.journalIssue} onChange={(e) => set('journalIssue', e.target.value)} />
            </Field>
          </div>
        </>
      )}

      <div className={space} />

      {/* DOI / URL — referans olarak, otomatik lookup yok */}
      <div className={`grid grid-cols-2 ${gap}`}>
        <Field label="DOI">
          <Input value={value.doi} onChange={(e) => set('doi', e.target.value)} placeholder="10.1234/..." className="font-mono text-[12px]" />
        </Field>
        <Field label="URL">
          <Input value={value.url} onChange={(e) => set('url', e.target.value)} placeholder="https://..." className="font-mono text-[12px]" />
        </Field>
      </div>
    </>
  )
}

// In-tab overlay for editing a cilt group's parent metadata + per-file volume numbers.
function GroupForm({
  form, setForm, fileIds, fileById, volumes, setVolumes, labels, setLabels,
  onCancel, onCommit, editing,
}: {
  form: Group['form']
  setForm: React.Dispatch<React.SetStateAction<Group['form']>>
  fileIds: string[]; fileById: Map<string, PendingFile>
  volumes: Record<string, string>
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  labels: Record<string, string>
  setLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onCancel: () => void; onCommit: () => void; editing: boolean
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[12px] text-ink-light mb-3">
        <button onClick={onCancel} className="inline-flex items-center gap-1 text-forest underline">
          <X size={12} /> Geri
        </button>
        <span className="text-ink-muted">·</span>
        <span className="font-serif italic">{editing ? 'Cilt grubunu düzenle' : 'Yeni cilt grubu'}</span>
      </div>

      <div className="mb-3 px-3 py-2 rounded-lg bg-gold-soft/20 border border-gold/30 text-[12px] text-ink-light flex items-start gap-2.5">
        <Sparkles size={14} className="text-gold-dark flex-shrink-0 mt-0.5" />
        <div>
          Ana eserin künyesini doldurursan canonical; boş bırakırsan ilk cilt işlenirken worker otomatik dolduracak.
        </div>
      </div>

      <Eyebrow>Ana eserin künyesi (opsiyonel)</Eyebrow>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Yazar soyadı">
          <Input value={form.authorSurname} onChange={(e) => setForm((s) => ({ ...s, authorSurname: e.target.value }))} />
        </Field>
        <Field label="Yazar adı">
          <Input value={form.authorName} onChange={(e) => setForm((s) => ({ ...s, authorName: e.target.value }))} />
        </Field>
      </div>
      <div className="h-3" />
      <Field label="Eser başlığı">
        <Input value={form.title} onChange={(e) => setForm((s) => ({ ...s, title: e.target.value }))} placeholder="örn. et-Tahrir ve't-Tenvir" />
      </Field>
      <div className="h-3" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Yayıncı">
          <Input value={form.publisher} onChange={(e) => setForm((s) => ({ ...s, publisher: e.target.value }))} />
        </Field>
        <Field label="Yıl">
          <Input value={form.year} onChange={(e) => setForm((s) => ({ ...s, year: e.target.value }))} className="font-mono" />
        </Field>
      </div>

      <Divider />

      <Eyebrow>Ciltler ({fileIds.length})</Eyebrow>
      <div className="space-y-1.5">
        {fileIds.map((fid) => {
          const pf = fileById.get(fid); if (!pf) return null
          return (
            <div key={fid} className="flex items-center gap-2 px-3 py-2 bg-parchment-dark/40 border border-ink-muted/15 rounded-lg">
              <div className="w-7 h-9 rounded-sm flex items-end justify-center pb-1 text-white text-[9px] font-bold flex-shrink-0"
                style={{ background: '#8a6a3d' }}>
                {pf.file.name.split('.').pop()?.toUpperCase().slice(0, 4)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold text-ink truncate">{pf.file.name}</div>
              </div>
              <Input type="number" min={1} placeholder="cilt #"
                value={volumes[fid] ?? ''}
                onChange={(e) => setVolumes((v) => ({ ...v, [fid]: e.target.value }))}
                className="w-16 h-8 text-center font-mono text-[12px]" />
              <Input placeholder="etiket (ops.)"
                value={labels[fid] ?? ''}
                onChange={(e) => setLabels((l) => ({ ...l, [fid]: e.target.value }))}
                className="w-32 h-8 text-[12px]" />
            </div>
          )
        })}
      </div>

      <FooterBar
        hint="Her cilt için numara zorunlu; etiket isteğe bağlı"
        primary={onCommit}
        primaryLabel={editing ? 'Grubu güncelle' : 'Grup oluştur'}
        onCancel={onCancel}
      />
    </div>
  )
}
