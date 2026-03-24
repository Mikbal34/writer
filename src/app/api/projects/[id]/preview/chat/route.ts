import { NextRequest } from 'next/server'
import { requireAuth, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { streamChatWithTools, HAIKU, type ChatMessage, type SystemPromptPart, type ToolDefinition } from '@/lib/claude'
import { compressHistory } from '@/lib/conversation'
import { checkCredits, deductCredits } from '@/lib/credits'
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
      description: 'Generate an illustration for a specific chapter or subsection. The image will use character visual traits for consistency.',
      input_schema: {
        type: 'object' as const,
        properties: {
          sceneDescription: { type: 'string', description: 'Detailed scene description for image generation (English). Include setting, lighting, mood, character actions.' },
          chapterId: { type: 'string', description: 'Chapter database ID to attach the image to (optional)' },
          subsectionId: { type: 'string', description: 'Subsection database ID to attach the image to (optional)' },
          characterNames: { type: 'array', items: { type: 'string' }, description: 'Names of characters appearing in this scene' },
          aspectRatio: { type: 'string', enum: ['1:1', '3:4', '4:3', '16:9'], description: 'Image aspect ratio (default: 4:3)' },
        },
        required: ['sceneDescription'],
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
  ]
}

// ---------------------------------------------------------------------------
// Tool call handler
// ---------------------------------------------------------------------------
async function handleToolCallFn(
  toolName: string,
  toolInput: Record<string, unknown>,
  projectId: string,
  artStyle: string | null
): Promise<string> {
  if (toolName === 'create_character') {
    const { name, description, visualTraits } = toolInput as { name: string; description: string; visualTraits: string }
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

    const prompt = buildImagePrompt(sceneDescription, characterTraits, artStyle ?? undefined)
    const [generated] = await generateImage({
      prompt,
      aspectRatio: (aspectRatio as '4:3') ?? '4:3',
      numberOfImages: 1,
    })

    const count = await prisma.projectImage.count({ where: { projectId } })
    const image = await prisma.projectImage.create({
      data: {
        projectId,
        chapterId: chapterId ?? null,
        subsectionId: subsectionId ?? null,
        imageData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer>,
        prompt,
        style: artStyle,
        aspectRatio: aspectRatio ?? '4:3',
        sortOrder: count,
      },
    })

    return JSON.stringify({
      success: true,
      imageId: image.id,
      url: `/api/projects/${projectId}/preview/images/${image.id}`,
    })
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

    const prompt = buildImagePrompt(newSceneDescription, characterTraits, artStyle ?? undefined)
    const [generated] = await generateImage({ prompt, numberOfImages: 1 })

    await prisma.projectImage.update({
      where: { id: imageId },
      data: { imageData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer>, prompt, style: artStyle },
    })

    return JSON.stringify({
      success: true,
      imageId,
      url: `/api/projects/${projectId}/preview/images/${imageId}`,
    })
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
    if (!character) return JSON.stringify({ error: 'Character not found' })

    const prompt = `Character portrait: ${character.visualTraits ?? character.name}. ${artStyle ? `Art style: ${artStyle}.` : ''} Bust portrait, centered, detailed face, book illustration quality.`
    const [generated] = await generateImage({ prompt, aspectRatio: '1:1', numberOfImages: 1 })

    await prisma.character.update({
      where: { id: characterId },
      data: { referenceData: new Uint8Array(generated.imageData.buffer) as Uint8Array<ArrayBuffer> },
    })

    return JSON.stringify({ success: true, characterId })
  }

  return JSON.stringify({ error: `Unknown tool: ${toolName}` })
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(
  project: { title: string; language: string | null; projectType: string },
  characters: Array<{ name: string; description: string | null; visualTraits: string | null }>,
  chapters: Array<{ number: number; title: string; sections: Array<{ title: string; subsections: Array<{ subsectionId: string; title: string }> }> }>,
  artStyle: string | null,
  conversationSummary: string | null
): SystemPromptPart[] {
  const characterList = characters.length > 0
    ? `\n\nExisting characters:\n${characters.map((c) => `- ${c.name}: ${c.description ?? 'No description'} [Visual: ${c.visualTraits ?? 'Not set'}]`).join('\n')}`
    : '\n\nNo characters created yet.'

  const chapterList = chapters.map((ch) =>
    `Ch ${ch.number}: ${ch.title}\n${ch.sections.map((s) => `  ${s.title}\n${s.subsections.map((sub) => `    ${sub.subsectionId} ${sub.title}`).join('\n')}`).join('\n')}`
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
- Use generate_scene_image to create illustrations (attach to chapters via chapterId)
- Use set_art_style to set the global style before generating images
- Use regenerate_image if the user wants to change an existing image`

  const dynamicPart = `Respond in ${project.language === 'tr' ? 'Turkish' : project.language === 'en' ? 'English' : project.language ?? 'English'}.

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
    const { id: projectId } = await ctx.params

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: session.user.id },
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

    // Compress history
    const { messages: compressedMessages, summary: conversationSummary } =
      await compressHistory(messages)

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
            (toolName, toolInput) => handleToolCallFn(toolName, toolInput, projectId, artStyle),
            (chunk) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ chunk })}\n\n`))
            },
            (toolName) => {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ step: 'thinking', tool: toolName })}\n\n`))
            },
            { model: HAIKU }
          )

          const { newBalance, creditsUsed } = await deductCredits(
            session.user.id,
            'preview_chat',
            result.inputTokens,
            result.outputTokens,
            'haiku',
            { projectId }
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
