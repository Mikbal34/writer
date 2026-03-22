import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { generateJSONWithUsage, HAIKU } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'

// The uploads directory is at the project root (same level as /src)
const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
}

const MAX_FILE_SIZE_MB = 100
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

interface BibliographyExtraction {
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

// ---------------------------------------------------------------------------
// POST /api/sources/upload
// Multipart form data: file (File), projectId (string)
// Creates a Source record and optionally triggers the processing pipeline.
// ---------------------------------------------------------------------------
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

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Validate file type
    const mimeType = file.type
    const extension = ALLOWED_TYPES[mimeType]
    if (!extension) {
      return NextResponse.json(
        { error: `File type not allowed: ${mimeType}. Allowed: PDF, TXT, DOC, DOCX` },
        { status: 415 }
      )
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: `File exceeds maximum size of ${MAX_FILE_SIZE_MB}MB` },
        { status: 413 }
      )
    }

    // Credit check for AI extraction
    const credits = await checkCredits(session.user.id, 'source_upload_extract')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 }
      )
    }

    // Create project-specific upload directory
    const projectUploadsDir = path.join(UPLOADS_DIR, projectId)
    await mkdir(projectUploadsDir, { recursive: true })

    // Generate a unique filename to avoid collisions
    const timestamp = Date.now()
    const safeOriginalName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const savedFilename = `${timestamp}_${safeOriginalName}`
    const filePath = path.join(projectUploadsDir, savedFilename)

    // Write the file to disk
    const arrayBuffer = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(arrayBuffer))

    // Create Source record in the database
    const source = await prisma.source.create({
      data: {
        projectId,
        filename: file.name,
        filePath: path.relative(process.cwd(), filePath),
        fileType: extension,
        processed: false,
      },
    })

    // Trigger async processing + AI bibliography extraction (fire-and-forget)
    processAndExtractBibliography(source.id, projectId, filePath, extension, bibliographyId, session.user.id).catch(
      (err) => {
        console.error(
          `[sources/upload] Processing failed for source ${source.id}:`,
          err
        )
      }
    )

    return NextResponse.json(source, { status: 201 })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/sources/upload]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// Process PDF via Python service, then extract bibliography with AI
