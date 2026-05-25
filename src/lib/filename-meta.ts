/**
 * Deterministic filename → metadata hint extractor. No LLM, no API.
 *
 * Recognizes the convention the user uses for academic PDFs:
 *   <LANG>_<Surname>_<TitleStub>[_c<N>].<ext>
 * e.g.  EN_Donner_MuhammadAndBelievers.pdf
 *       TR_Hallaq_ImkansizDevlet.pdf
 *       AR_Razi_MefatihulGayb_c04.pdf
 *
 * Also handles loose forms like "Donner - Muhammad and the Believers.pdf"
 * or "Donner_Muhammad_2010.pdf". Strict accuracy NOT guaranteed — this
 * is a UI pre-fill helper; the user reviews and edits before submit.
 */

export interface FilenameHint {
  authorSurname: string | null
  title: string | null
  year: string | null
  volumeNumber: number | null
  lang: 'AR' | 'EN' | 'TR' | 'DE' | 'FR' | null
}

const LANG_PREFIXES = ['AR', 'EN', 'TR', 'DE', 'FR'] as const

function camelToWords(s: string): string {
  // "MuhammadAndBelievers" → "Muhammad And Believers"
  // Keep consecutive caps together: "PhDThesis" → "PhD Thesis"
  return s
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
}

export function parseFilenameForMetadata(filename: string): FilenameHint {
  const out: FilenameHint = {
    authorSurname: null,
    title: null,
    year: null,
    volumeNumber: null,
    lang: null,
  }

  // Strip extension
  let stem = filename.replace(/\.(pdf|epub|docx|fb2)$/i, '')

  // Trailing year " 2010" or "_2010" → year
  const yearMatch = stem.match(/[\s_-](1[5-9]\d{2}|20[0-3]\d)$/)
  if (yearMatch) {
    out.year = yearMatch[1]
    stem = stem.slice(0, yearMatch.index!)
  }

  // Trailing _c\d+ → volume number
  const volMatch = stem.match(/_c(\d+)$/i)
  if (volMatch) {
    out.volumeNumber = parseInt(volMatch[1], 10)
    stem = stem.slice(0, volMatch.index!)
  }

  // Lang prefix
  const langMatch = stem.match(/^(AR|EN|TR|DE|FR)_/i)
  if (langMatch && LANG_PREFIXES.includes(langMatch[1].toUpperCase() as typeof LANG_PREFIXES[number])) {
    out.lang = langMatch[1].toUpperCase() as FilenameHint['lang']
    stem = stem.slice(langMatch[0].length)
  }

  // Separator-based split: underscore, hyphen, or " - "
  // After lang strip we expect "Surname_TitleStub" or "Surname - Title Stub"
  const sepMatch = stem.match(/^([^_\-\s]+)(?:_| - |-)(.+)$/)
  if (sepMatch) {
    out.authorSurname = sepMatch[1]
    out.title = camelToWords(sepMatch[2].replace(/_/g, ' '))
  } else {
    // Whole stem becomes title — surname unknown
    out.title = camelToWords(stem.replace(/_/g, ' '))
  }

  return out
}
