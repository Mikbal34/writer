import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { createReadStream, existsSync, statSync } from 'fs'
import path from 'path'

type RouteContext = { params: Promise<{ id: string }> }

// MIME type map by file extension
const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  html: 'text/html; charset=utf-8',
}

// GET /api/outputs/[id]/download
// Streams the generated output file to the client.
export async function GET(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    // Verify the output belongs to the requesting user
    const output = await prisma.output.findFirst({
      where: {
        id,
        project: { userId: session.user.id },
      },
      include: {
        project: { select: { title: true } },
        subsection: { select: { title: true, subsectionId: true } },
      },
    })

    if (!output) {
      return NextResponse.json({ error: 'Output not found' }, { status: 404 })
    }

    // Resolve the absolute file path
    const absolutePath = path.isAbsolute(output.filePath)
      ? output.filePath
      : path.join(process.cwd(), output.filePath)

    if (!existsSync(absolutePath)) {
      return NextResponse.json({ error: 'File not found on disk' }, { status: 404 })
    }

    const stats = statSync(absolutePath)
    const ext = output.fileType.toLowerCase()
    const mimeType = MIME_TYPES[ext] ?? 'application/octet-stream'

    // Build a meaningful download filename
    const baseName = output.subsection
      ? `${output.subsection.subsectionId}_${output.subsection.title}`
          .replace(/[^a-zA-Z0-9_-]/g, '_')
          .slice(0, 80)
      : output.project.title.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)

    const downloadFilename = `${baseName}.${ext}`

    // Stream the file using a ReadableStream backed by a Node.js fs ReadStream
    const nodeStream = createReadStream(absolutePath)
    const webStream = new ReadableStream({
      start(controller) {
        nodeStream.on('data', (chunk: Buffer | string) => {
          controller.enqueue(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
        })
        nodeStream.on('end', () => controller.close())
        nodeStream.on('error', (err) => controller.error(err))
      },
      cancel() {
        nodeStream.destroy()
      },
    })

    return new Response(webStream, {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Disposition': `attachment; filename="${downloadFilename}"`,
        'Content-Length': String(stats.size),
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/outputs/[id]/download]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
