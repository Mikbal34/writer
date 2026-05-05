/**
 * Selection-based rewrite endpoint. The writing editor's BubbleMenu
 * sends a slice of selected text plus a transformation action; we
 * call Claude with a focused "rewrite this fragment" prompt and
 * return the rewrite so the client can replace the selection.
 *
 * Synchronous (non-streaming) on purpose — the user is staring at a
 * single highlighted block waiting for the swap, and a streaming UX
 * for short snippets feels laggy.
 *
 *   POST /api/projects/[id]/write/[subsectionId]/rewrite
 *     body: { text, action, customPrompt? }
 *   →  { rewrite }
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithUsage } from '@/lib/claude'
import { checkCredits, deductCredits } from '@/lib/credits'
import { CITATION_FORMAT_META } from '@/lib/citations/metadata'
import type { CitationFormat } from '@prisma/client'

const INLINE_STYLE_HINT: Record<string, string> = {
  'author-date': 'metin içinde "(Yazar, Yıl, s. N)" formunda görünür',
  'parenthetical-author-page': 'metin içinde "(Yazar Sayfa)" formunda görünür',
  numeric: 'metin içinde "[N]" numaralı atıf formunda görünür',
  footnote: 'dipnot olarak görünür — gövde metninde yalnızca üs simgesiyle anılır',
}

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

type RouteContext = { params: Promise<{ id: string; subsectionId: string }> }

type RewriteAction = 'rewrite' | 'shorten' | 'expand' | 'academic' | 'custom'

const ACTION_INSTRUCTIONS: Record<RewriteAction, string> = {
  rewrite:
    'Aşağıdaki metni anlamını koruyarak yeniden ifade et. Cümle yapısını ve kelime seçimini değiştirebilirsin ama aynı bilgiyi söyle.',
  shorten:
    'Aşağıdaki metni daha öz, kısa hâle getir. Tekrarları ve doldurma cümleleri çıkar; ana fikri koru.',
  expand:
    'Aşağıdaki metni daha fazla detay, örnek ve nüansla genişlet. Yeni iddialar uydurma — sadece var olan fikri açıklayan cümleler ekle.',
  academic:
    'Aşağıdaki metni daha resmi, akademik bir Türkçeye çevir; analitik ve nesnel bir tonla yeniden yaz. Birinci tekil/çoğul şahıs varsa kaldır.',
  custom: '', // overwritten by user prompt below
}

// Markers that MUST round-trip unchanged. We hand the LLM a list of
// these in the system prompt as opaque tokens and post-check both
// missing markers (model deleted one) and fabricated markers (model
// invented an id that wasn't in the original — i.e. a hallucinated
// citation or cross-reference).
const PRESERVE_PATTERNS: { name: string; regex: RegExp }[] = [
  // Inline markers — citations, footnotes, cross-refs.
  { name: 'cite', regex: /\[cite:[^\]]+\]/g },
  { name: 'fn', regex: /\[fn:[^\]]+\]/g },
  { name: 'ref', regex: /\[ref:[^\]]+\]/g },
  // Block markers — only the opening token (chart specs span multiple
  // lines but the marker line is unique).
  { name: 'chart', regex: /\[chart:[^\]]+\]/g },
  { name: 'figure', regex: /\[figure:[^\]]+\]/g },
  { name: 'mermaid', regex: /\[mermaid:[^\]]+\]/g },
  { name: 'equation', regex: /\[equation:[^\]]+\]/g },
  { name: 'table', regex: /\[table:[^\]]+\]/g },
]

function countMarkers(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { name, regex } of PRESERVE_PATTERNS) {
    out[name] = (text.match(regex) ?? []).length
  }
  return out
}

function listMarkers(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const { name, regex } of PRESERVE_PATTERNS) {
    out[name] = text.match(regex) ?? []
  }
  return out
}

const VALID_ACTIONS: ReadonlyArray<RewriteAction> = [
  'rewrite',
  'shorten',
  'expand',
  'academic',
  'custom',
]

const MAX_INPUT_CHARS = 6000

export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const { id: projectId, subsectionId } = await ctx.params

    const body = (await req.json().catch(() => ({}))) as {
      text?: string
      action?: string
      customPrompt?: string
    }

    const text = (body.text ?? '').trim()
    const action = (body.action ?? 'rewrite') as RewriteAction
    const customPrompt = (body.customPrompt ?? '').trim()

    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 })
    }
    if (text.length > MAX_INPUT_CHARS) {
      return NextResponse.json(
        { error: `Selection too long — max ${MAX_INPUT_CHARS} characters.` },
        { status: 400 },
      )
    }
    if (!VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: 'invalid action' }, { status: 400 })
    }
    if (action === 'custom' && !customPrompt) {
      return NextResponse.json(
        { error: 'customPrompt is required for action=custom' },
        { status: 400 },
      )
    }

    // Verify project + subsection ownership and load the bits we need
    // for context-aware prompting (citation format, style profile,
    // surrounding paragraph).
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: {
        id: true,
        language: true,
        citationFormat: true,
        styleProfile: true,
        linkedStyleProfile: { select: { profile: true } },
      },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const subsection = await prisma.subsection.findFirst({
      where: { id: subsectionId, section: { chapter: { projectId } } },
      select: { id: true, content: true, title: true },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    // Credit gate. Estimate scales with selection length so a quick
    // 50-char tone tweak doesn't see the same gate as a 5000-char
    // expand. Floor at 40 (a kept-busy minimum), ceiling at 500
    // (the actual deductCredits below uses real token usage anyway).
    const estimatedCost = Math.max(40, Math.min(500, Math.ceil(text.length / 30)))
    const credits = await checkCredits(session.user.id, 'rewrite_selection', estimatedCost)
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 },
      )
    }

    const instruction =
      action === 'custom' ? customPrompt : ACTION_INSTRUCTIONS[action]

    // Surround the selection with the rest of the subsection so the
    // model can match flow on either side. We tag the rewritten span
    // with <SEÇIM> so it knows which slice to actually return.
    const fullContent = subsection.content?.trim() ?? ''
    let surroundingContext = ''
    if (fullContent && fullContent.includes(text)) {
      const marked = fullContent.replace(text, `<SEÇIM>${text}</SEÇIM>`)
      surroundingContext =
        '\n\nSUBSECTION TAM METNİ (yeniden yazılan kısım <SEÇIM>...</SEÇIM> ile işaretli — yalnızca seçim içeriğini yeniden yaz, çevredeki cümleleri olduğu gibi bırak):\n' +
        marked
    }

    // Citation format awareness — so the LLM doesn't, e.g., paraphrase
    // (Smith, 2020) into just "Smith" on a Shorten action.
    const formatMeta = CITATION_FORMAT_META[project.citationFormat as CitationFormat]
    const formatBlock = formatMeta
      ? `\n\nATIF FORMATI: ${formatMeta.displayName}${formatMeta.version ? ' ' + formatMeta.version : ''} — ${INLINE_STYLE_HINT[formatMeta.inlineStyle] ?? ''}`
      : ''

    // User's writing-twin style profile, if linked. Keep the dump
    // small to not balloon the prompt — the relevant signals live in
    // a handful of fields the writing prompt already uses.
    const stylePayload =
      (project.linkedStyleProfile?.profile as Record<string, unknown> | null) ??
      (project.styleProfile as Record<string, unknown> | null) ??
      null
    const styleBlock = stylePayload
      ? `\n\nKULLANICININ YAZIM STİLİ (writing twin — yeniden yazımda bu sesle uyumlu kal):\n${JSON.stringify(stylePayload).slice(0, 1500)}`
      : ''

    const systemPrompt =
      'Sen akademik bir editörsün. Verilen metin parçasını kullanıcının talebine göre yeniden yazarsın. ' +
      'Çıktıda sadece yeniden yazılmış metni döndür — başına/sonuna açıklama, tırnak, "İşte yeniden yazım:" gibi şeyler ekleme.\n\n' +
      'KORUNACAK İŞARETLER (opak token gibi düşün, içeriklerini değiştirme, sayılarını azaltma, yerlerini ait oldukları cümlede tut):\n' +
      '  • [cite:bibId,p=...] — atıf markerı\n' +
      '  • [fn: ...]          — dipnot markerı\n' +
      '  • [ref:id]           — şekil/tablo/denklem cross-reference\n' +
      '  • [chart:id ...] / [figure:id ...] / [mermaid:id ...] / [equation:id] / [table:id ...] — blok markerları\n\n' +
      'Bu işaretlerden hiçbirini silme, birleştirme veya çoğaltma. Bağlı oldukları cümle yeniden yazıldıysa onları yine ilgili cümlede tut. ' +
      'Markdown formatlarını (**kalın**, *italik*, > alıntı, listeler, tablolar) bozmadan korumaya çalış. ' +
      'YENİ MARKER UYDURMA: orijinalde olmayan bir [cite:...], [fn:...], [ref:...], [chart:...], [figure:...], [mermaid:...], [equation:...], [table:...] çıktıya ekleme. Yeni atıf, dipnot veya cross-reference önerme.'

    const userMessage =
      `${instruction}` +
      formatBlock +
      styleBlock +
      surroundingContext +
      '\n\n--- YENİDEN YAZILACAK METİN ---\n' +
      text +
      '\n--- METİN BİTİŞ ---\n\n' +
      'Yeniden yazılmış metin (sadece metin, açıklama / tırnak / etiket yok):'

    // Stream the LLM response as SSE so the client can render a live
    // character counter while the model writes — much nicer than a
    // 5–10 s opaque spinner on Expand actions.
    const encoder = new TextEncoder()
    const beforeIds = listMarkers(text)

    const stream = new ReadableStream({
      async start(controller) {
        const safeEnqueue = (payload: string): boolean => {
          try {
            controller.enqueue(encoder.encode(payload))
            return true
          } catch {
            return false
          }
        }

        try {
          const result = await streamChatWithUsage(
            [{ role: 'user', content: userMessage }],
            systemPrompt,
            (chunk) => {
              safeEnqueue(`data: ${JSON.stringify({ delta: chunk })}\n\n`)
            },
            { model: undefined },
          )

          const rewrite = result.fullText.trim()

          // Marker drift: lost = original disappeared, fabricated = new
          // id invented. Both surface to client.
          const afterIds = listMarkers(rewrite)
          const lostMarkers: string[] = []
          const fabricatedMarkers: string[] = []
          for (const { name } of PRESERVE_PATTERNS) {
            const beforeSet = new Set(beforeIds[name] ?? [])
            const afterSet = new Set(afterIds[name] ?? [])
            for (const m of beforeSet) if (!afterSet.has(m)) lostMarkers.push(`${name}:${m}`)
            for (const m of afterSet) if (!beforeSet.has(m)) fabricatedMarkers.push(`${name}:${m}`)
          }

          await deductCredits(
            session.user.id,
            'rewrite_selection',
            result.inputTokens,
            result.outputTokens,
            'sonnet',
            { projectId, subsectionId, action, lostMarkers, fabricatedMarkers },
            { read: result.cacheReadTokens, creation: result.cacheCreationTokens },
          )

          safeEnqueue(
            `data: ${JSON.stringify({ done: true, rewrite, lostMarkers, fabricatedMarkers })}\n\n`,
          )
          safeEnqueue('data: [DONE]\n\n')
        } catch (err) {
          console.error('[rewrite/stream]', err)
          safeEnqueue(
            `data: ${JSON.stringify({ error: err instanceof Error ? err.message : 'rewrite failed' })}\n\n`,
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST rewrite]', err)
    return NextResponse.json({ error: 'Rewrite failed' }, { status: 500 })
  }
}
