import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

/**
 * POST /api/research/download-pdf
 * Downloads a PDF from a given URL, creates Source + LibraryEntry, triggers processing.
 * Body: { bibliographyId: string, pdfUrl: string }
 */
export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { bibliographyId, pdfUrl } = (await req.json()) as {
      bibliographyId: string
      pdfUrl: string
    }

    if (!bibliographyId || !pdfUrl) {
      return NextResponse.json(
        { error: 'bibliographyId and pdfUrl are required' },
        { status: 400 }
      )
    }

    // Fetch bibliography and verify ownership
    const bib = await prisma.bibliography.findUnique({
      where: { id: bibliographyId },
      include: { project: { select: { id: true, userId: true } } },
    })

    if (!bib || bib.project.userId !== userId) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    if (bib.sourceId) {
      return NextResponse.json({ error: 'Bibliography already has a source' }, { status: 409 })
    }

    const projectId = bib.project.id

    // Step 1: Download the PDF
    const pdfResponse = await fetch(pdfUrl, {
      signal: AbortSignal.timeout(60000), // 60s timeout for large files
      headers: {
        'User-Agent': 'Quilpen/1.0 (Academic Research Tool)',
        Accept: 'application/pdf,*/*',
      },
    })

    if (!pdfResponse.ok) {
      return NextResponse.json(
        { error: `Failed to download PDF: ${pdfResponse.status}` },
        { status: 502 }
      )
    }

    const contentType = pdfResponse.headers.get('content-type') || ''
    const isPdf = contentType.includes('pdf') || pdfUrl.endsWith('.pdf')

    if (!isPdf) {
      // Try to accept it anyway — some servers don't set correct content-type
      console.warn(`[download-pdf] Non-PDF content-type: ${contentType} for ${pdfUrl}`)
    }

    const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer())

    // Validate minimum size (a real PDF should be at least a few KB)
    if (pdfBuffer.length < 1024) {
      return NextResponse.json(
        { error: 'Downloaded file too small — likely not a valid PDF' },
        { status: 422 }
      )
    }

    // Step 2: Save PDF to disk
    const projectUploadsDir = path.join(UPLOADS_DIR, projectId)
    await mkdir(projectUploadsDir, { recursive: true })

    const safeName = `${bib.authorSurname}_${bib.title}`
      .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF-]/g, '_')
      .slice(0, 80)
    const filename = `${Date.now()}_${safeName}.pdf`
    const filePath = path.join(projectUploadsDir, filename)

    await writeFile(filePath, pdfBuffer)

    const relativeFilePath = path.relative(process.cwd(), filePath)

    // Step 3: Create Source record
    const source = await prisma.source.create({
      data: {
        projectId,
        filename: `${bib.authorSurname} - ${bib.title}.pdf`,
        filePath: relativeFilePath,
        fileType: 'pdf',
        processed: false,
      },
    })

    // Step 4: Link source to bibliography
    await prisma.bibliography.update({
      where: { id: bibliographyId },
      data: { sourceId: source.id },
    })

    // Step 5: Create or update LibraryEntry (for reuse across projects)
    let libraryEntry = await prisma.libraryEntry.findUnique({
      where: {
        userId_authorSurname_title: {
          userId,
          authorSurname: bib.authorSurname,
          title: bib.title,
        },
      },
    })

    if (libraryEntry) {
      // Update existing entry with file path if not already set
      if (!libraryEntry.filePath) {
        libraryEntry = await prisma.libraryEntry.update({
          where: { id: libraryEntry.id },
          data: {
            filePath: relativeFilePath,
            fileType: 'pdf',
          },
        })
      }
    } else {
      // Create new LibraryEntry
      libraryEntry = await prisma.libraryEntry.create({
        data: {
          userId,
          entryType: bib.entryType,
          authorSurname: bib.authorSurname,
          authorName: bib.authorName,
          title: bib.title,
          shortTitle: bib.shortTitle,
          editor: bib.editor,
          translator: bib.translator,
          publisher: bib.publisher,
          publishPlace: bib.publishPlace,
          year: bib.year,
          volume: bib.volume,
          edition: bib.edition,
          journalName: bib.journalName,
          journalVolume: bib.journalVolume,
          journalIssue: bib.journalIssue,
          pageRange: bib.pageRange,
          doi: bib.doi,
          url: bib.url,
          filePath: relativeFilePath,
          fileType: 'pdf',
          importSource: 'research',
        },
      })
    }

    // Step 6: Link bibliography to library entry
    if (!bib.libraryEntryId) {
      await prisma.bibliography.update({
        where: { id: bibliographyId },
        data: { libraryEntryId: libraryEntry.id },
      })
    }

    // Step 7: Trigger processing pipeline (fire-and-forget)
    triggerProcessing(source.id, projectId, filePath, bibliographyId).catch((err) =>
      console.error(`[download-pdf] Processing failed for source ${source.id}:`, err)
    )

    return NextResponse.json({
      success: true,
      sourceId: source.id,
      libraryEntryId: libraryEntry.id,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/research/download-pdf]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Trigger Python service processing: extract text → chunk → embed
 */
async function triggerProcessing(
  sourceId: string,
  projectId: string,
  filePath: string,
  bibliographyId: string
): Promise<void> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'

  try {
    const response = await fetch(`${pythonServiceUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, filePath, fileType: 'pdf' }),
    })

    if (!response.ok) {
      console.error(`[download-pdf] Python service returned ${response.status}`)
      return
    }

    const result = (await response.json()) as {
      totalPages: number
      chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
    }

    // Update source with page count
    await prisma.source.update({
      where: { id: sourceId },
      data: { totalPages: result.totalPages },
    })

    // Save chunks
    if (result.chunks?.length > 0) {
      const chunkRecords = await Promise.all(
        result.chunks.map((chunk) =>
          prisma.sourceChunk.create({
            data: {
              sourceId,
              bibliographyId,
              pageNumber: chunk.pageNumber,
              chunkIndex: chunk.chunkIndex,
              content: chunk.content,
            },
          })
        )
      )

      // Generate embeddings in batches
      const BATCH_SIZE = 100
      for (let i = 0; i < result.chunks.length; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE, result.chunks.length)
        const batchTexts = result.chunks.slice(i, batchEnd).map((c) => c.content)
        const batchRecords = chunkRecords.slice(i, batchEnd)

        try {
          const embedRes = await fetch(`${pythonServiceUrl}/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batchTexts }),
          })
          if (!embedRes.ok) continue

          const { embeddings } = (await embedRes.json()) as { embeddings: number[][] }

          for (let j = 0; j < batchRecords.length; j++) {
            await prisma.$executeRawUnsafe(
              `UPDATE "SourceChunk" SET embedding = $1::vector WHERE id = $2`,
              JSON.stringify(embeddings[j]),
              batchRecords[j].id
            )
          }
        } catch {
          // ignore embedding errors, chunks are still saved
        }
      }
    }
  } catch {
    // Python service not available
    console.warn(`[download-pdf] Python service unavailable for source ${sourceId}`)
  } finally {
    await prisma.source.update({
      where: { id: sourceId },
      data: { processed: true },
    })
  }
}
