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

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Plus, X, Search, Sparkles, FileText, Upload, BookCopy, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

type Tab = 'isbn' | 'manual' | 'file'

interface Props {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultTab?: Tab
  onAdded?: (entryId: string) => void
}

interface BiblioHit {
  source: 'doi' | 'isbn'
  entryType?: string
  authorSurname?: string | null
  authorName?: string | null
  title?: string | null
  publisher?: string | null
  publishPlace?: string | null
  year?: string | null
  journalName?: string | null
  journalVolume?: string | null
  journalIssue?: string | null
  pageRange?: string | null
  doi?: string | null
  isbn?: string | null
  coverUrl?: string | null
  url?: string | null
  abstract?: string | null
}

export function AddSourceDialog({ open, onOpenChange, defaultTab = 'isbn', onAdded }: Props) {
  const [tab, setTab] = useState<Tab>(defaultTab)
  useEffect(() => { if (open) setTab(defaultTab) }, [open, defaultTab])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[640px] p-0 gap-0 overflow-hidden border-0 bg-parchment"
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

          {/* Tabs */}
          <div className="flex gap-1 mt-[18px]">
            <ModalTab id="isbn" icon={Search} label="ISBN ile" detail="otomatik doldur"
              active={tab === 'isbn'} onClick={() => setTab('isbn')} />
            <ModalTab id="manual" icon={FileText} label="Manuel" detail="formu kendin doldur"
              active={tab === 'manual'} onClick={() => setTab('manual')} />
            <ModalTab id="file" icon={Upload} label="Dosya ile" detail="PDF / EPUB sürükle"
              active={tab === 'file'} onClick={() => setTab('file')} />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 px-6 pt-[22px] pb-1 max-h-[60vh] overflow-auto">
          {tab === 'isbn' && <IsbnTab onClose={() => onOpenChange(false)} onAdded={onAdded} />}
          {tab === 'manual' && <ManualTab onClose={() => onOpenChange(false)} onAdded={onAdded} />}
          {tab === 'file' && <FileTab onClose={() => onOpenChange(false)} onAdded={onAdded} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── tab chip ─────────────────────────────────────────────────────────
function ModalTab({
  icon: Icon, label, detail, active, onClick,
}: {
  id: string; icon: typeof Search; label: string; detail: string;
  active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex-1 px-3.5 pt-2.5 pb-3.5 rounded-t-[10px] text-left transition relative',
        active ? 'bg-parchment text-ink' : 'bg-white/[0.06] text-white hover:bg-white/[0.10]',
      ].join(' ')}
    >
      <div className={['flex items-center gap-[7px] text-[13px] font-semibold',
        active ? 'text-ink' : 'text-white'].join(' ')}>
        <Icon size={14} className={active ? 'text-forest' : 'text-gold-soft'} />
        {label}
      </div>
      <div className={['mt-[3px] text-[11px] font-serif italic',
        active ? 'text-ink-muted' : 'text-gold-soft/60'].join(' ')}>{detail}</div>
      {active && (
        <span className="absolute -bottom-px left-3 right-3 h-0.5 bg-gold rounded-[1px]" />
      )}
    </button>
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
function IsbnTab({ onClose, onAdded }: { onClose: () => void; onAdded?: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [hit, setHit] = useState<BiblioHit | null>(null)
  const [searched, setSearched] = useState(false)
  const [saving, setSaving] = useState(false)

  const search = async () => {
    if (!q.trim()) return
    setSearching(true); setSearched(false); setHit(null)
    try {
      const res = await fetch(`/api/library/biblio-lookup?q=${encodeURIComponent(q.trim())}`)
      const data = await res.json()
      setHit(data.found ? data.hit : null)
      setSearched(true)
    } catch (err) {
      console.error(err)
      toast.error('Tarama başarısız')
    } finally {
      setSearching(false)
    }
  }

  const commit = async () => {
    if (!hit) return
    setSaving(true)
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entryType: hit.entryType ?? 'kitap',
          authorSurname: hit.authorSurname || 'Unknown',
          authorName: hit.authorName ?? null,
          title: hit.title ?? '',
          publisher: hit.publisher ?? null,
          publishPlace: hit.publishPlace ?? null,
          year: hit.year ?? null,
          journalName: hit.journalName ?? null,
          journalVolume: hit.journalVolume ?? null,
          journalIssue: hit.journalIssue ?? null,
          pageRange: hit.pageRange ?? null,
          doi: hit.doi ?? null,
          url: hit.url ?? null,
          importSource: hit.source, // 'doi' or 'isbn'
        }),
      })
      if (!res.ok) throw new Error(`POST failed: ${res.status}`)
      const entry = await res.json()
      toast.success('Kütüphaneye eklendi')
      onAdded?.(entry.id)
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <Eyebrow>ISBN veya DOI</Eyebrow>
      <p className="text-[12.5px] font-serif italic text-ink-light mb-3 mt-0">
        Kitabın ISBN'ini veya makalenin DOI'sini yapıştır — künye bilgileri 3 saniye içinde otomatik dolar.
      </p>

      <div className="relative flex items-center gap-2 bg-parchment-dark rounded-[10px] pr-1 pl-3.5 py-1"
        style={{ border: '1.5px solid color-mix(in oklch, var(--color-forest) 50%, transparent)', boxShadow: '0 0 0 4px rgba(58,82,56,0.08)' }}
      >
        <Search size={16} className="text-forest" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="978-0-691-02021-8  veya  10.1007/s11023-..."
          className="border-0 outline-0 bg-transparent font-mono text-[14.5px] focus-visible:ring-0 px-1 py-2.5 shadow-none"
          onKeyDown={(e) => { if (e.key === 'Enter') search() }}
        />
        <Button size="sm" onClick={search} disabled={!q.trim() || searching}
          className="bg-forest hover:bg-forest/90 text-white px-3.5 py-[7px]">
          {searching ? <Loader2 className="animate-spin" size={12} /> : <Sparkles size={12} />} Tara
        </Button>
      </div>

      {/* Result */}
      {searched && !hit && (
        <div className="mt-4 p-3 rounded-lg bg-parchment-dark text-[12.5px] text-ink-light">
          Eşleşme bulunamadı. ISBN/DOI'yi kontrol et veya <button
            className="text-forest underline font-semibold"
            onClick={() => { /* parent switches tab */ }}
          >Manuel</button> sekmesinden ekle.
        </div>
      )}
      {hit && (
        <div className="mt-4">
          <div className="inline-flex items-center gap-1.5 text-[10.5px] uppercase tracking-[0.14em] font-semibold text-forest mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[#5ab070]" />
            Eşleşme bulundu · {hit.source === 'isbn' ? 'OpenLibrary' : 'Crossref'}
          </div>
          <div className="bg-parchment-dark rounded-[12px] p-4 flex gap-3.5 border border-ink-muted/15">
            {hit.coverUrl ? (
              <img src={hit.coverUrl} alt="cover" className="w-[72px] h-[100px] object-cover rounded-sm shadow"
                onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <div className="w-[72px] h-[100px] rounded-sm flex-shrink-0 flex items-center justify-center text-white text-[11px] text-center font-serif italic font-semibold p-2 leading-tight"
                style={{ background: 'linear-gradient(135deg, #6a4a2a, #3a2812)' }}>
                {hit.title?.slice(0, 22) ?? 'Kapak'}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-serif text-[17px] font-semibold leading-tight m-0">{hit.title}</h3>
              <div className="mt-1.5 text-[12.5px] font-serif italic text-ink-light">
                {[hit.authorSurname, hit.authorName].filter(Boolean).join(', ') || '—'}
              </div>
              <div className="mt-1 text-[11.5px] text-ink-muted">
                {[hit.publisher, hit.year].filter(Boolean).join(' · ')}
                {hit.journalName ? ` · ${hit.journalName}` : ''}
              </div>
              <div className="mt-2.5 flex gap-1 flex-wrap">
                <Chip>{(hit.entryType || 'kaynak').toUpperCase()}</Chip>
                {hit.source === 'doi' && <Chip variant="olive">DOI</Chip>}
                {hit.source === 'isbn' && <Chip variant="olive">ISBN</Chip>}
              </div>
            </div>
          </div>
          <div className="mt-3 p-2.5 px-3.5 bg-parchment-dark/50 rounded-lg text-[12px] text-ink-light flex items-start gap-2.5">
            <Sparkles size={14} className="text-gold flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-ink">Yanlış mı?</span> ISBN'i tekrar gir veya Manuel sekmesine geç.
            </div>
          </div>
        </div>
      )}

      <FooterBar
        hint={hit ? 'Crossref + OpenLibrary doğrulaması yapıldı' : 'OpenLibrary + Crossref tarar'}
        primary={hit ? commit : search}
        primaryLabel={hit ? 'Bul ve ekle' : 'Tara'}
        onCancel={onClose}
        loading={searching || saving}
      />
    </div>
  )
}

function Chip({ children, variant }: { children: React.ReactNode; variant?: 'olive' }) {
  const base = 'inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded'
  if (variant === 'olive') return <span className={`${base} bg-forest/15 text-forest`}>{children}</span>
  return <span className={`${base} bg-ink/8 text-ink-light`}>{children}</span>
}

// ═══════════════════════════ TAB 2 — MANUEL ═══════════════════════════
function ManualTab({ onClose, onAdded }: { onClose: () => void; onAdded?: (id: string) => void }) {
  const [f, setF] = useState({
    entryType: 'kitap', authorSurname: '', authorName: '',
    title: '', shortTitle: '',
    publisher: '', publishPlace: '', year: '', volume: '', edition: '',
  })
  const [saving, setSaving] = useState(false)

  const upd = <K extends keyof typeof f>(k: K, v: string) => setF((s) => ({ ...s, [k]: v }))

  const commit = async () => {
    if (!f.authorSurname.trim() || !f.title.trim()) {
      toast.error('Soyad ve başlık zorunlu')
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...f, importSource: 'manual' }),
      })
      if (!res.ok) throw new Error(`POST failed: ${res.status}`)
      const entry = await res.json()
      toast.success('Kütüphaneye eklendi')
      onAdded?.(entry.id)
      onClose()
    } catch (err) {
      console.error(err)
      toast.error('Kaydedilemedi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tür" required>
          <Select value={f.entryType} onValueChange={(v) => upd('entryType', String(v ?? 'kitap'))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="kitap">Kitap</SelectItem>
              <SelectItem value="makale">Makale</SelectItem>
              <SelectItem value="tez">Tez</SelectItem>
              <SelectItem value="ansiklopedi">Ansiklopedi</SelectItem>
              <SelectItem value="nesir">Nesir</SelectItem>
              <SelectItem value="ceviri">Çeviri</SelectItem>
              <SelectItem value="web">Web</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Yıl">
          <Input value={f.year} onChange={(e) => upd('year', e.target.value)} placeholder="örn. 1976" className="font-mono" />
        </Field>
      </div>

      <Divider />
      <Eyebrow>Yazar</Eyebrow>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Soyad" required>
          <Input value={f.authorSurname} onChange={(e) => upd('authorSurname', e.target.value)} placeholder="örn. Wolfson" />
        </Field>
        <Field label="Ad">
          <Input value={f.authorName} onChange={(e) => upd('authorName', e.target.value)} placeholder="örn. Harry Austryn" />
        </Field>
      </div>

      <Divider />
      <Field label="Başlık" required>
        <Input value={f.title} onChange={(e) => upd('title', e.target.value)} placeholder="Eserin tam başlığı" />
      </Field>
      <div className="h-3" />
      <Field label="Kısa başlık">
        <Input value={f.shortTitle} onChange={(e) => upd('shortTitle', e.target.value)} placeholder="örn. Philosophy of Kalam" />
      </Field>

      <Divider />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Yayıncı">
          <Input value={f.publisher} onChange={(e) => upd('publisher', e.target.value)} placeholder="örn. Harvard Univ. Press" />
        </Field>
        <Field label="Yayın yeri">
          <Input value={f.publishPlace} onChange={(e) => upd('publishPlace', e.target.value)} placeholder="örn. Cambridge, MA" />
        </Field>
      </div>
      <div className="h-3" />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Cilt">
          <Input value={f.volume} onChange={(e) => upd('volume', e.target.value)} placeholder="—" />
        </Field>
        <Field label="Baskı">
          <Input value={f.edition} onChange={(e) => upd('edition', e.target.value)} placeholder="1." />
        </Field>
      </div>

      <FooterBar
        hint="Zorunlu alanlar yıldızla işaretli"
        primary={commit}
        primaryLabel="Kütüphaneye ekle"
        onCancel={onClose}
        loading={saving}
      />
    </div>
  )
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
  return <div className="h-px bg-rule-soft my-[18px]" />
}

// ═══════════════════════════ TAB 3 — DOSYA (with cilt-gruplama) ═══════
// Standalone uploads AND multi-volume grouping in one tab. Tick 2+
// files → "Grupla" → fill parent metadata + per-file cilt number →
// the group lands on a list. "Yükle ve ekle" fires standalone
// uploads (POST /upload-pdf) and group uploads (parent POST /library
// + N × POST /[id]/volumes) in parallel.
type PendingFile = { id: string; file: File }
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

  // Group-form overlay state.
  const [groupFormOpen, setGroupFormOpen] = useState(false)
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [gForm, setGForm] = useState(emptyGroupForm())
  const [gFileIds, setGFileIds] = useState<string[]>([])
  const [gVolumes, setGVolumes] = useState<Record<string, string>>({})
  const [gLabels, setGLabels] = useState<Record<string, string>>({})
  const [extracting, setExtracting] = useState(false)

  const fileById = useMemo(() => new Map(files.map((f) => [f.id, f])), [files])
  const ungrouped = useMemo(() => {
    const taken = new Set<string>()
    for (const g of groups) for (const fid of g.fileIds) taken.add(fid)
    return files.filter((f) => !taken.has(f.id))
  }, [files, groups])

  const addFiles = (incoming: FileList | File[]) => {
    const fresh: PendingFile[] = Array.from(incoming)
      .filter((f) => /\.(pdf|epub|docx)$/i.test(f.name) && f.size > 0 && f.size <= 50 * 1024 * 1024)
      .map((file) => ({ id: newId(), file }))
    if (fresh.length === 0) return
    setFiles((prev) => [...prev, ...fresh])
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

  const openGroupForSelection = async () => {
    const ids = ungrouped.filter((f) => selectedIds.has(f.id)).map((f) => f.id)
    if (ids.length < 2) { toast.error('Grup için en az 2 dosya seç'); return }
    setEditingGroupId(null)
    setGForm(emptyGroupForm())
    setGFileIds(ids)
    const vols: Record<string, string> = {}
    ids.forEach((fid, idx) => { vols[fid] = String(idx + 1) })
    setGVolumes(vols); setGLabels({}); setGroupFormOpen(true)
    // Prefill from the first file's metadata via /extract-metadata.
    const first = fileById.get(ids[0])?.file
    if (first) {
      setExtracting(true)
      try {
        const fd = new FormData(); fd.append('file', first)
        const res = await fetch('/api/library/extract-metadata', { method: 'POST', body: fd })
        if (res.ok) {
          const m = await res.json() as Partial<{
            authorSurname: string; authorName: string; title: string; year: string; publisher: string
          }>
          setGForm((s) => ({
            authorSurname: s.authorSurname || m.authorSurname || '',
            authorName: s.authorName || m.authorName || '',
            title: s.title || m.title || '',
            year: s.year || m.year || '',
            publisher: s.publisher || m.publisher || '',
          }))
        }
      } catch { /* user fills manually */ }
      finally { setExtracting(false) }
    }
  }

  const openGroupForEdit = (g: Group) => {
    setEditingGroupId(g.id)
    setGForm({ ...g.form }); setGFileIds([...g.fileIds])
    setGVolumes({ ...g.volumeNumbers }); setGLabels({ ...g.labels })
    setGroupFormOpen(true)
  }

  const commitGroup = () => {
    if (!gForm.authorSurname.trim()) { toast.error('Yazar soyadı zorunlu'); return }
    if (!gForm.title.trim()) { toast.error('Ana eser başlığı zorunlu'); return }
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

  const handleUpload = async () => {
    if (files.length === 0) { toast.error('Yüklenecek dosya yok'); return }
    if (groupFormOpen) { toast.error('Önce grubu kaydet veya iptal et'); return }
    setUploading(true)
    const errors: string[] = []

    const standalonePromises = ungrouped.map(async (pf) => {
      const fd = new FormData(); fd.append('file', pf.file)
      const res = await fetch('/api/library/upload-pdf', { method: 'POST', body: fd })
      if (!res.ok) throw new Error(`${pf.file.name}: ${res.status}`)
      const entry = await res.json(); onAdded?.(entry.id)
    })

    const groupPromises = groups.map(async (g) => {
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
      if (!parentRes.ok) throw new Error(`Ana eser oluşturulamadı (${g.form.title}): ${parentRes.status}`)
      const parent = await parentRes.json() as { id: string }
      onAdded?.(parent.id)
      await Promise.all(g.fileIds.map(async (fid) => {
        const pf = fileById.get(fid); if (!pf) return
        const volNumber = parseInt(g.volumeNumbers[fid] ?? '1', 10)
        const label = g.labels[fid]?.trim()
        const fd = new FormData()
        fd.append('file', pf.file); fd.append('volumeNumber', String(volNumber))
        if (label) fd.append('label', label)
        const volRes = await fetch(`/api/library/${parent.id}/volumes`, { method: 'POST', body: fd })
        if (!volRes.ok) throw new Error(`${pf.file.name} (cilt ${volNumber}): ${volRes.status}`)
      }))
    })

    const results = await Promise.allSettled([...standalonePromises, ...groupPromises])
    for (const r of results) if (r.status === 'rejected')
      errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason))
    setUploading(false)
    if (errors.length === 0) {
      toast.success(`${files.length} dosya işleme alındı`)
      onClose()
    } else {
      toast.error(`${errors.length} hata`, { description: errors.slice(0, 3).join(' · ') })
    }
  }

  if (groupFormOpen) return (
    <GroupForm
      form={gForm} setForm={setGForm}
      fileIds={gFileIds} fileById={fileById}
      volumes={gVolumes} setVolumes={setGVolumes}
      labels={gLabels} setLabels={setGLabels}
      extracting={extracting}
      onCancel={() => setGroupFormOpen(false)}
      onCommit={commitGroup}
      editing={!!editingGroupId}
    />
  )

  const selectedCount = ungrouped.filter((f) => selectedIds.has(f.id)).length

  return (
    <div>
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
              maks. 50 MB · birden fazla dosya · çoklu seçip "Grupla" ile cilt yapabilirsin
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
            />
          ))}
        </div>
      )}

      <FooterBar
        hint={
          files.length === 0 ? 'Künye otomatik çıkarılır'
          : `${ungrouped.length} tek · ${groups.length} grup`
        }
        primary={handleUpload}
        primaryLabel={uploading ? 'Yükleniyor…' : 'Yükle ve ekle'}
        onCancel={onClose}
        loading={uploading || files.length === 0}
      />
    </div>
  )
}

