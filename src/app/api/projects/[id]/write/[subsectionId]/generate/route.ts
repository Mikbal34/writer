import { NextRequest, NextResponse } from 'next/server'
import { AuthError, resolveUserIdForEval } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { buildSessionContext } from '@/lib/prompts/session-context'
import { getWritingPrompt } from '@/lib/prompts/writing'
import { startJob, completeJob, failJob } from '@/lib/jobs'
import { embedQuery } from '@/lib/library-pipeline'
import { retrieveLibraryChunks } from '@/lib/library-retrieval'
import { validateCitations } from '@/lib/citation-validator'
import { reviewSubsection } from '@/lib/writing-reviewer'
import { buildEvidenceGraph, formatEvidenceForPrompt } from '@/lib/evidence-graph'
import {
  buildSynthesisPlan,
  formatPlanForPrompt,
  plannerBackendForGoal,
  type SynthesisMode,
  type SectionGoal,
} from '@/lib/synthesis-planner'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

// ---------------------------------------------------------------------------
// RAG: fetch relevant chunks for the subsection
// ---------------------------------------------------------------------------
interface RagChunk {
  content: string
  pageNumber: number | null
  /** Printed page label from the book (e.g. "49" when pageNumber is
   *  64 because of front matter). Citation rendering prefers this so
   *  the LLM's footnotes match what the reader sees on the printed
   *  page. NULL for SourceChunk rows (Source pipeline doesn't track
   *  labels yet) or library chunks created before the pageLabel
   *  pipeline / lacking /PageLabels in the source PDF. */
  pdfPageLabel: string | null
  sourceTitle: string
}

const TOP_PROJECT_CHUNKS = 4
const TOP_LIBRARY_CHUNKS = 8

