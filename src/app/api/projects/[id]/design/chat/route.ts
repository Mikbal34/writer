import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  streamChatWithTools,
  HAIKU,
  type ChatMessage,
  type SystemPromptPart,
  type ToolDefinition,
} from '@/lib/claude'
import { compressHistory, type ChatType } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// BookDesign type
// ---------------------------------------------------------------------------
interface BookDesign {
  bodyFont: string
  bodyFontSize: number
  headingFont: string
  headingFontSize: number
  lineHeight: number
  paragraphSpacing: number
  firstLineIndent: number
  textAlign: string
  pageSize: string
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
  chapterTitleSize: number
  chapterTitleAlign: string
  chapterTitleStyle: string
  sectionTitleSize: number
  subsectionTitleSize: number
  imageLayout: string
  imageWidthPercent: number
  imagePosition: string
  textColor: string
  headingColor: string
  accentColor: string
  showPageNumbers: boolean
  pageNumberPosition: string
  showChapterDivider: boolean
}

// ---------------------------------------------------------------------------
// Preset definitions
// ---------------------------------------------------------------------------
const PRESETS: Record<string, BookDesign> = {
  children_book: {
    bodyFont: 'Helvetica',
    bodyFontSize: 16,
    headingFont: 'Helvetica-Bold',
    headingFontSize: 28,
    lineHeight: 1.8,
    paragraphSpacing: 12,
    firstLineIndent: 0,
    textAlign: 'left',
    pageSize: 'A4',
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    chapterTitleSize: 32,
    chapterTitleAlign: 'center',
    chapterTitleStyle: 'bold',
    sectionTitleSize: 22,
    subsectionTitleSize: 18,
    imageLayout: 'full_page',
    imageWidthPercent: 90,
    imagePosition: 'before',
    textColor: '#2D1F0E',
    headingColor: '#C9A84C',
    accentColor: '#E8A838',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    showChapterDivider: true,
  },
  novel: {
    bodyFont: 'main',
    bodyFontSize: 11,
    headingFont: 'main-bold',
    headingFontSize: 18,
    lineHeight: 1.6,
    paragraphSpacing: 4,
    firstLineIndent: 24,
    textAlign: 'justify',
    pageSize: '5x8',
    marginTop: 54,
    marginBottom: 54,
    marginLeft: 54,
    marginRight: 54,
    chapterTitleSize: 22,
    chapterTitleAlign: 'center',
    chapterTitleStyle: 'bold',
    sectionTitleSize: 14,
    subsectionTitleSize: 12,
    imageLayout: 'inline_right',
    imageWidthPercent: 40,
    imagePosition: 'after',
    textColor: '#1a1a1a',
    headingColor: '#1a1a1a',
    accentColor: '#666666',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    showChapterDivider: true,
  },
  academic: {
    bodyFont: 'main',
    bodyFontSize: 12,
    headingFont: 'main-bold',
    headingFontSize: 18,
    lineHeight: 1.5,
    paragraphSpacing: 6,
    firstLineIndent: 36,
    textAlign: 'justify',
    pageSize: 'A4',
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 72,
    marginRight: 72,
    chapterTitleSize: 24,
    chapterTitleAlign: 'left',
    chapterTitleStyle: 'bold',
    sectionTitleSize: 16,
    subsectionTitleSize: 13,
    imageLayout: 'center',
    imageWidthPercent: 70,
    imagePosition: 'after',
    textColor: '#000000',
    headingColor: '#000000',
    accentColor: '#333333',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    showChapterDivider: false,
  },
  magazine: {
    bodyFont: 'Helvetica',
    bodyFontSize: 10,
    headingFont: 'Helvetica-Bold',
    headingFontSize: 20,
    lineHeight: 1.4,
    paragraphSpacing: 6,
    firstLineIndent: 0,
    textAlign: 'left',
    pageSize: 'A4',
    marginTop: 54,
    marginBottom: 54,
    marginLeft: 54,
    marginRight: 54,
    chapterTitleSize: 26,
    chapterTitleAlign: 'left',
    chapterTitleStyle: 'bold',
    sectionTitleSize: 16,
    subsectionTitleSize: 12,
    imageLayout: 'half_page',
    imageWidthPercent: 60,
    imagePosition: 'before',
    textColor: '#222222',
    headingColor: '#0066cc',
    accentColor: '#0066cc',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-outside',
    showChapterDivider: false,
  },
  poetry: {
    bodyFont: 'main-italic',
    bodyFontSize: 13,
    headingFont: 'main-bold',
    headingFontSize: 20,
    lineHeight: 2.0,
    paragraphSpacing: 12,
    firstLineIndent: 0,
    textAlign: 'center',
    pageSize: 'A5',
    marginTop: 72,
    marginBottom: 72,
    marginLeft: 54,
    marginRight: 54,
    chapterTitleSize: 22,
    chapterTitleAlign: 'center',
    chapterTitleStyle: 'italic',
    sectionTitleSize: 16,
    subsectionTitleSize: 13,
    imageLayout: 'center',
    imageWidthPercent: 60,
    imagePosition: 'before',
    textColor: '#2D1F0E',
    headingColor: '#5C4A32',
    accentColor: '#C9A84C',
    showPageNumbers: true,
    pageNumberPosition: 'bottom-center',
    showChapterDivider: true,
  },
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
function buildTools(): ToolDefinition[] {
  return [
    {
      name: 'update_design',
      description:
        'Updates specific fields of the book design. Use this to change fonts, sizes, colors, margins, or any other design property. Pass only the fields you want to change.',
      input_schema: {
        type: 'object' as const,
        properties: {
          bodyFont: { type: 'string', description: 'Body text font' },
          bodyFontSize: { type: 'number', description: 'Body font size in pt' },
          headingFont: { type: 'string', description: 'Heading font' },
          headingFontSize: { type: 'number', description: 'Heading font size in pt' },
          lineHeight: { type: 'number', description: 'Line height multiplier (e.g. 1.5)' },
          paragraphSpacing: { type: 'number', description: 'Space between paragraphs in pt' },
          firstLineIndent: { type: 'number', description: 'First line indent in pt (0 = no indent)' },
          textAlign: { type: 'string', description: 'Text alignment: left, justify, center, right' },
          pageSize: { type: 'string', description: 'Page size: A4, A5, 5x8, letter' },
          marginTop: { type: 'number', description: 'Top margin in pt' },
          marginBottom: { type: 'number', description: 'Bottom margin in pt' },
          marginLeft: { type: 'number', description: 'Left margin in pt' },
          marginRight: { type: 'number', description: 'Right margin in pt' },
          chapterTitleSize: { type: 'number', description: 'Chapter title font size in pt' },
          chapterTitleAlign: { type: 'string', description: 'Chapter title alignment: left, center, right' },
          chapterTitleStyle: { type: 'string', description: 'Chapter title style: bold, italic, normal' },
          sectionTitleSize: { type: 'number', description: 'Section title font size in pt' },
          subsectionTitleSize: { type: 'number', description: 'Subsection title font size in pt' },
          imageLayout: { type: 'string', description: 'Default image layout: full_page, half_page, inline_right, inline_left, center, float_right' },
          imageWidthPercent: { type: 'number', description: 'Default image width as percentage (10-100)' },
          imagePosition: { type: 'string', description: 'Default image position: before, after' },
          textColor: { type: 'string', description: 'Body text color as hex (e.g. #1a1a1a)' },
          headingColor: { type: 'string', description: 'Heading color as hex' },
          accentColor: { type: 'string', description: 'Accent color as hex' },
          showPageNumbers: { type: 'boolean', description: 'Whether to show page numbers' },
          pageNumberPosition: { type: 'string', description: 'Page number position: bottom-center, bottom-outside, bottom-inside' },
          showChapterDivider: { type: 'boolean', description: 'Whether to show a divider line after chapter titles' },
        },
      },
    },
    {
      name: 'apply_preset',
      description:
        'Applies a full design preset, replacing all current design settings. Use this when the user asks for a specific book style like a novel, children\'s book, academic paper, magazine, or poetry collection.',
      input_schema: {
        type: 'object' as const,
        properties: {
          preset: {
            type: 'string',
            enum: ['children_book', 'novel', 'academic', 'magazine', 'poetry'],
            description: 'Preset name to apply',
          },
        },
        required: ['preset'],
      },
    },
    {
      name: 'update_all_images_layout',
      description: 'Changes the layout settings for ALL images in the project at once.',
      input_schema: {
        type: 'object' as const,
        properties: {
          layout: { type: 'string', description: 'Image layout: full_page, half_page, inline_right, inline_left, center, float_right' },
          widthPercent: { type: 'number', description: 'Image width as percentage (10-100)' },
          position: { type: 'string', description: 'Image position relative to text: before, after' },
        },
      },
    },
    {
      name: 'update_image_layout',
      description: 'Changes the layout settings for a single specific image.',
      input_schema: {
        type: 'object' as const,
        properties: {
          imageId: { type: 'string', description: 'Database ID of the image to update' },
          layout: { type: 'string', description: 'Image layout: full_page, half_page, inline_right, inline_left, center, float_right' },
          widthPercent: { type: 'number', description: 'Image width as percentage (10-100)' },
          position: { type: 'string', description: 'Image position relative to text: before, after' },
        },
        required: ['imageId'],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------
async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectId: string
): Promise<string> {
  if (toolName === 'update_design') {
    try {
      const existing = await prisma.project.findFirst({
        where: { id: projectId },
        select: { bookDesign: true },
      })
      const currentDesign = (existing?.bookDesign ?? {}) as Record<string, unknown>
      const merged = { ...currentDesign, ...toolInput }
      await prisma.project.update({
        where: { id: projectId },
        data: { bookDesign: merged as object },
      })
      return JSON.stringify({ success: true, updatedFields: Object.keys(toolInput) })
    } catch (err) {
      return JSON.stringify({ error: `Failed to update design: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  if (toolName === 'apply_preset') {
    const { preset } = toolInput as { preset: string }
    const design = PRESETS[preset]
    if (!design) {
      return JSON.stringify({ error: `Unknown preset: ${preset}. Available: ${Object.keys(PRESETS).join(', ')}` })
    }
    try {
      await prisma.project.update({
        where: { id: projectId },
        data: { bookDesign: design as unknown as object },
      })
      return JSON.stringify({ success: true, preset, appliedDesign: design })
    } catch (err) {
      return JSON.stringify({ error: `Failed to apply preset: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  if (toolName === 'update_all_images_layout') {
    const { layout, widthPercent, position } = toolInput as {
      layout?: string
      widthPercent?: number
      position?: string
    }
    try {
      await prisma.projectImage.updateMany({
        where: { projectId },
        data: {
          ...(layout !== undefined && { layout }),
          ...(widthPercent !== undefined && { widthPercent }),
          ...(position !== undefined && { position }),
        },
      })
      const count = await prisma.projectImage.count({ where: { projectId } })
      return JSON.stringify({ success: true, updatedCount: count })
    } catch (err) {
      return JSON.stringify({ error: `Failed to update image layouts: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  if (toolName === 'update_image_layout') {
    const { imageId, layout, widthPercent, position } = toolInput as {
      imageId: string
      layout?: string
      widthPercent?: number
      position?: string
    }
    try {
      await prisma.projectImage.update({
        where: { id: imageId },
        data: {
          ...(layout !== undefined && { layout }),
          ...(widthPercent !== undefined && { widthPercent }),
          ...(position !== undefined && { position }),
        },
      })
      return JSON.stringify({ success: true, imageId })
    } catch (err) {
      return JSON.stringify({ error: `Failed to update image: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` })
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(
  project: { title: string; language: string | null; projectType: string },
  currentDesign: BookDesign | null,
  conversationSummary: string | null
): SystemPromptPart[] {
  const langNames: Record<string, string> = {
    en: 'English', tr: 'Turkish', ar: 'Arabic', fa: 'Persian', ur: 'Urdu',
    de: 'German', fr: 'French', es: 'Spanish', pt: 'Portuguese', it: 'Italian',
    ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi',
    he: 'Hebrew', pl: 'Polish', nl: 'Dutch', sv: 'Swedish', th: 'Thai',
    vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay', bn: 'Bengali',
    sw: 'Swahili', uk: 'Ukrainian', el: 'Greek', cs: 'Czech', ro: 'Romanian',
    hu: 'Hungarian', da: 'Danish', no: 'Norwegian', fi: 'Finnish',
  }
  const langName = langNames[project.language ?? 'en'] ?? project.language ?? 'English'

  const summarySection = conversationSummary
    ? `\n\n## Previous Conversation Summary\n${conversationSummary}`
    : ''

  const staticPart = `You are a book design assistant. You help users design the visual layout and typography of their book.

Available presets:
- children_book: Large fonts (16pt body), colorful headings, full-page images, wide margins
- novel: Serif font (11pt), justified text, small inline images, narrow margins, 5x8 page
- academic: Times New Roman (12pt), formal, no images, footnotes, wide margins, A4
- magazine: Sans-serif (10pt), half-page images, modern look, A4
- poetry: Italic serif (13pt), centered text, A5 page, wide line spacing

RULES:
- Respond in the project's language (${langName})
- Use tools to apply changes — don't just describe them
- When the user asks for a style, use apply_preset first, then fine-tune with update_design
- Explain what you changed after applying
- Keep explanations concise and helpful
- NEVER use emoji`

  const designSummary = currentDesign
    ? `Current design: ${currentDesign.pageSize} page, ${currentDesign.bodyFont} ${currentDesign.bodyFontSize}pt body, ${currentDesign.headingColor} headings, ${currentDesign.textAlign} text alignment`
    : 'No design set yet — suggest a preset based on the project type.'

  const dynamicPart = `Project: "${project.title}" (${project.projectType})
Language: ${langName}
${designSummary}${summarySection}`

  return [
    { text: staticPart, cache: true },
    { text: dynamicPart },
  ]
}

// ---------------------------------------------------------------------------
// POST handler
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const session = await requireAuth()
    const userId = session.user.id
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId },
      select: {
        id: true,
        title: true,
        language: true,
        projectType: true,
        bookDesign: true,
      },
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

    const currentDesign = project.bookDesign as BookDesign | null

    // Compress history — token-based with structured design prompt
    const { messages: compressedMessages, summary: conversationSummary } =
      await compressHistory(messages, {
        chatType: 'design' as ChatType,
        maxTokens: 20000,
        keepRecent: 4,
        reinjectContext: currentDesign
          ? `Current design: ${currentDesign.pageSize} page, ${currentDesign.bodyFont} ${currentDesign.bodyFontSize}pt, ${currentDesign.textAlign}`
          : undefined,
      })

    const systemPrompt = buildSystemPrompt(project, currentDesign, conversationSummary)
    const tools = buildTools()

    // Credit check
    const credits = await checkCredits(session.user.id, 'design_chat')
    if (!credits.allowed) {
      return new Response(
        JSON.stringify({ error: 'Insufficient credits', balance: credits.balance, cost: credits.estimatedCost }),
        { status: 402, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        try {
          const result = await streamChatWithTools(
            compressedMessages,
            systemPrompt,
            tools,
            (toolName, toolInput) => handleToolCall(toolName, toolInput, projectId),
            (chunk) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
            },
            (toolName) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step: 'thinking', tool: toolName })}\n\n`))
            },
            { model: HAIKU, cacheTools: true }
          )

          const { newBalance, creditsUsed } = await deductCredits(
            session.user.id,
            'design_chat',
            result.inputTokens,
            result.outputTokens,
            'haiku',
            { projectId },
            { read: result.cacheReadTokens, creation: result.cacheCreationTokens }
          )

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, creditsUsed, balance: newBalance })}\n\n`)
          )

          // Save chat messages using sessionId with "design-" prefix
          try {
            const designSessionId = sessionId.startsWith('design-') ? sessionId : `design-${sessionId}`
            await prisma.illustrationChatMessage.createMany({
              data: [
                { projectId, sessionId: designSessionId, role: 'user', content: userContent },
                { projectId, sessionId: designSessionId, role: 'assistant', content: result.fullText },
              ],
            })
          } catch (saveErr) {
            console.error('[design/chat] Failed to save messages:', saveErr)
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (streamErr) {
          const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr)
          console.error('[design/chat] Stream error:', errMsg, streamErr)
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed', detail: errMsg })}\n\n`)
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
    const errMsg = err instanceof Error ? err.message : String(err)
    console.error('[POST /api/projects/[id]/design/chat]', errMsg, err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
