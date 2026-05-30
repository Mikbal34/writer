"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Loader2 } from "lucide-react";
import type { CitationFormat } from "@prisma/client";
import CitationFormatPicker from "@/components/citations/CitationFormatPicker";
import { FadeUp } from "@/components/shared/Animations";
import { Ornament, PageTitle } from "@/components/shared/BookElements";

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
    <div className="h-full overflow-y-auto px-6 lg:px-10 py-6 lg:py-8">
      <div className="max-w-5xl mx-auto">
        {/* Breadcrumbs — Atıf Formatı genelde Export sayfasından açılır,
            kullanıcı oradan geldiyse oraya dönmek doğru olur. */}
        <Link
          href={`/projects/${projectId}/export`}
          className="inline-flex items-center gap-1 font-ui text-xs text-ink-light hover:text-ink mb-4 transition-colors"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Export sayfasına dön
        </Link>

        {/* Header — recipe workspace pattern */}
        <FadeUp>
          <PageTitle
            title="Atıf Formatı"
            subtitle="Enstitünün veya derginin istediği formatı seç. Değişiklik uygulandığında yazılmış tüm metin ve kaynakça yeni formata dönüşür; export da aynı formatta çıkar."
          />
        </FadeUp>
        <Ornament className="w-40 mx-auto text-sandy mb-6" />

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