function FileRow({ pf, selected, onToggle, onRemove }: {
  pf: PendingFile; selected: boolean; onToggle: () => void; onRemove: () => void
}) {
  const sizeMB = (pf.file.size / 1024 / 1024).toFixed(1)
  const ext = pf.file.name.split('.').pop()?.toUpperCase().slice(0, 4) ?? 'FILE'
  return (
    <label className={[
      'flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1.5 border cursor-pointer transition',
      selected ? 'bg-forest/8 border-forest/40' : 'bg-parchment-dark/40 border-ink-muted/15',
    ].join(' ')}>
      <input type="checkbox" checked={selected} onChange={onToggle}
        className="w-4 h-4 accent-forest cursor-pointer" />
      <div className="w-8 h-10 rounded-sm flex items-end justify-center pb-1 text-white text-[9px] font-bold tracking-wider flex-shrink-0"
        style={{ background: '#8a6a3d' }}>{ext}</div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink truncate">{pf.file.name}</div>
        <div className="text-[11px] text-ink-muted mt-0.5">{sizeMB} MB</div>
      </div>
      <button onClick={(e) => { e.preventDefault(); onRemove() }}
        className="p-1 text-ink-muted hover:text-ink" aria-label="Çıkar"><X size={12} /></button>
    </label>
  )
}

