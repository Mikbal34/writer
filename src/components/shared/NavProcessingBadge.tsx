'use client'

/**
 * Tiny indicator in the IconRail that surfaces background OCR/ingest
 * activity from EVERY page. Polls /api/library/in-flight every 15 s.
 * Hidden when nothing is in flight — zero chrome cost when idle.
 *
 * Click → small panel anchored to the rail (mirrors NotificationBell)
 * with each entry/cilt's phase + elapsed + remaining estimate.
 *
 * Pairs with the inline row badge in LibraryEntryTable: when the user
 * is on /library the row carries detail; here they get the cross-page
 * "is something still cooking?" answer.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Loader2, BookCopy } from 'lucide-react'
import { processingEta, formatEta, type ProcessingStatus } from '@/lib/processing-eta'

const POLL_MS = 15_000

type Item =
  | {
      kind: 'entry'
      id: string
      title: string
      authorSurname: string | null
      status: string
      createdAt: string
      sizeBytes: number | null
    }
  | {
      kind: 'volume'
      id: string
      parentId: string
      parentTitle: string
      volumeNumber: number
      status: string
      createdAt: string
      sizeBytes: number | null
    }

export default function NavProcessingBadge() {
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/library/in-flight', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { entries: Item[]; volumes: Item[] }
      setItems([...(data.entries ?? []), ...(data.volumes ?? [])])
    } catch {
      /* transient — keep polling */
    }
  }, [])

  useEffect(() => {
    void fetchItems()
    const t = setInterval(fetchItems, POLL_MS)
    return () => clearInterval(t)
  }, [fetchItems])

  // Click-outside to close.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${items.length} kitap arka planda işleniyor`}
        className="w-[38px] h-[38px] mx-auto rounded-[9px] flex items-center justify-center bg-transparent text-white/70 hover:text-white hover:bg-white/10 transition-colors relative"
      >
        <Loader2 className="w-[18px] h-[18px] animate-spin" />
        <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-gold text-[10px] font-bold text-white flex items-center justify-center">
          {items.length}
        </span>
      </button>

      {open && (
        <div
          className="absolute left-[46px] bottom-0 w-[320px] bg-parchment border border-ink-muted/20 rounded-xl shadow-2xl overflow-hidden z-50"
          role="dialog"
        >
          <div className="px-4 py-2.5 border-b border-ink-muted/15 bg-gold-soft/15 text-[12px] font-semibold text-ink flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-gold-dark animate-spin" />
            {items.length} kitap işleniyor
          </div>
          <ul className="max-h-80 overflow-auto divide-y divide-ink-muted/10">
            {items.map((it) => {
              const eta = processingEta(it.status as ProcessingStatus, it.sizeBytes, it.createdAt)
              const href = it.kind === 'volume' ? `/library/${it.parentId}` : `/library/${it.id}`
              const display = it.kind === 'volume'
                ? `${it.parentTitle} — cilt ${it.volumeNumber}`
                : it.title
              return (
                <li key={`${it.kind}:${it.id}`}>
                  <Link
                    href={href}
                    onClick={() => setOpen(false)}
                    className="block px-4 py-2.5 hover:bg-gold-soft/15 transition-colors"
                  >
                    <div className="flex items-center gap-2 text-[12.5px] text-ink">
                      {it.kind === 'volume' ? (
                        <BookCopy className="w-3.5 h-3.5 text-forest flex-shrink-0" />
                      ) : (
                        <Loader2 className="w-3.5 h-3.5 text-gold-dark animate-spin flex-shrink-0" />
                      )}
                      <span className="truncate font-medium">{display}</span>
                    </div>
                    <div className="mt-0.5 ml-5 text-[11px] text-ink-muted italic">
                      {formatEta(eta)}
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="px-4 py-2 text-[10.5px] text-ink-muted bg-parchment-dark/30 border-t border-ink-muted/10">
            Süre tahmini — taranmış kitaplarda gerçek OCR uzayabilir.
          </div>
        </div>
      )}
    </div>
  )
}
