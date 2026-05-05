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

// Inline markers that MUST round-trip unchanged. We log these to the
// system prompt below so the LLM treats them as opaque tokens, and we
// post-check counts to catch drift before returning the rewrite.
const PRESERVE_PATTERNS: { name: string; regex: RegExp }[] = [
  { name: 'cite', regex: /\[cite:[^\]]+\]/g },
  { name: 'fn', regex: /\[fn:[^\]]+\]/g },
  { name: 'ref', regex: /\[ref:[^\]]+\]/g },
]

function countMarkers(text: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { name, regex } of PRESERVE_PATTERNS) {
    out[name] = (text.match(regex) ?? []).length
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

    // Verify project + subsection ownership.
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
      select: { id: true, language: true },
    })
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })
    }
    const subsection = await prisma.subsection.findFirst({
      where: { id: subsectionId, section: { chapter: { projectId } } },
      select: { id: true },
    })
    if (!subsection) {
      return NextResponse.json({ error: 'Subsection not found' }, { status: 404 })
    }

    // Credit gate.
    const credits = await checkCredits(session.user.id, 'rewrite_selection')
    if (!credits.allowed) {
      return NextResponse.json(
        { error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost },
        { status: 402 },
      )
    }

    const instruction =
      action === 'custom' ? customPrompt : ACTION_INSTRUCTIONS[action]

    const systemPrompt =
      'Sen akademik bir editörsün. Verilen metin parçasını kullanıcının talebine göre yeniden yazarsın. ' +
      'Çıktıda sadece yeniden yazılmış metni döndür — başına/sonuna açıklama, tırnak, "İşte yeniden yazım:" gibi şeyler ekleme.\n\n' +
      'KORUNACAK İŞARETLER (opak token gibi düşün, içeriklerini değiştirme, sayılarını azaltma, yerlerini ait oldukları cümlede tut):\n' +
      '  • [cite:bibId,p=...] — atıf markerı\n' +
      '  • [fn: ...]          — dipnot markerı\n' +
      '  • [ref:id]           — şekil/tablo/denklem cross-reference\n\n' +
      'Bu işaretlerden hiçbirini silme, birleştirme veya çoğaltma. Bağlı oldukları cümle yeniden yazıldıysa onları yine ilgili cümlede tut. ' +
      'Markdown formatlarını (**kalın**, *italik*, > alıntı, listeler, tablolar) bozmadan korumaya çalış. Yeni atıf uydurma; mevcut olmayan cite/fn/ref ekleme.'

    const userMessage =
      `${instruction}\n\n` +
      '--- METIN BAŞLANGIÇ ---\n' +
      text +
      '\n--- METIN BİTİŞ ---\n\n' +
      'Yeniden yazılmış metin (sadece metin, başka şey yazma):'

    const result = await streamChatWithUsage(
      [{ role: 'user', content: userMessage }],
      systemPrompt,
      undefined,
      { model: undefined },
    )

    const rewrite = result.fullText.trim()

    // Marker drift check: if the input had cite/fn/ref markers and the
    // rewrite dropped any, surface a flag so the client can warn the
    // user. We don't refuse the rewrite — sometimes the user wants to
    // shorten and accept the loss — but we make it visible.
    const before = countMarkers(text)
    const after = countMarkers(rewrite)
    const lostMarkers: string[] = []
    for (const { name } of PRESERVE_PATTERNS) {
      if ((before[name] ?? 0) > (after[name] ?? 0)) lostMarkers.push(name)
    }

    await deductCredits(
      session.user.id,
      'rewrite_selection',
      result.inputTokens,
      result.outputTokens,
      'sonnet',
      { projectId, subsectionId, action, lostMarkers },
      { read: result.cacheReadTokens, creation: result.cacheCreationTokens },
    )

    return NextResponse.json({
      rewrite,
      markersBefore: before,
      markersAfter: after,
      lostMarkers, // e.g. ['cite'] if any cite markers were dropped
    })
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[POST rewrite]', err)
    return NextResponse.json({ error: 'Rewrite failed' }, { status: 500 })
  }
}
