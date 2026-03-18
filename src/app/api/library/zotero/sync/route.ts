import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getCollectionItems, getItemAttachments, downloadAttachment } from '@/lib/zotero'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

const CONTENT_TYPE_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'txt',
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const body = await req.json()
    const collectionKeys = body.collectionKeys as string[] | undefined
    const downloadFiles = body.downloadFiles !== false // default true

    const conn = await prisma.zoteroConnection.findUnique({
      where: { userId },
    })
    if (!conn) {
      return NextResponse.json({ error: 'No Zotero connection' }, { status: 404 })
    }

    const keys = collectionKeys ?? conn.syncCollections ?? []
    if (keys.length === 0) {
      return NextResponse.json({ error: 'No collections selected' }, { status: 400 })
    }

    // Update saved collection preferences
    if (collectionKeys) {
      await prisma.zoteroConnection.update({
        where: { userId },
        data: { syncCollections: collectionKeys },
      })
    }

    let created = 0
    let updated = 0
    let skipped = 0
    let filesDownloaded = 0

    // Prepare library uploads dir for this user
    const libraryUploadsDir = path.join(UPLOADS_DIR, 'library', userId)
    if (downloadFiles) {
      await mkdir(libraryUploadsDir, { recursive: true })
    }

    for (const collKey of keys) {
      const items = await getCollectionItems(conn.zoteroUserId, conn.apiKey, collKey)

      for (const item of items) {
        let entryId: string | null = null

        // Upsert by zoteroKey
        const existing = await prisma.libraryEntry.findFirst({
          where: { userId, zoteroKey: item.zoteroKey },
        })

        if (existing) {
          await prisma.libraryEntry.update({
            where: { id: existing.id },
            data: {
              entryType: item.entryType,
              authorSurname: item.authorSurname,
              authorName: item.authorName,
              title: item.title,
              publisher: item.publisher,
              publishPlace: item.publishPlace,
              year: item.year,
              volume: item.volume,
              edition: item.edition,
              journalName: item.journalName,
              journalVolume: item.journalVolume,
              journalIssue: item.journalIssue,
              pageRange: item.pageRange,
              doi: item.doi,
              url: item.url,
              editor: item.editor,
              translator: item.translator,
              importSource: 'zotero',
            },
          })
          entryId = existing.id
          updated++
        } else {
          // Check dedup by author+title
          const dup = await prisma.libraryEntry.findUnique({
            where: {
              userId_authorSurname_title: {
                userId,
                authorSurname: item.authorSurname,
                title: item.title,
              },
            },
          })
          if (dup) {
            await prisma.libraryEntry.update({
              where: { id: dup.id },
              data: { zoteroKey: item.zoteroKey, importSource: 'zotero' },
            })
            entryId = dup.id
            updated++
          } else {
            try {
              const newEntry = await prisma.libraryEntry.create({
                data: {
                  userId,
                  zoteroKey: item.zoteroKey,
                  entryType: item.entryType,
                  authorSurname: item.authorSurname,
                  authorName: item.authorName,
                  title: item.title,
                  publisher: item.publisher,
                  publishPlace: item.publishPlace,
                  year: item.year,
                  volume: item.volume,
                  edition: item.edition,
                  journalName: item.journalName,
                  journalVolume: item.journalVolume,
                  journalIssue: item.journalIssue,
                  pageRange: item.pageRange,
                  doi: item.doi,
                  url: item.url,
                  editor: item.editor,
                  translator: item.translator,
                  importSource: 'zotero',
                },
              })
              entryId = newEntry.id
              created++
            } catch {
              skipped++
              continue
            }
          }
        }

        // Download PDF attachment if entry doesn't already have a file
        if (downloadFiles && entryId) {
          const entry = await prisma.libraryEntry.findUnique({
            where: { id: entryId },
            select: { filePath: true },
          })

          if (!entry?.filePath) {
            try {
              const attachments = await getItemAttachments(
                conn.zoteroUserId,
                conn.apiKey,
                item.zoteroKey
              )

              // Pick first PDF, fallback to first attachment
              const pdfAttachment = attachments.find(
                (a) => a.contentType === 'application/pdf'
              ) ?? attachments[0]

              if (pdfAttachment) {
                const fileBuffer = await downloadAttachment(
                  conn.zoteroUserId,
                  conn.apiKey,
                  pdfAttachment.key
                )

                if (fileBuffer) {
                  const ext = CONTENT_TYPE_EXT[pdfAttachment.contentType] ?? 'pdf'
                  const safeFilename = pdfAttachment.filename.replace(/[^a-zA-Z0-9._-]/g, '_')
                  const savedFilename = `${Date.now()}_${safeFilename}`
                  const filePath = path.join(libraryUploadsDir, savedFilename)

                  await writeFile(filePath, fileBuffer)

                  await prisma.libraryEntry.update({
                    where: { id: entryId },
                    data: {
                      filePath: path.relative(process.cwd(), filePath),
                      fileType: ext,
                    },
                  })
                  filesDownloaded++
                }
              }
            } catch (dlErr) {
              console.error(
                `[zotero/sync] Failed to download attachment for ${item.zoteroKey}:`,
                dlErr
              )
            }
          }
        }
      }
    }

    await prisma.zoteroConnection.update({
      where: { userId },
      data: { lastSyncAt: new Date() },
    })

    return NextResponse.json({ created, updated, skipped, filesDownloaded })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/library/zotero/sync]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
