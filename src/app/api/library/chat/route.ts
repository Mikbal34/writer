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
import { AuthError, resolveUserIdForEval } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { rerankChunks } from '@/lib/rerank'
import { embedQuery } from '@/lib/library-pipeline'
import { isGenericBookQuery } from '@/lib/book-summary'
import { ftsChunks, ftsNotes, rrfMerge, rrfMergeMany } from '@/lib/hybrid-retrieval'
import { rewriteQuery } from '@/lib/query-rewrite'
import { expandQuery } from '@/lib/query-expansion'
import { splitComparativeQuery } from '@/lib/comparative-split'
import { generateHyde } from '@/lib/hyde'
import { SYNTHESIS_PROMPT_BLOCK, shouldActivateSynthesis } from '@/lib/synthesis-mode'
import { compressHistory } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Split the retrieval budget between PDF chunks (raw source text) and
// user-authored notes (curated, often higher-signal commentary). 8 + 4
// stays under the same token budget as the previous 8-chunk-only setup
// while letting notes carry weight.
// Bumped from 8 → 15 because user reports of "kaynaklarda bulunamadı"
// in library-wide mode traced back to relevant chunks sitting just
// past the top-8 cutoff when 50+ books compete in the same ranking.
// Notes stay narrower since they're already user-curated.
// Two-stage retrieval: pgvector returns RETRIEVAL_POOL chunks (cast
// a wide net, recall-oriented), then a Haiku reranker drops the
// list to TOP_K_CHUNKS that actually answer the question. Same
// pattern for notes, smaller pool since they're already user-
// curated. Hard-disabling rerank (RERANK_ENABLED=false) collapses
// the pipeline back to vector-only as a safety hatch.
// Pool 60 sweet spot — 100'e çıkarmak RRF skorlarını dilüte etti, top-K
// kalitesi bozuldu. MMR diversity cap (entry-cap=2) ile 60 chunk yeter.
const RETRIEVAL_POOL_CHUNKS = 60
const RETRIEVAL_POOL_NOTES = 15
// 8 → 6: Sonnet'a daha az excerpt → input token %25 ↓ → prod chat call maliyeti
// belirgin düşer. Eval gösterdi top-8'in son 2 chunk'ı genelde marjinal.
const TOP_K_CHUNKS = 6
const TOP_K_NOTES = 3
// MMR-lite (entry-level diversity cap): top-K seçiminde aynı kitap'tan
// en fazla N chunk al. Tematik sorularda tek kitabın 3-4 chunk'ı top-K'yı
// kaplamasını engeller, beklenen 5+ kaynaktan daha çok temsil garanti edilir.
// 0 = cap kapalı (mevcut davranış), 2 = her kitaptan max 2 chunk.
const ENTRY_CAP_PER_TOPK = parseInt(process.env.ENTRY_CAP_PER_TOPK ?? '2', 10)
const MAX_HISTORY_MESSAGES = 12

type Scope = 'all' | 'picked' | 'single'

interface RetrievedChunk {
  /** Stable id of the underlying LibraryChunk / LibraryNote row.
   *  Needed by the reranker to re-map score → original record. */
  id: string
  kind: 'chunk' | 'note'
  entryId: string
  // Multi-volume entries: identifies which volume the chunk/note came
  // from so the chat UI can open the correct PDF in the sources panel.
  // NULL for legacy single-volume entries that pre-date the volume model.
  volumeId: string | null
  title: string
  authorSurname: string | null
  pageNumber: number | null
  /** Printed page label (e.g. "49") when the PDF has /PageLabels.
   *  NULL for older chunks pre-pageLabel pipeline or PDFs without
   *  labels. UI prefers this over pageNumber for citation display. */
  pdfPageLabel: string | null
  /** Closest preceding section heading on the page. NULL for notes
   *  and pre-pipeline chunks. Used by the reranker prompt and the
   *  chip breadcrumb. */
  sectionTitle: string | null
  content: string
  noteTitle: string | null
}


