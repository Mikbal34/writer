import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChat, type ChatMessage } from '@/lib/claude'
import { findOrCreateBibliography } from '@/lib/bibliography'
import type { Prisma } from '@prisma/client'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Build a compact roadmap representation for the system prompt
// ---------------------------------------------------------------------------
type ChapterInput = {
  id: string
  number: number
  title: string
  sections: Array<{
    id: string
    sectionId: string
    title: string
    subsections: Array<{
      id: string
      subsectionId: string
      title: string
      sourceMappings?: Array<{
        id: string
        sourceType: string
        priority: string
        relevance: string | null
        howToUse: string | null
        whereToFind: string | null
        extractionGuide: string | null
        bibliography: {
          authorSurname: string
          authorName: string | null
          title: string
        }
      }>
    }>
  }>
}

function buildCompactRoadmap(chapters: ChapterInput[]) {
  return chapters.map((ch) => ({
    dbId: ch.id,
    displayId: ch.number,
    title: ch.title,
    sections: ch.sections.map((sec) => ({
      dbId: sec.id,
      displayId: sec.sectionId,
      title: sec.title,
      subsections: sec.subsections.map((sub) => ({
        dbId: sub.id,
        displayId: sub.subsectionId,
        title: sub.title,
        sources: (sub.sourceMappings ?? []).map((sm) => ({
          mappingDbId: sm.id,
          author: sm.bibliography.authorName
            ? `${sm.bibliography.authorSurname}, ${sm.bibliography.authorName}`
            : sm.bibliography.authorSurname,
          work: sm.bibliography.title,
          sourceType: sm.sourceType,
          priority: sm.priority,
          howToUse: sm.howToUse,
          whereToFind: sm.whereToFind,
          extractionGuide: sm.extractionGuide,
        })),
      })),
    })),
  }))
}

// ---------------------------------------------------------------------------
// System prompt — creation mode vs modification mode
// ---------------------------------------------------------------------------
type LibraryEntryCompact = {
  authorSurname: string
  authorName: string | null
  title: string
  year: string | null
  entryType: string
}

