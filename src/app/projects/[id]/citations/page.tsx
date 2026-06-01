"use client";

/**
 * /projects/[id]/citations
 *
 * Two-pane verification screen. Left: every citation made in the
 * project, grouped by chapter. Right: the active citation's verify
 * panel — the writer's surrounding context, the cited page's
 * extracted text, and on demand the rendered original PDF page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  Loader2,
  Search,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Circle,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Ornament, PageTitle, SpineShadow } from "@/components/shared/BookElements";
import { FadeUp } from "@/components/shared/Animations";
import CitationVerifyPanel, {
  type CitationRecord,
} from "@/components/citations/CitationVerifyPanel";

type VerificationStatus = "unverified" | "verified" | "suspected" | "failed";

function statusOf(c: CitationRecord): VerificationStatus {
  return c.verification?.status ?? "unverified";
}

// Ranks govern list ordering — failed and suspected float to the top
// so the user can fix problems first.
const STATUS_ORDER: Record<VerificationStatus, number> = {
  failed: 0,
  suspected: 1,
  unverified: 2,
  verified: 3,
};

function StatusBadge({ status }: { status: VerificationStatus }) {
  if (status === "verified") {
    return (
      <span
        title="Doğrulandı"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-forest-light/10 text-forest font-ui text-[10px]"
      >
        <CheckCircle2 className="h-3 w-3" />
        Doğrulandı
      </span>
    );
  }
  if (status === "suspected") {
    return (
      <span
        title="Şüpheli — kaynak sayfada birebir eşleşme yok"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-gold/15 text-gold-dark font-ui text-[10px]"
      >
        <AlertTriangle className="h-3 w-3" />
        Şüpheli
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span
        title="Eşleşmiyor — kaynakta bu içerik bulunamadı"
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-red-50 text-red-700 font-ui text-[10px]"
      >
        <XCircle className="h-3 w-3" />
        Uymuyor
      </span>
    );
  }
  return (
    <span
      title="Henüz doğrulanmadı"
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-sandy/40 text-ink-light font-ui text-[10px]"
    >
      <Circle className="h-3 w-3" />
      Bekliyor
    </span>
  );
}

export default function CitationsPage() {
  const params = useParams<{ id: string }>();
  const projectId = params.id;
  const [citations, setCitations] = useState<CitationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const fetchCitations = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/citations`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: { citations: CitationRecord[] } = await r.json();
      setCitations(data.citations);
      setActiveKey((cur) => cur ?? data.citations[0]?.key ?? null);
    } catch {
      toast.error("Atıflar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchCitations();
  }, [fetchCitations]);

  const handleBulkVerify = useCallback(async () => {
    setVerifying(true);
    try {
      const r = await fetch(`/api/projects/${projectId}/citations/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data: { verified: number; suspected: number; failed: number; total: number } =
        await r.json();
      toast.success(
        `${data.total} atıf tarandı — ${data.verified} doğrulandı, ${data.suspected} şüpheli, ${data.failed} uymuyor`,
      );
      await fetchCitations();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Doğrulama başarısız");
    } finally {
      setVerifying(false);
    }
  }, [projectId, fetchCitations]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? citations.filter((c) => {
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
        })
      : citations;
    // Show problems (failed → suspected → unverified → verified) on top.
    return [...base].sort((a, b) => {
      const da = STATUS_ORDER[statusOf(a)];
      const db = STATUS_ORDER[statusOf(b)];
      return da - db;
    });
  }, [citations, search]);

  const tally = useMemo(() => {
    const t: Record<VerificationStatus, number> = {
      verified: 0,
      suspected: 0,
      failed: 0,
      unverified: 0,
    };
    for (const c of citations) t[statusOf(c)]++;
    return t;
  }, [citations]);

  const active = useMemo(
    () => citations.find((c) => c.key === activeKey) ?? null,
    [citations, activeKey],
  );

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* Left: search + bulk verify + list (no title) */}
      <aside className="md:w-[440px] md:shrink-0 flex flex-col min-h-0">
        <div className="p-3 border-y border-sandy/40 space-y-2">
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
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 flex-wrap font-ui text-[11px] text-ink-light">
                <span>{citations.length} atıf</span>
                {filtered.length !== citations.length && (
                  <span>· {filtered.length} eşleşme</span>
                )}
                {tally.verified > 0 && (
                  <span className="text-forest">· {tally.verified} ✓</span>
                )}
                {tally.suspected > 0 && (
                  <span className="text-gold-dark">· {tally.suspected} ⚠</span>
                )}
                {tally.failed > 0 && (
                  <span className="text-red-700">· {tally.failed} ✗</span>
                )}
              </div>
              <button
                type="button"
                onClick={handleBulkVerify}
                disabled={verifying || citations.length === 0}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-sm border border-sandy bg-white hover:bg-sandy-soft/40 font-ui text-[11px] text-ink-light disabled:opacity-50 disabled:cursor-not-allowed"
                title="Tüm atıfları kaynak sayfalarla otomatik karşılaştır"
              >
                {verifying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <ShieldCheck className="h-3 w-3" />
                )}
                {verifying ? "Doğrulanıyor…" : "Tümünü doğrula"}
              </button>
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
                  const vstatus = statusOf(c);
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
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <StatusBadge status={vstatus} />
                          </div>
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

      {/* Right: title at top + verify panel underneath */}
      <section className="flex-1 min-h-0 flex flex-col">
        <div className="px-6 lg:px-10 pt-6 lg:pt-8 pb-2 shrink-0">
          <FadeUp>
            <PageTitle
              title="Atıf Doğrulama"
              subtitle="Yazıdaki her atıfın gerçekten kaynak sayfada yer alıp almadığını kontrol et."
            />
          </FadeUp>
          <Ornament className="w-40 mx-auto text-sandy mt-1 mb-1" />
        </div>
        <div className="flex-1 min-h-0">
          {active ? (
            <CitationVerifyPanel citation={active} allCitations={citations} />
          ) : (
            <div className="h-full flex items-center justify-center font-body text-sm text-ink-light">
              Soldan bir atıf seç.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
