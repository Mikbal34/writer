"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Search,
  Loader2,
  Sparkles,
  ChevronDown,
  CheckCircle2,
  ExternalLink,
  FileDown,
  AlertTriangle,
  Plus,
  Quote,
  X as XIcon,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import WorkspaceShell from "@/components/shared/WorkspaceShell"

interface SearchResult {
  externalId: string
  provider: string
  title: string
  authorSurname: string
  authorName: string | null
  authors: string[]
  year: string | null
  publisher: string | null
  journalName: string | null
  doi: string | null
  url: string | null
  abstract: string | null
  citationCount: number | null
  entryType: string
  openAccessUrl: string | null
  alreadyInLibrary?: boolean
  relevanceScore?: number
  _finalScore?: number
}

interface StatusEntry {
  id: string
  pdfStatus: string
  pdfError: string | null
  filePath: string | null
}

const PROVIDER_LABELS: Record<string, string> = {
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
  crossref: "CrossRef",
  google_books: "Google Books",
  arxiv: "arXiv",
  pmc: "PubMed Central",
  doaj: "DOAJ",
  biorxiv: "bioRxiv",
}

// Per-provider accent colour for the result spine + db chip pill.
// Picked from the v7 mock so the result list reads as a multi-source
// shelf, not a wall of the same colour.
const PROVIDER_COLORS: Record<string, string> = {
  openalex: "#5a7050",
  semantic_scholar: "#8a6a3d",
  crossref: "#6a4a2a",
  google_books: "#5a4a2a",
  arxiv: "#a08a5a",
  pmc: "#3a5238",
  doaj: "#8a3a2a",
  biorxiv: "#2a3d28",
}

const TYPE_LABELS: Record<string, string> = {
  makale: "Makale",
  kitap: "Kitap",
  tez: "Tez",
}

const PROVIDER_ORDER: Array<keyof typeof PROVIDER_LABELS> = [
  "openalex",
  "semantic_scholar",
  "crossref",
  "google_books",
  "arxiv",
  "pmc",
  "doaj",
  "biorxiv",
]

// Bold-match a result snippet against the query keywords. Returns
// alternating plain / mark segments. Case-insensitive substring match.
function highlightSnippet(
  text: string | null,
  query: string,
): Array<{ text: string; bold?: boolean }> {
  if (!text) return []
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2)
  if (terms.length === 0) return [{ text }]
  const escaped = terms
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|")
  const re = new RegExp(`(${escaped})`, "gi")
  const parts: Array<{ text: string; bold?: boolean }> = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, match.index) })
    }
    parts.push({ text: match[0], bold: true })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex) })
  }
  return parts
}

// Derive 4 score components per result from the data we already have.
function scoreComponents(r: SearchResult): {
  keyword: number
  citations: number
  recency: number
  openAccess: number
} {
  const keyword = Math.max(0, Math.min(1, (r.relevanceScore ?? 0) / 10))
  const cited = r.citationCount ?? 0
  const citations =
    cited === 0
      ? 0
      : Math.max(0, Math.min(1, Math.log10(cited + 1) / Math.log10(200)))
  const yr = parseInt(r.year ?? "", 10)
  const now = new Date().getFullYear()
  const age = Number.isFinite(yr) ? now - yr : 30
  const recency = Math.max(0, Math.min(1, 1 - age / 20))
  const openAccess = r.openAccessUrl ? 1 : 0
  return { keyword, citations, recency, openAccess }
}

