"use client";

import { useState } from "react";
import {
  Search,
  Loader2,
  Sparkles,
  BookMarked,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  ExternalLink,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Ornament, PageNumber, PageTitle } from "@/components/shared/BookElements";
import { FadeUp, FadeIn } from "@/components/shared/Animations";

interface SearchResult {
  externalId: string;
  provider: string;
  title: string;
  authorSurname: string;
  authorName: string | null;
  authors: string[];
  year: string | null;
  publisher: string | null;
  journalName: string | null;
  doi: string | null;
  url: string | null;
  abstract: string | null;
  citationCount: number | null;
  entryType: string;
  openAccessUrl: string | null;
  alreadyInLibrary?: boolean;
}

interface AIQuery {
  text: string;
  reasoning?: string;
}

const PROVIDER_LABELS: Record<string, string> = {
  openalex: "OpenAlex",
  semantic_scholar: "Semantic Scholar",
  crossref: "CrossRef",
  google_books: "Google Books",
};

const PROVIDER_COLORS: Record<string, string> = {
  openalex: "bg-blue-100 text-blue-700",
  semantic_scholar: "bg-purple-100 text-purple-700",
  crossref: "bg-orange-100 text-orange-700",
  google_books: "bg-green-100 text-green-700",
};

const TYPE_LABELS: Record<string, string> = {
  makale: "Makale",
  kitap: "Kitap",
  tez: "Tez",
};

