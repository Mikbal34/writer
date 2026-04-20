import type { CitationFormat } from '@prisma/client'

/**
 * Describes each supported citation format for the picker UI: the human
 * name, a short description, what academic fields it's common in, and
 * whether its in-text citation is author-date, numeric, or footnote.
 *
 * Keep descriptions short (one sentence) — they render as secondary text
 * on the format cards. Field tags should be recognisable keywords.
 */
export type InlineStyle = 'author-date' | 'numeric' | 'footnote' | 'parenthetical-author-page'

export interface CitationFormatMeta {
  format: CitationFormat
  displayName: string
  version?: string
  inlineStyle: InlineStyle
  description: string
  fields: string[]
  region: 'global' | 'regional'
}

export const CITATION_FORMAT_META: Record<CitationFormat, CitationFormatMeta> = {
  APA: {
    format: 'APA',
    displayName: 'APA',
    version: '7. baskı',
    inlineStyle: 'author-date',
    description: 'Psikoloji, eğitim, sosyal bilimlerde en yaygın format.',
    fields: ['Psikoloji', 'Eğitim', 'Sosyoloji', 'İşletme'],
    region: 'global',
  },
  MLA: {
    format: 'MLA',
    displayName: 'MLA',
    version: '9. baskı',
    inlineStyle: 'parenthetical-author-page',
    description: 'Edebiyat, dil ve beşeri bilimlerde standart.',
    fields: ['Edebiyat', 'Dil', 'Kültürel Çalışmalar'],
    region: 'global',
  },
  CHICAGO: {
    format: 'CHICAGO',
    displayName: 'Chicago',
    version: '17. baskı (Notes)',
    inlineStyle: 'footnote',
    description: 'Tarih, sanat, felsefe — dipnotlu klasik akademik stil.',
    fields: ['Tarih', 'Sanat', 'Felsefe', 'Din Bilimleri'],
    region: 'global',
  },
  HARVARD: {
    format: 'HARVARD',
    displayName: 'Harvard',
    inlineStyle: 'author-date',
    description: 'İngiltere ve Avustralya üniversitelerinde yaygın; APA benzeri.',
    fields: ['İşletme', 'Ekonomi', 'Sosyal Bilimler (UK/AU)'],
    region: 'global',
  },
  IEEE: {
    format: 'IEEE',
    displayName: 'IEEE',
    inlineStyle: 'numeric',
    description: 'Mühendislik, bilgisayar bilimleri — numaralı köşeli parantez.',
    fields: ['Bilgisayar', 'Elektrik-Elektronik', 'Mühendislik'],
    region: 'global',
  },
  VANCOUVER: {
    format: 'VANCOUVER',
    displayName: 'Vancouver',
    inlineStyle: 'numeric',
    description: 'Tıp ve sağlık bilimleri — biyomedikal dergi standardı.',
    fields: ['Tıp', 'Biyomedikal', 'Hemşirelik', 'Halk Sağlığı'],
    region: 'global',
  },
  AMA: {
    format: 'AMA',
    displayName: 'AMA',
    version: '11. baskı',
    inlineStyle: 'numeric',
    description: 'Amerikan Tıp Derneği formatı; Vancouver\'a çok yakın.',
    fields: ['Tıp (ABD)', 'Klinik Araştırma'],
    region: 'global',
  },
  TURABIAN: {
    format: 'TURABIAN',
    displayName: 'Turabian',
    version: '9. baskı',
    inlineStyle: 'footnote',
    description: 'Öğrenci sürümü Chicago — tez ve ödevler için basitleştirilmiş.',
    fields: ['Üniversite Tezleri', 'Lisansüstü Ödev'],
    region: 'global',
  },
  ISNAD: {
    format: 'ISNAD',
    displayName: 'ISNAD',
    version: '2. baskı',
    inlineStyle: 'footnote',
    description: 'Türkiye ilahiyat ve sosyal bilimler (ULAKBİM) standardı.',
    fields: ['İlahiyat', 'Türk Tarihi', 'Sosyal Bilimler (TR)'],
    region: 'regional',
  },
}

/**
 * Recommends a starter format based on the user's field of study.
 * Returns null when we can't confidently map the field.
 */
const FIELD_TO_FORMAT: Array<{ match: RegExp; format: CitationFormat; reason: string }> = [
  { match: /psikoloji|eğitim|sosyoloji/i, format: 'APA', reason: 'Bu alanda baskın format APA\'dır.' },
  { match: /edebiyat|dil|karşılaştırmalı/i, format: 'MLA', reason: 'Edebiyat ve dil çalışmalarının standardı.' },
  { match: /tarih|sanat|felsefe|din|ilahiyat/i, format: 'CHICAGO', reason: 'Beşeri bilimlerde dipnot temelli klasik stil.' },
  { match: /ilahiyat|kelam|tasavvuf|fıkıh|türk(\s+)?islam/i, format: 'ISNAD', reason: 'Türkiye İlahiyat Fakülteleri ve ULAKBİM ISNAD bekler.' },
  { match: /tıp|sağlık|hemşire|biyomedikal/i, format: 'VANCOUVER', reason: 'Biyomedikal dergilerin çoğunluğu Vancouver kullanır.' },
  { match: /tıp.*abd|klinik araştırma/i, format: 'AMA', reason: 'Amerikan Tıp Derneği dergileri AMA ister.' },
  { match: /bilgisayar|yazılım|elektrik|elektronik|mühendislik|makine|endüstri/i, format: 'IEEE', reason: 'IEEE mühendislik dergilerinin zorunlu formatı.' },
  { match: /işletme|ekonomi|finans|pazarlama/i, format: 'HARVARD', reason: 'İşletme ve ekonomide yaygın; ayrıca UK üniversite standardı.' },
  { match: /tez|yüksek lisans|doktora/i, format: 'TURABIAN', reason: 'Turabian özellikle tez yazımı için Chicago\'nun öğrenci sürümüdür.' },
]

export interface SuggestionResult {
  format: CitationFormat
  reason: string
}

export function suggestFormatForField(field: string): SuggestionResult | null {
  const trimmed = field.trim()
  if (!trimmed) return null
  for (const rule of FIELD_TO_FORMAT) {
    if (rule.match.test(trimmed)) {
      return { format: rule.format, reason: rule.reason }
    }
  }
  return null
}

/** Convenience list of fields users can pick from in the "smart picker". */
export const COMMON_FIELDS: string[] = [
  'Psikoloji',
  'Eğitim',
  'Sosyoloji',
  'İşletme',
  'Ekonomi',
  'Edebiyat',
  'Dil',
  'Tarih',
  'Sanat',
  'Felsefe',
  'İlahiyat',
  'Tıp',
  'Biyomedikal',
  'Hemşirelik',
  'Bilgisayar',
  'Elektrik-Elektronik',
  'Mühendislik',
]