export default function LiteratureSearchPage() {
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("")
  const [yearFrom, setYearFrom] = useState("")
  const [yearTo, setYearTo] = useState("")
  // Default off — users with broad queries shouldn't lose non-PDF
  // results silently. They can toggle the PDF'li pill to filter down.
  const [requirePdf, setRequirePdf] = useState(false)

  const [results, setResults] = useState<SearchResult[]>([])
  const [generatedQueries, setGeneratedQueries] = useState<Array<{ text: string; reasoning?: string }>>([])
  const [cached, setCached] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const searchStartedAt = useRef<number | null>(null)
  const [searchDurationMs, setSearchDurationMs] = useState<number | null>(null)

  // Live search progress
  type Stage = 'idle' | 'expanding' | 'searching' | 'dedupe' | 'scoring' | 'done'
  const [stage, setStage] = useState<Stage>('idle')
  type ProviderStatus = 'pending' | 'searching' | 'done'
  const [providerState, setProviderState] = useState<Record<string, { status: ProviderStatus; count: number }>>({})
  const [dedupStats, setDedupStats] = useState<{ before: number; after: number } | null>(null)
  // Tracks the PDF-availability filter cut so the empty/hint surface
  // can suggest toggling `requirePdf` when the cut killed the result
  // set (or trimmed it significantly).
  const [pdfFilterStats, setPdfFilterStats] = useState<{ kept: number; total: number } | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)
  /** When set, the right detail panel renders this result. */
  const [detailId, setDetailId] = useState<string | null>(null)
  /** Sidebar refinement filters — purely client-side narrowing. */
  const [refineProviders, setRefineProviders] = useState<Set<string>>(new Set())
  const [refineTypes, setRefineTypes] = useState<Set<string>>(new Set())

  // PDF status tracking for recently added entries
  const [pollIds, setPollIds] = useState<string[]>([])
  const [statusById, setStatusById] = useState<Record<string, StatusEntry>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault()
    if (!query.trim()) return

    setIsSearching(true)
    setResults([])
    setSelectedIds(new Set())
    setStage('expanding')
    setProviderState({})
    setDedupStats(null)
    setPdfFilterStats(null)
    setGeneratedQueries([])
    setCached(false)
    setSearchDurationMs(null)
    searchStartedAt.current = Date.now()

    try {
      const res = await fetch("/api/library/literature-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          filters: {
            type: typeFilter || undefined,
            yearFrom: yearFrom ? parseInt(yearFrom) : undefined,
            yearTo: yearTo ? parseInt(yearTo) : undefined,
            requirePdf,
          },
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Arama başarısız")
        setStage('idle')
        return
      }

      if (!res.body) {
        toast.error("Arama sonucu alınamadı")
        setStage('idle')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const payload = line.slice(6).trim()
          if (payload === "[DONE]") continue
          try {
            const evt = JSON.parse(payload) as { type: string } & Record<string, unknown>
            handleSearchEvent(evt)
          } catch {
            // malformed chunk — ignore
          }
        }
      }
    } catch {
      toast.error("Bağlantı hatası")
    } finally {
      setIsSearching(false)
      setStage('done')
      if (searchStartedAt.current) {
        setSearchDurationMs(Date.now() - searchStartedAt.current)
      }
    }
  }

  function handleSearchEvent(evt: { type: string } & Record<string, unknown>) {
    switch (evt.type) {
      case 'cached': {
        const results = (evt.results as SearchResult[]) ?? []
        setResults(results)
        setCached(true)
        setStage('done')
        toast.success(`${results.length} sonuç (cache'den)`, { duration: 2000 })
        break
      }
      case 'expanding':
        setStage('expanding')
        break
      case 'queries':
        setGeneratedQueries((evt.queries as Array<{ text: string; reasoning?: string }>) ?? [])
        setStage('searching')
        break
      case 'provider_start':
        setProviderState((prev) => ({
          ...prev,
          [evt.provider as string]: { status: 'searching', count: 0 },
        }))
        break
      case 'provider_done':
        setProviderState((prev) => ({
          ...prev,
          [evt.provider as string]: { status: 'done', count: Number(evt.count ?? 0) },
        }))
        break
      case 'dedupe':
        setDedupStats({ before: Number(evt.before ?? 0), after: Number(evt.after ?? 0) })
        setStage('dedupe')
        break
      case 'pdf_filter':
        setPdfFilterStats({
          kept: Number(evt.kept ?? 0),
          total: Number(evt.total ?? 0),
        })
        break
      case 'scoring':
        setStage('scoring')
        break
      case 'results': {
        const results = (evt.results as SearchResult[]) ?? []
        setResults(results)
        setStage('done')
        if (results.length === 0) {
          // Tailor the message: if the PDF filter swallowed every
          // result we tell the user how to recover instead of a
          // generic "no results" line.
          if (requirePdf) {
            toast.info(
              "PDF'siz olanları gizliyorsun — PDF'li filtresini kapat veya farklı kelimeler dene.",
            )
          } else {
            toast.info("Sonuç bulunamadı. Filtreleri değiştirip tekrar dene.")
          }
        }
        break
      }
      case 'error':
        toast.error(String(evt.message ?? 'Arama hatası'))
        setStage('idle')
        break
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll() {
    const all = new Set(results.filter((r) => !r.alreadyInLibrary).map((r) => r.externalId))
    setSelectedIds(all)
  }

  function clearSelection() {
    setSelectedIds(new Set())
  }

  const addOne = useCallback(
    async (r: SearchResult) => {
      if (r.alreadyInLibrary) return
      setIsAdding(true)
      try {
        const res = await fetch("/api/library/bulk-add-from-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ results: [r] }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          toast.error(err.error ?? "Kütüphaneye ekleme başarısız")
          return
        }
        const data = await res.json()
        toast.success(`Eklendi · ${r.title.slice(0, 36)}${r.title.length > 36 ? "…" : ""}`)
        const newIds = (data.entries ?? []).map((e: { id: string }) => e.id)
        setPollIds((prev) => [...prev, ...newIds])
        setResults((prev) =>
          prev.map((row) =>
            row.externalId === r.externalId ? { ...row, alreadyInLibrary: true } : row,
          ),
        )
      } catch {
        toast.error("Bağlantı hatası")
      } finally {
        setIsAdding(false)
      }
    },
    [],
  )

  async function handleBulkAdd() {
    if (selectedIds.size === 0) return
    const chosen = results.filter((r) => selectedIds.has(r.externalId))
    setIsAdding(true)
    try {
      const res = await fetch("/api/library/bulk-add-from-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: chosen }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        toast.error(err.error ?? "Kütüphaneye ekleme başarısız")
        return
      }
      const data = await res.json()
      toast.success(`${data.added} kaynak eklendi${data.skipped ? `, ${data.skipped} zaten vardı` : ""}`)

      const newIds = (data.entries ?? []).map((e: { id: string }) => e.id)
      setPollIds(newIds)

      setResults((prev) =>
        prev.map((r) => (selectedIds.has(r.externalId) ? { ...r, alreadyInLibrary: true } : r))
      )
      clearSelection()
    } catch {
      toast.error("Bağlantı hatası")
    } finally {
      setIsAdding(false)
    }
  }

  // Poll status for entries that are downloading PDFs
  useEffect(() => {
    if (pollIds.length === 0) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }

    const poll = async () => {
      try {
        const qs = pollIds.join(",")
        const res = await fetch(`/api/library/pdf-status?ids=${qs}`)
        if (!res.ok) return
        const data = (await res.json()) as { entries: StatusEntry[] }
        const byId: Record<string, StatusEntry> = {}
        for (const e of data.entries) byId[e.id] = e
        setStatusById(byId)

        const stillWorking = data.entries.some((e) =>
          ["pending", "downloading", "extracting", "embedding"].includes(e.pdfStatus)
        )
        if (!stillWorking && pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch {
        // ignore transient errors
      }
    }

    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
    }
  }, [pollIds])

  const activeDownloads = useMemo(
    () =>
      Object.values(statusById).filter((e) =>
        ["pending", "downloading", "extracting", "embedding"].includes(e.pdfStatus)
      ).length,
    [statusById]
  )
  const readyDownloads = useMemo(
    () => Object.values(statusById).filter((e) => e.pdfStatus === "ready").length,
    [statusById]
  )
  const failedDownloads = useMemo(
    () => Object.values(statusById).filter((e) => e.pdfStatus === "failed").length,
    [statusById]
  )

  const selectableCount = results.filter((r) => !r.alreadyInLibrary).length

  // ── Refinement-derived view ───────────────────────────────────────
  const providerCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of results) m[r.provider] = (m[r.provider] ?? 0) + 1
    return m
  }, [results])
  const typeCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of results) m[r.entryType] = (m[r.entryType] ?? 0) + 1
    return m
  }, [results])

  const visibleResults = useMemo(() => {
    return results.filter((r) => {
      if (refineProviders.size > 0 && !refineProviders.has(r.provider)) return false
      if (refineTypes.size > 0 && !refineTypes.has(r.entryType)) return false
      return true
    })
  }, [results, refineProviders, refineTypes])

  useEffect(() => {
    if (visibleResults.length === 0) {
      if (detailId !== null) setDetailId(null)
      return
    }
    const stillVisible = visibleResults.some((r) => r.externalId === detailId)
    if (!stillVisible) {
      setDetailId(visibleResults[0].externalId)
    }
  }, [visibleResults, detailId])

  const detailResult = useMemo(
    () => results.find((r) => r.externalId === detailId) ?? null,
    [results, detailId],
  )
  const detailRank = useMemo(
    () => (detailResult ? visibleResults.findIndex((r) => r.externalId === detailResult.externalId) + 1 : 0),
    [visibleResults, detailResult],
  )

  function toggleProviderFacet(provider: string) {
    setRefineProviders((prev) => {
      const next = new Set(prev)
      next.has(provider) ? next.delete(provider) : next.add(provider)
      return next
    })
  }
  function toggleTypeFacet(t: string) {
    setRefineTypes((prev) => {
      const next = new Set(prev)
      next.has(t) ? next.delete(t) : next.add(t)
      return next
    })
  }

  const rawTotal = useMemo(
    () =>
      Object.values(providerState).reduce(
        (acc, p) => acc + (p?.count ?? 0),
        0,
      ),
    [providerState],
  )

  const stageLabel: Record<Stage, string> = {
    idle: "Aramaya hazır",
    expanding: "Sorgu genişletiliyor…",
    searching: "Veritabanları taranıyor…",
    dedupe: "Tekrarlananlar ayıklanıyor…",
    scoring: "Sonuçlar skorlanıyor…",
    done: "Tarama tamamlandı",
  }
  const isDone = stage === "done" && results.length > 0
  const isIdle = stage === "idle" || (stage === "done" && results.length === 0 && !isSearching)

  return (
    <WorkspaceShell fullHeight bareMain>
      <div className="flex flex-1 min-h-0 gap-3.5 bg-page">
        <main className="flex-1 min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden">
          {/* === Dark forest hero with embedded search === */}
          <section
            className="relative overflow-hidden px-11 pt-8 pb-6 text-gold-soft"
            style={{
              background:
                "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
            }}
          >
            {/* Decorative ∗ ornament */}
            <div
              aria-hidden
              className="pointer-events-none absolute -right-2 -top-7 select-none"
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: 200,
                lineHeight: 1,
                color: "var(--color-gold-soft)",
                opacity: 0.12,
                transform: "rotate(-10deg)",
              }}
            >
              ∗
            </div>

            <div className="font-ui inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-gold-soft/70 mb-1.5">
              <Sparkles className="h-3 w-3" />
              Akademik literatür
            </div>
            <h1 className="font-display italic font-medium text-[38px] leading-none tracking-tight text-white">
              Literatür Tara
            </h1>
            <p className="mt-2.5 font-body text-[13.5px] leading-relaxed text-gold-soft/85 max-w-[640px]">
              Konunu yaz — 8 akademik veritabanı paralel taranır, en alâkalı
              25 kaynak skorlanıp önüne gelir.
            </p>

            {/* Inline search — full hero width so the input gets the
                editorial weight the mock implies. */}
            <form
              onSubmit={handleSearch}
              className="mt-6 flex gap-2 w-full"
            >
              <div className="flex flex-1 items-center gap-2 rounded-[10px] bg-white pl-4 pr-1 py-1 shadow-[0_4px_16px_rgba(0,0,0,0.25)]">
                <Search className="h-4 w-4 text-ink-muted shrink-0" />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="örn: kalâm tartışmalarının Hristiyan teolojiyle ilişkisi"
                  className="flex-1 bg-transparent border-0 outline-none py-2.5 px-2 font-body text-[14.5px] text-ink placeholder:text-ink-muted"
                  disabled={isSearching}
                />
                <button
                  type="submit"
                  disabled={isSearching || !query.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gold px-5 py-2.5 font-ui text-sm font-semibold text-white hover:bg-gold-hover transition-colors disabled:opacity-60"
                >
                  {isSearching ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Tara
                </button>
              </div>
            </form>

            {/* Database chips — show live counts when search in flight */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="font-ui text-[10.5px] uppercase tracking-[0.12em] text-gold-soft/55 mr-1">
                Veritabanı:
              </span>
              {PROVIDER_ORDER.map((provider) => {
                const p = providerState[provider]
                const count =
                  p?.count ?? providerCounts[provider] ?? 0
                const inFlight = p?.status === "searching"
                const done = p?.status === "done"
                return (
                  <DbChip
                    key={provider}
                    label={PROVIDER_LABELS[provider]}
                    color={PROVIDER_COLORS[provider]}
                    count={count}
                    state={inFlight ? "searching" : done ? "done" : "idle"}
                  />
                )
              })}
            </div>
          </section>

          {/* === Filter / sort bar === */}
          <div className="flex items-center gap-2.5 px-9 py-3 border-b border-sandy/60 bg-panel font-ui text-[12px]">
            <SearchStatusIndicator
              isSearching={isSearching}
              isDone={isDone}
              isIdle={isIdle}
              cached={cached}
              visibleCount={visibleResults.length}
              totalCount={results.length}
              rawTotal={rawTotal}
              durationMs={searchDurationMs}
              stageLabel={stageLabel[stage]}
            />
            <span className="flex-1" />

            <FilterPill label={typeFilter ? TYPE_LABELS[typeFilter] : "Tüm tipler"} active={!!typeFilter}>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="absolute inset-0 opacity-0 cursor-pointer"
                aria-label="Tip filtresi"
              >
                <option value="">Tüm tipler</option>
                {Object.entries(TYPE_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </FilterPill>
            <YearRangePill
              from={yearFrom}
              to={yearTo}
              onChange={(from, to) => {
                setYearFrom(from);
                setYearTo(to);
              }}
            />
            <FilterPill
              label="PDF'li"
              icon={<FileDown className="h-3 w-3" />}
              active={requirePdf}
              onClick={() => setRequirePdf(!requirePdf)}
            />
          </div>

          {/* === Three-column results === */}
          <div className="flex flex-1 min-h-0">
            {/* Left rail: refinement */}
            <aside className="hidden lg:flex w-[220px] shrink-0 flex-col gap-5 border-r border-sandy/60 px-5 py-5 overflow-y-auto">
              {selectableCount > 0 && (
                <BulkAddPanel
                  selectedCount={selectedIds.size}
                  selectableCount={selectableCount}
                  isAdding={isAdding}
                  onSelectAll={selectAll}
                  onClear={clearSelection}
                  onAdd={handleBulkAdd}
                />
              )}
              <RefineSection
                title="Veritabanı"
                items={PROVIDER_ORDER.filter((p) => (providerCounts[p] ?? 0) > 0).map((p) => ({
                  id: p,
                  label: PROVIDER_LABELS[p],
                  count: providerCounts[p] ?? 0,
                  checked: refineProviders.has(p),
                }))}
                onToggle={toggleProviderFacet}
              />
              <RefineSection
                title="Tür"
                items={Object.entries(typeCounts)
                  .filter(([, n]) => n > 0)
                  .map(([id, count]) => ({
                    id,
                    label: TYPE_LABELS[id] ?? id,
                    count,
                    checked: refineTypes.has(id),
                  }))}
                onToggle={toggleTypeFacet}
              />

              {/* PDF status counters — when bulk-add downloads are in flight */}
              {(activeDownloads > 0 || readyDownloads > 0 || failedDownloads > 0) && (
                <div className="rounded-md border border-sandy/60 bg-panel p-2.5 font-ui text-[11px] text-ink-light space-y-1">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-forest mb-1">
                    PDF işlemleri
                  </div>
                  {activeDownloads > 0 && (
                    <div className="flex items-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      {activeDownloads} indiriliyor
                    </div>
                  )}
                  {readyDownloads > 0 && (
                    <div className="flex items-center gap-1.5 text-forest">
                      <CheckCircle2 className="h-3 w-3" />
                      {readyDownloads} hazır
                    </div>
                  )}
                  {failedDownloads > 0 && (
                    <div className="flex items-center gap-1.5 text-destructive">
                      <AlertTriangle className="h-3 w-3" />
                      {failedDownloads} başarısız
                    </div>
                  )}
                </div>
              )}
            </aside>

            {/* Center: result list */}
            <div className="flex-1 min-w-0 overflow-y-auto px-7 py-5">
              {isIdle && results.length === 0 ? (
                <EmptyHero />
              ) : visibleResults.length === 0 ? (
                <div className="font-display italic text-center text-ink-muted py-16">
                  {requirePdf && pdfFilterStats &&
                  pdfFilterStats.total > pdfFilterStats.kept ? (
                    <>
                      PDF&apos;li filtresi nedeniyle{" "}
                      <span className="text-ink">
                        {pdfFilterStats.total - pdfFilterStats.kept} sonuç
                      </span>{" "}
                      gizlendi. Üstteki <span className="text-gold">PDF&apos;li</span>{" "}
                      pill&apos;ini kapatarak hepsini gör.
                    </>
                  ) : (
                    "Filtrelere uyan sonuç yok. Sol panelden seçimleri gevşet."
                  )}
                </div>
              ) : (
                <>
                  {/* PDF filter hint — surfaces when the filter cut a
                      meaningful chunk but didn't zero out the list. */}
                  {requirePdf && pdfFilterStats &&
                    pdfFilterStats.total - pdfFilterStats.kept >= 5 && (
                      <div className="mb-4 px-3 py-2 rounded-md border border-gold/30 bg-gold/10 font-ui text-[11.5px] text-ink-light flex items-center gap-2">
                        <FileDown className="h-3 w-3 text-gold-dark shrink-0" />
                        <span>
                          <span className="font-semibold text-ink">
                            {pdfFilterStats.total - pdfFilterStats.kept}
                          </span>{" "}
                          PDF&apos;siz sonuç gizlendi.
                        </span>
                        <button
                          type="button"
                          onClick={() => setRequirePdf(false)}
                          className="ml-auto font-ui text-[11px] text-gold-dark hover:underline"
                        >
                          Hepsini göster
                        </button>
                      </div>
                    )}

                  {visibleResults.map((r, i) => (
                    <ResultCard
                      key={r.externalId}
                      r={r}
                      rank={i + 1}
                      query={query}
                      active={r.externalId === detailId}
                      isSelected={selectedIds.has(r.externalId)}
                      onActivate={() => setDetailId(r.externalId)}
                      onToggleSelect={() => toggleSelect(r.externalId)}
                      onAdd={() => addOne(r)}
                    />
                  ))}
                  <div className="text-center mt-5 font-display italic text-[11px] text-ink-muted">
                    — {results.length} sonucun {visibleResults.length} tanesi gösteriliyor —
                  </div>
                </>
              )}
            </div>

            {/* Right: detail panel */}
            <aside className="hidden xl:flex w-[320px] shrink-0 flex-col border-l border-sandy/60 bg-panel px-5 py-4 overflow-y-auto">
              {detailResult ? (
                <DetailContent
                  key={detailResult.externalId}
                  r={detailResult}
                  rank={detailRank}
                  isAdding={isAdding}
                  onAdd={() => addOne(detailResult)}
                  onClose={() => setDetailId(null)}
                />
              ) : (
                <div className="flex flex-1 items-center justify-center text-center font-display italic text-[13px] text-ink-muted px-2">
                  Bir sonuç seç — detaylar burada açılır.
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </WorkspaceShell>
  )
}

// ── Helper sub-components ─────────────────────────────────────────

function DbChip({
  label,
  color,
  count,
  state,
}: {
  label: string
  color: string
  count: number
  state: "idle" | "searching" | "done"
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full border font-ui text-[11px] text-white/85"
      style={{
        background: "rgba(255,255,255,0.08)",
        borderColor: "rgba(232,212,154,0.18)",
      }}
    >
      <span
        className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-[3px] text-white font-display text-[9px] font-semibold"
        style={{ background: color }}
      >
        {label[0]}
      </span>
      <span>{label}</span>
      {state === "searching" ? (
        <Loader2 className="h-3 w-3 animate-spin text-gold-soft" />
      ) : count > 0 ? (
        <span className="text-gold-soft/65 tabular-nums">
          {count.toLocaleString("tr-TR")}
        </span>
      ) : null}
    </span>
  )
}

function FilterPill({
  label,
  icon,
  active,
  onClick,
  children,
}: {
  label: string
  icon?: React.ReactNode
  active?: boolean
  onClick?: () => void
  children?: React.ReactNode
}) {
  // Show the dropdown chevron only when a child popover/select is
  // attached; pure toggle pills (PDF'li) shouldn't imply a menu.
  const hasDropdown = !!children;
  return (
    <span
      onClick={onClick}
      className={cn(
        "group relative inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-ui text-[11.5px] cursor-pointer transition-colors",
        active
          ? "border-gold bg-gold/15 text-gold-dark"
          : "border-sandy bg-elevated text-ink-light hover:bg-panel",
      )}
    >
      {icon}
      {label}
      {hasDropdown && <ChevronDown className="h-2.5 w-2.5" />}
      {children}
    </span>
  )
}

function RefineSection({
  title,
  items,
  onToggle,
}: {
  title: string
  items: Array<{ id: string; label: string; count: number; checked: boolean }>
  onToggle: (id: string) => void
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2">
        {title}
      </div>
      <div className="flex flex-col gap-1">
        {items.map((item) => (
          <label
            key={item.id}
            className="flex items-center gap-2 font-ui text-[12px] text-ink-light cursor-pointer hover:text-ink transition-colors"
          >
            <input
              type="checkbox"
              checked={item.checked}
              onChange={() => onToggle(item.id)}
              className="accent-forest"
            />
            <span className="flex-1 truncate">{item.label}</span>
            <span className="text-[11px] text-ink-muted tabular-nums">
              {item.count}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

function SearchStatusIndicator({
  isSearching,
  isDone,
  isIdle,
  cached,
  visibleCount,
  totalCount,
  rawTotal,
  durationMs,
  stageLabel,
}: {
  isSearching: boolean
  isDone: boolean
  isIdle: boolean
  cached: boolean
  visibleCount: number
  totalCount: number
  rawTotal: number
  durationMs: number | null
  stageLabel: string
}) {
  let dotColor = "#cbb88b"
  if (isSearching) dotColor = "var(--color-gold)"
  if (isDone) dotColor = "#5ab070"

  return (
    <div className="inline-flex items-center gap-2">
      <span
        className="inline-block w-2 h-2 rounded-full"
        style={{ background: dotColor }}
      />
      <span className="font-ui text-[10px] uppercase tracking-[0.12em] text-ink">
        {isSearching ? stageLabel : isDone ? "Tarama tamamlandı" : isIdle ? "Aramaya hazır" : stageLabel}
      </span>
      {isDone && (
        <span className="text-[11px] text-ink-muted">
          · {rawTotal > 0 && `${rawTotal.toLocaleString("tr-TR")} sonuçtan `}
          en alâkalı {visibleCount}
          {totalCount !== visibleCount && ` / ${totalCount}`} gösteriliyor
          {durationMs && ` · ${(durationMs / 1000).toFixed(1)} sn`}
          {cached && " · cache"}
        </span>
      )}
    </div>
  )
}

function BulkAddPanel({
  selectedCount,
  selectableCount,
  isAdding,
  onSelectAll,
  onClear,
  onAdd,
}: {
  selectedCount: number
  selectableCount: number
  isAdding: boolean
  onSelectAll: () => void
  onClear: () => void
  onAdd: () => void
}) {
  return (
    <div className="rounded-md border border-gold/40 bg-gold/10 p-2.5 font-ui text-[11px] text-ink space-y-2">
      <div className="text-[10px] uppercase tracking-[0.16em] text-gold-dark">
        Toplu seçim
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAll}
          className="px-1.5 py-0.5 rounded-sm text-gold-dark hover:bg-gold/15 transition-colors"
        >
          Tümünü seç ({selectableCount})
        </button>
        {selectedCount > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="px-1.5 py-0.5 rounded-sm text-ink-light hover:bg-elevated transition-colors"
          >
            Temizle
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onAdd}
        disabled={selectedCount === 0 || isAdding}
        className="w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md bg-gold text-white font-semibold hover:bg-gold-hover transition-colors disabled:opacity-50"
      >
        {isAdding ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Plus className="h-3 w-3" />
        )}
        {selectedCount > 0 ? `${selectedCount} kaynağı ekle` : "Eklenecek seçim yok"}
      </button>
    </div>
  )
}

function ResultCard({
  r,
  rank,
  query,
  active,
  isSelected,
  onActivate,
  onToggleSelect,
  onAdd,
}: {
  r: SearchResult
  rank: number
  query: string
  active: boolean
  isSelected: boolean
  onActivate: () => void
  onToggleSelect: () => void
  onAdd: () => void
}) {
  const dbColor = PROVIDER_COLORS[r.provider] ?? "#5a4a2a"
  const score = r.relevanceScore ?? 0
  const scoreNorm = score / 10
  const snippet = useMemo(
    () => highlightSnippet(r.abstract, query),
    [r.abstract, query],
  )

  return (
    <article
      onClick={onActivate}
      className={cn(
        "relative flex gap-3.5 rounded-[10px] p-3.5 mb-2 cursor-pointer transition-all",
        active
          ? "bg-elevated border border-sandy/60 shadow-[inset_3px_0_0_var(--color-gold)]"
          : "bg-transparent border border-transparent hover:bg-panel/60",
      )}
    >
      {/* Rank + score */}
      <div className="flex w-11 shrink-0 flex-col items-center gap-1">
        <div
          className={cn(
            "font-display italic text-[22px] font-medium leading-none",
            rank <= 3 ? "text-gold" : "text-ink-muted",
          )}
        >
          {rank}
        </div>
        <div className="font-ui text-[9px] uppercase tracking-widest text-ink-muted">
          skor
        </div>
        <div
          className={cn(
            "font-mono text-[11px] font-semibold tabular-nums",
            scoreNorm >= 0.85 ? "text-forest" : "text-ink-light",
          )}
        >
          {scoreNorm.toFixed(2)}
        </div>
      </div>

      {/* Source spine */}
      <div
        className="w-1 shrink-0 self-stretch rounded-sm"
        style={{ background: dbColor }}
      />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2 flex-wrap font-ui text-[11px]">
          <span
            className="font-semibold uppercase tracking-[0.08em]"
            style={{ color: dbColor }}
          >
            {PROVIDER_LABELS[r.provider] ?? r.provider}
          </span>
          <span className="text-ink-muted">·</span>
          <span className="font-display italic text-ink-muted">
            {r.year ?? "—"}
          </span>
          {r.openAccessUrl && (
            <>
              <span className="text-ink-muted">·</span>
              <span className="inline-flex items-center gap-1 text-gold-dark">
                <FileDown className="h-3 w-3" />
                PDF
              </span>
            </>
          )}
          {r.openAccessUrl && (
            <span
              className="inline-flex items-center px-1.5 py-0 rounded-sm font-ui text-[9px] font-semibold uppercase"
              style={{ background: "rgba(58,82,56,0.15)", color: "var(--color-forest)" }}
            >
              açık erişim
            </span>
          )}
          {(r.citationCount ?? 0) > 50 && (
            <>
              <span className="text-ink-muted">·</span>
              <span className="inline-flex items-center gap-1 text-ink-muted">
                <Quote className="h-3 w-3" />
                {r.citationCount} atıf
              </span>
            </>
          )}
        </div>

        <h3 className="mt-1.5 font-display text-[16px] font-semibold leading-snug text-ink line-clamp-2">
          {r.title}
        </h3>
        <div className="mt-1 font-display italic text-[12.5px] text-ink-light line-clamp-1">
          {r.authors.length > 0 ? r.authors.slice(0, 3).join(", ") : r.authorSurname}
          {r.journalName && (
            <>
              <span className="text-ink-muted"> · </span>
              <span className="not-italic">{r.journalName}</span>
            </>
          )}
        </div>

        {r.abstract && (
          <p className="mt-2 font-body text-[12.5px] leading-relaxed text-ink-light line-clamp-2">
            {snippet.map((part, i) =>
              part.bold ? (
                <mark
                  key={i}
                  className="rounded-sm px-0.5 py-0 bg-gold/30 text-ink"
                >
                  {part.text}
                </mark>
              ) : (
                <span key={i}>{part.text}</span>
              ),
            )}
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={isSelected}
            onChange={onToggleSelect}
            disabled={r.alreadyInLibrary}
            className="accent-gold h-3.5 w-3.5 disabled:opacity-30"
            title="Toplu eklemeye dahil et"
          />
          <button
            type="button"
            onClick={onAdd}
            disabled={r.alreadyInLibrary}
            className={cn(
              "inline-flex items-center gap-1 px-2.5 py-1 rounded-md font-ui text-[11.5px]",
              r.alreadyInLibrary
                ? "bg-panel text-ink-muted cursor-default"
                : "border border-sandy bg-elevated text-ink hover:bg-panel transition-colors",
            )}
          >
            {r.alreadyInLibrary ? (
              <>
                <CheckCircle2 className="h-3 w-3 text-forest" />
                Eklendi
              </>
            ) : (
              <>
                <Plus className="h-3 w-3" />
                Kütüphane&apos;ye ekle
              </>
            )}
          </button>
          {r.openAccessUrl && (
            <a
              href={r.openAccessUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-ui text-[11px] text-ink-light hover:bg-elevated transition-colors"
            >
              <FileDown className="h-3 w-3" />
              PDF
            </a>
          )}
          {r.url && (
            <a
              href={r.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md font-ui text-[11px] text-ink-light hover:bg-elevated transition-colors"
              title="Kaynak sayfası"
            >
              <ExternalLink className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </article>
  )
}

function DetailContent({
  r,
  rank,
  isAdding,
  onAdd,
  onClose,
}: {
  r: SearchResult
  rank: number
  isAdding: boolean
  onAdd: () => void
  onClose: () => void
}) {
  const components = useMemo(() => scoreComponents(r), [r])
  const score = (r.relevanceScore ?? 0) / 10

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <div className="flex items-center justify-between mb-3">
        <span className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest">
          Skor: {score.toFixed(2)} · #{rank}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="h-6 w-6 flex items-center justify-center rounded-sm text-ink-muted hover:bg-elevated transition-colors"
          aria-label="Detayı kapat"
        >
          <XIcon className="h-4 w-4" />
        </button>
      </div>

      <h3 className="font-display text-[18px] font-semibold leading-snug text-ink">
        {r.title}
      </h3>
      <div className="mt-2 font-display italic text-[12.5px] text-ink-light">
        {r.authors.length > 0 ? r.authors.slice(0, 4).join(", ") : r.authorSurname}
      </div>
      <div className="mt-1 font-ui text-[11.5px] text-ink-muted">
        {r.journalName ?? r.publisher ?? "—"}
        {r.year && ` · ${r.year}`}
      </div>

      <div className="flex flex-wrap gap-1 mt-2.5">
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-ui text-[10px] font-semibold text-white"
          style={{ background: PROVIDER_COLORS[r.provider] ?? "#5a4a2a" }}
        >
          {PROVIDER_LABELS[r.provider] ?? r.provider}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-ui text-[10px] bg-sandy-soft text-ink-light uppercase">
          {TYPE_LABELS[r.entryType] ?? r.entryType}
        </span>
        {r.openAccessUrl && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm font-ui text-[10px] bg-[#e5d6b4] text-[#7a5b1f]">
            <FileDown className="h-2.5 w-2.5" />
            PDF
          </span>
        )}
      </div>

      {r.abstract && (
        <div className="mt-4">
          <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-1.5">
            Özet
          </div>
          <div className="font-display text-[12.5px] leading-relaxed text-ink max-h-[200px] overflow-y-auto">
            {r.abstract}
          </div>
        </div>
      )}

      <div className="mt-4">
        <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-forest mb-2">
          Neden bu sonuç?
        </div>
        <div className="flex flex-col gap-1.5">
          <ScoreBar label="Anahtar kelime" v={components.keyword} />
          <ScoreBar label="Atıf yoğunluğu" v={components.citations} />
          <ScoreBar label="Yenilik" v={components.recency} />
          <ScoreBar label="Açık erişim" v={components.openAccess} />
        </div>
      </div>

      <div className="flex gap-1.5 mt-auto pt-4">
        <button
          type="button"
          onClick={onAdd}
          disabled={r.alreadyInLibrary || isAdding}
          className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-gold px-3 py-2 font-ui text-[12px] font-semibold text-white hover:bg-gold-hover transition-colors disabled:opacity-50"
        >
          {isAdding ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : r.alreadyInLibrary ? (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Kütüphanede
            </>
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" />
              Kütüphane&apos;ye ekle
            </>
          )}
        </button>
        {r.openAccessUrl && (
          <a
            href={r.openAccessUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-sandy bg-elevated text-ink-light hover:bg-panel transition-colors"
            title="PDF'i aç"
          >
            <FileDown className="h-3.5 w-3.5" />
          </a>
        )}
        {r.doi && (
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(r.doi ?? "")
              toast.success("DOI kopyalandı")
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-sandy bg-elevated text-ink-light hover:bg-panel transition-colors"
            title="DOI'yi kopyala"
          >
            <Quote className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  )
}

function ScoreBar({ label, v }: { label: string; v: number }) {
  const pct = Math.round(v * 100)
  const fillColor = v > 0.8 ? "var(--color-forest)" : "var(--color-gold)"
  return (
    <div className="flex items-center gap-2 font-ui text-[11.5px] text-ink-light">
      <span className="w-[100px] truncate">{label}</span>
      <div className="flex-1 h-1 rounded-sm bg-sandy-soft overflow-hidden">
        <div className="h-full rounded-sm" style={{ width: `${pct}%`, background: fillColor }} />
      </div>
      <span className="font-mono text-[10px] text-ink tabular-nums w-7 text-right">
        {v.toFixed(2)}
      </span>
    </div>
  )
}

function EmptyHero() {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="font-display italic text-[18px] text-ink-muted mb-2">
        Aramaya başla
      </div>
      <p className="font-body text-sm text-ink-light max-w-md">
        Konu, kavram veya yazar adı yaz — sistem akademik veritabanlarını
        paralel tarar, en alâkalı 25 kaynağı yan yana getirir.
      </p>
    </div>
  )
}

// Click-toggle year range pill. Replaces the hover-only popover so the
// flow works on touch + keyboard. Uygula commits the draft into parent
// state; Temizle wipes both fields. Outside-click backdrop closes.
function YearRangePill({
  from,
  to,
  onChange,
}: {
  from: string
  to: string
  onChange: (from: string, to: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [draftFrom, setDraftFrom] = useState(from)
  const [draftTo, setDraftTo] = useState(to)

  // Sync draft when parent state changes (e.g. cleared by another path).
  useEffect(() => {
    if (!open) {
      setDraftFrom(from)
      setDraftTo(to)
    }
  }, [from, to, open])

  const active = !!(from || to)
  const label = active ? `${from || "…"}–${to || "…"}` : "Yıl aralığı"

  function commit() {
    onChange(draftFrom, draftTo)
    setOpen(false)
  }
  function clear() {
    setDraftFrom("")
    setDraftTo("")
    onChange("", "")
    setOpen(false)
  }

  return (
    <span className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border font-ui text-[11.5px] cursor-pointer transition-colors",
          active
            ? "border-gold bg-gold/15 text-gold-dark"
            : "border-sandy bg-elevated text-ink-light hover:bg-panel",
        )}
      >
        {label}
        <ChevronDown
          className={cn("h-2.5 w-2.5 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
          />
          <div
            className="absolute left-0 top-full mt-1 z-40 flex flex-col gap-2 bg-elevated border border-sandy rounded-md p-2.5 shadow-lg min-w-[240px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                placeholder="başlangıç"
                value={draftFrom}
                onChange={(e) => setDraftFrom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit()
                  if (e.key === "Escape") setOpen(false)
                }}
                autoFocus
                className="w-20 px-2 py-1 rounded-sm border border-sandy bg-white text-[12px] outline-none focus:border-gold"
              />
              <span className="text-ink-muted">–</span>
              <input
                type="number"
                placeholder="bitiş"
                value={draftTo}
                onChange={(e) => setDraftTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit()
                  if (e.key === "Escape") setOpen(false)
                }}
                className="w-20 px-2 py-1 rounded-sm border border-sandy bg-white text-[12px] outline-none focus:border-gold"
              />
            </div>
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={clear}
                className="font-ui text-[11px] text-ink-muted hover:text-ink transition-colors"
              >
                Temizle
              </button>
              <button
                type="button"
                onClick={commit}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-md bg-gold text-white font-ui text-[11px] font-semibold hover:bg-gold-hover transition-colors"
              >
                Uygula
              </button>
            </div>
          </div>
        </>
      )}
    </span>
  )
}
