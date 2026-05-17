/**
 * Library RAG chat. Embeds the user's question, finds the top-k most
 * similar chunks across their library (or just the picked entries),
 * streams a Claude answer that cites those chunks via [n] markers,
 * and persists both the user prompt and the assistant response.
 *
 *   POST /api/library/chat
 *     { sessionId, message, scope: 'all'|'picked'|'single', entryIds? }
 *   →  SSE: data: {"delta":"…"}\n\n
 *           data: {"done":true, sources:[{entryId, title, page, marker}]}\n\n
 *           data: [DONE]
 */
import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { compressHistory } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL ?? 'http://localhost:8000'
// Split the retrieval budget between PDF chunks (raw source text) and
// user-authored notes (curated, often higher-signal commentary). 8 + 4
// stays under the same token budget as the previous 8-chunk-only setup
// while letting notes carry weight.
const TOP_K_CHUNKS = 8
const TOP_K_NOTES = 4
const MAX_HISTORY_MESSAGES = 12

type Scope = 'all' | 'picked' | 'single'

interface RetrievedChunk {
  kind: 'chunk' | 'note'
  entryId: string
  title: string
  authorSurname: string | null
  pageNumber: number | null
  content: string
  noteTitle: string | null
}

async function embedQueryText(text: string): Promise<number[] | null> {
  try {
    const res = await fetch(`${PYTHON_SERVICE_URL}/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texts: [text] }),
    })
    if (!res.ok) return null
    const data = (await res.json()) as { embeddings: number[][] }
    return data.embeddings?.[0] ?? null
  } catch {
    return null
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await requireAuth()
    const body = (await req.json().catch(() => ({}))) as {
      sessionId?: string
      message?: string
      scope?: Scope
      entryIds?: string[]
      collectionIds?: string[]
      tagIds?: string[]
    }
    const sessionId = (body.sessionId ?? '').trim()
    const message = (body.message ?? '').trim()
    const scope: Scope = body.scope === 'picked' || body.scope === 'single' ? body.scope : 'all'
    let entryIds = (body.entryIds ?? []).filter((id) => typeof id === 'string')
    const collectionIds = (body.collectionIds ?? []).filter((id) => typeof id === 'string')
    const tagIds = (body.tagIds ?? []).filter((id) => typeof id === 'string')

    if (!sessionId || !message) {
      return new Response(JSON.stringify({ error: 'sessionId and message are required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    if (scope !== 'all' && entryIds.length === 0 && collectionIds.length === 0 && tagIds.length === 0) {
      return new Response(
        JSON.stringify({ error: 'Picked / single scope requires at least one entryId, collectionId or tagId' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Resolve folder + tag scopes into the explicit entry id list that
    // the SQL retrieval queries can plug into ANY($1::text[]). We union
    // with any explicit entryIds the caller already passed.
    if (scope !== 'all' && (collectionIds.length > 0 || tagIds.length > 0)) {
      const filters: Record<string, unknown>[] = []
      if (collectionIds.length > 0) {
        filters.push({ collections: { some: { collectionId: { in: collectionIds } } } })
      }
      if (tagIds.length > 0) {
        filters.push({ tags: { some: { tagId: { in: tagIds } } } })
      }
      const resolved = await prisma.libraryEntry.findMany({
        where: {
          userId: session.user.id,
          OR: filters,
        },
        select: { id: true },
      })
      const merged = new Set<string>([...entryIds, ...resolved.map((e) => e.id)])
      entryIds = [...merged]
      if (entryIds.length === 0) {
        // No matching entries — bail with an empty assistant response
        // rather than running an unscoped query against the whole lib.
        return new Response(
          JSON.stringify({
            error:
              'Seçili klasör/etikette uygun kaynak bulunamadı.',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    // Credits gate.
    const credits = await checkCredits(session.user.id, 'library_chat')
    if (!credits.allowed) {
      return new Response(
        JSON.stringify({
          error: 'Insufficient credits',
          balance: credits.balance,
          cost: credits.estimatedCost,
        }),
        { status: 402, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // Load existing thread, oldest → newest, and compress to keep
    // prompt size sane.
    const priorMessages = await prisma.libraryChatMessage.findMany({
      where: { userId: session.user.id, sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
      take: 200,
    })
    const compressed = await compressHistory(
      priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { chatType: 'general', keepRecent: MAX_HISTORY_MESSAGES },
    )

    // Embed the user's question once and run two ordered retrievals:
    // top-K PDF chunks and top-K user notes. We keep them as separate
    // queries (instead of one big UNION) so each side can use its own
    // ORDER BY ... <-> $1 index pass cleanly; the JS layer merges and
    // tags rows with kind="chunk" | "note" for the prompt.
    const queryVec = await embedQueryText(message)
    let retrievedChunks: RetrievedChunk[] = []
    let retrievedNotes: RetrievedChunk[] = []
    if (queryVec) {
      const vecLiteral = JSON.stringify(queryVec)
      retrievedChunks =
        scope === 'all'
          ? await prisma.$queryRaw<RetrievedChunk[]>`
              SELECT 'chunk' AS kind,
                     le.id AS "entryId",
                     le.title AS title,
                     le."authorSurname" AS "authorSurname",
                     lc."pageNumber" AS "pageNumber",
                     lc.content AS content,
                     NULL AS "noteTitle"
              FROM "LibraryChunk" lc
              JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
              WHERE le."userId" = ${session.user.id}
                AND lc.embedding IS NOT NULL
              ORDER BY lc.embedding <-> ${vecLiteral}::vector
              LIMIT ${TOP_K_CHUNKS}
            `
          : await prisma.$queryRaw<RetrievedChunk[]>`
              SELECT 'chunk' AS kind,
                     le.id AS "entryId",
                     le.title AS title,
                     le."authorSurname" AS "authorSurname",
                     lc."pageNumber" AS "pageNumber",
                     lc.content AS content,
                     NULL AS "noteTitle"
              FROM "LibraryChunk" lc
              JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
              WHERE le."userId" = ${session.user.id}
                AND le.id = ANY(${entryIds}::text[])
                AND lc.embedding IS NOT NULL
              ORDER BY lc.embedding <-> ${vecLiteral}::vector
              LIMIT ${TOP_K_CHUNKS}
            `
      retrievedNotes =
        scope === 'all'
          ? await prisma.$queryRaw<RetrievedChunk[]>`
              SELECT 'note' AS kind,
                     le.id AS "entryId",
                     le.title AS title,
                     le."authorSurname" AS "authorSurname",
                     ln."pageNumber" AS "pageNumber",
                     ln."contentText" AS content,
                     ln.title AS "noteTitle"
              FROM "LibraryNote" ln
              JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
              WHERE ln."userId" = ${session.user.id}
                AND ln.embedding IS NOT NULL
              ORDER BY ln.embedding <-> ${vecLiteral}::vector
              LIMIT ${TOP_K_NOTES}
            `
          : await prisma.$queryRaw<RetrievedChunk[]>`
              SELECT 'note' AS kind,
                     le.id AS "entryId",
                     le.title AS title,
                     le."authorSurname" AS "authorSurname",
                     ln."pageNumber" AS "pageNumber",
                     ln."contentText" AS content,
                     ln.title AS "noteTitle"
              FROM "LibraryNote" ln
              JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
              WHERE ln."userId" = ${session.user.id}
                AND le.id = ANY(${entryIds}::text[])
                AND ln.embedding IS NOT NULL
              ORDER BY ln.embedding <-> ${vecLiteral}::vector
              LIMIT ${TOP_K_NOTES}
            `
    }
    // Interleave: notes first (curated, usually more relevant) then
    // chunks. The prompt block stays in the merged order so [1]..[N]
    // numbering matches what we send to the model.
    const retrieved: RetrievedChunk[] = [...retrievedNotes, ...retrievedChunks]

    // Build prompt — number each excerpt so the model can cite [1], [2]…
    // Notes are marked with NOT: tag so the model can introduce them
    // differently ("kendi notunda şunu yazmıştın..." vs "kitapta...").
    const excerptBlock =
      retrieved.length === 0
        ? '(Bu konuda kütüphanede embedded içerik bulunamadı.)'
        : retrieved
            .map((c, i) => {
              const author = c.authorSurname ? `${c.authorSurname}, ` : ''
              const page = c.pageNumber !== null ? ` (s. ${c.pageNumber})` : ''
              if (c.kind === 'note') {
                const noteLabel = c.noteTitle ? ` — "${c.noteTitle}"` : ''
                return `[${i + 1}] NOT (${author}${c.title}${noteLabel}${page})\n${c.content}`
              }
              return `[${i + 1}] ${author}${c.title}${page}\n${c.content}`
            })
            .join('\n\n')

    const systemPrompt =
      'Sen kullanıcının PDF kütüphanesi üzerinde çalışan bir araştırma asistanısın. Aşağıdaki excerpt\'lerden yararlanarak Türkçe yanıtla. ' +
      'Her bilgi parçasını [1], [2] gibi numaralı atıflarla işaretle (kaynak listesi cevabın altında değil, cümle içinde olsun). ' +
      'Excerpt\'lerde olmayan bir iddiada bulunma; bilgi yetersizse "Verilen kaynaklarda bunu doğrulayan bir bilgi yok." de. ' +
      'Yeni atıf uydurma; sadece sana verilen [n] numaralarını kullan.\n\n' +
      `KAYNAK EXCERPTS:\n${excerptBlock}`

    const messagesForLlm = [
      ...compressed.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ]

    // Persist the user message before streaming so a mid-stream crash
    // doesn't lose the prompt.
    await prisma.libraryChatMessage.create({
      data: {
        userId: session.user.id,
        sessionId,
        role: 'user',
        content: message,
        scope,
        entryIds,
      },
    })

    // Bump the rewrite endpoint pattern to also stream here. The final
    // 'done' event carries the citation list so the UI can render
    // chips beneath the assistant message.
    const encoder = new TextEncoder()
    const sources = retrieved.map((c, i) => ({
      marker: i + 1,
      kind: c.kind,
      entryId: c.entryId,
      title: c.title,
      authorSurname: c.authorSurname,
      page: c.pageNumber,
      noteTitle: c.noteTitle,
      // First ~280 chars of the cited chunk/note so the PDF panel can
      // surface a "AI bu metni gösterdi" preview when the user opens
      // the source. Keeps the payload light; full content is in DB.
      text: (c.content ?? '').slice(0, 280),
    }))

    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (payload: string) => {
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            return false
          }
        }
        let fullText = ''
        try {
          const result = await streamChatWithUsage(
            messagesForLlm,
            systemPrompt,
            (chunk) => {
              fullText += chunk
              safeEnqueue(`data: ${JSON.stringify({ delta: chunk })}\n\n`)
            },
          )

          fullText = result.fullText.trim() || fullText

          await prisma.libraryChatMessage.create({
            data: {
              userId: session.user.id,
              sessionId,
              role: 'assistant',
              content: fullText,
              sources: sources as object,
            },
          })

          await deductCredits(
            session.user.id,
            'library_chat',
            result.inputTokens,
            result.outputTokens,
            'sonnet',
            {
              scope,
              entryCount: entryIds.length,
              retrievedChunks: retrieved.length,
            },
            { read: result.cacheReadTokens, creation: result.cacheCreationTokens },
          )

          safeEnqueue(`data: ${JSON.stringify({ done: true, sources })}\n\n`)
          safeEnqueue('data: [DONE]\n\n')
        } catch (err) {
          console.error('[library/chat]', err)
          safeEnqueue(
            `data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'chat failed' })}\n\n`,
          )
        } finally {
          try {
            controller.close()
          } catch {
            // already closed
          }
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
    console.error('[POST library/chat]', err)
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
