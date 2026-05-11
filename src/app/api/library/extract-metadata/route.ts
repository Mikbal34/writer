/**
 * POST /api/library/extract-metadata
 *
 * Preview-only metadata extraction — receives a file, runs the same
 * Python extraction + Haiku metadata pass we'd do on a real upload,
 * but **commits nothing**. Used by the bulk upload dialog's "Grupla"
 * step so the form can be prefilled with author / title / year /
 * publisher pulled from the first cilt's cover.
 *
 * Native metadata (EPUB DC, DOCX core_properties) is returned as-is
 * when present; for PDFs we fall back to Haiku on the extracted text.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { extractMetadataFromText } from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024
const PYTHON_SERVICE_URL =
  process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'

interface ProcessBytesResponse {
  extractedText: string
  metadata?: {
    title?: string
    author?: string
    year?: string
    publisher?: string
    abstract?: string
    language?: string
  } | null
}

function splitAuthor(full: string | null | undefined): {
  authorSurname: string | null
  authorName: string | null
} {
  if (!full || !full.trim()) return { authorSurname: null, authorName: null }
  const s = full.trim()
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',')
    return {
      authorSurname: last.trim() || null,
      authorName: rest.join(',').trim() || null,
    }
  }
  const parts = s.split(/\s+/)
  if (parts.length === 1) return { authorSurname: parts[0], authorName: null }
  return {
    authorSurname: parts[parts.length - 1],
    authorName: parts.slice(0, -1).join(' '),
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAuth()

    const form = await req.formData()
    const file = form.get('file')
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field is required' }, { status: 400 })
    }
    if (file.size === 0 || file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file size out of range' }, { status: 400 })
    }
    const lower = file.name.toLowerCase()
    if (!/\.(pdf|epub|docx)$/.test(lower)) {
      return NextResponse.json(
        { error: 'Only PDF / EPUB / DOCX accepted' },
        { status: 400 },
      )
    }

    // Forward to Python /process-bytes — same endpoint the real upload
    // hits. We use a dummy sourceId; nothing persists from here.
    const pyForm = new FormData()
    pyForm.append('sourceId', `preview-${Date.now()}`)
    pyForm.append('file', file, file.name)

    const pyRes = await fetch(`${PYTHON_SERVICE_URL}/process-bytes`, {
      method: 'POST',
      body: pyForm,
    })
    if (!pyRes.ok) {
      const body = await pyRes.text().catch(() => '')
      return NextResponse.json(
        { error: `Python extraction failed (${pyRes.status}): ${body.slice(0, 200)}` },
        { status: 500 },
      )
    }
    const data = (await pyRes.json()) as ProcessBytesResponse

    // Prefer native metadata (EPUB DC / DOCX core_properties) when
    // present — much more reliable than Haiku on first-chapter text.
    if (data.metadata && (data.metadata.title || data.metadata.author)) {
      const { authorSurname, authorName } = splitAuthor(data.metadata.author)
      return NextResponse.json({
        source: 'native',
        authorSurname: authorSurname || null,
        authorName: authorName || null,
        title: data.metadata.title || null,
        year: data.metadata.year || null,
        publisher: data.metadata.publisher || null,
      })
    }

    // Fallback: Haiku on the extracted text.
    if (!data.extractedText || data.extractedText.length < 200) {
      return NextResponse.json({
        source: 'empty',
        authorSurname: null,
        authorName: null,
        title: null,
        year: null,
        publisher: null,
      })
    }

    try {
      const { data: meta } = await extractMetadataFromText(data.extractedText)
      return NextResponse.json({
        source: 'haiku',
        authorSurname:
          meta.authorSurname && meta.authorSurname !== 'Unknown'
            ? meta.authorSurname
            : null,
        authorName: meta.authorName,
        title: meta.title,
        year: meta.year,
        publisher: meta.publisher,
      })
    } catch (err) {
      console.error('[extract-metadata] Haiku failed:', err)
      return NextResponse.json({
        source: 'error',
        authorSurname: null,
        authorName: null,
        title: null,
        year: null,
        publisher: null,
      })
    }
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/extract-metadata]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
