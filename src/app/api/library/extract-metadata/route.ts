/**
 * POST /api/library/extract-metadata
 *
 * Preview-only metadata extraction for the bulk-upload dialog. PDFs are
 * extracted locally with pdfjs and run through the DOI/ISBN-aware
 * extractMetadataFromText helper — no Python round-trip, no Fly proxy
 * timeout chain that broke this on slow scanned books. For EPUB/DOCX
 * (rare in the preview flow) we still call the Python sidecar with a
 * short timeout; on failure we return a graceful "preview unavailable"
 * and let the user upload anyway (worker enrich will run later).
 *
 * Commits nothing — the dialog uses the returned fields to prefill the
 * group form, then the actual upload creates the entry.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import {
  extractMetadataFromText,
  extractPdfLocalAsProcessResponse,
} from '@/lib/library-pipeline'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 50 * 1024 * 1024
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
const PYTHON_TIMEOUT_MS = 20_000 // EPUB/DOCX fallback only — keep short.

interface PreviewResponse {
  source: 'doi' | 'isbn' | 'haiku' | 'native' | 'empty' | 'error'
  authorSurname: string | null
  authorName: string | null
  title: string | null
  year: string | null
  publisher: string | null
}

function splitAuthor(full: string | null | undefined): {
  authorSurname: string | null
  authorName: string | null
} {
  if (!full || !full.trim()) return { authorSurname: null, authorName: null }
  const s = full.trim()
  if (s.includes(',')) {
    const [last, ...rest] = s.split(',')
    return { authorSurname: last.trim() || null, authorName: rest.join(',').trim() || null }
  }
  const parts = s.split(/\s+/)
  if (parts.length === 1) return { authorSurname: parts[0], authorName: null }
  return { authorSurname: parts[parts.length - 1], authorName: parts.slice(0, -1).join(' ') }
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
      return NextResponse.json({ error: 'Only PDF / EPUB / DOCX accepted' }, { status: 400 })
    }

    const bytes = Buffer.from(await file.arrayBuffer())

    // ── PDF: local pdfjs path ──────────────────────────────────────
    if (lower.endsWith('.pdf')) {
      let extractedText = ''
      try {
        const data = await extractPdfLocalAsProcessResponse(bytes, `preview-${Date.now()}`)
        extractedText = data?.extractedText ?? ''
      } catch (err) {
        console.warn('[extract-metadata] pdfjs local extract failed:', err)
      }
      if (!extractedText || extractedText.length < 200) {
        // Scanned PDF without a text layer — preview unavailable. The
        // user uploads; worker runs the full Tesseract/Surya pipeline
        // and the enrich runs after that.
        return NextResponse.json<PreviewResponse>({
          source: 'empty', authorSurname: null, authorName: null,
          title: null, year: null, publisher: null,
        })
      }
      try {
        const { data: meta, source } = await extractMetadataFromText(extractedText)
        return NextResponse.json<PreviewResponse>({
          source,
          authorSurname:
            meta.authorSurname && meta.authorSurname !== 'Unknown' ? meta.authorSurname : null,
          authorName: meta.authorName ?? null,
          title: meta.title ?? null,
          year: meta.year ?? null,
          publisher: meta.publisher ?? null,
        })
      } catch (err) {
        console.error('[extract-metadata] DOI/ISBN/Haiku failed:', err)
        return NextResponse.json<PreviewResponse>({
          source: 'error', authorSurname: null, authorName: null,
          title: null, year: null, publisher: null,
        })
      }
    }

    // ── EPUB / DOCX: Python sidecar with a short timeout ───────────
    try {
      const pyForm = new FormData()
      pyForm.append('sourceId', `preview-${Date.now()}`)
      pyForm.append('file', file, file.name)
      const pyRes = await fetch(`${PYTHON_SERVICE_URL}/process-bytes`, {
        method: 'POST',
        body: pyForm,
        signal: AbortSignal.timeout(PYTHON_TIMEOUT_MS),
      })
      if (!pyRes.ok) {
        return NextResponse.json<PreviewResponse>({
          source: 'empty', authorSurname: null, authorName: null,
          title: null, year: null, publisher: null,
        })
      }
      const data = (await pyRes.json()) as {
        extractedText?: string
        metadata?: { title?: string; author?: string; year?: string; publisher?: string } | null
      }
      if (data.metadata && (data.metadata.title || data.metadata.author)) {
        const { authorSurname, authorName } = splitAuthor(data.metadata.author)
        return NextResponse.json<PreviewResponse>({
          source: 'native',
          authorSurname: authorSurname || null,
          authorName: authorName || null,
          title: data.metadata.title || null,
          year: data.metadata.year || null,
          publisher: data.metadata.publisher || null,
        })
      }
      if (data.extractedText && data.extractedText.length >= 200) {
        const { data: meta, source } = await extractMetadataFromText(data.extractedText)
        return NextResponse.json<PreviewResponse>({
          source,
          authorSurname:
            meta.authorSurname && meta.authorSurname !== 'Unknown' ? meta.authorSurname : null,
          authorName: meta.authorName ?? null,
          title: meta.title ?? null,
          year: meta.year ?? null,
          publisher: meta.publisher ?? null,
        })
      }
      return NextResponse.json<PreviewResponse>({
        source: 'empty', authorSurname: null, authorName: null,
        title: null, year: null, publisher: null,
      })
    } catch (err) {
      console.warn('[extract-metadata] EPUB/DOCX preview failed:', err)
      return NextResponse.json<PreviewResponse>({
        source: 'empty', authorSurname: null, authorName: null,
        title: null, year: null, publisher: null,
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
