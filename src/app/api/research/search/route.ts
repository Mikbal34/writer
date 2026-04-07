import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { searchAcademic } from '@/lib/academic-search'

/**
 * GET /api/research/search
 * Search academic databases. No credits consumed.
 * Query params: q, providers (comma-separated), type, yearFrom, yearTo, page, limit, projectId
 */
export async function GET(req: NextRequest) {
  try {
    const session = await requireAuth()
    const url = req.nextUrl.searchParams

    const query = url.get('q')
    if (!query) {
      return NextResponse.json({ error: 'q parameter is required' }, { status: 400 })
    }

    const providers = url.get('providers')?.split(',').filter(Boolean)
    const type = url.get('type') || undefined
    const yearFrom = url.get('yearFrom') ? parseInt(url.get('yearFrom')!) : undefined
    const yearTo = url.get('yearTo') ? parseInt(url.get('yearTo')!) : undefined
    const page = parseInt(url.get('page') || '1')
    const limit = Math.min(parseInt(url.get('limit') || '10'), 25)
    const projectId = url.get('projectId') || undefined

    const { results, providers: usedProviders } = await searchAcademic({
      query,
      providers,
      type,
      yearFrom,
      yearTo,
      page,
      limit,
    })

    // Mark results that already exist in user's library
    if (results.length > 0) {
      const titles = results.map((r) => r.title)
      const existingEntries = await prisma.libraryEntry.findMany({
        where: {
          userId: session.user.id,
          title: { in: titles },
        },
        select: { title: true, authorSurname: true },
      })

      const existingSet = new Set(
        existingEntries.map((e) => `${e.title.toLowerCase()}|${e.authorSurname.toLowerCase()}`)
      )

      for (const result of results) {
        const key = `${result.title.toLowerCase()}|${result.authorSurname.toLowerCase()}`
        result.alreadyInLibrary = existingSet.has(key)
      }
    }

    // If projectId provided, also check project bibliography
    if (projectId && results.length > 0) {
      const project = await prisma.project.findFirst({
        where: { id: projectId, userId: session.user.id },
        select: { id: true },
      })

      if (project) {
        const existingBibs = await prisma.bibliography.findMany({
          where: { projectId },
          select: { title: true, authorSurname: true },
        })

        const bibSet = new Set(
          existingBibs.map((b) => `${b.title.toLowerCase()}|${b.authorSurname.toLowerCase()}`)
        )

        for (const result of results) {
          const key = `${result.title.toLowerCase()}|${result.authorSurname.toLowerCase()}`
          if (bibSet.has(key)) {
            result.alreadyInLibrary = true
          }
        }
      }
    }

    return NextResponse.json({
      results,
      providers: usedProviders,
      page,
      limit,
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/research/search]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
