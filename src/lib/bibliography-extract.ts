import { generateJSONWithUsage, HAIKU, SONNET } from '@/lib/claude'

export interface BibliographyExtraction {
  entryType: 'kitap' | 'makale' | 'nesir' | 'ceviri' | 'tez' | 'ansiklopedi' | 'web'
  authorSurname: string
  authorName: string | null
  title: string
  shortTitle: string | null
  editor: string | null
  translator: string | null
  publisher: string | null
  publishPlace: string | null
  year: string | null
  volume: string | null
  edition: string | null
  journalName: string | null
  journalVolume: string | null
  journalIssue: string | null
  pageRange: string | null
  doi: string | null
  url: string | null
}

export interface ExtractionResult {
  data: BibliographyExtraction
  modelUsed: 'haiku' | 'sonnet'
  inputTokens: number
  outputTokens: number
  fallbackReason?: string
}

// ----- Prompt ---------------------------------------------------------
// History note: the original prompt was a bare "extract these fields"
// schema with no formatting rules. It produced three classes of failure:
//   1. publisher field carried full addresses + phone numbers because
//      no rule said "name only"
//   2. OCR typos (Chamblrs/Chambers, Inb/Ibn, Metafizigi/Metafiziği)
//      passed through unchanged because no rule said "fix obvious OCR
//      artifacts in proper nouns"
//   3. articles got the same treatment as books — journal metadata
//      sat in footers/headers the model wasn't told to look for
// This prompt directly addresses all three.
const SYSTEM_PROMPT =
  'You are a bibliography extraction assistant. You read the first pages ' +
  '(often OCR\'d) of a PDF and return clean bibliographic metadata. ' +
  'You ALWAYS respond with valid JSON, no surrounding text.'

function buildUserPrompt(text: string): string {
  return `Analyze the text extracted from the first pages of a PDF (the source may be OCR'd, so expect some character errors) and return bibliography information as JSON.

Text:
---
${text}
---

Return EXACTLY this JSON shape (use null for any field you cannot determine):
{
  "entryType": "kitap" | "makale" | "nesir" | "ceviri" | "tez" | "ansiklopedi" | "web",
  "authorSurname": "Author's surname (first author only)",
  "authorName": "Author's first name(s)",
  "title": "Full title of the work",
  "shortTitle": "Short title for citation footnotes",
  "editor": "Editor / editor-in-chief",
  "translator": "Translator",
  "publisher": "Publisher",
  "publishPlace": "Place of publication",
  "year": "Publication year",
  "volume": "Volume number (multi-volume works)",
  "edition": "Edition number / label",
  "journalName": "Journal name (article only)",
  "journalVolume": "Journal volume (article only)",
  "journalIssue": "Journal issue (article only)",
  "pageRange": "Article page range (article only, e.g. 23-47)",
  "doi": "DOI",
  "url": "URL"
}

CRITICAL FIELD RULES:

publisher — the publisher's name ONLY. Strip every:
  • street address, building number, postal code
  • phone, fax, e-mail, URL
  • catalog/series number ("yayın no. 108", "Klasik 67. kitap", "Sertifika no. 17613")
  • city name (city goes in publishPlace, not here)
  • dash- or paren-led subtitle ("— Wiley Blackwell — The Atrium…")
  Examples:
   ✗ "Edinburgh University Press, Edinburgh (The Tun – Holyrood Road)"
   ✓ "Edinburgh University Press"
   ✗ "Klasik (67. Kitap) — İnfo Cad. No: 38, 34134 Vefa, İstanbul · Tel: 0212 520 86 64–42"
   ✓ "Klasik Yayınları"
   ✗ "Oxford University Press, 198 Madison Avenue, New York, NY 10016"
   ✓ "Oxford University Press"

publishPlace — city only. If both city and country appear ("Leiden, Netherlands"), city is fine. If multiple co-locations appear ("Leiden–Boston"), keep both.

OCR REPAIR — if a proper noun (author/editor/translator/title) contains an obvious OCR-style artifact, correct it silently. Common patterns:
  • "Chamblrs" → "Chambers"  (l/e swap)
  • "Inb Sina" → "Ibn Sina"  (letter transposition)
  • "Metafizigi" → "Metafiziği"  (missing Turkish ğ)
  • "Ka'be" → "Kâbe"  (Turkish circumflex)
  • "el-Bidaye" → "el-Bidâye"  (Arabic transliteration diacritics)
  • doubled letters like "Mathuridi" → "Mâtürîdî"
Only repair when the artifact is unambiguous. When in doubt, keep the original.

ARTICLE-AWARE — if entryType is "makale":
  • Check page headers and footers (often shown as separate text lines near the top/bottom of pages) for "Journal Name, vol. X, no. Y, pp. Z–W (YEAR)".
  • journalName, journalVolume, journalIssue, pageRange are usually all available; fill them.
  • If the text seems to come from the SECOND page of an article (because the first was a cover), still extract what you can.

GENERAL:
  • If you cannot determine entryType from context, default to "kitap".
  • If no author name is found, write "Unknown" for authorSurname.
  • Return ONLY the JSON object, no commentary.`
}

