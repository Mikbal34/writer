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
  Loader2,
  BookOpen,
  FileText,
  Circle,
  Search,
} from "lucide-react";
import { toast } from "sonner";
import { Ornament, PageTitle, SpineShadow } from "@/components/shared/BookElements";
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
  if (kind === "pdf") return <BookOpen className="h-3.5 w-3.5 text-forest-light" />;
  if (kind === "chunks") return <FileText className="h-3.5 w-3.5 text-gold" />;
  return <Circle className="h-3.5 w-3.5 text-ink-muted" />;
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
    <div className="h-full flex flex-col md:flex-row">
      {/* Left: title + search + list (header sayfanın tamamına değil,
          sadece sol panelin başına yerleşir — Atıf Doğrulama ekranın
          "asıl iş alanı" sol tarafta, sağ panel seçilen atıfı gösterir.) */}
      <aside className="md:w-[440px] md:shrink-0 flex flex-col min-h-0">
        <div className="px-5 pt-6 pb-3">
          <FadeUp>
            <PageTitle
              title="Atıf Doğrulama"
              subtitle="Yazıdaki her atıfın gerçekten kaynak sayfada yer alıp almadığını kontrol et."
            />
          </FadeUp>
          <Ornament className="w-32 mx-auto text-sandy mt-1 mb-1" />
        </div>
        <div className="p-3 border-y border-sandy/40">
          <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-light" />
              <input
                type="text"
                placeholder="Yazar / başlık / bağlam..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-sm border border-sandy/60 bg-white font-body text-sm placeholder:text-ink-muted focus:outline-none focus:border-gold/60"
              />
            </div>
            <div className="font-ui text-[11px] text-ink-light mt-2">
              {citations.length} atıf
              {filtered.length !== citations.length && (
                <span> · {filtered.length} eşleşme</span>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-10 gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-gold" />
                <span className="font-body text-sm text-ink-light">Yükleniyor...</span>
              </div>
            ) : citations.length === 0 ? (
              <div className="px-5 py-10 text-center font-body text-sm text-ink-light">
                Bu projede henüz atıf yok. Yazma editöründe{" "}
                <kbd className="font-ui text-[10px] px-1 py-0.5 bg-white border border-sandy rounded">
                  Cmd+Shift+C
                </kbd>{" "}
                ile bir kaynak ekle.
              </div>
            ) : filtered.length === 0 ? (
              <div className="px-5 py-10 text-center font-body text-sm text-ink-light">
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
                  const volumeStr =
                    c.volumeNumber !== null && c.volumeNumber !== undefined
                      ? ` · c. ${c.volumeNumber}`
                      : "";
                  const pageStr =
                    c.page !== null && c.page !== undefined ? ` · s. ${c.page}` : "";
                  return (
                    <li key={c.key}>
                      <button
                        type="button"
                        onClick={() => setActiveKey(c.key)}
                        className={`w-full text-left px-3 py-2.5 flex items-start gap-2 border-b border-sandy/30 transition-colors ${
                          isActive
                            ? "bg-gold/10"
                            : "hover:bg-page/90"
                        }`}
                      >
                        <span className="mt-0.5 shrink-0">
                          <StatusIcon kind={st} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="font-body text-sm text-ink truncate">
                            {author}
                            {year}
                            <span className="text-ink-light">{volumeStr}{pageStr}</span>
                          </div>
                          <div className="font-ui text-[11px] text-ink-light truncate">
                            {c.chapterNumber}. {c.chapterTitle} ·{" "}
                            {c.subsectionLabel} {c.subsectionTitle}
                          </div>
                          {c.contextSnippet && (
                            <div className="font-body text-xs text-ink-light mt-1 line-clamp-2">
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

        <SpineShadow />

        {/* Right: verify panel */}
        <section className="flex-1 min-h-0">
          {active ? (
            <CitationVerifyPanel citation={active} />
          ) : (
            <div className="h-full flex items-center justify-center font-body text-sm text-ink-light">
              Solda bir atıf seç.
            </div>
          )}
        </section>
    </div>
  );
}
