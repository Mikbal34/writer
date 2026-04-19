"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import {
  Search,
  Loader2,
  Sparkles,
  ChevronLeft,
  ChevronUp,
  ChevronDown,
  CheckCircle2,
  ExternalLink,
  FileDown,
  AlertTriangle,
  Library,
} from "lucide-react"
import { toast } from "sonner"

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

const TYPE_LABELS: Record<string, string> = {
  makale: "Makale",
  kitap: "Kitap",
  tez: "Tez",
}

export default function LiteratureSearchPage() {
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<string>("")
  const [yearFrom, setYearFrom] = useState("")
  const [yearTo, setYearTo] = useState("")
  const [requirePdf, setRequirePdf] = useState(true)

  const [results, setResults] = useState<SearchResult[]>([])
  const [generatedQueries, setGeneratedQueries] = useState<Array<{ text: string; reasoning?: string }>>([])
  const [cached, setCached] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  // Live search progress
  type Stage = 'idle' | 'expanding' | 'searching' | 'dedupe' | 'scoring' | 'done'
  const [stage, setStage] = useState<Stage>('idle')
  type ProviderStatus = 'pending' | 'searching' | 'done'
  const [providerState, setProviderState] = useState<Record<string, { status: ProviderStatus; count: number }>>({})
  const [dedupStats, setDedupStats] = useState<{ before: number; after: number } | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set())
  const [isAdding, setIsAdding] = useState(false)

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
    setGeneratedQueries([])
    setCached(false)

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
        // we just let the UI advance to scoring without a dedicated stage
        break
      case 'scoring':
        setStage('scoring')
        break
      case 'results': {
        const results = (evt.results as SearchResult[]) ?? []
        setResults(results)
        setStage('done')
        if (results.length === 0) {
          toast.info("Sonuç bulunamadı. Filtreleri değiştirip tekrar dene.")
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

      // Mark added results as alreadyInLibrary in the UI
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

  const toggleAbstract = useCallback((id: string) => {
    setExpandedAbstracts((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const selectableCount = results.filter((r) => !r.alreadyInLibrary).length

  const pdfAvailable = results.filter((r) => !!r.openAccessUrl)
  const pdfMissing = results.filter((r) => !r.openAccessUrl)

  return (
    <div className="min-h-screen bg-[#F5F0E6]">
      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <Link
              href="/library"
              className="inline-flex items-center gap-1 font-ui text-xs text-[#8a7a65] hover:text-[#2D1F0E] mb-2"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              Kütüphaneye Dön
            </Link>
            <h1 className="font-display text-3xl font-bold text-[#2D1F0E] flex items-center gap-2">
              <Sparkles className="h-6 w-6 text-[#C9A84C]" />
              Literatür Tara
            </h1>
            <p className="font-body text-sm text-[#6b5a45] mt-1">
              Konunu yaz, 8 akademik veritabanında (OpenAlex, Semantic Scholar, CrossRef, Google Books, arXiv, PMC, DOAJ, bioRxiv) paralel tarama yapılır; skorlanıp en alakalı 25 kaynak listelenir.
            </p>
          </div>
        </div>

        {/* Search form */}
        <form
          onSubmit={handleSearch}
          className="bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm p-5 mb-5"
        >
          <div className="flex gap-2 mb-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="örn: erken çocukluk bilişsel gelişim"
                required
                className="w-full pl-10 pr-3 py-3 rounded-sm border border-[#d4c9b5] bg-white font-body text-sm text-[#2D1F0E] placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]"
              />
            </div>
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="flex items-center gap-2 px-5 py-3 rounded-sm bg-[#2D1F0E] text-[#FAF7F0] font-ui text-sm hover:opacity-90 disabled:opacity-50"
            >
              {isSearching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {isSearching ? "Aranıyor..." : "Ara"}
            </button>
          </div>

          <div className="flex gap-3 flex-wrap text-sm">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-3 py-1.5 rounded-sm border border-[#d4c9b5] bg-white text-[#2D1F0E] font-ui text-xs"
            >
              <option value="">Tüm tipler</option>
              <option value="makale">Makale</option>
              <option value="kitap">Kitap</option>
              <option value="tez">Tez</option>
            </select>
            <input
              type="number"
              value={yearFrom}
              onChange={(e) => setYearFrom(e.target.value)}
              placeholder="Yıl ≥"
              className="w-24 px-2 py-1.5 rounded-sm border border-[#d4c9b5] bg-white text-[#2D1F0E] font-ui text-xs"
            />
            <input
              type="number"
              value={yearTo}
              onChange={(e) => setYearTo(e.target.value)}
              placeholder="Yıl ≤"
              className="w-24 px-2 py-1.5 rounded-sm border border-[#d4c9b5] bg-white text-[#2D1F0E] font-ui text-xs"
            />
            <label className="flex items-center gap-2 font-ui text-xs text-[#6b5a45] cursor-pointer">
              <input
                type="checkbox"
                checked={requirePdf}
                onChange={(e) => setRequirePdf(e.target.checked)}
                className="accent-[#C9A84C]"
              />
              Sadece PDF'i olanlar
            </label>
          </div>

          {generatedQueries.length > 0 && !cached && (
            <div className="mt-3 p-3 rounded-sm bg-[#C9A84C]/10 border border-[#C9A84C]/30">
              <p className="font-ui text-[11px] text-[#8a7a65] mb-1.5">
                AI ile genişletildi:
              </p>
              <div className="flex flex-wrap gap-1.5">
                {generatedQueries.map((q, i) => (
                  <span
                    key={i}
                    className="font-ui text-[11px] px-2 py-0.5 rounded bg-[#FAF7F0] text-[#6b5a45] border border-[#d4c9b5]"
                    title={q.reasoning}
                  >
                    {q.text}
                  </span>
                ))}
              </div>
            </div>
          )}
        </form>

        {/* Live progress — shown while stage !== idle/done */}
        {stage !== 'idle' && stage !== 'done' && (
          <div className="mb-5 p-4 rounded-sm bg-[#FAF7F0] border border-[#d4c9b5]">
            <div className="flex items-center gap-2 mb-3">
              <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
              <span className="font-ui text-sm font-medium text-[#2D1F0E]">
                {stage === 'expanding' && "AI sorguyu genişletiyor..."}
                {stage === 'searching' && "Akademik kaynaklar taranıyor..."}
                {stage === 'dedupe' && "Sonuçlar tekilleştiriliyor..."}
                {stage === 'scoring' && "AI alaka skorlaması yapıyor..."}
              </span>
            </div>

            {/* Provider checklist */}
            {(stage === 'searching' || stage === 'dedupe' || stage === 'scoring') &&
              Object.keys(providerState).length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {Object.entries(providerState).map(([provider, { status, count }]) => {
                  const label = PROVIDER_LABELS[provider] ?? provider
                  const isDone = status === 'done'
                  return (
                    <div
                      key={provider}
                      className="flex items-center gap-2 p-2 rounded-sm border transition-colors"
                      style={{
                        borderColor: isDone ? '#d4c9b5' : '#e8e2d8',
                        backgroundColor: isDone ? 'rgba(45,139,78,0.04)' : 'transparent',
                      }}
                    >
                      {isDone ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-[#2D8B4E] shrink-0" />
                      ) : (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-[#C9A84C] shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="font-ui text-xs text-[#2D1F0E] truncate">{label}</div>
                        {isDone && (
                          <div className="font-ui text-[10px] text-[#8a7a65] tabular-nums">
                            {count} sonuç
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {dedupStats && (stage === 'dedupe' || stage === 'scoring') && (
              <p className="font-ui text-[11px] text-[#8a7a65] mt-3">
                {dedupStats.before} ham sonuç → {dedupStats.after} tekil
              </p>
            )}
          </div>
        )}

        {/* Bulk-add bar */}
        {selectableCount > 0 && (
          <div className="sticky top-4 z-10 mb-4 flex items-center justify-between p-3 rounded-sm bg-[#2D1F0E] text-[#FAF7F0]">
            <div className="flex items-center gap-3 font-ui text-sm">
              <span>
                {selectedIds.size} seçili · {selectableCount} eklenebilir
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="text-[#C9A84C] text-xs hover:underline"
              >
                Tümünü seç
              </button>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-xs text-[#FAF7F0]/70 hover:text-[#FAF7F0] hover:underline"
                >
                  Temizle
                </button>
              )}
            </div>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={selectedIds.size === 0 || isAdding}
              className="flex items-center gap-2 px-4 py-1.5 rounded-sm bg-[#C9A84C] text-[#1a0f05] font-ui text-xs font-medium hover:bg-[#d4b85a] disabled:opacity-50"
            >
              {isAdding ? <Loader2 className="h-3 w-3 animate-spin" /> : <Library className="h-3 w-3" />}
              Kütüphaneme Ekle
            </button>
          </div>
        )}

        {/* PDF download status */}
        {pollIds.length > 0 && (activeDownloads > 0 || readyDownloads > 0 || failedDownloads > 0) && (
          <div className="mb-4 flex items-center gap-4 p-3 rounded-sm bg-[#FAF7F0] border border-[#d4c9b5] font-ui text-xs">
            {activeDownloads > 0 && (
              <span className="flex items-center gap-1.5 text-[#6b5a45]">
                <Loader2 className="h-3 w-3 animate-spin" />
                {activeDownloads} PDF indiriliyor
              </span>
            )}
            {readyDownloads > 0 && (
              <span className="flex items-center gap-1.5 text-[#2D8B4E]">
                <CheckCircle2 className="h-3 w-3" />
                {readyDownloads} hazır
              </span>
            )}
            {failedDownloads > 0 && (
              <span className="flex items-center gap-1.5 text-[#c44]">
                <AlertTriangle className="h-3 w-3" />
                {failedDownloads} başarısız
              </span>
            )}
          </div>
        )}

        {/* Results */}
        {results.length === 0 && !isSearching && (
          <div className="text-center py-16 font-ui text-sm text-[#8a7a65]">
            Sonuçlar burada görünecek.
          </div>
        )}

        {pdfAvailable.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <FileDown className="h-4 w-4 text-[#2D8B4E]" />
              <h2 className="font-display text-sm font-semibold text-[#2D1F0E]">
                PDF'i Hazır ({pdfAvailable.length})
              </h2>
              <span className="font-ui text-[11px] text-[#8a7a65]">
                — eklerken PDF'i otomatik indirilir
              </span>
            </div>
            <div className="space-y-3">{pdfAvailable.map(renderCard)}</div>
          </div>
        )}

        {pdfMissing.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-[#C9A84C]" />
              <h2 className="font-display text-sm font-semibold text-[#2D1F0E]">
                PDF Yüklenmesi Gerekenler ({pdfMissing.length})
              </h2>
              <span className="font-ui text-[11px] text-[#8a7a65]">
                — kütüphaneye ekledikten sonra manuel PDF yüklemen gerekir, yoksa yazımda kullanılmaz
              </span>
            </div>
            <div className="space-y-3">{pdfMissing.map(renderCard)}</div>
          </div>
        )}
      </div>
    </div>
  )

  function renderCard(r: SearchResult) {
    const isSelected = selectedIds.has(r.externalId)
    const isExpanded = expandedAbstracts.has(r.externalId)
    return (
      <div
        key={r.externalId}
        className={`rounded-sm border p-4 transition-colors ${
          r.alreadyInLibrary
            ? "bg-[#F5F0E6]/50 border-[#d4c9b5]/40"
            : isSelected
            ? "bg-[#C9A84C]/10 border-[#C9A84C]"
            : "bg-[#FAF7F0] border-[#d4c9b5]"
        }`}
      >
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(r.externalId)}
                    disabled={r.alreadyInLibrary}
                    className="mt-1 h-4 w-4 accent-[#C9A84C] disabled:opacity-40"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="font-body text-[15px] font-semibold text-[#2D1F0E] leading-snug">
                          {r.title}
                        </h3>
                        <p className="font-ui text-xs text-[#6b5a45] mt-0.5">
                          {r.authors.slice(0, 4).join(", ")}
                          {r.authors.length > 4 && ` +${r.authors.length - 4}`}
                          {r.year && ` · ${r.year}`}
                          {r.journalName && ` · ${r.journalName}`}
                          {r.publisher && !r.journalName && ` · ${r.publisher}`}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {r.relevanceScore !== undefined && (
                          <span
                            className="font-ui text-[10px] px-2 py-0.5 rounded-full bg-[#C9A84C]/20 text-[#8a7540] tabular-nums"
                            title="Konuya alaka skoru (0-10)"
                          >
                            {r.relevanceScore.toFixed(1)}/10
                          </span>
                        )}
                        {r.citationCount !== null && r.citationCount > 0 && (
                          <span className="font-ui text-[10px] text-[#8a7a65] tabular-nums">
                            {r.citationCount.toLocaleString("tr-TR")} atıf
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      <span className="font-ui text-[10px] px-1.5 py-0.5 rounded bg-[#d4c9b5]/40 text-[#6b5a45]">
                        {TYPE_LABELS[r.entryType] ?? r.entryType}
                      </span>
                      <span className="font-ui text-[10px] px-1.5 py-0.5 rounded bg-[#d4c9b5]/40 text-[#6b5a45]">
                        {PROVIDER_LABELS[r.provider] ?? r.provider}
                      </span>
                      {r.openAccessUrl && (
                        <span className="font-ui text-[10px] px-1.5 py-0.5 rounded bg-[#2D8B4E]/15 text-[#2D8B4E] flex items-center gap-1">
                          <FileDown className="h-2.5 w-2.5" />
                          Açık erişim
                        </span>
                      )}
                      {r.alreadyInLibrary && (
                        <span className="font-ui text-[10px] px-1.5 py-0.5 rounded bg-[#5c7cfa]/15 text-[#5c7cfa] flex items-center gap-1">
                          <CheckCircle2 className="h-2.5 w-2.5" />
                          Kütüphanende
                        </span>
                      )}
                      {r.doi && (
                        <a
                          href={`https://doi.org/${r.doi}`}
                          target="_blank"
                          rel="noreferrer"
                          className="font-ui text-[10px] text-[#8a7a65] hover:text-[#C9A84C] flex items-center gap-1"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                          DOI
                        </a>
                      )}
                    </div>

                    {r.abstract && (
                      <div className="mt-2">
                        <p className="font-body text-xs text-[#4d3f2e] leading-relaxed">
                          {isExpanded ? r.abstract : r.abstract.slice(0, 240)}
                          {r.abstract.length > 240 && !isExpanded && "..."}
                        </p>
                        {r.abstract.length > 240 && (
                          <button
                            type="button"
                            onClick={() => toggleAbstract(r.externalId)}
                            className="font-ui text-[10px] text-[#C9A84C] hover:underline mt-1 flex items-center gap-1"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="h-2.5 w-2.5" /> Daralt
                              </>
                            ) : (
                              <>
                                <ChevronDown className="h-2.5 w-2.5" /> Tamamını göster
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
    )
  }
}