/**
 * MMR-lite diversity cap: sıralı listeden top-K seç, ama aynı entry'den
 * en fazla `capPerEntry` chunk. Tematik sorularda tek kitabın top-K'yı
 * kaplamasını engeller — 5+ farklı kaynak bekleyen sorularda recall ↑.
 *
 * Algoritma: skoruna göre sıralı listede gez, cap'i aşmayanları al, cap'i
 * aşanları "yedek" listeye koy. Top-K dolmazsa yedeklerle tamamla.
 */
function applyDiversityCap<T extends { entryId: string }>(
  sortedItems: T[],
  topK: number,
  capPerEntry: number,
): T[] {
  const selected: T[] = []
  const overflow: T[] = []
  const perEntryCount = new Map<string, number>()
  for (const item of sortedItems) {
    if (selected.length >= topK) break
    const count = perEntryCount.get(item.entryId) ?? 0
    if (count < capPerEntry) {
      selected.push(item)
      perEntryCount.set(item.entryId, count + 1)
    } else {
      overflow.push(item)
    }
  }
  for (const item of overflow) {
    if (selected.length >= topK) break
    selected.push(item)
  }
  return selected
}

export async function POST(req: NextRequest) {
  try {
    const userId = await resolveUserIdForEval(req.headers)
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
          userId: userId,
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

    // Eval-mode: retrieve + rerank yap, sources döndür, Sonnet'i ATLA.
    // Credit check, user msg persist, assistant msg persist YOK — yan etki
    // sıfır. Eval runner için ucuz ölçüm (~%85 maliyet düşer).
    const evalSkipLlm = req.headers.get('x-eval-skip-llm') === '1'

    // Credits gate (eval-mode'da atlanır).
    if (!evalSkipLlm) {
      const credits = await checkCredits(userId, 'library_chat')
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
    }

    // Load existing thread, oldest → newest, and compress to keep
    // prompt size sane.
    const priorMessages = await prisma.libraryChatMessage.findMany({
      where: { userId: userId, sessionId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
      take: 200,
    })
    const compressed = await compressHistory(
      priorMessages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { chatType: 'general', keepRecent: MAX_HISTORY_MESSAGES },
    )

    // Conversation-aware rewrite: turns "peki ya bu fikrin
    // eleştirileri?" into "Modernlik dini önermesinin eleştirileri
    // nedir?" by inlining what "bu" referred to, so retrieval
    // doesn't search cold against a pronoun. Falls back to the raw
    // message when there's no prior history or the Haiku call
    // fails. The original `message` still flows to the answering
    // LLM downstream so the user reads their own words echoed back.
    const retrievalQuery = await rewriteQuery(
      message,
      priorMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    )

    // Multilingual query expansion: a Turkish question about an
    // English/Arabic source often fails to surface the key passage
    // because the wording + language differ from the source. Expand
    // into a few cross-lingual / domain-term variants, retrieve for
    // EACH (hybrid: vector + FTS), and RRF-fuse the union so a hit
    // from any variant reaches the reranker. variants[0] is always
    // the original, so this only adds recall.
    // Variants pipeline:
    //   1) query expansion → her kütüphane diline 1 variant + 1 domain-term
    //   2) comparative split → 0-4 alt-sorgu (sadece "X vs Y" sorularında)
    // Birleşmiş listede her variant için ayrı vector+FTS retrieve çalışır,
    // RRF ile birleştirilir → multilingual kütüphanelerde her dilin
    // chunk'ları kendi dilindeki sorgu vektörü ile match yapar.
    //
    // TODO: libraryLangs şimdilik hardcoded — eval-driven yaklaşım.
    // Olumlu sonuç verirse runtime auto-detection helper'ına geçilecek
    // (lib/library-languages.ts). beratok2312 dağılımı: en(66) tr(56) ar(6).
    const libraryLangs = userId === 'cmn1ulqtk00030purt66j5ow6'
      ? ['en', 'tr', 'ar']
      : undefined
    // HyDE: sorunun hipotetik cevabını üret, onu da variant olarak ekle.
    // Sorgu vektörü "soruya cevap olabilecek metne" yakın olur → chunk match
    // güçlenir (Gao et al. 2022, paper +10-20pp recall).
    // Env flag ile aç/kapa — eval-driven karar için.
    const hydeEnabled = (process.env.HYDE_ENABLED ?? '1') === '1'
    const [variants, subqueries, hyde] = await Promise.all([
      expandQuery(retrievalQuery, libraryLangs),
      splitComparativeQuery(retrievalQuery),
      hydeEnabled ? generateHyde(retrievalQuery) : Promise.resolve(null),
    ])
    // Dedup: subquery zaten variant olarak gelmiş olabilir.
    const allVariantsSet = new Set<string>(variants)
    for (const s of subqueries) allVariantsSet.add(s)
    if (hyde) allVariantsSet.add(hyde)
    const allVariants = [...allVariantsSet]
    const variantVecs = await Promise.all(allVariants.map(embedQuery))

    let retrievedChunks: RetrievedChunk[] = []
    let retrievedNotes: RetrievedChunk[] = []
    // Note: both let-bound because the rerank pass below replaces
    // them with the slim top-K subsets.

    // Per-query hybrid chunk retrieval (vector + FTS, RRF-merged).
    const hybridChunksFor = async (
      qText: string,
      vecLiteral: string,
    ): Promise<RetrievedChunk[]> => {
      const [vec, lex] = await Promise.all([
        scope === 'all'
          ? prisma.$queryRaw<RetrievedChunk[]>`
              SELECT lc.id AS id, 'chunk' AS kind, le.id AS "entryId",
                     lc."volumeId" AS "volumeId", le.title AS title,
                     le."authorSurname" AS "authorSurname", lc."pageNumber" AS "pageNumber",
                     lc."pdfPageLabel" AS "pdfPageLabel", lc."sectionTitle" AS "sectionTitle",
                     lc.content AS content, NULL AS "noteTitle"
              FROM "LibraryChunk" lc
              JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
              WHERE le."userId" = ${userId} AND lc.embedding IS NOT NULL
              ORDER BY lc.embedding <=> ${vecLiteral}::vector
              LIMIT ${RETRIEVAL_POOL_CHUNKS}
            `
          : prisma.$queryRaw<RetrievedChunk[]>`
              SELECT lc.id AS id, 'chunk' AS kind, le.id AS "entryId",
                     lc."volumeId" AS "volumeId", le.title AS title,
                     le."authorSurname" AS "authorSurname", lc."pageNumber" AS "pageNumber",
                     lc."pdfPageLabel" AS "pdfPageLabel", lc."sectionTitle" AS "sectionTitle",
                     lc.content AS content, NULL AS "noteTitle"
              FROM "LibraryChunk" lc
              JOIN "LibraryEntry" le ON lc."libraryEntryId" = le.id
              WHERE le."userId" = ${userId}
                AND le.id = ANY(${entryIds}::text[]) AND lc.embedding IS NOT NULL
              ORDER BY lc.embedding <=> ${vecLiteral}::vector
              LIMIT ${RETRIEVAL_POOL_CHUNKS}
            `,
        ftsChunks(
          userId,
          qText,
          scope === 'all' ? null : entryIds,
          RETRIEVAL_POOL_CHUNKS,
        ).catch((err) => {
          console.warn('[chat] FTS chunks fallback:', err)
          return [] as RetrievedChunk[]
        }),
      ])
      return rrfMerge(vec, lex)
    }

    // BALANCED COMPARATIVE RETRIEVE: "X vs Y" sorularda her sub-query
    // için AYRI havuz + her tarafdan eşit chunk. RRF'nin bir tarafa
    // bias problemini çözer (K kategorisi 0.323'te takılıydı).
    const isComparative = subqueries.length >= 2
    if (isComparative) {
      const perSideTopK = Math.ceil(TOP_K_CHUNKS / subqueries.length)
      const perSidePool: RetrievedChunk[][] = []
      for (const sq of subqueries) {
        const idx = allVariants.indexOf(sq)
        const sqVec = idx >= 0 ? variantVecs[idx] : null
        if (!sqVec) continue
        const sidePool = await hybridChunksFor(sq, JSON.stringify(sqVec))
        // Her tarafdan diversity-cap=1 ile top-K_per_side (her kitap max 1)
        const sideTop = applyDiversityCap(sidePool, perSideTopK, 1)
        perSidePool.push(sideTop)
      }
      // Round-robin merge: her taraftan sırayla 1'er chunk al
      const balancedChunks: RetrievedChunk[] = []
      const seenIds = new Set<string>()
      let added = true
      let pos = 0
      while (added && balancedChunks.length < TOP_K_CHUNKS) {
        added = false
        for (const side of perSidePool) {
          if (pos >= side.length) continue
          const c = side[pos]
          if (seenIds.has(c.id)) continue
          balancedChunks.push(c)
          seenIds.add(c.id)
          added = true
          if (balancedChunks.length >= TOP_K_CHUNKS) break
        }
        pos++
      }
      retrievedChunks = balancedChunks
    } else {
      // Chunks: retrieve per variant, fuse the union (normal akış).
      const chunkPools = await Promise.all(
        allVariants.map((qText, i) => {
          const v = variantVecs[i]
          return v ? hybridChunksFor(qText, JSON.stringify(v)) : Promise.resolve([] as RetrievedChunk[])
        }),
      )
      retrievedChunks = rrfMergeMany(chunkPools).slice(0, RETRIEVAL_POOL_CHUNKS)
    }

    // Notes: user's own annotations, almost always in the user's
    // language and low-volume — expansion adds little, so retrieve
    // once with the primary (rewritten) query vector.
    const primaryVec = variantVecs[0]
    if (primaryVec) {
      const vecLiteral = JSON.stringify(primaryVec)
      const [vecNotes, lexNotes] = await Promise.all([
        scope === 'all'
          ? prisma.$queryRaw<RetrievedChunk[]>`
              SELECT ln.id AS id, 'note' AS kind, le.id AS "entryId",
                     ln."volumeId" AS "volumeId", le.title AS title,
                     le."authorSurname" AS "authorSurname", ln."pageNumber" AS "pageNumber",
                     ln."pdfPageLabel" AS "pdfPageLabel", NULL AS "sectionTitle",
                     ln."contentText" AS content, ln.title AS "noteTitle"
              FROM "LibraryNote" ln
              JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
              WHERE ln."userId" = ${userId} AND ln.embedding IS NOT NULL
              ORDER BY ln.embedding <=> ${vecLiteral}::vector
              LIMIT ${RETRIEVAL_POOL_NOTES}
            `
          : prisma.$queryRaw<RetrievedChunk[]>`
              SELECT ln.id AS id, 'note' AS kind, le.id AS "entryId",
                     ln."volumeId" AS "volumeId", le.title AS title,
                     le."authorSurname" AS "authorSurname", ln."pageNumber" AS "pageNumber",
                     ln."pdfPageLabel" AS "pdfPageLabel", NULL AS "sectionTitle",
                     ln."contentText" AS content, ln.title AS "noteTitle"
              FROM "LibraryNote" ln
              JOIN "LibraryEntry" le ON ln."libraryEntryId" = le.id
              WHERE ln."userId" = ${userId}
                AND le.id = ANY(${entryIds}::text[]) AND ln.embedding IS NOT NULL
              ORDER BY ln.embedding <=> ${vecLiteral}::vector
              LIMIT ${RETRIEVAL_POOL_NOTES}
            `,
        ftsNotes(
          userId,
          retrievalQuery,
          scope === 'all' ? null : entryIds,
          RETRIEVAL_POOL_NOTES,
        ).catch((err) => {
          console.warn('[chat] FTS notes fallback:', err)
          return [] as RetrievedChunk[]
        }),
      ])
      retrievedNotes = rrfMerge(vecNotes, lexNotes).slice(0, RETRIEVAL_POOL_NOTES)
    }

    // Two-stage retrieval — rerank the wide pool down to the final
    // top-K. Haiku judges each candidate vs the original question
    // and returns a 0-10 relevance score; we then keep the highest-
    // scoring TOP_K_CHUNKS / TOP_K_NOTES. Falls back to vector
    // order on Haiku failure.
    if (retrievedChunks.length > TOP_K_CHUNKS) {
      const ranked = await rerankChunks(
        retrievalQuery,
        retrievedChunks.map((c) => ({
          id: c.id,
          content: c.content,
          title: c.title,
          sectionTitle: c.sectionTitle,
          pageLabel: c.pdfPageLabel,
        })),
      )
      const order = new Map(ranked.map((r, i) => [r.id, i]))
      const sortedByScore = retrievedChunks
        .slice()
        .sort(
          (a, b) =>
            (order.get(a.id) ?? Number.POSITIVE_INFINITY) -
            (order.get(b.id) ?? Number.POSITIVE_INFINITY),
        )
      retrievedChunks = ENTRY_CAP_PER_TOPK > 0
        ? applyDiversityCap(sortedByScore, TOP_K_CHUNKS, ENTRY_CAP_PER_TOPK)
        : sortedByScore.slice(0, TOP_K_CHUNKS)
    }
    if (retrievedNotes.length > TOP_K_NOTES) {
      const ranked = await rerankChunks(
        retrievalQuery,
        retrievedNotes.map((c) => ({
          id: c.id,
          content: c.content,
          title: c.title,
          sectionTitle: c.sectionTitle,
          pageLabel: c.pdfPageLabel,
        })),
      )
      const order = new Map(ranked.map((r, i) => [r.id, i]))
      retrievedNotes = retrievedNotes
        .slice()
        .sort(
          (a, b) =>
            (order.get(a.id) ?? Number.POSITIVE_INFINITY) -
            (order.get(b.id) ?? Number.POSITIVE_INFINITY),
        )
        .slice(0, TOP_K_NOTES)
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
              // Prefer the printed page label (the "49" stamped on
              // the page) over the PDF index — the LLM should cite
              // pages the way the book itself numbers them, not by
              // raw PDF offset.
              const pageDisplay = c.pdfPageLabel ?? c.pageNumber
              const page =
                pageDisplay !== null && pageDisplay !== undefined
                  ? ` (s. ${pageDisplay})`
                  : ''
              if (c.kind === 'note') {
                const noteLabel = c.noteTitle ? ` — "${c.noteTitle}"` : ''
                return `[${i + 1}] NOT (${author}${c.title}${noteLabel}${page})\n${c.content}`
              }
              return `[${i + 1}] ${author}${c.title}${page}\n${c.content}`
            })
            .join('\n\n')

    // Single-entry summary block: when the user is scoped to one
    // book AND asked a generic "what's it about" question, inject
    // the precomputed book summary into the system prompt so the
    // LLM can answer the spirit of the question even when vector
    // retrieval surfaces narrow passages. RAG excerpts still go in
    // beneath for specific factual followups.
    let bookSummaryBlock = ''
    if (
      scope !== 'all' &&
      entryIds.length === 1 &&
      isGenericBookQuery(message)
    ) {
      const summaryEntry = await prisma.libraryEntry.findFirst({
        where: { id: entryIds[0], userId: userId },
        select: { title: true, summary: true },
      })
      if (summaryEntry?.summary) {
        bookSummaryBlock =
          `\n\nKİTAP ÖZETİ (${summaryEntry.title}):\n${summaryEntry.summary}\n` +
          '↑ Yukarıdaki özet bu kitabın bütünsel tezini ve yaklaşımını\n' +
          'aktarır; "ne anlatıyor / ana fikir" tipi genel sorularda\n' +
          'önce buradan yararlan, ardından excerpt\'lerden somut atıflar ekle.'
      }
    }

    // Synthesis mode: when the user is asking a comparative
    // question AND retrieval pulled chunks from ≥ 2 distinct
    // entries, append a prompt block that reshapes the answer as
    // "position map + synthesis". One-source comparison falls back
    // to normal mode — nothing to compare against.
    const distinctEntryIds = new Set(
      [...retrievedChunks, ...retrievedNotes].map((c) => c.entryId),
    )
    const synthesisActive = shouldActivateSynthesis(message, distinctEntryIds)
    const synthesisBlock = synthesisActive ? `\n\n${SYNTHESIS_PROMPT_BLOCK}\n` : ''

    const systemPrompt =
      'You are a research assistant working over the user\'s PDF library.\n' +
      'LANGUAGE (critical): Reply in the SAME language as the USER\'S QUESTION ' +
      '(Turkish question → Turkish answer, English → English, Arabic → Arabic). ' +
      'The source excerpts may be in ANY language and are often in a different ' +
      'language than the question — this does NOT change your answer language. ' +
      'Read evidence in whatever language it is in, then write the answer in the ' +
      'user\'s question language, academic register, preserving its diacritics/script. ' +
      'Translate quoted phrases into the answer language (keep proper names/terms).\n\n' +
      'RULES:\n' +
      '1) MANDATORY CITATIONS: every sentence that draws on a source must end with its ' +
      '[n] marker. No uncited factual sentence. Combine like [1][3] when multiple sources ' +
      'support it. Cite inline, not as a trailing list.\n' +
      '2) Do NOT claim anything not in the excerpts. Do not stretch or over-interpret ' +
      'them; never present a concept absent from a passage as if it were there.\n' +
      '3) Evaluate the excerpts FIRST: do they directly answer the question? If the ' +
      'sources do NOT answer it, or relate only indirectly, say so honestly IN THE ' +
      'USER\'S LANGUAGE — e.g. "The provided sources do not directly answer this; the ' +
      'closest related material covers [short accurate summary][n]; try a narrower ' +
      'question like \'concept Y in book X\'." Treat this as academic honesty, not failure.\n' +
      '4) Never invent citation numbers; use only the [n] markers given to you.\n' +
      '5) Academic register in the user\'s language.\n\n' +
      `KAYNAK EXCERPTS:\n${excerptBlock}` +
      bookSummaryBlock +
      synthesisBlock

    const messagesForLlm = [
      ...compressed.messages.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: message },
    ]

    // Persist the user message before streaming so a mid-stream crash
    // doesn't lose the prompt. Eval-mode: hiç yazma (yan etki sıfır).
    if (!evalSkipLlm) {
      await prisma.libraryChatMessage.create({
        data: {
          userId: userId,
          sessionId,
          role: 'user',
          content: message,
          scope,
          entryIds,
        },
      })
    }

    // Bump the rewrite endpoint pattern to also stream here. The final
    // 'done' event carries the citation list so the UI can render
    // chips beneath the assistant message.
    const encoder = new TextEncoder()
    const sources = retrieved.map((c, i) => ({
      marker: i + 1,
      kind: c.kind,
      entryId: c.entryId,
      volumeId: c.volumeId,
      title: c.title,
      authorSurname: c.authorSurname,
      // page is the PDF index — used to jump the viewer to the right
      // place. pageLabel is the printed book page, used for display
      // in chips, citation chips, and downstream rendering.
      page: c.pageNumber,
      pageLabel: c.pdfPageLabel,
      // Chapter/section heading the chunk lives under; surfaced
      // as a breadcrumb on the chip so the reader sees "Bölüm 3"
      // alongside the book title.
      sectionTitle: c.sectionTitle,
      noteTitle: c.noteTitle,
      // First ~280 chars of the cited chunk/note so the PDF panel can
      // surface a "AI bu metni gösterdi" preview when the user opens
      // the source. Keeps the payload light; full content is in DB.
      text: (c.content ?? '').slice(0, 280),
    }))

    // Eval-mode early return: Sonnet'a hiç gitme, sadece sources dön.
    if (evalSkipLlm) {
      return new Response(JSON.stringify({ done: true, sources }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

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
          // Prompt caching: system prompt'u "cache: true" parts olarak
          // gönder. Anthropic 5 dakika cache TTL ile sonraki çağrıları
          // %90 input cost düşürür. Aynı session içinde art arda chat'lerde
          // büyük tasarruf — Sonnet maliyetini ~%50 azaltır.
          const result = await streamChatWithUsage(
            messagesForLlm,
            [{ text: systemPrompt, cache: true }],
            (chunk) => {
              fullText += chunk
              safeEnqueue(`data: ${JSON.stringify({ delta: chunk })}\n\n`)
            },
          )

          fullText = result.fullText.trim() || fullText

          await prisma.libraryChatMessage.create({
            data: {
              userId: userId,
              sessionId,
              role: 'assistant',
              content: fullText,
              sources: sources as object,
            },
          })

          await deductCredits(
            userId,
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
