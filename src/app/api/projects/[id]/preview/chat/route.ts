import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithTools, HAIKU, type ChatMessage, type SystemPromptPart, type ToolDefinition } from '@/lib/claude'
import { compressHistory, type ChatType } from '@/lib/conversation'
import { checkCredits, deductCredits, checkImageCredits, deductImageCredits } from '@/lib/credits'
import { generateImage, buildImagePrompt } from '@/lib/imagen'

type RouteContext = { params: Promise<{ id: string }> }

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
function buildTools(): ToolDefinition[] {
  return [
    {
      name: 'create_character',
      description: 'Create a new character card with name, physical description, and visual traits for consistent image generation.',
      input_schema: {
        type: 'object' as const,
        properties: {
          name: { type: 'string', description: 'Character name' },
          description: { type: 'string', description: 'Physical and personality description in the project language' },
          visualTraits: { type: 'string', description: 'Detailed visual description for image generation (English). E.g. "elderly bald man, 50 years old, short, round face, warm smile, wearing a brown wool vest"' },
        },
        required: ['name', 'description', 'visualTraits'],
      },
    },
    {
      name: 'update_character',
      description: 'Update an existing character\'s description or visual traits.',
      input_schema: {
        type: 'object' as const,
        properties: {
          characterId: { type: 'string', description: 'Database ID of the character' },
          description: { type: 'string', description: 'Updated description' },
          visualTraits: { type: 'string', description: 'Updated visual traits for image generation (English)' },
        },
        required: ['characterId'],
      },
    },
    {
      name: 'generate_scene_image',
      description: 'Generate an illustration for a specific chapter or subsection. The image will use character visual traits for consistency. REQUIRES chapterId — every scene image must be linked to a chapter.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sceneDescription: { type: 'string', description: 'Detailed scene description for image generation (English). Include setting, lighting, mood, character actions.' },
          chapterId: { type: 'string', description: 'Chapter database ID (REQUIRED). Use the [dbId: ...] value from the book structure.' },
          subsectionId: { type: 'string', description: 'Subsection database ID to attach the image to' },
          characterNames: { type: 'array', items: { type: 'string' }, description: 'Names of characters appearing in this scene' },
          aspectRatio: { type: 'string', enum: ['1:1', '3:4', '4:3', '16:9'], description: 'Image aspect ratio (default: 4:3)' },
        },
        required: ['sceneDescription', 'chapterId'],
      },
    },
    {
      name: 'regenerate_image',
      description: 'Regenerate a specific existing image with a new or modified prompt.',
      input_schema: {
        type: 'object' as const,
        properties: {
          imageId: { type: 'string', description: 'Database ID of the image to replace' },
          newSceneDescription: { type: 'string', description: 'New scene description (English)' },
          characterNames: { type: 'array', items: { type: 'string' }, description: 'Characters in the scene' },
        },
        required: ['imageId', 'newSceneDescription'],
      },
    },
    {
      name: 'set_art_style',
      description: 'Set the global art style for all future image generations in this project.',
      input_schema: {
        type: 'object' as const,
        properties: {
          style: { type: 'string', description: 'Art style name. One of: watercolor, digital_art, pencil_sketch, oil_painting, anime, children_book, realistic' },
        },
        required: ['style'],
      },
    },
    {
      name: 'generate_character_portrait',
      description: 'Generate a reference portrait for a character to establish their visual appearance.',
      input_schema: {
        type: 'object' as const,
        properties: {
          characterId: { type: 'string', description: 'Character database ID' },
        },
        required: ['characterId'],
      },
    },
    {
      name: 'generate_book_cover',
      description: 'Generate a book cover illustration. Creates a vertical cover image with the book title and visual elements.',
      input_schema: {
        type: 'object' as const,
        properties: {
          coverDescription: { type: 'string', description: 'Detailed description for the cover illustration (English). Include visual elements, mood, colors, composition.' },
          includeTitle: { type: 'boolean', description: 'Whether to include the book title text in the image (default: false, title added separately)' },
        },
        required: ['coverDescription'],
      },
    },
  ]
}

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------
async function handleToolCallFn(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectId: string,
  artStyle: string | null,
  userId: string
): Promise<string> {
  if (toolName === 'create_character') {
    const { name, description, visualTraits } = toolInput as { name: string; description: string; visualTraits: string }

    // Check for existing character with the same name — update instead of duplicating
    const existing = await prisma.character.findFirst({
      where: { projectId, name },
    })

    if (existing) {
      const character = await prisma.character.update({
        where: { id: existing.id },
        data: { description, visualTraits },
      })
      return JSON.stringify({ success: true, characterId: character.id, name: character.name, updated: true })
    }

    const count = await prisma.character.count({ where: { projectId } })
    const character = await prisma.character.create({
      data: {
        projectId,
        name,
        description,
        visualTraits,
        sortOrder: count,
      },
    })
    return JSON.stringify({ success: true, characterId: character.id, name: character.name })
  }

  if (toolName === 'update_character') {
    const { characterId, description, visualTraits } = toolInput as { characterId: string; description?: string; visualTraits?: string }
    await prisma.character.update({
      where: { id: characterId },
      data: {
        ...(description !== undefined && { description }),
        ...(visualTraits !== undefined && { visualTraits }),
      },
    })
    return JSON.stringify({ success: true })
  }

  if (toolName === 'generate_scene_image') {
    const { sceneDescription, chapterId, subsectionId, characterNames, aspectRatio } = toolInput as {
      sceneDescription: string
      chapterId?: string
      subsectionId?: string
      characterNames?: string[]
      aspectRatio?: string
    }

    // Require chapterId — images must be linked to the book structure
    if (!chapterId) {
      return JSON.stringify({ error: 'chapterId is required. Every scene image must be linked to a chapter. Use the dbId from the book structure.' })
    }

    // Fetch character visual traits for consistency
    const characterTraits: string[] = []
    if (characterNames && characterNames.length > 0) {
      const characters = await prisma.character.findMany({
        where: { projectId, name: { in: characterNames } },
        select: { name: true, visualTraits: true },
      })
      for (const c of characters) {
        if (c.visualTraits) characterTraits.push(`${c.name}: ${c.visualTraits}`)
      }
    }

    // Validate IDs exist before using them
    let validChapterId: string | null = null
    let validSubsectionId: string | null = null
    if (chapterId) {
      const ch = await prisma.chapter.findFirst({ where: { id: chapterId, projectId }, select: { id: true } })
      if (ch) validChapterId = ch.id
      else return JSON.stringify({ error: `Chapter with id "${chapterId}" not found in this project. Use get_chapter_detail or check the book structure for valid dbIds.` })
    }
    if (subsectionId) {
      const sub = await prisma.subsection.findFirst({ where: { id: subsectionId, section: { chapter: { projectId } } }, select: { id: true } })
      if (sub) validSubsectionId = sub.id
    }

    // Check credits before generating
    const creditCheck = await checkImageCredits(userId)
    if (!creditCheck.allowed) {
      return JSON.stringify({ error: `Insufficient credits for image generation. Required: 150, balance: ${creditCheck.balance}. The user needs more credits to generate images.` })
    }

    const prompt = buildImagePrompt(sceneDescription, characterTraits, artStyle ?? undefined)

    try {
      const [generated] = await generateImage({
        prompt,
        aspectRatio: (aspectRatio as '4:3') ?? '4:3',
        numberOfImages: 1,
      })

      const count = await prisma.projectImage.count({ where: { projectId } })
      const image = await prisma.projectImage.create({
        data: {
          projectId,
          chapterId: validChapterId,
          subsectionId: validSubsectionId,
          imageData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer>,
          prompt,
          style: artStyle,
          aspectRatio: aspectRatio ?? '4:3',
          sortOrder: count,
        },
      })

      // Deduct credits only on success
      const { newBalance, creditsUsed } = await deductImageCredits(userId, 'generate_image', { projectId })

      return JSON.stringify({
        success: true,
        imageId: image.id,
        url: `/api/projects/${projectId}/preview/images/${image.id}`,
        creditsUsed,
        newBalance,
      })
    } catch (imgErr) {
      const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr)
      console.error('[preview/chat] Scene image generation failed:', errMsg)
      return JSON.stringify({
        error: `Image generation failed: ${errMsg}. The scene was not saved. No credits were charged. You can retry with the same or modified description.`,
      })
    }
  }

  if (toolName === 'regenerate_image') {
    const { imageId, newSceneDescription, characterNames } = toolInput as {
      imageId: string
      newSceneDescription: string
      characterNames?: string[]
    }

    const characterTraits: string[] = []
    if (characterNames && characterNames.length > 0) {
      const characters = await prisma.character.findMany({
        where: { projectId, name: { in: characterNames } },
        select: { name: true, visualTraits: true },
      })
      for (const c of characters) {
        if (c.visualTraits) characterTraits.push(`${c.name}: ${c.visualTraits}`)
      }
    }

    // Check credits before regenerating
    const creditCheck = await checkImageCredits(userId)
    if (!creditCheck.allowed) {
      return JSON.stringify({ error: `Insufficient credits for image regeneration. Required: 150, balance: ${creditCheck.balance}.` })
    }

    const prompt = buildImagePrompt(newSceneDescription, characterTraits, artStyle ?? undefined)

    try {
      const [generated] = await generateImage({ prompt, numberOfImages: 1 })

      await prisma.projectImage.update({
        where: { id: imageId },
        data: { imageData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer>, prompt, style: artStyle },
      })

      const { newBalance, creditsUsed } = await deductImageCredits(userId, 'regenerate_image', { projectId })

      return JSON.stringify({
        success: true,
        imageId,
        url: `/api/projects/${projectId}/preview/images/${imageId}`,
        creditsUsed,
        newBalance,
      })
    } catch (imgErr) {
      const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr)
      return JSON.stringify({ error: `Regeneration failed: ${errMsg}. No credits were charged. The original image is unchanged. You can retry.` })
    }
  }

  if (toolName === 'set_art_style') {
    const { style } = toolInput as { style: string }
    // Store art style in project metadata
    await prisma.project.update({
      where: { id: projectId },
      data: { writingGuidelines: { artStyle: style } },
    })
    return JSON.stringify({ success: true, style })
  }

  if (toolName === 'generate_character_portrait') {
    const { characterId } = toolInput as { characterId: string }
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { name: true, visualTraits: true },
    })
    if (!character) return JSON.stringify({ error: `Character with id "${characterId}" not found. Use the correct dbId from the characters list.` })

    // Check credits before generating
    const creditCheck = await checkImageCredits(userId)
    if (!creditCheck.allowed) {
      return JSON.stringify({ error: `Insufficient credits for portrait generation. Required: 150, balance: ${creditCheck.balance}.` })
    }

    const prompt = `Character portrait: ${character.visualTraits ?? character.name}. ${artStyle ? `Art style: ${artStyle}.` : ''} Bust portrait, centered, detailed face, book illustration quality.`

    try {
      const [generated] = await generateImage({ prompt, aspectRatio: '1:1', numberOfImages: 1 })

      await prisma.character.update({
        where: { id: characterId },
        data: { referenceData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer> },
      })

      const { newBalance, creditsUsed } = await deductImageCredits(userId, 'generate_portrait', { projectId })

      return JSON.stringify({ success: true, characterId, name: character.name, creditsUsed, newBalance })
    } catch (imgErr) {
      const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr)
      console.error(`[preview/chat] Portrait generation failed for ${character.name}:`, errMsg)
      return JSON.stringify({
        error: `Portrait generation failed for "${character.name}": ${errMsg}. No credits were charged. The character still exists (id: ${characterId}). You can retry later. Do NOT create a new character.`,
      })
    }
  }

  if (toolName === 'generate_book_cover') {
    const { coverDescription } = toolInput as { coverDescription: string }
    // Check credits before generating
    const creditCheck = await checkImageCredits(userId)
    if (!creditCheck.allowed) {
      return JSON.stringify({ error: `Insufficient credits for cover generation. Required: 150, balance: ${creditCheck.balance}.` })
    }

    const prompt = `Book cover illustration: ${coverDescription}. ${artStyle ? `Art style: ${artStyle}.` : ''} Vertical composition, professional book cover quality, centered focal point, dramatic lighting.`

    try {
      const [generated] = await generateImage({ prompt, aspectRatio: '3:4', numberOfImages: 1 })

      // Save as a special project image with no chapter (cover)
      const image = await prisma.projectImage.create({
        data: {
          projectId,
          chapterId: null,
          subsectionId: null,
          imageData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer>,
          prompt,
          style: artStyle ?? 'cover',
          aspectRatio: '3:4',
          sortOrder: -1, // covers sort before chapter images
        },
      })

      const { newBalance, creditsUsed } = await deductImageCredits(userId, 'generate_cover', { projectId })

      return JSON.stringify({
        success: true,
        imageId: image.id,
        url: `/api/projects/${projectId}/preview/images/${image.id}`,
        type: 'book_cover',
        creditsUsed,
        newBalance,
      })
    } catch (imgErr) {
      const errMsg = imgErr instanceof Error ? imgErr.message : String(imgErr)
      return JSON.stringify({ error: `Book cover generation failed: ${errMsg}. No credits were charged. You can retry.` })
    }
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` })
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(
  project: { title: string; language: string | null; projectType: string },
  characters: Array<{ name: string; description: string | null; visualTraits: string | null }>,
  chapters: Array<{ id: string; number: number; title: string; sections: Array<{ title: string; subsections: Array<{ id: string; subsectionId: string; title: string }> }> }>,
  artStyle: string | null,
  conversationSummary: string | null
): SystemPromptPart[] {
  const characterList = characters.length > 0
    ? `\n\nExisting characters:\n${characters.map((c) => `- ${c.name}: ${c.description ?? 'No description'} [Visual: ${c.visualTraits ?? 'Not set'}]`).join('\n')}`
    : '\n\nNo characters created yet.'

  const chapterList = chapters.map((ch) =>
    `Ch ${ch.number} [dbId: ${ch.id}]: ${ch.title}\n${ch.sections.map((s) => `  ${s.title}\n${s.subsections.map((sub) => `    ${sub.subsectionId} [dbId: ${sub.id}] ${sub.title}`).join('\n')}`).join('\n')}`
  ).join('\n')

  const summarySection = conversationSummary
    ? `\n\n## Previous Conversation Summary\n${conversationSummary}`
    : ''

  const staticPart = `You are a book illustration assistant. You help create visual content for books — character designs, scene illustrations, and art direction.

Your capabilities:
1. Create character cards with detailed visual descriptions for consistent image generation
2. Generate scene illustrations for chapters/subsections using Google Imagen
3. Maintain visual consistency across all images by using character visual traits
4. Set and manage the art style for the entire book

WORKFLOW:
- When the user first asks for illustrations, propose a visual plan: identify key characters and suggest scenes
- Create characters FIRST with detailed visual traits before generating any scene images
- For each character, generate a reference portrait to establish their look
- Then generate scene illustrations that include those characters consistently
- Always use character visual traits in scene prompts for consistency

ART STYLES available: watercolor, digital_art, pencil_sketch, oil_painting, anime, children_book, realistic

RULES:
- Visual traits MUST be in English (Imagen works best with English prompts)
- Character descriptions can be in the project language
- Scene descriptions for Imagen MUST be in English and highly detailed
- Include lighting, mood, setting, character positions, and actions in scene descriptions
- Always explain what you're doing in the project language before using tools
- NEVER use emoji

TOOLS:
- Use create_character to establish characters before generating scenes
- Use generate_character_portrait to create a reference portrait after creating a character
- Use generate_scene_image to create illustrations. ALWAYS attach to a chapter using its dbId from the book structure below. Use the [dbId: ...] values, not chapter numbers.
- Use set_art_style to set the global style before generating images
- Use regenerate_image if the user wants to change an existing image
- Use generate_book_cover to create a book cover illustration (3:4 vertical ratio)`

  const langNames: Record<string, string> = { en: "English", tr: "Turkish", ar: "Arabic", fa: "Persian", ur: "Urdu", de: "German", fr: "French", es: "Spanish", pt: "Portuguese", it: "Italian", ru: "Russian", zh: "Chinese", ja: "Japanese", ko: "Korean", hi: "Hindi", he: "Hebrew", pl: "Polish", nl: "Dutch", sv: "Swedish", th: "Thai", vi: "Vietnamese", id: "Indonesian", ms: "Malay", bn: "Bengali", sw: "Swahili", uk: "Ukrainian", el: "Greek", cs: "Czech", ro: "Romanian", hu: "Hungarian", da: "Danish", no: "Norwegian", fi: "Finnish" };
  const langName = langNames[project.language ?? "en"] ?? project.language ?? "English";
  const dynamicPart = `Respond in ${langName}.

Project: "${project.title}" (${project.projectType})
${artStyle ? `Current art style: ${artStyle}` : 'No art style set yet — ask the user or suggest one.'}
${characterList}

Book structure:
${chapterList || 'No chapters yet.'}${summarySection}`

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
        writingGuidelines: true,
        chapters: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            number: true,
            title: true,
            sections: {
              orderBy: { sortOrder: 'asc' },
              select: {
                title: true,
                subsections: {
                  orderBy: { sortOrder: 'asc' },
                  select: { id: true, subsectionId: true, title: true },
                },
              },
            },
          },
        },
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

    // Fetch characters
    const characters = await prisma.character.findMany({
      where: { projectId },
      select: { name: true, description: true, visualTraits: true },
      orderBy: { sortOrder: 'asc' },
    })

    // Get art style from project metadata
    const guidelines = project.writingGuidelines as Record<string, unknown> | null
    const artStyle = (guidelines?.artStyle as string) ?? null

    // Compress history — token-based with structured preview prompt
    const characterContext = characters.length > 0
      ? `Characters: ${characters.map(c => `${c.name} (${c.visualTraits ?? 'no traits'})`).join(', ')}`
      : undefined
    const { messages: compressedMessages, summary: conversationSummary } =
      await compressHistory(messages, {
        chatType: 'preview' as ChatType,
        maxTokens: 25000,
        keepRecent: 4,
        reinjectContext: [
          artStyle ? `Art style: ${artStyle}` : null,
          characterContext,
        ].filter(Boolean).join('\n') || undefined,
      })

    const systemPrompt = buildSystemPrompt(project, characters, project.chapters, artStyle, conversationSummary)
    const tools = buildTools()

    // Credit check
    const credits = await checkCredits(session.user.id, 'preview_chat')
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
            (toolName, toolInput) => handleToolCallFn(toolName, toolInput, projectId, artStyle, userId),
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
            'preview_chat',
            result.inputTokens,
            result.outputTokens,
            'haiku',
            { projectId },
            { read: result.cacheReadTokens, creation: result.cacheCreationTokens }
          )

          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ done: true, creditsUsed, balance: newBalance })}\n\n`)
          )

          // Save chat messages
          try {
            await prisma.illustrationChatMessage.createMany({
              data: [
                { projectId, sessionId, role: 'user', content: userContent },
                { projectId, sessionId, role: 'assistant', content: result.fullText },
              ],
            })
          } catch (saveErr) {
            console.error('[preview/chat] Failed to save messages:', saveErr)
          }

          controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        } catch (streamErr) {
          const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr)
          console.error('[preview/chat] Stream error:', errMsg, streamErr)
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'Stream failed', detail: errMsg })}\n\n`))
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
    console.error('[POST /api/projects/[id]/preview/chat]', errMsg, err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: errMsg }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