// In-tab overlay for editing a cilt group's parent metadata + per-file volume numbers.
function GroupForm({
  form, setForm, fileIds, fileById, volumes, setVolumes, labels, setLabels,
  extracting, onCancel, onCommit, editing,
}: {
  form: Group['form']
  setForm: React.Dispatch<React.SetStateAction<Group['form']>>
  fileIds: string[]; fileById: Map<string, PendingFile>
  volumes: Record<string, string>
  setVolumes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  labels: Record<string, string>
  setLabels: React.Dispatch<React.SetStateAction<Record<string, string>>>
  extracting: boolean
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
        {extracting && (
          <span className="inline-flex items-center gap-1 text-gold-dark ml-auto">
            <Loader2 size={11} className="animate-spin" /> künye çıkarılıyor…
          </span>
        )}
      </div>

      <Eyebrow>Ana eserin künyesi</Eyebrow>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Yazar soyadı" required>
          <Input value={form.authorSurname} onChange={(e) => setForm((s) => ({ ...s, authorSurname: e.target.value }))} />
        </Field>
        <Field label="Yazar adı">
          <Input value={form.authorName} onChange={(e) => setForm((s) => ({ ...s, authorName: e.target.value }))} />
        </Field>
      </div>
      <div className="h-3" />
      <Field label="Eser başlığı" required>
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