function buildSystemPrompt(
  compactRoadmap: ReturnType<typeof buildCompactRoadmap>,
  project: { title: string; topic: string | null; purpose: string | null; audience: string | null; language: string | null },
  libraryEntries?: LibraryEntryCompact[]
) {
  const isCreationMode = compactRoadmap.length === 0

  const commandDocs = `
Kullanilabilir komutlar:
- {"action": "update_subsection", "subsectionDbId": "...", "fields": {"title?": "...", "description?": "...", "whatToWrite?": "...", "keyPoints?": [...], "writingStrategy?": "...", "estimatedPages?": N}}
- {"action": "add_subsection", "sectionDbId": "...", "subsection": {"subsectionId": "1.1.4", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N}}
- {"action": "remove_subsection", "subsectionDbId": "..."}
- {"action": "update_section", "sectionDbId": "...", "fields": {"title?": "...", "keyConcepts?": [...]}}
- {"action": "add_section", "chapterDbId": "...", "section": {"sectionId": "1.3", "title": "...", "keyConcepts": [...]}, "subsections": [{"subsectionId": "1.3.1", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N}]}
- {"action": "remove_section", "sectionDbId": "..."}
- {"action": "update_chapter", "chapterDbId": "...", "fields": {"title?": "...", "purpose?": "...", "estimatedPages?": N}}
- {"action": "add_chapter", "chapter": {"number": N, "title": "...", "purpose": "...", "estimatedPages": N}, "tempId": "__temp_ch_1", "sections": [{"sectionId": "1.1", "title": "...", "keyConcepts": [...], "tempId": "__temp_sec_1_1", "subsections": [{"subsectionId": "1.1.1", "title": "...", "description": "...", "whatToWrite": "...", "keyPoints": [...], "writingStrategy": "...", "estimatedPages": N}]}]}
- {"action": "remove_chapter", "chapterDbId": "..."}
- {"action": "move_section", "sectionDbId": "...", "targetChapterDbId": "..."}
- {"action": "update_source", "sourceMappingDbId": "...", "fields": {"howToUse?": "...", "whereToFind?": "...", "extractionGuide?": "...", "relevance?": "...", "priority?": "primary|supporting"}}
- {"action": "add_source", "subsectionDbId": "...", "source": {"author": "Soyadi, Adi", "work": "Eser Adi", "sourceType": "classical|modern", "priority": "primary|supporting", "relevance": "...", "howToUse": "...", "whereToFind": "...", "extractionGuide": "..."}}
- {"action": "remove_source", "sourceMappingDbId": "..."}
- {"action": "update_project", "fields": {"topic?": "...", "purpose?": "...", "audience?": "..."}}

KAYNAK KURALLARI:
- add_source komutunda su alanlarin TAMAMI doldurulmali, hicbiri bos birakilmamali: relevance, howToUse, whereToFind, extractionGuide. Bilgi eksikse bile en iyi tahminini yaz.
- Kaynak eklerken ONCE kullanicinin kutuphanesindeki kaynaklari tercih et. Kutuphanede uygun kaynak varsa onu kullan, eksik kalirsa kendin oner.`

  const librarySection = libraryEntries && libraryEntries.length > 0
    ? `\n\nKULLANICININ KUTUPHANESI (once buradan eslestir, eksik kalirsa kendin oner):\n${libraryEntries.map((e) => `- ${e.authorSurname}${e.authorName ? ', ' + e.authorName : ''}: "${e.title}" (${e.year ?? '?'}) [${e.entryType}]`).join('\n')}`
    : ''

  if (isCreationMode) {
    return `Sen bir akademik kitap planlama asistanisin. Kullanici yeni bir kitap projesi olusturdu, henuz roadmap yok.

Proje bilgileri:
- Baslik: ${project.title}
- Konu: ${project.topic ?? 'Belirtilmedi'}
- Amac: ${project.purpose ?? 'Belirtilmedi'}
- Hedef Kitle: ${project.audience ?? 'Belirtilmedi'}
- Dil: ${project.language ?? 'tr'}

Gorevin:
1. Eger konu, amac veya hedef kitle belirtilmemisse, kullaniciya kitap hakkinda sorular sor.
2. Kitabin icerigi ve yapisi hakkinda yeterli bilgi topladiktan sonra, roadmap olusturmadan ONCE kullaniciya kaynaklarla ilgili sorular sor:
   - Kullanmayi dusundukleri belirli kaynaklar (kitaplar, makaleler, yazarlar) var mi?
   - Kaynak tercihleri nedir? (klasik mi modern mi, birincil mi ikincil mi)
   - Her alt baslik icin yaklasik kac kaynak istiyorlar? (ornek: 2-3 kaynak)
   - Belirli bir akademik gelenek veya ekol tercih ediyorlar mi?
3. Kaynak bilgilerini aldiktan sonra (veya kullanici "sen sec/sen belirle" derse), kapsamli bir roadmap olustur (4-6 bolum, her bolumde 2-3 alt bolum, her alt bolumde 2-3 alt kisim).
4. Roadmap'i olustururken HER alt baslige mutlaka kaynak ekle (add_source komutuyla). Kullanicinin verdigi kaynaklari kullan, eksik kalanlari kendin oner.
5. update_project komutu ile proje bilgilerini guncelle.

KURALLAR:
1. Once kullaniciya ne yapacagini kisa ve net acikla (Turkce).
2. Sonra asagidaki formatta komutlari ekle:
<roadmap_commands>
[...komutlar JSON array...]
</roadmap_commands>

TOPLU OLUSTURMA:
- Yeni bolumler olustururken add_chapter komutuna tempId ver (ornek: "__temp_ch_1").
- add_chapter icindeki sections ve subsections alt ogeleri otomatik olusturulur.
- Sonraki komutlarda tempId'leri referans olarak kullanabilirsin.

${commandDocs}

ONEMLI:
- Eger kullanici sadece soru soruyorsa veya bilgi istiyorsa, komut ekleme.
- Birden fazla degisiklik isterse, hepsini tek bir commands array'inde topla.
- Kaynak eklerken author formatini "Soyadi, Adi" olarak kullan.${librarySection}`
  }

  return `Sen bir akademik kitap planlama asistanisin. Kullanici mevcut roadmap uzerinde degisiklik yapmak istiyor.

Mevcut roadmap yapisi:
${JSON.stringify(compactRoadmap, null, 2)}

Gorevin: Kullanicinin istegini anla, acikla, ve sonra degisiklikleri uygulayacak komutlari uret.

KURALLAR:
1. Once kullaniciya ne yapacagini kisa ve net acikla (Turkce).
2. Sonra asagidaki formatta komutlari ekle:
<roadmap_commands>
[...komutlar JSON array...]
</roadmap_commands>

TOPLU OLUSTURMA:
- Yeni bolumler olustururken add_chapter komutuna tempId ver (ornek: "__temp_ch_1").
- add_chapter icindeki sections ve subsections alt ogeleri otomatik olusturulur.
- Sonraki komutlarda tempId'leri referans olarak kullanabilirsin.

${commandDocs}

ONEMLI:
- dbId alanlari icin mevcut roadmap'teki gercek ID'leri kullan.
- displayId alanlari "1.1", "1.1.1" formatinda.
- Eger kullanici sadece soru soruyorsa veya bilgi istiyorsa, komut ekleme.
- Birden fazla degisiklik isterse, hepsini tek bir commands array'inde topla.
- Kaynak eklerken author formatini "Soyadi, Adi" olarak kullan.${librarySection}`
}

