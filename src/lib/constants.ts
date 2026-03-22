// Format-specific page layout settings
// Used by both DOCX export (font, spacing) and writing prompts (wordsPerPage)
export const FORMAT_SETTINGS: Record<string, FormatSettings> = {
  ISNAD:   { font: 'Times New Roman', fontSize: 12, lineSpacing: 1.5, wordsPerPage: 370 },
  APA:     { font: 'Times New Roman', fontSize: 12, lineSpacing: 2.0, wordsPerPage: 275 },
  Chicago: { font: 'Times New Roman', fontSize: 12, lineSpacing: 2.0, wordsPerPage: 275 },
  MLA:     { font: 'Times New Roman', fontSize: 12, lineSpacing: 2.0, wordsPerPage: 275 },
  Harvard: { font: 'Arial',          fontSize: 12, lineSpacing: 1.5, wordsPerPage: 350 },
  IEEE:    { font: 'Times New Roman', fontSize: 10, lineSpacing: 1.0, wordsPerPage: 500 },
}

export interface FormatSettings {
  font: string
  fontSize: number
  lineSpacing: number
  wordsPerPage: number
}

export const DEFAULT_FORMAT = FORMAT_SETTINGS.ISNAD

export function getFormatSettings(citationFormat?: string | null): FormatSettings {
  if (!citationFormat) return DEFAULT_FORMAT
  return FORMAT_SETTINGS[citationFormat] ?? DEFAULT_FORMAT
}