export default function ResearchPage({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [mode, setMode] = useState<"manual" | "ai">("manual");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [aiQueries, setAiQueries] = useState<AIQuery[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isImporting, setIsImporting] = useState(false);
  const [expandedAbstracts, setExpandedAbstracts] = useState<Set<string>>(new Set());

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");

  async function handleManualSearch(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;

    setIsSearching(true);
    setResults([]);
    setSelectedIds(new Set());

    try {
      const params = new URLSearchParams({ q: query, projectId, limit: "15" });
      if (typeFilter) params.set("type", typeFilter);
      if (yearFrom) params.set("yearFrom", yearFrom);
      if (yearTo) params.set("yearTo", yearTo);

      const res = await fetch(`/api/research/search?${params}`);
      if (!res.ok) throw new Error("Search failed");

      const data = await res.json();
      setResults(data.results);

      if (data.results.length === 0) {
        toast.info("Sonuç bulunamadı");
      }
    } catch {
      toast.error("Arama sırasında hata oluştu");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleAISearch() {
    if (!aiDescription.trim()) return;

    setIsSearching(true);
    setResults([]);
    setAiQueries([]);
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/research/ai-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: aiDescription, projectId }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 402) {
          toast.error("Yetersiz kredi");
          return;
        }
        throw new Error(err.error || "AI search failed");
      }

      const data = await res.json();
      setAiQueries(data.queries || []);
      setResults(data.results || []);

      if (data.results?.length === 0) {
        toast.info("Sonuç bulunamadı");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI arama başarısız";
      toast.error(msg);
    } finally {
      setIsSearching(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAbstract(id: string) {
    setExpandedAbstracts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleImport() {
    const selected = results.filter((r) => selectedIds.has(r.externalId));
    if (selected.length === 0) return;

    setIsImporting(true);
    try {
      const res = await fetch("/api/research/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ results: selected, projectId }),
      });

      if (!res.ok) throw new Error("Import failed");

      const data = await res.json();
      toast.success(
        `${data.created} kaynak eklendi${data.linked > 0 ? `, ${data.linked} projeye bağlandı` : ""}${data.skipped > 0 ? ` (${data.skipped} zaten mevcut)` : ""}`
      );

      // Mark imported results
      setResults((prev) =>
        prev.map((r) =>
          selectedIds.has(r.externalId) ? { ...r, alreadyInLibrary: true } : r
        )
      );
      setSelectedIds(new Set());
    } catch {
      toast.error("Import başarısız oldu");
    } finally {
      setIsImporting(false);
    }
  }

  const selectableResults = results.filter((r) => !r.alreadyInLibrary);

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 overflow-y-auto flex-1 min-h-0">
      {/* Header */}
      <FadeUp className="mb-6">
        <PageTitle
          title="Literatür Araştırma"
          subtitle="Akademik veritabanlarında kaynak arayın ve projenize ekleyin"
        />
      </FadeUp>

      {/* Mode tabs */}
      <FadeIn delay={0.1} className="flex gap-1 mb-4">
        <button
          onClick={() => setMode("manual")}
          className={`px-4 py-2 font-ui text-xs rounded-sm transition-colors ${
            mode === "manual"
              ? "bg-forest text-[#F5EDE0]"
              : "bg-[#e8dfd0]/40 text-ink hover:bg-[#e8dfd0]/60"
          }`}
        >
          <Search className="w-3.5 h-3.5 inline mr-1.5" />
          Manuel Arama
        </button>
        <button
          onClick={() => setMode("ai")}
          className={`px-4 py-2 font-ui text-xs rounded-sm transition-colors ${
            mode === "ai"
              ? "bg-forest text-[#F5EDE0]"
              : "bg-[#e8dfd0]/40 text-ink hover:bg-[#e8dfd0]/60"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 inline mr-1.5" />
          AI Destekli Arama
          <span className="ml-1.5 text-[10px] opacity-70">~5 kredi</span>
        </button>
      </FadeIn>

      {/* Manual search */}
      {mode === "manual" && (
        <FadeIn delay={0.15} className="mb-6">
          <form onSubmit={handleManualSearch} className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Anahtar kelime, yazar, başlık..."
                className="flex-1 bg-[#FAF7F0] border-[#d4c9b5] font-ui text-sm"
              />
              <button
                type="submit"
                disabled={isSearching || !query.trim()}
                className="px-4 py-2 bg-forest text-[#F5EDE0] rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors disabled:opacity-50"
              >
                {isSearching ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
              </button>
            </div>

            {/* Filters */}
            <div className="flex gap-3 flex-wrap">
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="px-3 py-1.5 bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm font-ui text-xs text-ink"
              >
                <option value="">Tüm türler</option>
                <option value="makale">Makale</option>
                <option value="kitap">Kitap</option>
                <option value="tez">Tez</option>
              </select>
              <div className="flex items-center gap-1.5">
                <Input
                  value={yearFrom}
                  onChange={(e) => setYearFrom(e.target.value)}
                  placeholder="Yıldan"
                  className="w-20 h-8 bg-[#FAF7F0] border-[#d4c9b5] font-ui text-xs"
                  type="number"
                />
                <span className="text-muted-foreground text-xs">—</span>
                <Input
                  value={yearTo}
                  onChange={(e) => setYearTo(e.target.value)}
                  placeholder="Yıla"
                  className="w-20 h-8 bg-[#FAF7F0] border-[#d4c9b5] font-ui text-xs"
                  type="number"
                />
              </div>
            </div>
          </form>
        </FadeIn>
      )}

      {/* AI search */}
      {mode === "ai" && (
        <FadeIn delay={0.15} className="mb-6">
          <div className="space-y-3">
            <textarea
              value={aiDescription}
              onChange={(e) => setAiDescription(e.target.value)}
              placeholder="Ne tür kaynaklar arıyorsunuz? Doğal dilde açıklayın...&#10;Örn: Osmanlı'da vakıf sistemi ve toplumsal etkileri hakkında kaynak arıyorum"
              rows={3}
              className="w-full px-4 py-3 bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm font-body text-sm text-ink resize-none focus:outline-none focus:ring-1 focus:ring-forest"
            />
            <button
              onClick={handleAISearch}
              disabled={isSearching || !aiDescription.trim()}
              className="flex items-center gap-2 px-4 py-2 bg-forest text-[#F5EDE0] rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors disabled:opacity-50"
            >
              {isSearching ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Sparkles className="w-4 h-4" />
              )}
              Sorgu Üret & Ara
            </button>
          </div>

          {/* AI-generated queries */}
          {aiQueries.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {aiQueries.map((q, i) => (
                <div
                  key={i}
                  className="px-3 py-1.5 bg-[#e8dfd0]/50 rounded-sm text-xs font-ui text-ink"
                  title={q.reasoning}
                >
                  &ldquo;{q.text}&rdquo;
                </div>
              ))}
            </div>
          )}
        </FadeIn>
      )}

      <Ornament className="w-48 mx-auto text-[#c9bfad] mb-4" />

      {/* Loading */}
      {isSearching && (
        <div className="flex items-center justify-center py-12 gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-forest" />
          <span className="font-ui text-sm text-muted-foreground">
            Akademik veritabanları aranıyor...
          </span>
        </div>
      )}

      {/* Results */}
      {!isSearching && results.length > 0 && (
        <div className="space-y-1">
          {/* Results header */}
          <div className="flex items-center justify-between mb-3">
            <span className="font-ui text-xs text-muted-foreground">
              {results.length} sonuç bulundu
            </span>
            {selectableResults.length > 0 && (
              <button
                onClick={() => {
                  if (selectedIds.size === selectableResults.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(selectableResults.map((r) => r.externalId)));
                  }
                }}
                className="font-ui text-xs text-forest hover:underline"
              >
                {selectedIds.size === selectableResults.length
                  ? "Seçimi kaldır"
                  : "Tümünü seç"}
              </button>
            )}
          </div>

          {/* Result cards */}
          {results.map((result) => {
            const isSelected = selectedIds.has(result.externalId);
            const isExpanded = expandedAbstracts.has(result.externalId);

            return (
              <div
                key={`${result.provider}-${result.externalId}`}
                className={`py-3 px-4 -mx-4 border-b border-[#d4c9b5]/30 transition-colors ${
                  result.alreadyInLibrary
                    ? "opacity-50"
                    : isSelected
                    ? "bg-forest/5"
                    : "hover:bg-[#e8dfd0]/15"
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  {!result.alreadyInLibrary ? (
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleSelect(result.externalId)}
                      className="mt-1 shrink-0 accent-forest"
                    />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 mt-1 text-forest shrink-0" />
                  )}

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <span className="font-body text-sm font-semibold text-ink">
                        {result.authorSurname}
                        {result.authorName ? `, ${result.authorName}` : ""}
                        {result.authors.length > 1 && (
                          <span className="text-muted-foreground font-normal">
                            {" "}et al.
                          </span>
                        )}
                      </span>
                      <span className="text-muted-foreground">—</span>
                      <span className="font-body text-sm italic text-ink-light">
                        {result.title}
                      </span>
                    </div>

                    {/* Meta line */}
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      {result.year && (
                        <span className="font-display text-xs text-muted-foreground">
                          {result.year}
                        </span>
                      )}
                      {result.journalName && (
                        <span className="font-ui text-[10px] text-muted-foreground truncate max-w-[200px]">
                          {result.journalName}
                        </span>
                      )}
                      {result.citationCount != null && result.citationCount > 0 && (
                        <span className="font-ui text-[10px] text-muted-foreground">
                          {result.citationCount} atıf
                        </span>
                      )}
                      {result.openAccessUrl && (
                        <span className="flex items-center gap-0.5 text-[10px] font-ui text-forest">
                          <Download className="w-3 h-3" />
                          OA
                        </span>
                      )}
                      <span
                        className={`font-ui text-[10px] px-1.5 py-0.5 rounded-sm ${
                          PROVIDER_COLORS[result.provider] || "bg-muted text-muted-foreground"
                        }`}
                      >
                        {PROVIDER_LABELS[result.provider] || result.provider}
                      </span>
                      <span className="font-ui text-[10px] px-1.5 py-0.5 bg-[#e8dfd0] text-ink-light rounded-sm">
                        {TYPE_LABELS[result.entryType] || result.entryType}
                      </span>
                      {result.alreadyInLibrary && (
                        <span className="font-ui text-[10px] text-forest">
                          kütüphanede
                        </span>
                      )}
                    </div>

                    {/* Abstract toggle */}
                    {result.abstract && (
                      <button
                        onClick={() => toggleAbstract(result.externalId)}
                        className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground hover:text-ink font-ui transition-colors"
                      >
                        {isExpanded ? (
                          <ChevronUp className="w-3 h-3" />
                        ) : (
                          <ChevronDown className="w-3 h-3" />
                        )}
                        Özet
                      </button>
                    )}
                    {isExpanded && result.abstract && (
                      <p className="mt-1.5 text-xs font-body text-ink-light leading-relaxed line-clamp-6">
                        {result.abstract}
                      </p>
                    )}
                  </div>

                  {/* External link */}
                  {result.url && (
                    <a
                      href={result.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="shrink-0 w-8 h-8 flex items-center justify-center hover:bg-[#e8dfd0]/50 rounded-sm transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-ink-light" />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!isSearching && results.length === 0 && (query || aiDescription) && (
        <div className="text-center py-12">
          <BookMarked className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
          <p className="font-body text-sm text-muted-foreground">
            Henüz arama yapılmadı veya sonuç bulunamadı
          </p>
        </div>
      )}

      {/* Import bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-0 left-0 right-0 mt-6 -mx-6 px-6 py-3 bg-[#FAF7F0] border-t border-[#d4c9b5] flex items-center justify-between">
          <span className="font-ui text-sm text-ink">
            {selectedIds.size} kaynak seçildi
          </span>
          <button
            onClick={handleImport}
            disabled={isImporting}
            className="flex items-center gap-2 px-4 py-2 bg-forest text-[#F5EDE0] rounded-sm font-ui text-xs hover:bg-forest/90 transition-colors disabled:opacity-50"
          >
            {isImporting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <BookMarked className="w-4 h-4" />
            )}
            Kütüphaneye Ekle & Projeye Bağla
          </button>
        </div>
      )}

      <PageNumber number="vi" />
    </div>
  );
}
