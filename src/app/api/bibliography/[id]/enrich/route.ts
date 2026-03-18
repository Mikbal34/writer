import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { generateJSON } from '@/lib/claude'

type RouteContext = { params: Promise<{ id: string }> }

const ENRICHABLE_FIELDS = [
  'authorSurname',
  'authorName',
  'title',
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

type EnrichableField = (typeof ENRICHABLE_FIELDS)[number]

interface EnrichResult {
  suggestions: Partial<Record<EnrichableField, string>>
}

// POST /api/bibliography/[id]/enrich
export async function POST(_req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id } = await ctx.params

    const entry = await prisma.bibliography.findFirst({
      where: { id, project: { userId: session.user.id } },
    })

    if (!entry) {
      return NextResponse.json(
        { error: 'Bibliography entry not found' },
        { status: 404 }
      )
    }

    // Collect current field values
    const currentFields: Record<string, string | null> = {}
    for (const field of ENRICHABLE_FIELDS) {
      currentFields[field] = (entry as Record<string, unknown>)[field] as string | null
    }

    // If there's a linked source, grab chunk text for context
    let sourceText = ''
    if (entry.sourceId) {
      const chunks = await prisma.sourceChunk.findMany({
        where: { sourceId: entry.sourceId },
        orderBy: { chunkIndex: 'asc' },
        select: { content: true },
      })
      const joined = chunks.map((c) => c.content).join('\n')
      sourceText = joined.slice(0, 8000)
    }

    // Identify which fields are empty
    const emptyFields = ENRICHABLE_FIELDS.filter(
      (f) => !currentFields[f] || currentFields[f]!.trim() === ''
    )

    if (emptyFields.length === 0) {
      return NextResponse.json({ suggestions: {} })
    }

    // Build prompt
    const filledEntries = Object.entries(currentFields)
      .filter(([, v]) => v && v.trim() !== '')
      .map(([k, v]) => `  ${k}: "${v}"`)
      .join('\n')

    const prompt = [
      `Bir bibliyografya kaydının eksik alanlarını doldurman gerekiyor.`,
      ``,
      `Kayıt türü (entryType): ${entry.entryType}`,
      ``,
      `Mevcut dolu alanlar:`,
      filledEntries || '  (hiçbir alan dolu değil)',
      ``,
      `Doldurulması gereken boş alanlar: ${emptyFields.join(', ')}`,
      ``,
      sourceText
        ? `PDF'ten çıkarılmış metin (bu kaynağın içeriği):\n---\n${sourceText}\n---`
        : `Bu kayda bağlı PDF yok. Mevcut bilgilerden (yazar, başlık vb.) yararlanarak eksik alanları doldur.`,
      ``,
      `Kurallar:`,
      `- Sadece yukarıda listelenen boş alanlar için değer öner.`,
      `- Dolu alanları dahil etme.`,
      `- Emin olmadığın alanları dahil etme (null bırak / JSON'a ekleme).`,
      `- Yalnızca bir JSON nesnesi döndür: { "suggestions": { "alan": "değer", ... } }`,
      `- Değerler string olmalı.`,
    ].join('\n')

    const result = await generateJSON<EnrichResult>(
      prompt,
      'Sen bir bibliyografya uzmanısın. Akademik kaynakların künyelerini tamamlamak konusunda uzmansın. Türkçe ve Arapça kaynaklara hakimsin.'
    )

    // Safety: only return suggestions for fields that were actually empty
    const filtered: Partial<Record<EnrichableField, string>> = {}
    if (result.suggestions) {
      for (const field of emptyFields) {
        const val = result.suggestions[field]
        if (val && typeof val === 'string' && val.trim() !== '') {
          filtered[field] = val.trim()
        }
      }
    }

    return NextResponse.json({ suggestions: filtered })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/bibliography/[id]/enrich]', err)
    return NextResponse.json(
      { error: 'Failed to enrich bibliography entry' },
      { status: 500 }
    )
  }
}