// ---------------------------------------------------------------------------
async function processAndExtractBibliography(
  sourceId: string,
  projectId: string,
  filePath: string,
  fileType: string,
  bibliographyId: string | null = null,
  userId: string | null = null
): Promise<void> {
  try {
    const pythonServiceUrl =
      process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8001'

    // Step 1: Extract text from PDF via Python service
    const response = await fetch(`${pythonServiceUrl}/process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, filePath, fileType }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => '')
      console.error(`[sources/upload] Python service returned ${response.status}: ${body}`)
      return
    }

    const processResult = (await response.json()) as {
      sourceId: string
      totalPages: number
      extractedText: string
      chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
      ocrPending?: boolean
    }

    let { totalPages, extractedText, chunks } = processResult
    const ocrPending = processResult.ocrPending ?? false

    // Step 2: Update Source with totalPages
    await prisma.source.update({
      where: { id: sourceId },
      data: { totalPages },
    })

    // Step 3: Extract bibliography metadata via AI and link to bibliography
    let biblioId: string | null = bibliographyId

    if (extractedText && extractedText.trim().length > 0) {
      try {
        const aiResult = await generateJSONWithUsage<BibliographyExtraction>(
          `Analyze the text extracted from the first pages of the following PDF and return bibliography information as JSON.

Text:
---
${extractedText.slice(0, 8000)}
---

Return in the following JSON format:
{
  "entryType": "kitap" | "makale" | "nesir" | "ceviri" | "tez" | "ansiklopedi" | "web",
  "authorSurname": "Author's surname",
  "authorName": "Author's first name or null",
  "title": "Full title of the work",
  "shortTitle": "Short title or null",
  "editor": "Editor or null",
  "translator": "Translator or null",
  "publisher": "Publisher or null",
  "publishPlace": "Place of publication or null",
  "year": "Publication year or null",
  "volume": "Volume information or null",
  "edition": "Edition number or null",
  "journalName": "Journal name or null",
  "journalVolume": "Journal volume or null",
  "journalIssue": "Journal issue or null",
  "pageRange": "Page range or null",
  "doi": "DOI or null",
  "url": "URL or null"
}

Rules:
- Leave fields you cannot extract from the text as null.
- Determine the entryType based on the type of text (academic article → "makale", book → "kitap", etc.).
- If no author name is found, write "Unknown".
- Return only JSON, nothing else.`,
          'You are a bibliography extraction assistant. Extract bibliographic metadata from the given text. Always respond with valid JSON only.',
          { model: HAIKU }
        )
        const bibData = aiResult.data

        // Deduct credits for AI extraction
        if (userId) {
          try {
            await deductCredits(
              userId,
              'source_upload_extract',
              aiResult.inputTokens,
              aiResult.outputTokens,
              'haiku',
              { sourceId, projectId }
            )
          } catch (creditErr) {
            console.error('[sources/upload] Credit deduction failed:', creditErr)
          }
        }

        if (bibliographyId) {
          // Merge AI-extracted data into existing bibliography — only fill empty fields
          const existingBib = await prisma.bibliography.findUnique({
            where: { id: bibliographyId },
          })

          if (existingBib) {
            const mergeableFields = [
              'entryType', 'authorSurname', 'authorName', 'title', 'shortTitle',
              'editor', 'translator', 'publisher', 'publishPlace', 'year',
              'volume', 'edition', 'journalName', 'journalVolume', 'journalIssue',
              'pageRange', 'doi', 'url',
            ] as const

            const updateData: Record<string, string> = {}
            for (const key of mergeableFields) {
              const aiValue = bibData[key]
              if (aiValue && !existingBib[key]) {
                updateData[key] = typeof aiValue === 'string' ? aiValue.trim() : aiValue
              }
            }

            await prisma.bibliography.update({
              where: { id: bibliographyId },
              data: { ...updateData, sourceId },
            })
          }

          biblioId = bibliographyId
        } else if (bibData.authorSurname && bibData.title) {
          // No bibliographyId — create a new bibliography entry
          const bibRecord = await prisma.bibliography.create({
            data: {
              projectId,
              sourceId,
              entryType: bibData.entryType ?? 'kitap',
              authorSurname: bibData.authorSurname.trim(),
              authorName: bibData.authorName ?? null,
              title: bibData.title.trim(),
              shortTitle: bibData.shortTitle ?? null,
              editor: bibData.editor ?? null,
              translator: bibData.translator ?? null,
              publisher: bibData.publisher ?? null,
              publishPlace: bibData.publishPlace ?? null,
              year: bibData.year ?? null,
              volume: bibData.volume ?? null,
              edition: bibData.edition ?? null,
              journalName: bibData.journalName ?? null,
              journalVolume: bibData.journalVolume ?? null,
              journalIssue: bibData.journalIssue ?? null,
              pageRange: bibData.pageRange ?? null,
              doi: bibData.doi ?? null,
              url: bibData.url ?? null,
            },
          })
          biblioId = bibRecord.id
        }
      } catch (aiErr) {
        console.error(
          `[sources/upload] AI bibliography extraction failed for source ${sourceId}:`,
          aiErr
        )
        // If we have a bibliographyId but AI failed, still link the source
        if (bibliographyId) {
          await prisma.bibliography.update({
            where: { id: bibliographyId },
            data: { sourceId },
          })
          biblioId = bibliographyId
        }
      }
    } else if (bibliographyId) {
      // No extracted text but we have a bibliographyId — just link the source
      await prisma.bibliography.update({
        where: { id: bibliographyId },
        data: { sourceId },
      })
      biblioId = bibliographyId
    }

    // Step 4: If OCR is pending, poll for background results
    if (ocrPending) {
      console.log(`[sources/upload] OCR pending for source ${sourceId}, polling...`)
      const maxAttempts = 120 // up to ~10 minutes
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await new Promise((r) => setTimeout(r, 5000))
        try {
          const statusRes = await fetch(`${pythonServiceUrl}/ocr-status/${sourceId}`)
          if (!statusRes.ok) continue
          const status = (await statusRes.json()) as {
            ready: boolean
            totalPages: number
            chunks: Array<{ pageNumber: number; chunkIndex: number; content: string }>
            error: string
          }
          if (!status.ready) continue

          if (status.error) {
            console.error(`[sources/upload] OCR failed for source ${sourceId}: ${status.error}`)
            break
          }

          // Update totalPages with actual OCR count
          if (status.totalPages > 0) {
            await prisma.source.update({
              where: { id: sourceId },
              data: { totalPages: status.totalPages },
            })
          }

          chunks = status.chunks
          console.log(`[sources/upload] OCR complete for source ${sourceId}: ${chunks.length} chunks`)
          break
        } catch {
          // ignore poll errors, retry
        }
      }
    }

    // Step 5: Save chunks and generate embeddings
    if (chunks && chunks.length > 0) {
      try {
        // Create SourceChunk records
        const chunkRecords = await Promise.all(
          chunks.map((chunk) =>
            prisma.sourceChunk.create({
              data: {
                sourceId,
                bibliographyId: biblioId,
                pageNumber: chunk.pageNumber,
                chunkIndex: chunk.chunkIndex,
                content: chunk.content,
              },
            })
          )
        )

        console.log(
          `[sources/upload] Created ${chunkRecords.length} chunks for source ${sourceId}`
        )

        // Generate embeddings in batches of 100
        const BATCH_SIZE = 100
        for (let batchStart = 0; batchStart < chunks.length; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, chunks.length)
          const batchTexts = chunks.slice(batchStart, batchEnd).map((c) => c.content)
          const batchRecords = chunkRecords.slice(batchStart, batchEnd)

          try {
            const embedResponse = await fetch(`${pythonServiceUrl}/embed`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ texts: batchTexts }),
            })

            if (!embedResponse.ok) {
              const errText = await embedResponse.text().catch(() => '')
              console.error(
                `[sources/upload] Embedding batch failed (${batchStart}-${batchEnd}): ${embedResponse.status} ${errText}`
              )
              continue
            }

            const { embeddings } = (await embedResponse.json()) as {
              embeddings: number[][]
            }

            // Update vectors via raw SQL (Prisma doesn't support vector type directly)
            for (let i = 0; i < batchRecords.length; i++) {
              await prisma.$executeRawUnsafe(
                `UPDATE "SourceChunk" SET embedding = $1::vector WHERE id = $2`,
                JSON.stringify(embeddings[i]),
                batchRecords[i].id
              )
            }

            console.log(
              `[sources/upload] Embedded batch ${batchStart}-${batchEnd} for source ${sourceId}`
            )
          } catch (embedErr) {
            console.error(
              `[sources/upload] Embedding batch error (${batchStart}-${batchEnd}):`,
              embedErr
            )
          }
        }
      } catch (chunkErr) {
        console.error(
          `[sources/upload] Chunk creation failed for source ${sourceId}:`,
          chunkErr
        )
      }
    }
  } finally {
    // Always mark source as processed — even if Python service or AI fails
    await prisma.source.update({
      where: { id: sourceId },
      data: { processed: true },
    })
  }
}
