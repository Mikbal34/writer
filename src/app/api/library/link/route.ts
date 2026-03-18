import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import path from 'path'
import { existsSync } from 'fs'

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = await req.json()

    const { libraryEntryIds, projectId } = body as {
      libraryEntryIds: string[]
      projectId: string
    }

    if (!projectId || !Array.isArray(libraryEntryIds) || libraryEntryIds.length === 0) {
      return NextResponse.json(
        { error: 'projectId and libraryEntryIds[] are required' },
        { status: 400 }
      )
    }

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Verify library entries belong to user
    const entries = await prisma.libraryEntry.findMany({
      where: { id: { in: libraryEntryIds }, userId },
    })

    let linked = 0
    let skipped = 0
    let filesLinked = 0

    for (const entry of entries) {
      // Check if already linked (same author+title in project bibliography)
      const existing = await prisma.bibliography.findFirst({
        where: {
          projectId,
          authorSurname: entry.authorSurname,
          title: entry.title,
        },
      })

      let biblioId: string

      if (existing) {
        if (!existing.libraryEntryId) {
          await prisma.bibliography.update({
            where: { id: existing.id },
            data: { libraryEntryId: entry.id },
          })
          biblioId = existing.id
          linked++
        } else {
          biblioId = existing.id
          skipped++
        }
      } else {
        // Create new bibliography entry linked to library
        const biblio = await prisma.bibliography.create({
          data: {
            projectId,
            libraryEntryId: entry.id,
            entryType: entry.entryType,
            authorSurname: entry.authorSurname,
            authorName: entry.authorName,
            title: entry.title,
            shortTitle: entry.shortTitle,
            editor: entry.editor,
            translator: entry.translator,
            publisher: entry.publisher,
            publishPlace: entry.publishPlace,
            year: entry.year,
            volume: entry.volume,
            edition: entry.edition,
            journalName: entry.journalName,
            journalVolume: entry.journalVolume,
            journalIssue: entry.journalIssue,
            pageRange: entry.pageRange,
            doi: entry.doi,
            url: entry.url,
          },
        })
        biblioId = biblio.id
        linked++
      }

      // If library entry has a file, create a Source record for the project
      if (entry.filePath && entry.fileType) {
        const absPath = path.resolve(process.cwd(), entry.filePath)

        // Check the bibliography doesn't already have a source
        const bibWithSource = await prisma.bibliography.findUnique({
          where: { id: biblioId },
          select: { sourceId: true },
        })

        if (!bibWithSource?.sourceId && existsSync(absPath)) {
          const filename = path.basename(entry.filePath)

          const source = await prisma.source.create({
            data: {
              projectId,
              filename,
              filePath: entry.filePath,
              fileType: entry.fileType,
              processed: false,
            },
          })

          await prisma.bibliography.update({
            where: { id: biblioId },
            data: { sourceId: source.id },
          })

          // Trigger processing (fire-and-forget)
          triggerProcessing(source.id, projectId, absPath, entry.fileType, biblioId).catch(
            (err) => console.error(`[library/link] Processing failed for source ${source.id}:`, err)
          )

          filesLinked++
        }
      }
    }

    return NextResponse.json({ linked, skipped, filesLinked })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/link]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Fire-and-forget: call the Python processing service if available.
 */
async function triggerProcessing(
  sourceId: string,
  projectId: string,
  filePath: string,
  fileType: string,
  bibliographyId: string
): Promise<void> {
  const pythonServiceUrl = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'

  try {
    const response = await fetch(`${pythonServiceUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, filePath, fileType }),
    })

    if (!response.ok) {
      console.error(`[library/link] Python service returned ${response.status}`)
      return
    }

    const result = (await response.json()) as {
      totalPages: number
      chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
    }

    // Update source
    await prisma.source.update({
      where: { id: sourceId },
      data: { totalPages: result.totalPages, processed: true },
    })

    // Save chunks
    if (result.chunks?.length > 0) {
      await Promise.all(
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

      // Generate embeddings
      const BATCH_SIZE = 100
      for (let i = 0; i < result.chunks.length; i += BATCH_SIZE) {
        const batch = result.chunks.slice(i, i + BATCH_SIZE)
        try {
          const embedRes = await fetch(`${pythonServiceUrl}/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: batch.map((c) => c.content) }),
          })
          if (!embedRes.ok) continue

          const { embeddings } = (await embedRes.json()) as { embeddings: number[][] }
          // We'd need chunk IDs here - simplified for now
          console.log(`[library/link] Embedded ${embeddings.length} chunks for source ${sourceId}`)
        } catch {
          // ignore embedding errors
        }
      }
    }
  } catch {
    // Python service not available - just mark as processed
    await prisma.source.update({
      where: { id: sourceId },
      data: { processed: true },
    })
  }
}
