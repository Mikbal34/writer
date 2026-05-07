"use client";

/**
 * /projects/[id]/citations
 *
 * Two-pane verification screen. Left: every citation made in the
 * project, grouped by chapter. Right: the active citation's verify
 * panel — the writer's surrounding context, the cited page's
 * extracted text, and on demand the rendered original PDF page.
 */
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  BookmarkCheck,
  Loader2,
  BookOpen,
  FileText,
  Circle,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Ornament } from "@/components/shared/BookElements";
import { FadeUp } from "@/components/shared/Animations";
import CitationVerifyPanel, {
  type CitationRecord,
} from "@/components/citations/CitationVerifyPanel";

type StatusKind = "pdf" | "chunks" | "manual" | "missing";

function statusFor(c: CitationRecord): StatusKind {
  if (!c.bibliography) return "missing";
  if (c.bibliography.hasPdf) return "pdf";
  if (c.bibliography.libraryEntryId) return "chunks";
  return "manual";
}

function StatusIcon({ kind }: { kind: StatusKind }) {
  if (kind === "pdf") return <BookOpen className="h-3.5 w-3.5 text-[#2D8B4E]" />;
  if (kind === "chunks") return <FileText className="h-3.5 w-3.5 text-[#C9A84C]" />;
  return <Circle className="h-3.5 w-3.5 text-[#a89880]" />;
}

export default function CitationsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/projects/${projectId}/citations`)
      .then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)),
      )
      .then((data: { citations: CitationRecord[] }) => {
        setCitations(data.citations);
        setActiveKey((cur) => cur ?? data.citations[0]?.key ?? null);
      })
      .catch(() => toast.error("Atıflar yüklenemedi"))
      .finally(() => setLoading(false));
  }, [projectId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return citations;
    return citations.filter((c) => {
      const hay = [
        c.bibliography?.authorSurname,
        c.bibliography?.title,
        c.bibliography?.year,
        c.subsectionTitle,
        c.chapterTitle,
        c.contextSnippet,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [citations, search]);

  const active = useMemo(
    () => citations.find((c) => c.key === activeKey) ?? null,
    [citations, activeKey],
  );

  return (
    <div className="flex flex-col h-full">
      <FadeUp className="px-6 pt-8 pb-3 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <div className="h-px flex-1 max-w-[80px] bg-gradient-to-r from-transparent to-[#C9A84C]/60" />
          <BookmarkCheck className="h-5 w-5 text-[#C9A84C]" />
          <div className="h-px flex-1 max-w-[80px] bg-gradient-to-l from-transparent to-[#C9A84C]/60" />
        </div>
        <h1 className="font-display text-2xl font-bold text-[#2D1F0E] tracking-tight">
          Atıf Doğrulama
        </h1>
        <p className="font-body text-xs text-[#6b5a45] mt-1.5">
          Yazıdaki her atıfın gerçekten kaynak sayfada yer alıp almadığını kontrol et.
        </p>
        <Ornament className="w-32 mx-auto text-[#c9bfad] mt-3" />
      </FadeUp>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-[360px_1fr] gap-0 border-t border-[#d4c9b5]/40">
        {/* Left: list */}
        <aside className="border-r border-[#d4c9b5]/40 bg-[#FAF7F0]/60 flex flex-col min-h-0">
          <div className="p-3 border-b border-[#d4c9b5]/40">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#8a7a65]" />
              <input
                type="text"
                placeholder="Yazar / başlık / bağlam..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-sm border border-[#d4c9b5]/60 bg-white font-body text-sm placeholder:text-[#a89880] focus:outline-none focus:border-[#C9A84C]/60"
              />
            </div>
            <div className="font-ui text-[11px] text-[#8a7a65] mt-2">
              {citations.length} atıf
              {filtered.length !== citations.length && (
                <span> · {filtered.length} eşleşme</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-[#C9A84C]" />
                <span className="font-body text-sm text-[#8a7a65]">Yükleniyor...</span>
              </div>
            ) : citations.length === 0 ? (
              <div className="px-5 py-10 text-center font-body text-sm text-[#8a7a65]">
                Bu projede henüz atıf yok. Yazma editöründe{" "}
                <kbd className="font-ui text-[10px] px-1 py-0.5 bg-white border border-[#d4c9b5] rounded">
                  Cmd+Shift+C
                </kbd>{" "}
                ile bir kaynak ekle.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10 text-center font-body text-sm text-[#8a7a65]">
                Eşleşen atıf yok.
              </div>
            ) : (
              <ul>
                {filtered.map((c) => {
                  const isActive = c.key === activeKey;
                  const st = statusFor(c);
                  const author =
                    c.bibliography?.authorSurname ?? "Bilinmeyen";
                  const year = c.bibliography?.year
                    ? `, ${c.bibliography.year}`
                    : "";
                  const pageStr =
                    c.page !== null && c.page !== undefined ? ` · s. ${c.page}` : "";
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => setActiveKey(c.key)}
                        className={`w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-[#d4c9b5]/30 transition-colors ${
                          isActive
                            ? "bg-[#C9A84C]/10"
                            : "hover:bg-[#FAF7F0]/90"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          <StatusIcon kind={st} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-body text-sm text-[#2D1F0E] truncate">
                            {author}
                            {year}
                            <span className="text-[#6b5a45]">{pageStr}</span>
                          </div>
                          <div className="font-ui text-[11px] text-[#8a7a65] truncate">
                            {c.chapterNumber}. {c.chapterTitle} ·{" "}
                            {c.subsectionLabel} {c.subsectionTitle}
                          </div>
                          {c.contextSnippet && (
                            <div className="font-body text-xs text-[#6b5a45] mt-1 line-clamp-2">
                              {c.contextSnippet}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </aside>

        {/* Right: verify panel */}
        <section className="min-h-0">
          {active ? (
            <CitationVerifyPanel citation={active} />
          ) : (
            <div className="h-full flex items-center justify-center font-body text-sm text-[#8a7a65]">
              Solda bir atıf seç.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
