'use client'

/**
 * Page-level banner shown when the user has entries/volumes still
 * being processed by the worker. Polls /api/library/in-flight every
 * 20s, hides itself when nothing is in flight, and expands on click
 * to show the per-item status + ETA.
 *
 * Lets the user upload + walk away — when they come back they see
 * exactly what's still cooking, no detective work.
 */

import { useCallback, useEffect, useState } from 'react'
import { Loader2, ChevronDown, ChevronUp, BookCopy } from 'lucide-react'

type InFlightEntry = {
  kind: 'entry'
  id: string
  title: string
  authorSurname: string
  status: string
}
type InFlightVolume = {
  kind: 'volume'
  id: string
  parentId: string
  parentTitle: string
  volumeNumber: number
  status: string
}
type Item = InFlightEntry | InFlightVolume

const STATUS_LABEL: Record<string, string> = {
  queued: 'sıraya alındı',
  extracting: 'metin çıkarılıyor',
  embedding: 'vektörleniyor',
  pending: 'bekliyor',
  downloading: 'indiriliyor',
}

interface Props {
  /** Bumped by parent on upload so we refetch immediately instead of
   *  waiting up to 20s for the next poll. */
  refreshKey?: number
}

export function ProcessingBanner({ refreshKey }: Props) {
  const [items, setItems] = useState<Item[]>([])
  const [open, setOpen] = useState(false)

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch('/api/library/in-flight', { cache: 'no-store' })
      if (!res.ok) return
      const data = (await res.json()) as { entries: InFlightEntry[]; volumes: InFlightVolume[] }
      const combined: Item[] = [...data.entries, ...data.volumes]
      setItems(combined)
    } catch {
      /* transient — keep polling */
    }
  }, [])

  useEffect(() => {
    void fetchItems()
    const t = setInterval(fetchItems, 20_000)
    return () => clearInterval(t)
  }, [fetchItems, refreshKey])

  if (items.length === 0) return null

  return (
    <section className="px-9 pt-3">
      <div className="border border-gold/30 bg-gold-soft/15 rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gold-soft/25 transition text-left"
        >
          <Loader2 className="w-4 h-4 text-gold-dark animate-spin flex-shrink-0" />
          <div className="flex-1 text-[13px]">
            <span className="font-semibold text-ink">{items.length}</span>{' '}
            <span className="text-ink-light">kitap arka planda işleniyor</span>
            <span className="text-ink-muted ml-2 text-[11px]">
              (taranmış PDF'ler 10-25 dk sürebilir)
            </span>
          </div>
          {open ? (
            <ChevronUp className="w-4 h-4 text-ink-muted" />
          ) : (
            <ChevronDown className="w-4 h-4 text-ink-muted" />
          )}
        </button>

        {open && (
          <ul className="border-t border-gold/20 divide-y divide-gold/15 max-h-72 overflow-auto">
            {items.map((it) => (
              <li key={`${it.kind}:${it.id}`} className="flex items-center gap-3 px-4 py-2 text-[12.5px]">
                {it.kind === 'volume' ? (
                  <BookCopy className="w-3.5 h-3.5 text-forest flex-shrink-0" />
                ) : (
                  <Loader2 className="w-3.5 h-3.5 text-gold-dark animate-spin flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-ink truncate">
                    {it.kind === 'volume'
                      ? `${it.parentTitle} — cilt ${it.volumeNumber}`
                      : it.title}
                  </div>
                  {it.kind === 'entry' && it.authorSurname && (
                    <div className="text-ink-muted text-[10.5px] truncate">
                      {it.authorSurname}
                    </div>
                  )}
                </div>
                <span className="text-[10.5px] text-ink-light italic">
                  {STATUS_LABEL[it.status] ?? it.status}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
