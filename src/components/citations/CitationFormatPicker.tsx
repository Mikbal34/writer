"use client";

import { useMemo, useState } from "react";
import type { CitationFormat } from "@prisma/client";
import {
  BookOpen,
  Sparkles,
  Hash,
  FileText,
  Globe,
  GraduationCap,
  BookMarked,
  Newspaper,
  Check,
  Loader2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { CITATION_FORMAT_META, COMMON_FIELDS, suggestFormatForField } from "@/lib/citations/metadata";
import { CITATION_EXAMPLES } from "@/lib/citations/examples";

interface CitationPreviewSample {
  entryId: string;
  entryType: string;
  entryTypeLabel: string;
  inline: string;
  inlineSubsequent: string;
  bibliography: string;
}

interface CitationPreview {
  format: CitationFormat;
  displayName: string;
  version?: string;
  inlineStyle: string;
  description: string;
  sampleSentence: string;
  sampleFootnotes: string[];
  samples: CitationPreviewSample[];
}

interface Props {
  projectId: string;
  initialFormat: CitationFormat;
  onChanged?: (newFormat: CitationFormat) => void;
}

const ORDER: CitationFormat[] = [
  "APA",
  "MLA",
  "CHICAGO",
  "HARVARD",
  "IEEE",
  "VANCOUVER",
  "AMA",
  "TURABIAN",
  "ISNAD",
];

const ENTRY_TYPE_LABELS: Record<string, string> = {
  kitap: "Kitap",
  makale: "Makale",
  nesir: "Nesir",
  ceviri: "Çeviri",
  tez: "Tez",
  ansiklopedi: "Ansiklopedi",
  web: "Web",
};

const ENTRY_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  kitap: BookOpen,
  makale: FileText,
  nesir: BookMarked,
  ceviri: BookOpen,
  tez: GraduationCap,
  ansiklopedi: BookMarked,
  web: Globe,
};

const INLINE_STYLE_LABEL: Record<string, string> = {
  "author-date": "Yazar-tarih (metin içi)",
  "parenthetical-author-page": "Yazar-sayfa (metin içi)",
  numeric: "Numaralı (metin içi)",
  footnote: "Dipnotlu",
};

const INLINE_STYLE_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  "author-date": Hash,
  "parenthetical-author-page": Hash,
  numeric: Hash,
  footnote: Newspaper,
};