async function fetchRagChunks(
  projectId: string,
  subsectionId: string,
  userId: string,
  subsection: { title: string; description: string | null; keyPoints: string[] }
): Promise<RagChunk[]> {
  const queryText = [subsection.title, subsection.description, ...(subsection.keyPoints ?? [])]
    .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
    .join(' — ')
    .trim()

  if (queryText.length === 0) return []

  // Subsection-scoped: only look inside bibliographies the AI explicitly
  // mapped to THIS subsection during roadmap planning. Falls back to
  // project-wide search when the subsection has no mappings yet.
  const mappedBibs = await prisma.sourceMapping.findMany({
    where: { subsectionId },
    select: { bibliography: { select: { id: true, sourceId: true, libraryEntryId: true } } },
  })
  const bibIds = mappedBibs.map((m) => m.bibliography.id)
  const mappedSourceIds = mappedBibs
    .map((m) => m.bibliography.sourceId)
    .filter((id): id is string => !!id)
  const mappedLibraryEntryIds = mappedBibs
    .map((m) => m.bibliography.libraryEntryId)
    .filter((id): id is string => !!id)

  const hasSubsectionScope = bibIds.length > 0

  // Ideal path: embed the subsection query, then semantic-search both tables.
  const queryVector = await embedQuery(queryText)

  if (queryVector) {
    const vecLiteral = JSON.stringify(queryVector)

    // Project sources (proje-specific PDF chunks). Narrow to sources mapped
    // to this subsection when we have mappings; else fall back to project
    // scope so a subsection with no mappings still has something to cite.
    // SourceChunk doesn't track pdfPageLabel yet (Source pipeline is
    // separate from the library), so we synthesize a NULL column to
    // keep the row shape aligned with libraryChunks downstream.
    const projectChunks = hasSubsectionScope && mappedSourceIds.length > 0
      ? await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; pdfPageLabel: string | null; sourceTitle: string }>>`
          SELECT sc.content,
                 sc."pageNumber",
                 NULL::text AS "pdfPageLabel",
                 COALESCE(b.title, s.filename) as "sourceTitle"
          FROM "SourceChunk" sc
          JOIN "Source" s ON sc."sourceId" = s.id
          LEFT JOIN "Bibliography" b ON sc."bibliographyId" = b.id
          WHERE s.id = ANY(${mappedSourceIds}::text[])
            AND sc.embedding IS NOT NULL
          ORDER BY sc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_PROJECT_CHUNKS}
        `.catch(() => [])
      : hasSubsectionScope
      ? [] // subsection has mappings but none of them have uploaded Source files
      : await prisma.$queryRaw<Array<{ content: string; pageNumber: number | null; pdfPageLabel: string | null; sourceTitle: string }>>`
          SELECT sc.content,
                 sc."pageNumber",
                 NULL::text AS "pdfPageLabel",
                 COALESCE(b.title, s.filename) as "sourceTitle"
          FROM "SourceChunk" sc
          JOIN "Source" s ON sc."sourceId" = s.id
          LEFT JOIN "Bibliography" b ON sc."bibliographyId" = b.id
          WHERE s."projectId" = ${projectId}
            AND sc.embedding IS NOT NULL
          ORDER BY sc.embedding <-> ${vecLiteral}::vector
          LIMIT ${TOP_PROJECT_CHUNKS}
        `.catch(() => [])

    // Library chunks — chat seviyesinde retrieval (multilingual expansion,
    // MMR diversity cap=1, hybrid vector+FTS, RRF). Yazıda 5+ kaynak bekleyen
    // subsection'larda tek kitap dominate edemesin.
    let libraryEntryIdsScope: string[] = []
    if (hasSubsectionScope && mappedLibraryEntryIds.length > 0) {
      libraryEntryIdsScope = mappedLibraryEntryIds
    } else if (!hasSubsectionScope) {
      // Proje-genel: proje bibliography'lerinde library entry'ler
      const projectBibs = await prisma.bibliography.findMany({
        where: { projectId, libraryEntryId: { not: null } },
        select: { libraryEntryId: true },
      })
      libraryEntryIdsScope = projectBibs
        .map((b) => b.libraryEntryId)
        .filter((id): id is string => !!id)
    }

    let libraryChunks: Array<{
      content: string
      pageNumber: number | null
      pdfPageLabel: string | null
      sourceTitle: string
    }> = []

    if (libraryEntryIdsScope.length > 0) {
      const result = await retrieveLibraryChunks({
        userId,
        query: queryText,
        scope: 'picked',
        entryIds: libraryEntryIdsScope,
        topK: TOP_LIBRARY_CHUNKS,
        diversityCap: 1,
        pool: 60,
      }).catch(() => ({ chunks: [], variants: [] }))
      libraryChunks = result.chunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        pdfPageLabel: c.pdfPageLabel,
        sourceTitle: c.title,
      }))
    }

    const merged = [...projectChunks, ...libraryChunks]
    if (merged.length > 0) return merged
  }

  // Fallback path: crude keyword search across both tables when the embed
  // call fails (e.g. Python service unreachable).
  const queryTerms = queryText
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3)
    .slice(0, 3)

  if (queryTerms.length === 0) return []

  try {
    const conditions = queryTerms.map((term) => ({
      content: { contains: term, mode: 'insensitive' as const },
    }))

    const sourceFilter = hasSubsectionScope && mappedSourceIds.length > 0
      ? { sourceId: { in: mappedSourceIds }, OR: conditions }
      : hasSubsectionScope
      ? null
      : { source: { projectId }, OR: conditions }

    const libraryFilter = hasSubsectionScope && mappedLibraryEntryIds.length > 0
      ? { libraryEntryId: { in: mappedLibraryEntryIds }, OR: conditions }
      : hasSubsectionScope
      ? null
      : {
          OR: conditions,
          libraryEntry: { bibliographies: { some: { projectId } } },
        }

    const [projectChunks, libraryChunks] = await Promise.all([
      sourceFilter
        ? prisma.sourceChunk.findMany({
            where: sourceFilter,
            include: {
              source: { select: { filename: true } },
              bibliography: { select: { title: true } },
            },
            take: TOP_PROJECT_CHUNKS,
          })
        : Promise.resolve([]),
      libraryFilter
        ? prisma.libraryChunk.findMany({
            where: libraryFilter,
            include: { libraryEntry: { select: { title: true } } },
            take: TOP_LIBRARY_CHUNKS,
          })
        : Promise.resolve([]),
    ])

    return [
      ...projectChunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        // SourceChunk table doesn't carry pdfPageLabel; the fallback
        // ORM path can only return what the schema knows about.
        pdfPageLabel: null,
        sourceTitle: c.bibliography?.title ?? c.source.filename,
      })),
      ...libraryChunks.map((c) => ({
        content: c.content,
        pageNumber: c.pageNumber,
        pdfPageLabel: c.pdfPageLabel,
        sourceTitle: c.libraryEntry.title,
      })),
    ]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// POST /api/projects/[id]/write/[subsectionId]/generate
