"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, BookOpen, Loader2 } from "lucide-react";
import type { CitationFormat } from "@prisma/client";
import CitationFormatPicker from "@/components/citations/CitationFormatPicker";
import { FadeUp } from "@/components/shared/Animations";

export default function CitationSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.id as string;

  const [projectTitle, setProjectTitle] = useState<string>("");
  const [initialFormat, setInitialFormat] = useState<CitationFormat | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/projects/${projectId}`);
        if (!res.ok) {
          router.push("/");
          return;
        }
        const data = await res.json();
        setProjectTitle(data.title ?? "");
        setInitialFormat((data.citationFormat as CitationFormat) ?? "APA");
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId, router]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Breadcrumbs — Atıf Formatı genelde Export sayfasından açılır,
            kullanıcı oradan geldiyse oraya dönmek doğru olur. */}
        <Link
          href={`/projects/${projectId}/export`}
          className="inline-flex items-center gap-1 font-ui text-xs text-ink-light hover:text-ink mb-4 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Export sayfasına dön
        </Link>

        {/* Header */}
        <FadeUp className="mb-6">
          <div className="flex items-start gap-3">
            <div
              className="w-10 h-10 rounded-sm flex items-center justify-center shrink-0"
              style={{ backgroundColor: "rgba(201,168,76,0.18)" }}
            >
              <BookOpen className="h-5 w-5" style={{ color: "#8a5a1a" }} />
            </div>
            <div>
              <h1 className="font-display text-3xl font-bold text-ink">
                Atıf Formatı
              </h1>
              <p className="font-body text-sm text-ink-light mt-1 max-w-2xl">
                Enstitünün veya derginin istediği formatı seç. Değişiklik uygulandığında
                yazılmış tüm metin ve kaynakça yeni formata dönüşür; export da aynı formatta çıkar.
              </p>
            </div>
          </div>
        </FadeUp>

        {/* Picker */}
        {loading || !initialFormat ? (
          <div className="flex items-center justify-center py-24 text-ink-light">
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            <span className="font-ui text-xs">Yükleniyor…</span>
          </div>
        ) : (
          <CitationFormatPicker projectId={projectId} initialFormat={initialFormat} />
        )}
      </div>
    </div>
  );
}
