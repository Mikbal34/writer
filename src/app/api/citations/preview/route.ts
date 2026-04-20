import { NextRequest, NextResponse } from 'next/server'
import type { CitationFormat } from '@prisma/client'
import { CITATION_FORMAT_META } from '@/lib/citations/metadata'
import { buildCitationPreview, buildSampleFootnotes } from '@/lib/citations/preview'

const VALID: CitationFormat[] = [
  'ISNAD',
  'APA',
  'CHICAGO',
  'MLA',
  'HARVARD',
  'VANCOUVER',
  'IEEE',
  'AMA',
  'TURABIAN',
]

/**
 * GET /api/citations/preview?format=APA
 * Returns format metadata + rendered inline, subsequent, and bibliography
 * strings for the seven sample entries. No auth required — content is
 * entirely synthesised from server-side fixtures.
 */
export function GET(req: NextRequest) {
  const format = req.nextUrl.searchParams.get('format') as CitationFormat | null
  if (!format || !VALID.includes(format)) {
    return NextResponse.json({ error: 'Unknown or missing format' }, { status: 400 })
  }

  const meta = CITATION_FORMAT_META[format]
  const preview = buildCitationPreview(format)
  const footnotes = buildSampleFootnotes(format)

  return NextResponse.json({
    format,
    displayName: meta.displayName,
    version: meta.version ?? null,
    inlineStyle: meta.inlineStyle,
    description: meta.description,
    sampleSentence: preview.sampleSentence,
    sampleFootnotes: footnotes,
    samples: preview.samples.map((s) => ({
      entryId: s.entry.id,
      entryType: s.entry.entryType,
      entryTypeLabel: s.entry.entryType,
      inline: s.inline,
      inlineSubsequent: s.inlineSubsequent,
      bibliography: s.bibliography,
    })),
  })
}