export default function CitationFormatPicker({ projectId, initialFormat, onChanged }: Props) {
  const [selected, setSelected] = useState<CitationFormat>(initialFormat);
  const [field, setField] = useState<string>("");
  const [previewCache, setPreviewCache] = useState<Record<string, CitationPreview>>({});
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<CitationFormat>(initialFormat);

  const suggestion = useMemo(() => suggestFormatForField(field), [field]);

  const preview = previewCache[selected];

  async function ensurePreview(fmt: CitationFormat) {
    if (previewCache[fmt]) return;
    setLoadingPreview(true);
    try {
      const res = await fetch(`/api/citations/preview?format=${fmt}`);
      if (!res.ok) return;
      const data = (await res.json()) as CitationPreview;
      setPreviewCache((prev) => ({ ...prev, [fmt]: data }));
    } finally {
      setLoadingPreview(false);
    }
  }

  // Kick off preview fetch when format changes
  useMemo(() => {
    void ensurePreview(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function handleApply() {
    if (selected === saved) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citationFormat: selected }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Kaydedilemedi" }));
        throw new Error(err.error ?? "Kaydedilemedi");
      }
      setSaved(selected);
      onChanged?.(selected);
      toast.success(`Atıf formatı ${CITATION_FORMAT_META[selected].displayName} olarak kaydedildi.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  const selectedMeta = CITATION_FORMAT_META[selected];
  const isDirty = selected !== saved;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
      {/* LEFT — Smart suggestion */}
      <aside className="lg:col-span-3 space-y-4">
        <div className="bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm p-4">
          <div className="flex items-center gap-2 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-[#C9A84C]" />
            <span className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]" style={{ letterSpacing: "0.14em" }}>
              Akıllı Öneri
            </span>
          </div>
          <p className="font-body text-xs text-[#6b5a45] mb-3">
            Alanını yaz, sana en uygun formatı önerelim.
          </p>
          <input
            type="text"
            list="citation-common-fields"
            value={field}
            onChange={(e) => setField(e.target.value)}
            placeholder="örn. Psikoloji"
            className="w-full px-3 py-2 border border-[#d4c9b5] rounded-sm bg-white font-ui text-sm text-[#2D1F0E] placeholder:text-[#a89a82] focus:outline-none focus:border-[#C9A84C]"
          />
          <datalist id="citation-common-fields">
            {COMMON_FIELDS.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>

          {suggestion && (
            <div className="mt-3 p-3 rounded-sm bg-[#FAF3E3] border border-[#C9A84C]/30">
              <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a5a1a] mb-1" style={{ letterSpacing: "0.14em" }}>
                Önerilen
              </div>
              <div className="font-display text-lg font-bold text-[#2D1F0E] mb-1">
                {CITATION_FORMAT_META[suggestion.format].displayName}
                {CITATION_FORMAT_META[suggestion.format].version && (
                  <span className="font-ui text-xs text-[#8a7a65] ml-1.5">
                    {CITATION_FORMAT_META[suggestion.format].version}
                  </span>
                )}
              </div>
              <p className="font-body text-[11px] text-[#6b5a45] mb-2 leading-snug">{suggestion.reason}</p>
              <button
                type="button"
                onClick={() => setSelected(suggestion.format)}
                className="w-full px-3 py-1.5 rounded-sm font-ui text-xs bg-[#C9A84C] hover:bg-[#b5943d] text-[#1A0F05] transition-colors"
              >
                {selected === suggestion.format ? "Zaten seçili" : "Bu formatı kullan"}
              </button>
            </div>
          )}

          {field && !suggestion && (
            <div className="mt-3 p-3 rounded-sm bg-[#F5EDE0] border border-[#d4c9b5]">
              <p className="font-body text-[11px] text-[#6b5a45]">
                Bu alan için özel öneri yok. Sağdan formatları karşılaştırabilirsin.
              </p>
            </div>
          )}
        </div>

        {/* Current status card */}
        <div className="bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm p-4">
          <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] mb-1" style={{ letterSpacing: "0.14em" }}>
            Kayıtlı Format
          </div>
          <div className="font-display text-base font-bold text-[#2D1F0E]">
            {CITATION_FORMAT_META[saved].displayName}
            {CITATION_FORMAT_META[saved].version && (
              <span className="font-ui text-xs text-[#8a7a65] ml-1.5">
                {CITATION_FORMAT_META[saved].version}
              </span>
            )}
          </div>
          <p className="font-body text-[11px] text-[#8a7a65] mt-1">Tüm metin bu formatta oluşturulur.</p>
        </div>
      </aside>

      {/* MIDDLE — Format cards */}
      <section className="lg:col-span-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]" style={{ letterSpacing: "0.14em" }}>
            Formatlar
          </span>
          <span className="font-ui text-[10px] text-[#a89a82]">9 seçenek</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {ORDER.map((fmt) => {
            const meta = CITATION_FORMAT_META[fmt];
            const Icon = INLINE_STYLE_ICON[meta.inlineStyle] ?? Hash;
            const isSelected = selected === fmt;
            return (
              <button
                key={fmt}
                type="button"
                onClick={() => setSelected(fmt)}
                className="text-left p-3 rounded-sm border transition-all"
                style={{
                  backgroundColor: isSelected ? "#FAF3E3" : "#ffffff",
                  borderColor: isSelected ? "#C9A84C" : "#d4c9b5",
                  boxShadow: isSelected ? "0 2px 10px rgba(201,168,76,0.20)" : "none",
                  transform: isSelected ? "translateY(-1px)" : "none",
                }}
              >
                <div className="flex items-start justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <div
                      className="w-6 h-6 rounded-sm flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: isSelected ? "rgba(201,168,76,0.25)" : "rgba(212,201,181,0.4)",
                      }}
                    >
                      <Icon className="h-3.5 w-3.5" style={{ color: isSelected ? "#8a5a1a" : "#8a7a65" }} />
                    </div>
                    <div>
                      <div className="font-display text-sm font-bold text-[#2D1F0E]">
                        {meta.displayName}
                      </div>
                      {meta.version && (
                        <div className="font-ui text-[9px] text-[#8a7a65]">{meta.version}</div>
                      )}
                    </div>
                  </div>
                  {isSelected && <Check className="h-4 w-4 text-[#C9A84C] shrink-0" />}
                </div>
                <p className="font-body text-[11px] text-[#6b5a45] leading-snug mb-2 line-clamp-2">
                  {meta.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {meta.fields.slice(0, 3).map((f) => (
                    <span
                      key={f}
                      className="font-ui text-[9px] px-1.5 py-0.5 rounded-sm"
                      style={{ backgroundColor: "#F5EDE0", color: "#8a7a65" }}
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-2 pt-2 border-t border-[#d4c9b5]/50">
                  <span className="font-ui text-[9px] uppercase tracking-wider text-[#a89a82]">
                    {INLINE_STYLE_LABEL[meta.inlineStyle]}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* RIGHT — Live preview */}
      <section className="lg:col-span-4">
        <div className="sticky top-24">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5 text-[#8a7a65]" />
              <span className="font-ui text-[11px] uppercase tracking-widest text-[#8a7a65]" style={{ letterSpacing: "0.14em" }}>
                Canlı Önizleme
              </span>
            </div>
            <div className="font-display text-sm font-bold text-[#2D1F0E]">
              {selectedMeta.displayName}
            </div>
          </div>

          <div className="bg-white border border-[#d4c9b5] rounded-sm overflow-hidden">
            {/* Gold top rule */}
            <div
              style={{
                height: 2,
                background: "linear-gradient(90deg, #C9A84C 0%, #d4b76a 50%, #C9A84C 100%)",
              }}
            />
            <div className="p-4">
              <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] mb-2" style={{ letterSpacing: "0.14em" }}>
                Metin İçinde
              </div>
              {loadingPreview && !preview ? (
                <div className="flex items-center gap-2 text-[#8a7a65]">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span className="font-body text-xs">Önizleme yükleniyor…</span>
                </div>
              ) : (
                <>
                  <p
                    className="font-serif text-sm leading-relaxed text-[#2D1F0E]"
                    dangerouslySetInnerHTML={{ __html: highlightInline(preview?.sampleSentence ?? "") }}
                  />
                  {preview?.sampleFootnotes && preview.sampleFootnotes.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-dashed border-[#d4c9b5]">
                      <div className="font-ui text-[9px] uppercase tracking-widest text-[#a89a82] mb-1">
                        Dipnotlar
                      </div>
                      {preview.sampleFootnotes.map((fn, i) => (
                        <p key={i} className="font-serif text-[11px] text-[#6b5a45] leading-snug mb-1">
                          <sup>{i + 1}</sup>
                          {" "}
                          {fn}
                        </p>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>

          <div className="mt-4 bg-white border border-[#d4c9b5] rounded-sm overflow-hidden">
            <div
              style={{
                height: 2,
                background: "linear-gradient(90deg, #C9A84C 0%, #d4b76a 50%, #C9A84C 100%)",
              }}
            />
            <div className="p-4">
              <div className="font-ui text-[10px] uppercase tracking-widest text-[#8a7a65] mb-3" style={{ letterSpacing: "0.14em" }}>
                Kaynakçada
              </div>
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {(preview?.samples ?? CITATION_EXAMPLES.map((e) => ({
                  entryId: e.id,
                  entryType: e.entryType,
                  entryTypeLabel: ENTRY_TYPE_LABELS[e.entryType] ?? e.entryType,
                  inline: "",
                  inlineSubsequent: "",
                  bibliography: "",
                }))).map((s) => {
                  const EntryIcon = ENTRY_TYPE_ICONS[s.entryType] ?? FileText;
                  return (
                    <div key={s.entryId} className="pb-3 border-b border-[#d4c9b5]/40 last:border-b-0 last:pb-0">
                      <div className="flex items-center gap-1.5 mb-1">
                        <EntryIcon className="h-3 w-3 text-[#8a7a65]" />
                        <span className="font-ui text-[9px] uppercase tracking-wider text-[#a89a82]">
                          {ENTRY_TYPE_LABELS[s.entryType] ?? s.entryType}
                        </span>
                      </div>
                      <p
                        className="font-serif text-[11px] leading-snug text-[#2D1F0E]"
                        dangerouslySetInnerHTML={{ __html: renderItalic(s.bibliography) }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Apply bar */}
          {isDirty && (
            <div className="mt-4 p-3 rounded-sm bg-[#2D1F0E] text-[#F5EDE0]">
              <div className="font-body text-xs mb-2">
                <strong>{selectedMeta.displayName}</strong> formatı henüz kaydedilmedi.
                Tüm kitap yeni formata dönüşecek.
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={saving}
                  className="flex-1 px-3 py-1.5 rounded-sm font-ui text-xs bg-[#C9A84C] hover:bg-[#b5943d] text-[#1A0F05] transition-colors disabled:opacity-50"
                >
                  {saving ? (
                    <span className="flex items-center justify-center gap-1.5">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Kaydediliyor…
                    </span>
                  ) : (
                    "Uygula ve Kaydet"
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(saved)}
                  className="px-3 py-1.5 rounded-sm font-ui text-xs border border-[#c9bfad]/40 hover:bg-[#F5EDE0]/10 transition-colors"
                >
                  İptal
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * Wrap in-text citations (anything in parentheses, brackets, or starting with
 * a superscript digit) in a highlight span so users can see at a glance
 * where the citation marker lives in the sentence.
 */
function highlightInline(sentence: string): string {
  const escaped = escapeHtml(sentence);
  return escaped
    .replace(/(\([^)]*\d{4}[^)]*\))/g, '<span style="background-color:rgba(201,168,76,0.25);padding:0 3px;border-radius:2px;">$1</span>')
    .replace(/(\(\d+\))/g, '<span style="background-color:rgba(201,168,76,0.25);padding:0 3px;border-radius:2px;">$1</span>')
    .replace(/(\[\d+\])/g, '<span style="background-color:rgba(201,168,76,0.25);padding:0 3px;border-radius:2px;">$1</span>')
    .replace(/(¹|²|³|⁴|⁵)/g, '<sup style="color:#8a5a1a;font-weight:600;">$1</sup>');
}

function renderItalic(text: string): string {
  // Very light-weight italic marker: *text* → <em>text</em>
  const escaped = escapeHtml(text);
  return escaped.replace(/\*(.+?)\*/g, '<em>$1</em>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
