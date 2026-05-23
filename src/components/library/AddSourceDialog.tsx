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

import { useEffect, useRef, useState } from 'react'
import {
  Plus, X, Search, Sparkles, FileText, Upload, BookOpen, Loader2,
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

// ═══════════════════════════ TAB 3 — DOSYA ════════════════════════════
type FileItem = { file: File; status: 'pending' | 'uploading' | 'done' | 'error'; entryId?: string; error?: string }

function FileTab({ onClose, onAdded }: { onClose: () => void; onAdded?: (id: string) => void }) {
  const [items, setItems] = useState<FileItem[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  const addFiles = (files: FileList | File[]) => {
    const fresh: FileItem[] = Array.from(files)
      .filter((f) => /\.(pdf|epub|docx)$/i.test(f.name) && f.size > 0 && f.size <= 50 * 1024 * 1024)
      .map((file) => ({ file, status: 'pending' as const }))
    if (fresh.length === 0) return
    setItems((prev) => [...prev, ...fresh])
  }

  const uploadAll = async () => {
    setUploading(true)
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== 'pending') continue
      setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, status: 'uploading' } : it))
      try {
        const form = new FormData()
        form.append('file', items[i].file)
        const res = await fetch('/api/library/upload-pdf', { method: 'POST', body: form })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const entry = await res.json()
        setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, status: 'done', entryId: entry.id } : it))
        onAdded?.(entry.id)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, status: 'error', error: msg } : it))
      }
    }
    setUploading(false)
    const allDone = items.every((it) => it.status === 'done')
    if (allDone) {
      toast.success(`${items.length} dosya yüklendi — kuyrukta işleniyor`)
      onClose()
    } else {
      toast.success('Yükleme tamamlandı (sıraya alındı)')
    }
  }

  const removeItem = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i))
  const pendingCount = items.filter((it) => it.status === 'pending').length

  return (
    <div>
      <Eyebrow>Dosya yükle</Eyebrow>
      <p className="text-[12.5px] font-serif italic text-ink-light mb-3">
        Sürükle bırak ya da seç. Künye otomatik okunur — yoksa kuyrukta worker çıkarır.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault(); setDragging(false)
          addFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        className={[
          'rounded-[12px] py-[34px] px-6 text-center cursor-pointer transition',
          'border-2 border-dashed',
          dragging ? 'border-forest bg-forest/5' : 'border-ink-muted/30',
        ].join(' ')}
        style={dragging ? undefined : {
          background: 'repeating-linear-gradient(135deg, var(--color-parchment-dark) 0px, var(--color-parchment-dark) 12px, var(--color-parchment) 12px, var(--color-parchment) 24px)',
        }}
      >
        <input ref={inputRef} type="file" multiple accept=".pdf,.epub,.docx" className="hidden"
          onChange={(e) => e.target.files && addFiles(e.target.files)} />
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
          maks. 50 MB · birden fazla dosya
        </div>
      </div>

      {items.length > 0 && (
        <div className="mt-4">
          <Eyebrow>Sırada</Eyebrow>
          {items.map((it, i) => (
            <UploadRow key={i} item={it} onRemove={() => removeItem(i)} />
          ))}
        </div>
      )}

      <FooterBar
        hint={pendingCount > 0 ? `${pendingCount} dosya yüklenmeye hazır` : 'Künye otomatik çıkarılır'}
        primary={uploadAll}
        primaryLabel={uploading ? 'Yükleniyor…' : pendingCount > 0 ? 'Yükle ve ekle' : 'Tamam'}
        onCancel={onClose}
        loading={uploading || pendingCount === 0}
      />
    </div>
  )
}

function UploadRow({ item, onRemove }: { item: FileItem; onRemove: () => void }) {
  const sizeMB = (item.file.size / 1024 / 1024).toFixed(1)
  const color = item.status === 'done' ? '#c14a3a' : item.status === 'error' ? '#c14a3a' : '#8a6a3d'
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 bg-parchment-dark/40 border border-ink-muted/15 rounded-lg mb-1.5">
      <div className="w-8 h-10 rounded-sm flex items-end justify-center pb-1 text-white text-[9px] font-bold tracking-wider flex-shrink-0"
        style={{ background: color }}>
        {item.file.name.split('.').pop()?.toUpperCase().slice(0, 4)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-semibold text-ink truncate">{item.file.name}</div>
        <div className="text-[11px] text-ink-muted mt-0.5">
          {sizeMB} MB {item.error ? `· ${item.error}` : ''}
        </div>
        {item.status === 'uploading' && (
          <div className="mt-1.5 h-[3px] bg-rule-soft rounded-sm overflow-hidden">
            <div className="h-full bg-gold rounded-sm animate-pulse" style={{ width: '60%' }} />
          </div>
        )}
      </div>
      {item.status === 'done' && (
        <span className="text-[11px] font-semibold text-[#3a7050] inline-flex items-center gap-1">
          <BookOpen size={12} /> Sıraya alındı
        </span>
      )}
      {item.status === 'error' && (
        <span className="text-[11px] font-semibold text-[#c14a3a]">Hata</span>
      )}
      {item.status === 'pending' && (
        <button onClick={onRemove} className="p-1 text-ink-muted hover:text-ink" aria-label="Çıkar">
          <X size={12} />
        </button>
      )}
    </div>
  )
}
