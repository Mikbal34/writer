import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { readFile, stat } from 'fs/promises'
import path from 'path'

// GET /api/download?path=exports/...
export async function GET(req: NextRequest) {
  try {
    await requireAuth()

    const url = new URL(req.url)
    const filePath = url.searchParams.get('path')

    if (!filePath) {
      return NextResponse.json({ error: 'path is required' }, { status: 400 })
    }

    // Prevent directory traversal
    const resolved = path.isAbsolute(filePath)
      ? filePath
      : path.resolve(process.cwd(), filePath)

    const cwd = process.cwd()
    if (!resolved.startsWith(cwd)) {
      return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
    }

    try {
      await stat(resolved)
    } catch {
      return NextResponse.json({ error: 'File not found' }, { status: 404 })
    }

    const buffer = await readFile(resolved)
    const filename = path.basename(resolved)
    const ext = path.extname(filename).toLowerCase()

    const contentTypes: Record<string, string> = {
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.pdf': 'application/pdf',
    }
    const contentType = contentTypes[ext] ?? 'application/octet-stream'

    return new Response(buffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        'Content-Length': buffer.length.toString(),
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/download]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
