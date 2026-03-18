import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { uploadToGoogleDrive, DriveAuthError } from '@/lib/google-drive'
import { readFileSync, existsSync } from 'fs'
import path from 'path'

type RouteContext = { params: Promise<{ id: string }> }

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

// POST /api/outputs/[id]/drive — Upload an output file to Google Drive
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const output = await prisma.output.findFirst({
      where: {
        id,
        project: { userId: session.user.id },
      },
    })

    if (!output) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    // Resolve file path
    const absolutePath = path.isAbsolute(output.filePath)
      ? output.filePath
      : path.join(process.cwd(), output.filePath)

    if (!existsSync(absolutePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
    }

    const buffer = readFileSync(absolutePath)
    const ext = output.fileType.toLowerCase()
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'
    const fileName = path.basename(output.filePath)

    const { fileId, webViewLink } = await uploadToGoogleDrive({
      userId: session.user.id,
      fileName,
      mimeType,
      buffer,
      convertToGoogleDocs: ext === 'docx',
    })

    // Persist Drive info on the output record
    await prisma.output.update({
      where: { id: output.id },
      data: {
        driveFileId: fileId,
        driveWebLink: webViewLink,
      },
    })

    return NextResponse.json({
      success: true,
      fileId,
      webViewLink,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (err instanceof DriveAuthError) {
      return NextResponse.json(
        { error: err.message },
        { status: 403 },
      )
    }
    const message = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/outputs/[id]/drive]', message, err)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
