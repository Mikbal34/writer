"use client"

import type { IsnadDegreeType, IsnadMeta } from "@/lib/academic-meta"
import {
  BooleanToggle,
  FormSection,
  StringListField,
  TextAreaField,
  TextField,
} from "./shared"
import { Label } from "@/components/ui/label"

interface Props {
  meta: IsnadMeta
  onChange: (next: IsnadMeta) => void
  onGenerateAbstractTr?: () => void
  onGenerateAbstractEn?: () => void
  onGenerateKeywordsTr?: () => void
  onGenerateKeywordsEn?: () => void
  generatingAbstractTr?: boolean
  generatingAbstractEn?: boolean
  generatingKeywordsTr?: boolean
  generatingKeywordsEn?: boolean
  onAutoFillYear?: () => void
  autoFillingYear?: boolean
  onAutoFillSubtitle?: () => void
  autoFillingSubtitle?: boolean
}

const DEGREE_OPTIONS: Array<{ value: IsnadDegreeType; label: string }> = [
  { value: "yuksek_lisans", label: "Yüksek Lisans Tezi" },
  { value: "doktora", label: "Doktora Tezi" },
  { value: "tezsiz_yuksek_lisans", label: "Tezsiz Yüksek Lisans" },
  { value: "sanatta_yeterlik", label: "Sanatta Yeterlik Tezi" },
]

export default function IsnadForm({
  meta,
  onChange,
  onGenerateAbstractTr,
  onGenerateAbstractEn,
  onGenerateKeywordsTr,
  onGenerateKeywordsEn,
  generatingAbstractTr,
  generatingAbstractEn,
  generatingKeywordsTr,
  generatingKeywordsEn,
  onAutoFillYear,
  autoFillingYear,
  onAutoFillSubtitle,
  autoFillingSubtitle,
}: Props) {
  const set = <K extends keyof IsnadMeta>(k: K, v: IsnadMeta[K]) =>
    onChange({ ...meta, [k]: v })

  return (
    <div className="space-y-6">
      <FormSection
        title="Kapak Sayfası"
        description="ISNAD tez formatı için zorunlu sıra: [T.C.] / kurum / enstitü / anabilim dalı / başlık / yazar / tez türü / danışman / şehir+yıl."
      >
        <BooleanToggle
          label="Devlet üniversitesi (T.C. ibaresi yazılsın)"
          description="Devlet üniversitelerinde kapak sayfasının en üstüne “T.C.” yazılır. Özel üniversitelerde bu satır çıkmaz."
          checked={meta.isStateUniversity}
          onChange={(v) => set("isStateUniversity", v)}
        />
        <TextField
          label="Kurum (Üniversite)"
          value={meta.institution}
          onChange={(v) => set("institution", v)}
          placeholder="Bandırma Onyedi Eylül Üniversitesi"
        />
        <TextField
          label="Enstitü"
          value={meta.institute}
          onChange={(v) => set("institute", v)}
          placeholder="Lisansüstü Eğitim Enstitüsü"
        />
        <TextField
          label="Anabilim Dalı"
          value={meta.department}
          onChange={(v) => set("department", v)}
          placeholder="Temel İslam Bilimleri Anabilim Dalı"
        />
        <TextField
          label="Alt başlık"
          value={meta.subtitle}
          onChange={(v) => set("subtitle", v)}
          placeholder="İsteğe bağlı"
          onAutoFill={onAutoFillSubtitle}
          autoFillLoading={autoFillingSubtitle}
          autoFillHint="Proje başlığından çıkar (ör. başlıkta : varsa)"
        />
        <TextField
          label="Yazar"
          required
          value={meta.author}
          onChange={(v) => set("author", v ?? "")}
        />
        <div className="space-y-1.5">
          <Label className="text-xs">Tez türü</Label>
          <select
            value={meta.degreeType ?? ""}
            onChange={(e) =>
              set(
                "degreeType",
                (e.target.value || null) as IsnadDegreeType | null
              )
            }
            className="w-full h-9 rounded-md border border-[#d4c9b5] bg-white px-2 text-xs font-ui focus:outline-none focus:ring-2 focus:ring-forest/30"
          >
            <option value="">Seçiniz…</option>
            {DEGREE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <TextField
          label="Danışman"
          value={meta.advisor}
          onChange={(v) => set("advisor", v)}
          placeholder="Prof. Dr. …"
        />
        <TextField
          label="İkinci Danışman"
          value={meta.coAdvisor}
          onChange={(v) => set("coAdvisor", v)}
          placeholder="İsteğe bağlı"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TextField
            label="Şehir"
            value={meta.city}
            onChange={(v) => set("city", v)}
            placeholder="Bandırma"
          />
          <TextField
            label="Yıl"
            value={meta.year}
            onChange={(v) => set("year", v)}
            placeholder="2025"
            onAutoFill={onAutoFillYear}
            autoFillLoading={autoFillingYear}
            autoFillHint="Bu yılı kullan"
          />
        </div>
      </FormSection>

      <FormSection
        title="Özet (Türkçe)"
        description="150–250 kelime, tek paragraf. Altında 3–5 anahtar kelime listelenir."
      >
        <TextAreaField
          label="Türkçe Özet"
          value={meta.abstractTr}
          onChange={(v) => set("abstractTr", v)}
          rows={7}
          onGenerate={onGenerateAbstractTr}
          generating={generatingAbstractTr}
        />
        <StringListField
          label="Anahtar Kelimeler"
          value={meta.keywordsTr}
          onChange={(v) => set("keywordsTr", v)}
          placeholder="virgül ile ayırın"
          onGenerate={onGenerateKeywordsTr}
          generating={generatingKeywordsTr}
        />
      </FormSection>

      <FormSection
        title="Abstract (English)"
        description="150–250 words, single paragraph. Followed by 3–5 keywords."
      >
        <TextAreaField
          label="English Abstract"
          value={meta.abstractEn}
          onChange={(v) => set("abstractEn", v)}
          rows={7}
          onGenerate={onGenerateAbstractEn}
          generating={generatingAbstractEn}
        />
        <StringListField
          label="Keywords"
          value={meta.keywordsEn}
          onChange={(v) => set("keywordsEn", v)}
          placeholder="comma-separated"
          onGenerate={onGenerateKeywordsEn}
          generating={generatingKeywordsEn}
        />
      </FormSection>

      <FormSection title="Önsöz / İthaf">
        <TextAreaField
          label="Önsöz / Teşekkür"
          value={meta.acknowledgments}
          onChange={(v) => set("acknowledgments", v)}
          rows={5}
        />
        <TextAreaField
          label="İthaf"
          value={meta.dedication}
          onChange={(v) => set("dedication", v)}
          rows={2}
        />
      </FormSection>
    </div>
  )
}