// ----- Quality heuristics ---------------------------------------------
// When Haiku's output trips one of these red flags, we re-run on Sonnet
// — the extra ~$0.008 per upload is cheap insurance against the kinds
// of failures we saw historically (long-publisher with embedded
// addresses, articles missing journal metadata, etc.).
function shouldFallback(result: BibliographyExtraction): string | null {
  if (result.publisher) {
    if (result.publisher.length > 70) return 'publisher too long (likely contains address)'
    if (/\b(Tel|Faks?|Phone|Fax)\s*[:.]/i.test(result.publisher)) return 'publisher contains phone/fax'
    if (/(www\.|https?:\/\/)/i.test(result.publisher)) return 'publisher contains URL'
    if (/\b\d{4,}\b/.test(result.publisher)) return 'publisher contains long digit run (likely postal code or street)'
    if (/\b(Cad\.|Sok\.|Caddesi|Sokağı|Mah\.|Mahallesi|Street|Avenue|Road)\b/i.test(result.publisher)) {
      return 'publisher contains address keyword'
    }
  }
  if (result.entryType === 'makale') {
    const missing: string[] = []
    if (!result.journalName) missing.push('journalName')
    if (!result.journalVolume && !result.journalIssue) missing.push('journalVolume/Issue')
    if (!result.pageRange) missing.push('pageRange')
    if (missing.length >= 2) return `article missing key fields: ${missing.join(', ')}`
  }
  return null
}

/**
 * Two-pass bibliography extraction.
 *
 * Pass 1 — Haiku 4.5 with the hardened prompt. Cheap and fast; covers
 *           >80% of inputs cleanly.
 * Pass 2 — Sonnet 4.6, triggered only when Pass 1's output trips a
 *           quality red flag (`shouldFallback`). Sonnet's stronger
 *           semantic reasoning fixes the long-address publisher and
 *           article-metadata-blindness failure modes the historical
 *           kitap pulls suffered from.
 *
 * Cost profile: 100% Haiku on the happy path, ~3x cost only on the
 * minority that needed the extra reasoning. For a ballpark, ~$0.004
 * per upload typical, ~$0.012 when fallback fires.
 */
export async function extractBibliographyFromText(text: string): Promise<ExtractionResult> {
  const promptText = text.slice(0, 8000)
  const userPrompt = buildUserPrompt(promptText)

  const first = await generateJSONWithUsage<BibliographyExtraction>(
    userPrompt,
    SYSTEM_PROMPT,
    { model: HAIKU },
  )

  const reason = shouldFallback(first.data)
  if (!reason) {
    return {
      data: first.data,
      modelUsed: 'haiku',
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
    }
  }

  // Fallback to Sonnet — same prompt, stronger model.
  try {
    const second = await generateJSONWithUsage<BibliographyExtraction>(
      userPrompt,
      SYSTEM_PROMPT,
      { model: SONNET },
    )
    return {
      data: second.data,
      modelUsed: 'sonnet',
      inputTokens: first.inputTokens + second.inputTokens,
      outputTokens: first.outputTokens + second.outputTokens,
      fallbackReason: reason,
    }
  } catch (err) {
    console.warn(
      `[bibliography-extract] Sonnet fallback failed (${reason}); keeping Haiku result:`,
      err,
    )
    return {
      data: first.data,
      modelUsed: 'haiku',
      inputTokens: first.inputTokens,
      outputTokens: first.outputTokens,
      fallbackReason: `fallback wanted (${reason}) but Sonnet failed`,
    }
  }
}