// Streams AI-generated content via SSE.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    // Eval-mode bypass: X-Eval-Token + X-Eval-User-Id ile auth atlat.
    // Eval mode'da: credit skip + BackgroundJob skip + SSE yerine JSON.
    const isEvalMode =
      !!process.env.EVAL_TOKEN &&
      req.headers.get('x-eval-token') === process.env.EVAL_TOKEN
    const userId = await resolveUserIdForEval(req.headers)
    const { id: projectId, subsectionId } = await ctx.params

    // Optional body: { mode: 'fresh' | 'continue' }. 'continue' tells the
    // LLM to resume from the existing subsection.content rather than
    // start over. Body parsing is best-effort — empty body or invalid
    // JSON → fresh.
    let mode: 'fresh' | 'continue' = 'fresh'
    try {
      const body = (await req.clone().json()) as { mode?: string } | undefined
      if (body?.mode === 'continue') mode = 'continue'
    } catch {
      // ignore — empty body or non-JSON, stay in 'fresh' mode
    }

    // Verify project ownership
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: userId },
      select: { id: true, projectType: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }

    // Verify subsection belongs to project
    const subsection = await prisma.subsection.findFirst({
      where: {
        id: subsectionId,
        section: { chapter: { projectId } },
      },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    // Build writing context
    const writingCtx = await buildSessionContext(subsectionId)
    const { systemPromptParts, userPrompt } = getWritingPrompt(writingCtx)

    // RAG chunks — skip for non-academic projects
    const needsSources = project.projectType === 'ACADEMIC'
    const ragChunks = needsSources ? await fetchRagChunks(projectId, subsectionId, userId, subsection) : []
    const ragBlock =
      ragChunks.length > 0
        ? `\n\nRELEVANT SOURCE EXCERPTS:\n${ragChunks
            .map((c, i) => {
              // Prefer the printed book page label so the LLM's
              // footnote text matches the page a reader would find
              // by flipping through the physical book. Fall back to
              // the PDF index when the source lacks /PageLabels.
              const pageDisplay = c.pdfPageLabel ?? c.pageNumber ?? '?'
              return `[Excerpt ${i + 1}] Source: "${c.sourceTitle}" (p.${pageDisplay})\n${c.content}`
            })
            .join('\n\n')}`
        : ''

    // EVIDENCE GRAPH (Stage 4) — adaptive. Chunks'tan önce Haiku ile
    // claim/evidence yapısı çıkar; Sonnet ham metin yerine yapılandırılmış
    // evidence görür. Eval'da net pattern: tematik (4+ kaynak) sentezde
    // ciddi pozitif, comparative'de A→B yapısını "claim soup"a çevirip
    // negatif. Bu yüzden adaptive rule: en az 4 mapped bibliography AND
    // comparative pattern YOK ise aç. Env flag global kill-switch.
    const evidenceEnvOn = (process.env.EVIDENCE_GRAPH_ENABLED ?? '0') === '1'
    const compareCorpus = [
      subsection.title,
      subsection.description ?? '',
      ...(subsection.keyPoints ?? []),
    ].join(' ').toLowerCase()
    const isComparativeSubsection =
      /\b(vs|versus|difference|compare|contrast|distinguish|differ)\b/i.test(compareCorpus) ||
      /(karşılaştır|kıyas|fark|arasındaki|nasıl ayrı|ayrılık|ayrım)/i.test(compareCorpus)
    const evidenceEnabled =
      evidenceEnvOn && writingCtx.sources.length >= 4 && !isComparativeSubsection
    let evidenceBlock = ''
    if (evidenceEnabled && ragChunks.length > 0 && needsSources) {
      const titleToBibId = new Map<string, string>()
      for (const s of writingCtx.sources) titleToBibId.set(s.title, s.bibliographyId)
      const subsectionObjective = [
        subsection.description,
        ...(subsection.keyPoints ?? []),
      ]
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .join('\n')
      const graph = await buildEvidenceGraph({
        subsectionObjective: `${subsection.title}\n${subsectionObjective}`,
        chunks: ragChunks.map((c) => ({
          bibId: titleToBibId.get(c.sourceTitle) ?? 'unknown',
          sourceTitle: c.sourceTitle,
          page: c.pdfPageLabel ?? (c.pageNumber !== null ? String(c.pageNumber) : null),
          content: c.content,
        })),
      })
      if (graph.claims.length > 0) {
        evidenceBlock = '\n\n' + formatEvidenceForPrompt(graph.claims)
        console.log(
          `[evidence-graph] subsection=${subsectionId} claims=${graph.claims.length}` +
            ` coverage=${(graph.coverageRate * 100).toFixed(0)}%`,
        )
      }
    } else if (evidenceEnvOn) {
      console.log(
        `[evidence-graph] subsection=${subsectionId} SKIPPED sources=${writingCtx.sources.length} comparative=${isComparativeSubsection}`,
      )
    }

    // SYNTHESIS PLANNER — pipeline'ın "düşünme" katmanı. Ham source listesi
    // yerine Writer'a anlaşma/çatışma/sonuç haritası verir, böylece çıktı
    // "Mâtürîdî diyor ki, Rudolph diyor ki" akışından "iki yaklaşım şu
    // noktada örtüşür, şu noktada ayrılır, dolayısıyla..." akışına geçer.
    // synthesisMode roadmap tarafından otomatik atanıyor (SPECIFIC default).
    const synthesisMode: SynthesisMode = subsection.synthesisMode ?? 'SPECIFIC'
    const sectionGoal: SectionGoal = subsection.sectionGoal ?? 'DEFINE'
    const analysisDepth = Math.min(10, Math.max(0, subsection.analysisDepth ?? 3))
    const plannerBackend = plannerBackendForGoal(sectionGoal)
    // Planner artık goal'a göre tetikleniyor (mod değil). DEFINE → OFF;
    // CONTEXT → LIGHT (descriptive sentez); diğerleri → ilgili şema.
    let synthesisBlock = ''
    if (needsSources && ragChunks.length > 0 && plannerBackend !== 'OFF') {
      const titleToBibId = new Map<string, string>()
      for (const s of writingCtx.sources) titleToBibId.set(s.title, s.bibliographyId)
      const subsectionObjective = [
        subsection.description,
        ...(subsection.keyPoints ?? []),
      ]
        .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
        .join('\n')
      const planResult = await buildSynthesisPlan({
        subsectionTitle: subsection.title,
        subsectionObjective,
        mode: synthesisMode,
        goal: sectionGoal,
        chunks: ragChunks.map((c) => ({
          bibId: titleToBibId.get(c.sourceTitle) ?? 'unknown',
          sourceTitle: c.sourceTitle,
          page: c.pdfPageLabel ?? (c.pageNumber !== null ? String(c.pageNumber) : null),
          content: c.content,
        })),
      })
      if (!planResult.failed) {
        synthesisBlock = '\n\n' + formatPlanForPrompt(planResult, analysisDepth)
        console.log(
          `[synthesis-planner] subsection=${subsectionId} mode=${synthesisMode} goal=${sectionGoal} backend=${plannerBackend} depth=${analysisDepth} OK`,
        )
      } else {
        console.warn(
          `[synthesis-planner] subsection=${subsectionId} mode=${synthesisMode} FAILED: ${planResult.reason}`,
        )
      }
    }

    // In continue mode prepend the existing draft so the LLM picks up
    // exactly where it left off without paraphrasing or repeating.
    const existingContent = mode === 'continue' ? subsection.content?.trim() ?? '' : ''
    const continuationBlock =
      mode === 'continue' && existingContent
        ? `\n\nÖNCEDEN YAZILMIŞ KISIM (bu metnin tam devamını yaz; tekrar etme, özetleme — bittiği yerden doğal cümleyle bağla):\n\n${existingContent}`
        : ''
    const fullUserPrompt =
      userPrompt + ragBlock + evidenceBlock + synthesisBlock + continuationBlock

    // Create writing session record
    const writingSession = await prisma.writingSession.create({
      data: {
        subsectionId,
        context: {
          position: writingCtx.position,
          sourcesCount: writingCtx.sources.length,
          ragChunksCount: ragChunks.length,
        } as unknown as object,
        sourcesUsed: writingCtx.sources.map((s) => ({
          bibliographyId: s.bibliographyId,
          title: s.title,
        })) as unknown as object,
        promptSent: fullUserPrompt,
        status: 'streaming',
      },
    })

    // Credit check (eval-mode'da atlanır)
    if (!isEvalMode) {
      const credits = await checkCredits(userId, 'write_subsection_alt')
      if (!credits.allowed) {
        return NextResponse.json(
          { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
          { status: 402 }
        )
      }
    }

    // Create a BackgroundJob so the bell can surface progress / completion.
    // Eval-mode atlar — bell/notification akışı evaluation kapsamında değil.
    const jobId = isEvalMode
      ? ''
      : await startJob({
          userId: userId,
          type: 'subsection',
          title: subsection.title,
          projectId,
          subsectionId,
          resultUrl: `/projects/${projectId}/write?subsection=${subsectionId}`,
          message: 'Yazılıyor…',
        })

    // LLM worker. Pressing the Stop button on the client aborts the
    // request — we listen for that signal to (a) cancel the LLM stream
    // immediately and (b) flush whatever we generated so far to the DB
    // with status='paused' so a Continue click can resume from there.
    let bufferedText = ''
    let finalResult:
      | { fullText: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }
      | null = null
    let workError: string | null = null
    let workDone = false
    let creditInfo: { newBalance: number; creditsUsed: number } | null = null
    let aborted = false

    // Internal abort controller forwarded to streamChatWithUsage so we
    // can cancel the upstream Anthropic stream the moment the client
    // disconnects.
    const llmAbort = new AbortController()
    const onClientAbort = async () => {
      if (aborted) return
      aborted = true
      llmAbort.abort()
      try {
        const partial = (existingContent ? existingContent + bufferedText : bufferedText) || subsection.content || ''
        const wordCount = partial.trim().split(/\s+/).filter(Boolean).length
        await prisma.subsection.update({
          where: { id: subsectionId },
          data: {
            content: partial,
            wordCount,
            status: 'paused',
          },
        })
      } catch (err) {
        console.error('[generate] failed to persist partial on abort:', err)
      }
    }
    if (req.signal.aborted) {
      // Client never sustained the connection — bail before kicking
      // off the LLM.
      return new Response(null, { status: 499 })
    }
    req.signal.addEventListener('abort', onClientAbort, { once: true })

    // Signal-based coordination: onChunk wakes the SSE loop immediately
    // so users see the same character-by-character typing as before.
    let wakeResolve: (() => void) | null = null
    const wake = () => {
      const r = wakeResolve
      wakeResolve = null
      if (r) r()
    }
    const waitForUpdate = (maxMs: number) =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          wakeResolve = null
          resolve()
        }, maxMs)
        wakeResolve = () => {
          clearTimeout(timer)
          resolve()
        }
      })

    // Kick off the LLM work. We intentionally do NOT await this; it runs
    // alongside the SSE controller below and survives client disconnect.
    const workPromise = (async () => {
      try {
        await prisma.subsection.update({
          where: { id: subsectionId },
          data: { status: 'in_progress' },
        })

        const result = await streamChatWithUsage(
          [{ role: 'user', content: fullUserPrompt }],
          systemPromptParts,
          (chunk) => {
            bufferedText += chunk
            wake()
          },
          { signal: llmAbort.signal }
        )
        finalResult = result

        // If the client aborted *during* the stream the listener above
        // already saved the partial as 'paused'. Don't overwrite with a
        // 'completed' record in that case — the abort wins.
        if (aborted) return

        // In continue mode the new text is appended to whatever was
        // already in the subsection; in fresh mode it replaces.
        const finalContent = existingContent
          ? existingContent + (existingContent.endsWith('\n') ? '' : '\n\n') + result.fullText
          : result.fullText
        const wordCount = finalContent.trim().split(/\s+/).filter(Boolean).length

        await prisma.subsection.update({
          where: { id: subsectionId },
          data: {
            content: finalContent,
            wordCount,
            status: 'completed',
          },
        })

        // Citation accuracy validation — ölçüm aşamasında, sistemi değiştirmiyor.
        // ALLOWED_BIB_IDS = subsection'a bağlı bibliography ID'leri.
        const allowedBibIds = writingCtx.sources.map((s) => s.bibliographyId)
        const citationCheck = validateCitations({
          text: result.fullText,
          allowedBibIds,
        })
        if (citationCheck.totalCiteMarkers > 0) {
          console.log(
            `[citation-check] subsection=${subsectionId} ${citationCheck.summary}`,
          )
          if (citationCheck.fabricatedBibIds.length > 0) {
            console.warn(
              `[citation-check] FABRICATED:`,
              citationCheck.fabricatedBibIds.map((c) => c.bibId),
            )
          }
        }

        // REVIEWER AGENT (Stage 7) — Haiku judge unsupported claims +
        // fabricated citations + objective coverage. Env flag ile kapatılabilir.
        const reviewerEnabled = (process.env.WRITING_REVIEWER_ENABLED ?? '1') === '1'
        let reviewResult: Awaited<ReturnType<typeof reviewSubsection>> | null = null
        if (reviewerEnabled && result.fullText.length > 100) {
          const subsectionObjective = [
            subsection.description,
            ...(subsection.keyPoints ?? []),
          ]
            .filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
            .join('\n')
          reviewResult = await reviewSubsection({
            subsectionTitle: subsection.title,
            subsectionObjective,
            paragraph: result.fullText,
            allowedBibIds,
            retrievedExcerpts: ragChunks.slice(0, 8).map((c) => ({
              sourceTitle: c.sourceTitle,
              preview: c.content,
            })),
            goal: sectionGoal,
          })
          console.log(
            `[reviewer] subsection=${subsectionId} score=${reviewResult.score.toFixed(2)}` +
              ` unsupported=${reviewResult.unsupportedClaims.length}` +
              ` fabricated=${reviewResult.fabricatedCitations.length}` +
              ` regenerate=${reviewResult.regenerate}`,
          )
        }

        await prisma.writingSession.update({
          where: { id: writingSession.id },
          data: {
            responseReceived: result.fullText,
            status: 'completed',
            context: {
              position: writingCtx.position,
              sourcesCount: writingCtx.sources.length,
              ragChunksCount: ragChunks.length,
              synthesisMode,
              sectionGoal,
              plannerBackend,
              analysisDepth,
              synthesisPlanned: synthesisBlock.length > 0,
              citationCheck: {
                total: citationCheck.totalCiteMarkers,
                valid: citationCheck.validCiteMarkers,
                fabricated: citationCheck.fabricatedBibIds.map((c) => c.bibId),
                fabricatedRate: citationCheck.fabricatedRate,
                footnotes: citationCheck.totalFootnotes,
                fnViolations: citationCheck.fnViolations,
                inlineKunyeViolations: citationCheck.inlineKunyeViolations,
                coverage: citationCheck.coverage,
                coverageNotes: citationCheck.coverageNotes,
              },
              ...(reviewResult ? {
                review: {
                  score: reviewResult.score,
                  unsupportedClaims: reviewResult.unsupportedClaims,
                  fabricatedCitations: reviewResult.fabricatedCitations,
                  missingObjective: reviewResult.missingObjective,
                  coherent: reviewResult.coherent,
                  regenerate: reviewResult.regenerate,
                  goalCriteriaMet: reviewResult.goalCriteriaMet,
                  judgeFailed: reviewResult.judgeFailed,
                },
              } : {}),
            } as unknown as object,
          },
        })

        if (!isEvalMode) {
          const { newBalance, creditsUsed } = await deductCredits(
            userId,
            'write_subsection_alt',
            result.inputTokens,
            result.outputTokens,
            'sonnet',
            { projectId, subsectionId },
            { read: result.cacheReadTokens, creation: result.cacheCreationTokens }
          )
          creditInfo = { newBalance, creditsUsed }

          await completeJob(jobId, { message: `${wordCount} kelime yazıldı` })
        }
      } catch (err) {
        // AbortError is the expected path when the user pressed Stop —
        // the listener has already persisted the partial; no need to
        // mark anything as failed.
        const isAbortErr =
          (err as { name?: string } | null)?.name === 'AbortError' || aborted
        if (isAbortErr) {
          await prisma.writingSession
            .update({ where: { id: writingSession.id }, data: { status: 'paused' } })
            .catch(() => {})
          if (!isEvalMode) await failJob(jobId, 'paused').catch(() => {})
          return
        }
        workError = err instanceof Error ? err.message : String(err)
        await prisma.writingSession
          .update({ where: { id: writingSession.id }, data: { status: 'failed' } })
          .catch(() => {})
        await prisma.subsection
          .update({ where: { id: subsectionId }, data: { status: 'pending' } })
          .catch(() => {})
        if (!isEvalMode) await failJob(jobId, workError).catch(() => {})
      } finally {
        workDone = true
        wake()
      }
    })()

    // Surface unhandled rejections to the log (the promise is intentionally
    // not awaited by the response path).
    workPromise.catch((err) => console.error('[generate] detached worker:', err))

    // Eval-mode: SSE'i atla, workPromise bitene kadar bekle, JSON dön.
    // Runner böylece tek çağrıda fullText + citationCheck + review skoru alır.
    if (isEvalMode) {
      const startMs = Date.now()
      await workPromise
      const latencyMs = Date.now() - startMs
      if (workError) {
        return NextResponse.json({ error: workError, sessionId: writingSession.id }, { status: 500 })
      }
      // Closure-write narrowing'den kaçınmak için tüm sonuçları DB'den oku.
      const ws = await prisma.writingSession.findUnique({
        where: { id: writingSession.id },
        select: { context: true, responseReceived: true },
      })
      const fullText = ws?.responseReceived ?? ''
      return NextResponse.json({
        sessionId: writingSession.id,
        subsectionId,
        fullText,
        wordCount: fullText.trim().split(/\s+/).filter(Boolean).length,
        ragChunksCount: writingCtx.sources.length,
        allowedBibIds: writingCtx.sources.map((s) => s.bibliographyId),
        context: ws?.context ?? null,
        latencyMs,
      })
    }

    // SSE stream: polls the buffer every 80ms and enqueues any new text.
    // If the client disconnects, enqueue throws — we swallow the error and
    // the loop exits, but the workPromise keeps running until completion.
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        let sentChars = 0
        let connected = true
        const tryEnqueue = (payload: string): boolean => {
          if (!connected) return false
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            connected = false
            return false
          }
        }

        while (connected) {
          if (bufferedText.length > sentChars) {
            const delta = bufferedText.slice(sentChars)
            sentChars = bufferedText.length
            if (!tryEnqueue(`data: ${JSON.stringify({ delta })}\n\n`)) break
          }
          if (workDone) break
          await waitForUpdate(500)
        }

        if (!connected) {
          // Client left. Work continues; the bell will announce completion.
          return
        }

        if (workError) {
          tryEnqueue(`data: ${JSON.stringify({ error: workError })}\n\n`)
        } else if (finalResult) {
          const wordCount = finalResult.fullText.trim().split(/\s+/).filter(Boolean).length
          tryEnqueue(
            `data: ${JSON.stringify({
              done: true,
              wordCount,
              sessionId: writingSession.id,
              creditsUsed: creditInfo?.creditsUsed,
              balance: creditInfo?.newBalance,
            })}\n\n`
          )
          tryEnqueue('data: [DONE]\n\n')
        }
        try {
          controller.close()
        } catch {
          // already closed
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST /api/projects/[id]/write/[subsectionId]/generate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
