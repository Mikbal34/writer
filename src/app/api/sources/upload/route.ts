import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { extractBibliographyFromText, type BibliographyExtraction } from '@/lib/bibliography-extract'
import { checkCredits, deductCredits } from '@/lib/credits'
import { savePdfBytesR2 } from '@/lib/r2-storage'
import { enqueueIngest } from '@/lib/queue'
import {
  findOrCreateLibraryEntryFromMeta,
  type LibraryMetaInput,
} from '@/lib/library-from-source'
import type { Prisma } from '@prisma/client'
import { EntryType } from '@prisma/client'

const VALID_ENTRY_TYPES = new Set(Object.values(EntryType))

function toEntryTypeOrDefault(value: string | null | undefined): EntryType {
  if (value && VALID_ENTRY_TYPES.has(value as EntryType)) return value as EntryType
  return EntryType.kitap
}
const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

const MAX_FILE_SIZE_MB = 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

const BIB_METADATA_FIELDS = [
  'authorName',
  'shortTitle',
  'editor',
  'translator',
  'publisher',
  'publishPlace',
  'year',
  'volume',
  'edition',
  'journalName',
  'journalVolume',
  'journalIssue',
  'pageRange',
  'doi',
  'url',
] as const

/**
 * POST /api/sources/upload
 *
 * Unified library + project pipeline (post-refactor):
 *   1. Accept multipart upload (file, projectId, optional bibliographyId).
 *   2. Run Python service on the bytes to get first-pages text.
 *   3. Haiku extracts bibliography metadata from that text.
 *   4. Find-or-create a LibraryEntry for the user under (userId, surname,
 *      title) — so the PDF lives in the user's GLOBAL library, not a
 *      project-local Source silo.
 *   5. Create-or-update the Bibliography linked to libraryEntryId, with
 *      metadata copied across.
 *   6. Persist the PDF bytes to R2 under the library entry's path.
 *   7. Enqueue a worker `entry` ingest job — the worker re-extracts +
 *      chunks + embeds into LibraryChunk (global), so the file is
 *      retrievable across all the user's future projects.
 *
 * No `Source` row is created anymore (legacy table; kept in schema for
 * read-back of pre-refactor uploads). UI tracks PDF state via
 * `bibliography.libraryEntry.pdfStatus`.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null
    const bibliographyId = formData.get('bibliographyId') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }
    if (!projectId) {
      return NextResponse.json({ error: 'projectId is required' }, { status: 400 })
    }

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    const mimeType = file.type
    const extension = ALLOWED_TYPES[mimeType]
    if (!extension) {
      return NextResponse.json(
        { error: `File type not allowed: ${mimeType}. Allowed: PDF, TXT, DOC, DOCX` },
        { status: 415 }
      )
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB` },
        { status: 413 }
      )
    }

    // Currently only PDFs flow through the library pipeline (the worker
    // ingest expects a PDF in R2). DOCX/TXT support would need a parser
    // route in library-pipeline.ts — out of scope for this refactor.
    if (extension !== 'pdf') {
      return NextResponse.json(
        { error: 'Only PDF uploads are supported in the unified library pipeline.' },
        { status: 415 }
      )
    }

    const credits = await checkCredits(session.user.id, 'source_upload_extract')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    const bytes = Buffer.from(await file.arrayBuffer())
    if (bytes.length < 1024) {
      return NextResponse.json({ error: 'PDF too small to be valid' }, { status: 400 })
    }

    // If the user passed a bibliographyId we have a metadata fallback
    // even when AI extraction fails (we'll use the bib's own author +
    // title to seed the LibraryEntry).
    const existingBib = bibliographyId
      ? await prisma.bibliography.findFirst({
          where: { id: bibliographyId, projectId },
        })
      : null
    if (bibliographyId && !existingBib) {
      return NextResponse.json(
        { error: 'Bibliography not found in this project' },
        { status: 404 }
      )
    }

    // ---- Step 1: extract first-pages text for metadata seeding -------
    //
    // Python /process-bytes accepts a multipart upload directly — no
    // shared disk volume needed between web and python containers.
    // We only need the first ~8K chars of text for metadata extraction;
    // the chunks returned here are discarded because the worker will
    // re-extract from R2 during the ingest job.
    let firstPagesText = ''
    try {
      const pythonServiceUrl =
        process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'
      const tempSourceId = `meta-${Date.now()}-${session.user.id.slice(0, 8)}`
      const form = new FormData()
      form.append('sourceId', tempSourceId)
      form.append(
        'file',
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
        file.name || 'upload.pdf',
      )
      const response = await fetch(`${pythonServiceUrl}/process-bytes`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      })
      if (response.ok) {
        const data = (await response.json()) as { extractedText?: string }
        firstPagesText = (data.extractedText ?? '').slice(0, 8000)
      } else {
        console.warn(
          `[sources/upload] Python /process-bytes returned ${response.status}; metadata extraction will fall back to existing bib (if any) or filename`,
        )
      }
    } catch (err) {
      console.warn('[sources/upload] Python /process-bytes failed; using fallback metadata:', err)
    }

    // ---- Step 2: bibliography metadata extraction --------------------
    // Two-pass: Haiku first, Sonnet fallback when the output trips a
    // quality red flag (long publisher with embedded address, article
    // missing journal metadata, …). See lib/bibliography-extract.ts.
    let aiMeta: BibliographyExtraction | null = null
    let aiTokens = { input: 0, output: 0 }
    let aiModelUsed: 'haiku' | 'sonnet' = 'haiku'
    if (firstPagesText.trim().length > 200) {
      try {
        const extracted = await extractBibliographyFromText(firstPagesText)
        aiMeta = extracted.data
        aiTokens = { input: extracted.inputTokens, output: extracted.outputTokens }
        aiModelUsed = extracted.modelUsed
        if (extracted.fallbackReason) {
          console.log(
            `[sources/upload] Sonnet fallback used — reason: ${extracted.fallbackReason}`,
          )
        }
      } catch (err) {
        console.error('[sources/upload] metadata extraction failed:', err)
      }
    }

    // ---- Step 3: pick the canonical metadata for LibraryEntry --------
    // Priority: existing bibliography > AI extracted > filename fallback.
    const metaInput: LibraryMetaInput = {
      entryType: existingBib?.entryType ?? aiMeta?.entryType ?? 'kitap',
      authorSurname:
        (existingBib?.authorSurname?.trim() ||
          aiMeta?.authorSurname?.trim() ||
          'Unknown') as string,
      authorName: existingBib?.authorName ?? aiMeta?.authorName ?? null,
      title:
        (existingBib?.title?.trim() ||
          aiMeta?.title?.trim() ||
          file.name.replace(/\.[^.]+$/, '')) as string,
      shortTitle: existingBib?.shortTitle ?? aiMeta?.shortTitle ?? null,
      editor: existingBib?.editor ?? aiMeta?.editor ?? null,
      translator: existingBib?.translator ?? aiMeta?.translator ?? null,
      publisher: existingBib?.publisher ?? aiMeta?.publisher ?? null,
      publishPlace: existingBib?.publishPlace ?? aiMeta?.publishPlace ?? null,
      year: existingBib?.year ?? aiMeta?.year ?? null,
      volume: existingBib?.volume ?? aiMeta?.volume ?? null,
      edition: existingBib?.edition ?? aiMeta?.edition ?? null,
      journalName: existingBib?.journalName ?? aiMeta?.journalName ?? null,
      journalVolume: existingBib?.journalVolume ?? aiMeta?.journalVolume ?? null,
      journalIssue: existingBib?.journalIssue ?? aiMeta?.journalIssue ?? null,
      pageRange: existingBib?.pageRange ?? aiMeta?.pageRange ?? null,
      doi: existingBib?.doi ?? aiMeta?.doi ?? null,
      url: existingBib?.url ?? aiMeta?.url ?? null,
    }

    // ---- Step 4: tx — LibraryEntry find-or-create + Bibliography ----
    const { entry, bibId } = await prisma.$transaction(async (tx) => {
      const { entry } = await findOrCreateLibraryEntryFromMeta(
        tx,
        session.user.id,
        metaInput,
      )

      let bibId: string | null = null

      if (existingBib) {
        // Fill any null fields on the existing bib from the resolved
        // metadata (non-destructive — manually entered values win).
        const updateData: Prisma.BibliographyUpdateInput = {
          libraryEntry: { connect: { id: entry.id } },
          entryType: existingBib.entryType ?? toEntryTypeOrDefault(metaInput.entryType),
        }
        for (const f of BIB_METADATA_FIELDS) {
          const current = (existingBib as unknown as Record<string, unknown>)[f]
          const fromMeta = (metaInput as unknown as Record<string, unknown>)[f]
          if (current == null && fromMeta != null) {
            ;(updateData as Record<string, unknown>)[f] = fromMeta
          }
        }
        await tx.bibliography.update({ where: { id: existingBib.id }, data: updateData })
        bibId = existingBib.id
      } else {
        const created = await tx.bibliography.create({
          data: {
            projectId,
            libraryEntryId: entry.id,
            entryType: toEntryTypeOrDefault(metaInput.entryType),
            authorSurname: metaInput.authorSurname,
            authorName: metaInput.authorName ?? null,
            title: metaInput.title,
            shortTitle: metaInput.shortTitle ?? null,
            editor: metaInput.editor ?? null,
            translator: metaInput.translator ?? null,
            publisher: metaInput.publisher ?? null,
            publishPlace: metaInput.publishPlace ?? null,
            year: metaInput.year ?? null,
            volume: metaInput.volume ?? null,
            edition: metaInput.edition ?? null,
            journalName: metaInput.journalName ?? null,
            journalVolume: metaInput.journalVolume ?? null,
            journalIssue: metaInput.journalIssue ?? null,
            pageRange: metaInput.pageRange ?? null,
            doi: metaInput.doi ?? null,
            url: metaInput.url ?? null,
          },
        })
        bibId = created.id
      }

      return { entry, bibId }
    })

    // ---- Step 5: write bytes to R2 (outside tx — long IO) -----------
    // We only overwrite the existing R2 object if the entry didn't have
    // a usable PDF yet. If the library entry was already ready (same
    // book, prior upload), we skip the R2 write and the ingest — the
    // user's library already has it indexed.
    const alreadyHasUsablePdf = !!entry.filePath && entry.pdfStatus === 'ready'

    let filePath = entry.filePath
    let pdfStatus = entry.pdfStatus

    if (!alreadyHasUsablePdf) {
      try {
        filePath = await savePdfBytesR2(session.user.id, entry.id, bytes, 'pdf')
      } catch (err) {
        console.error('[sources/upload] R2 save failed:', entry.id, err)
        return NextResponse.json({ error: 'storage failed' }, { status: 502 })
      }

      // Mark the entry as queued and clear any stale chunks/embeddings
      // so the worker re-extracts fresh.
      await prisma.libraryChunk.deleteMany({
        where: { libraryEntryId: entry.id, volumeId: null },
      })
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: {
          filePath,
          fileType: 'pdf',
          pdfStatus: 'queued',
          pdfError: null,
        },
      })
      pdfStatus = 'queued'

      await enqueueIngest({
        kind: 'entry',
        entryId: entry.id,
        filename: file.name || 'upload.pdf',
      })
    }

    // ---- Step 6: credits ---------------------------------------------
    if (aiTokens.input > 0 || aiTokens.output > 0) {
      try {
        await deductCredits(
          session.user.id,
          'source_upload_extract',
          aiTokens.input,
          aiTokens.output,
          aiModelUsed,
          { libraryEntryId: entry.id, projectId },
        )
      } catch (creditErr) {
        console.error('[sources/upload] Credit deduction failed:', creditErr)
      }
    }

    return NextResponse.json(
      {
        libraryEntryId: entry.id,
        bibliographyId: bibId,
        filePath,
        pdfStatus,
        reused: alreadyHasUsablePdf,
      },
      { status: 201 },
    )
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/sources/upload]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