// ---------------------------------------------------------------------------
// Parse <roadmap_commands> from the AI response
// ---------------------------------------------------------------------------
function parseCommands(text: string): Array<Record<string, unknown>> {
  const match = text.match(/<roadmap_commands>\s*([\s\S]*?)\s*<\/roadmap_commands>/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1])
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Apply commands to the database
// ---------------------------------------------------------------------------
async function applyCommands(
  tx: Prisma.TransactionClient,
  projectId: string,
  commands: Array<Record<string, unknown>>,
  userId?: string
) {
  const tempIdMap = new Map<string, string>()

  function resolveId(id: string): string {
    if (id && id.startsWith('__temp_')) {
      return tempIdMap.get(id) ?? id
    }
    return id
  }

  for (const cmd of commands) {
    const action = cmd.action as string

    switch (action) {
      case 'update_subsection': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.subsectionDbId) break
        await tx.subsection.update({
          where: { id: resolveId(cmd.subsectionDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.description !== undefined && { description: fields.description as string }),
            ...(fields.whatToWrite !== undefined && { whatToWrite: fields.whatToWrite as string }),
            ...(fields.keyPoints !== undefined && { keyPoints: fields.keyPoints as string[] }),
            ...(fields.writingStrategy !== undefined && { writingStrategy: fields.writingStrategy as string }),
            ...(fields.estimatedPages !== undefined && { estimatedPages: fields.estimatedPages as number }),
          },
        })
        break
      }

      case 'add_subsection': {
        const sectionDbId = resolveId(cmd.sectionDbId as string)
        const sub = cmd.subsection as Record<string, unknown>
        if (!sectionDbId || !sub) break
        const existing = await tx.subsection.findMany({
          where: { sectionId: sectionDbId },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0
        const subsection = await tx.subsection.create({
          data: {
            sectionId: sectionDbId,
            subsectionId: (sub.subsectionId as string) ?? '',
            title: (sub.title as string) ?? '',
            description: (sub.description as string) ?? null,
            whatToWrite: (sub.whatToWrite as string) ?? null,
            keyPoints: (sub.keyPoints as string[]) ?? [],
            writingStrategy: (sub.writingStrategy as string) ?? null,
            estimatedPages: (sub.estimatedPages as number) ?? null,
            sortOrder: nextOrder,
            status: 'pending',
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, subsection.id)
        break
      }

      case 'remove_subsection': {
        if (!cmd.subsectionDbId) break
        await tx.subsection.delete({ where: { id: resolveId(cmd.subsectionDbId as string) } })
        break
      }

      case 'update_section': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.sectionDbId) break
        await tx.section.update({
          where: { id: resolveId(cmd.sectionDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.keyConcepts !== undefined && { keyConcepts: fields.keyConcepts as string[] }),
          },
        })
        break
      }

      case 'add_section': {
        const chapterDbId = resolveId(cmd.chapterDbId as string)
        const sec = cmd.section as Record<string, unknown>
        if (!chapterDbId || !sec) break
        const existing = await tx.section.findMany({
          where: { chapterId: chapterDbId },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0
        const section = await tx.section.create({
          data: {
            chapterId: chapterDbId,
            sectionId: (sec.sectionId as string) ?? '',
            title: (sec.title as string) ?? '',
            keyConcepts: (sec.keyConcepts as string[]) ?? [],
            sortOrder: nextOrder,
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, section.id)
        if (sec.tempId) tempIdMap.set(sec.tempId as string, section.id)

        // Auto-create subsections if provided inline
        const subsections = (cmd.subsections ?? sec.subsections) as Array<Record<string, unknown>> | undefined
        if (subsections && Array.isArray(subsections)) {
          for (const [subIdx, sub] of subsections.entries()) {
            const subsec = await tx.subsection.create({
              data: {
                sectionId: section.id,
                subsectionId: (sub.subsectionId as string) ?? '',
                title: (sub.title as string) ?? '',
                description: (sub.description as string) ?? null,
                whatToWrite: (sub.whatToWrite as string) ?? null,
                keyPoints: (sub.keyPoints as string[]) ?? [],
                writingStrategy: (sub.writingStrategy as string) ?? null,
                estimatedPages: (sub.estimatedPages as number) ?? null,
                sortOrder: subIdx,
                status: 'pending',
              },
            })
            if (sub.tempId) tempIdMap.set(sub.tempId as string, subsec.id)
          }
        }
        break
      }

      case 'remove_section': {
        if (!cmd.sectionDbId) break
        await tx.section.delete({ where: { id: resolveId(cmd.sectionDbId as string) } })
        break
      }

      case 'update_chapter': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.chapterDbId) break
        await tx.chapter.update({
          where: { id: resolveId(cmd.chapterDbId as string) },
          data: {
            ...(fields.title !== undefined && { title: fields.title as string }),
            ...(fields.purpose !== undefined && { purpose: fields.purpose as string }),
            ...(fields.estimatedPages !== undefined && { estimatedPages: fields.estimatedPages as number }),
          },
        })
        break
      }

      case 'add_chapter': {
        const ch = cmd.chapter as Record<string, unknown>
        if (!ch) break
        const existing = await tx.chapter.findMany({
          where: { projectId },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0
        const nextNumber = existing.length > 0 ? existing[0].number + 1 : 1
        const chapter = await tx.chapter.create({
          data: {
            projectId,
            number: (ch.number as number) ?? nextNumber,
            title: (ch.title as string) ?? '',
            purpose: (ch.purpose as string) ?? null,
            estimatedPages: (ch.estimatedPages as number) ?? null,
            sortOrder: nextOrder,
          },
        })
        if (cmd.tempId) tempIdMap.set(cmd.tempId as string, chapter.id)

        // Auto-create sections + subsections if provided inline
        const sections = (cmd.sections ?? ch.sections) as Array<Record<string, unknown>> | undefined
        if (sections && Array.isArray(sections)) {
          for (const [secIdx, sec] of sections.entries()) {
            const section = await tx.section.create({
              data: {
                chapterId: chapter.id,
                sectionId: (sec.sectionId as string) ?? '',
                title: (sec.title as string) ?? '',
                keyConcepts: (sec.keyConcepts as string[]) ?? [],
                sortOrder: secIdx,
              },
            })
            if (sec.tempId) tempIdMap.set(sec.tempId as string, section.id)

            const subsections = sec.subsections as Array<Record<string, unknown>> | undefined
            if (subsections && Array.isArray(subsections)) {
              for (const [subIdx, sub] of subsections.entries()) {
                const subsec = await tx.subsection.create({
                  data: {
                    sectionId: section.id,
                    subsectionId: (sub.subsectionId as string) ?? '',
                    title: (sub.title as string) ?? '',
                    description: (sub.description as string) ?? null,
                    whatToWrite: (sub.whatToWrite as string) ?? null,
                    keyPoints: (sub.keyPoints as string[]) ?? [],
                    writingStrategy: (sub.writingStrategy as string) ?? null,
                    estimatedPages: (sub.estimatedPages as number) ?? null,
                    sortOrder: subIdx,
                    status: 'pending',
                  },
                })
                if (sub.tempId) tempIdMap.set(sub.tempId as string, subsec.id)
              }
            }
          }
        }
        break
      }

      case 'remove_chapter': {
        if (!cmd.chapterDbId) break
        await tx.chapter.delete({ where: { id: resolveId(cmd.chapterDbId as string) } })
        break
      }

      case 'move_section': {
        const sectionDbId = resolveId(cmd.sectionDbId as string)
        const targetChapterDbId = resolveId(cmd.targetChapterDbId as string)
        if (!sectionDbId || !targetChapterDbId) break
        const existing = await tx.section.findMany({
          where: { chapterId: targetChapterDbId },
          orderBy: { sortOrder: 'desc' },
          take: 1,
        })
        const nextOrder = existing.length > 0 ? existing[0].sortOrder + 1 : 0
        await tx.section.update({
          where: { id: sectionDbId },
          data: { chapterId: targetChapterDbId, sortOrder: nextOrder },
        })
        break
      }

      case 'update_source': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields || !cmd.sourceMappingDbId) break
        await tx.sourceMapping.update({
          where: { id: cmd.sourceMappingDbId as string },
          data: {
            ...(fields.howToUse !== undefined && { howToUse: fields.howToUse as string }),
            ...(fields.whereToFind !== undefined && { whereToFind: fields.whereToFind as string }),
            ...(fields.extractionGuide !== undefined && { extractionGuide: fields.extractionGuide as string }),
            ...(fields.relevance !== undefined && { relevance: fields.relevance as string }),
            ...(fields.priority !== undefined && { priority: fields.priority as string }),
          },
        })
        break
      }

      case 'add_source': {
        const src = cmd.source as Record<string, unknown> | undefined
        let subsectionDbId = resolveId(cmd.subsectionDbId as string)
        if (!src || !subsectionDbId) break

        // Fallback: if subsectionDbId looks like a displayId (e.g. "1.1.1"), resolve it
        if (!subsectionDbId.startsWith('c') || subsectionDbId.includes('.')) {
          const found = await tx.subsection.findFirst({
            where: {
              subsectionId: subsectionDbId,
              section: { chapter: { projectId } },
            },
            select: { id: true },
          })
          if (found) subsectionDbId = found.id
          else break // subsection not found, skip
        }

        const biblio = await findOrCreateBibliography(
          tx,
          projectId,
          src.author as string,
          src.work as string,
          undefined,
          userId
        )
        await tx.sourceMapping.upsert({
          where: {
            subsectionId_bibliographyId: {
              subsectionId: subsectionDbId,
              bibliographyId: biblio.id,
            },
          },
          create: {
            subsectionId: subsectionDbId,
            bibliographyId: biblio.id,
            sourceType: (src.sourceType as string) ?? 'modern',
            priority: (src.priority as string) ?? 'supporting',
            relevance: (src.relevance as string) ?? null,
            howToUse: (src.howToUse as string) ?? null,
            whereToFind: (src.whereToFind as string) ?? null,
            extractionGuide: (src.extractionGuide as string) ?? null,
          },
          update: {
            sourceType: (src.sourceType as string) ?? 'modern',
            priority: (src.priority as string) ?? 'supporting',
            relevance: (src.relevance as string) ?? null,
            howToUse: (src.howToUse as string) ?? null,
            whereToFind: (src.whereToFind as string) ?? null,
            extractionGuide: (src.extractionGuide as string) ?? null,
          },
        })
        break
      }

      case 'remove_source': {
        if (!cmd.sourceMappingDbId) break
        // Get bibliography id before deleting the mapping
        const mapping = await tx.sourceMapping.findUnique({
          where: { id: cmd.sourceMappingDbId as string },
          select: { bibliographyId: true },
        })
        await tx.sourceMapping.delete({ where: { id: cmd.sourceMappingDbId as string } })

        // If no other mappings reference this bibliography, delete it too
        if (mapping) {
          const remaining = await tx.sourceMapping.count({
            where: { bibliographyId: mapping.bibliographyId },
          })
          if (remaining === 0) {
            await tx.bibliography.delete({ where: { id: mapping.bibliographyId } })
          }
        }
        break
      }

      case 'update_project': {
        const fields = cmd.fields as Record<string, unknown> | undefined
        if (!fields) break
        await tx.project.update({
          where: { id: projectId },
          data: {
            ...(fields.topic !== undefined && { topic: fields.topic as string }),
            ...(fields.purpose !== undefined && { purpose: fields.purpose as string }),
            ...(fields.audience !== undefined && { audience: fields.audience as string }),
          },
        })
        break
      }
    }
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/roadmap/chat
// SSE streaming endpoint for AI chat about roadmap
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true, title: true, topic: true, purpose: true, audience: true, language: true },
    })

    if (!project) {
      return new Response(JSON.stringify({ error: 'Project not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const body = await req.json()
    const messages = (body.messages ?? []) as ChatMessage[]
    const sessionId = (body.sessionId ?? '') as string
    const userContent = messages.length > 0 ? messages[messages.length - 1].content : ''

    // Fetch current roadmap structure with source data
    const chapters = await prisma.chapter.findMany({
      where: { projectId },
      orderBy: { sortOrder: 'asc' },
      include: {
        sections: {
          orderBy: { sortOrder: 'asc' },
          include: {
            subsections: {
              orderBy: { sortOrder: 'asc' },
              select: {
                id: true,
                subsectionId: true,
                title: true,
                sourceMappings: {
                  select: {
                    id: true,
                    sourceType: true,
                    priority: true,
                    relevance: true,
                    howToUse: true,
                    whereToFind: true,
                    extractionGuide: true,
                    bibliography: {
                      select: { authorSurname: true, authorName: true, title: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    })

    // Fetch user's library entries for AI context (max 200)
    const libraryEntries = await prisma.libraryEntry.findMany({
      where: { userId: session.user.id },
      select: {
        authorSurname: true,
        authorName: true,
        title: true,
        year: true,
        entryType: true,
      },
      take: 200,
      orderBy: { updatedAt: 'desc' },
    })

    const compactRoadmap = buildCompactRoadmap(chapters)
    const systemPrompt = buildSystemPrompt(compactRoadmap, project, libraryEntries)

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let fullResponse = ''
        try {
          for await (const chunk of streamChat(messages, systemPrompt)) {
            fullResponse += chunk
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`)
            )
          }

          // Parse and apply commands
          const commands = parseCommands(fullResponse)
          let commandsApplied = false

          if (commands.length > 0) {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ step: "applying" })}\n\n`)
            )
            try {
              await prisma.$transaction(async (tx) => {
                await applyCommands(tx, projectId, commands, session.user.id)
              })
              commandsApplied = true
            } catch (cmdErr) {
              console.error('[roadmap/chat] Failed to apply commands:', cmdErr)
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ chunk: '\n\n[Komutlar uygulanirken hata olustu. Lutfen tekrar deneyin.]' })}\n\n`
                )
              )
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ step: "applied" })}\n\n`)
            )
          }

          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ done: true, commandsApplied, commandCount: commands.length })}\n\n`
            )
          )

          // Persist chat messages to DB
          const strippedContent = fullResponse
            .replace(/<roadmap_commands>[\s\S]*?<\/roadmap_commands>/g, '')
            .trim()
          try {
            await prisma.roadmapChatMessage.createMany({
              data: [
                {
                  projectId,
                  sessionId,
                  role: 'user',
                  content: userContent,
                },
                {
                  projectId,
                  sessionId,
                  role: 'assistant',
                  content: strippedContent,
                  commands: commands.length > 0 ? (commands as unknown as Prisma.InputJsonValue) : undefined,
                  commandsApplied,
                },
              ],
            })
          } catch (saveErr) {
            console.error('[roadmap/chat] Failed to save chat messages:', saveErr)
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (streamErr) {
          console.error('[roadmap/chat] Stream error:', streamErr)
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ error: 'Stream failed' })}\n\n`
            )
          )
        } finally {
          controller.close()
        }
      },
    })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    console.error('[POST /api/projects/[id]/roadmap/chat]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
