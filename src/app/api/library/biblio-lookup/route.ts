/**
 * GET /api/library/biblio-lookup?q=<ISBN or DOI>
 *
 * Synchronous deterministic metadata lookup for the "Yeni kaynak ekle →
 * ISBN/DOI" tab in the add-source modal. The user pastes an ISBN or
 * DOI, we tell them in <1s exactly what it points to (Crossref or
 * OpenLibrary), and the UI prefills the form for confirmation.
 *
 * Accepts ISBN (10/13, with or without separators) or DOI (10.xxxx/...).
 * Returns 200 with `{ found: false }` when no hit — never an error,
 * since the UI's "Yanlış mı? Manuel sekmesine geç" hint handles that.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import {
  lookupByDoi, lookupByIsbn, findDoi, findIsbn, type BiblioHit,
} from '@/lib/biblio-lookup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    await requireAuth()
    const q = (new URL(req.url).searchParams.get('q') ?? '').trim()
    if (!q) {
      return NextResponse.json({ error: 'q query parameter required' }, { status: 400 })
    }

    // Treat the input as either a bare identifier OR a string that
    // contains one. findDoi/Isbn handle the "with prefix" variants
    // (e.g. "doi: 10.1234/..." or "ISBN: 978-0...").
    let hit: BiblioHit | null = null
    const doi = findDoi(q) ?? (/^10\.\d{4,9}\//.test(q) ? q : null)
    if (doi) hit = await lookupByDoi(doi)
    if (!hit) {
      const isbn = findIsbn(q) ?? (/^\d[\d-\s]{8,17}[\dX]$/i.test(q) ? q.replace(/[\s-]/g, '') : null)
      if (isbn) hit = await lookupByIsbn(isbn)
    }

    return NextResponse.json(hit ? { found: true, hit } : { found: false })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/library/biblio-lookup]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
