import { GoogleGenAI } from '@google/genai'
import { createClaudeClient, HAIKU } from '@/lib/claude'

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

/**
 * Sanitize a prompt so it passes Imagen's safety filter while preserving
 * the artistic intent as closely as possible.
 */
async function sanitizePromptForImagen(prompt: string): Promise<string> {
  const claude = createClaudeClient()
  const response = await claude.messages.create({
    model: HAIKU,
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
    system: [
      'You are an image prompt rewriter. Your job is to take an illustration prompt and rewrite it so it will pass Google Imagen safety filter, while keeping the scene as close to the original as possible.',
      '',
      'RULES:',
      '- Remove or replace: nudity, nakedness, explicit body descriptions, sexual/sensual language, violence, gore',
      '- Replace naked/nude with clothed alternatives (e.g. wearing a loose shirt, draped in elegant clothing)',
      '- Replace sensual/erotic/intimate with elegant/romantic/tender',
      '- Replace explicit body descriptions with tasteful alternatives (e.g. muscular torso to athletic build)',
      '- Keep: setting, lighting, mood (softened), character positions, clothing style, colors, composition',
      '- Keep: character visual traits (face, hair, eyes, expression) - these are safe',
      '- The rewritten prompt must still be in English',
      '- Output ONLY the rewritten prompt, nothing else - no explanation, no prefix',
    ].join('\n'),
  })

  const text = response.content[0]
  if (text.type === 'text') return text.text.trim()
  return prompt
}

export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9'

export interface GenerateImageOptions {
  prompt: string
  aspectRatio?: AspectRatio
  numberOfImages?: number
}

export interface GeneratedImage {
  imageData: Uint8Array
  mimeType: string
}

/**
 * Generate images using Google Imagen 4
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage[]> {
  const { prompt, aspectRatio = '4:3', numberOfImages = 1 } = options

  const safePrompt = await sanitizePromptForImagen(prompt)

  let response
  try {
    response = await genai.models.generateImages({
      model: 'imagen-4.0-generate-001',
      prompt: safePrompt,
      config: {
        numberOfImages,
        aspectRatio,
      },
    })
  } catch (apiErr: unknown) {
    const errMsg = apiErr instanceof Error ? apiErr.message : String(apiErr)
    if (errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota')) {
      console.error('[imagen] Quota exceeded:', errMsg)
      throw new Error('Image generation is temporarily unavailable due to high demand. Please try again later.')
    }
    throw apiErr
  }

  if (!response.generatedImages || response.generatedImages.length === 0) {
    // Surface filter / safety reasons only when the request was blocked.
    if ((response as { filters?: unknown }).filters) {
      console.error('[imagen] Filters:', JSON.stringify((response as { filters: unknown }).filters))
    }
    if ((response as { safetyAttributes?: unknown }).safetyAttributes) {
      console.error('[imagen] Safety:', JSON.stringify((response as { safetyAttributes: unknown }).safetyAttributes))
    }
  }

  if (!response.generatedImages || response.generatedImages.length === 0) {
    console.error('[imagen] BLOCKED — no images returned for prompt:', prompt.slice(0, 200))
    throw new Error('No images generated')
  }

  return response.generatedImages.map((img) => ({
    imageData: Uint8Array.from(Buffer.from(img.image!.imageBytes as string, 'base64')),
    mimeType: img.image!.mimeType ?? 'image/png',
  }))
}

/**
 * Build a consistent Imagen prompt with character traits and art style
 */
export function buildImagePrompt(
  sceneDescription: string,
  characterTraits: string[],
  artStyle?: string
): string {
  const parts: string[] = []

  if (artStyle) {
    parts.push(`Art style: ${artStyle}.`)
  }

  if (characterTraits.length > 0) {
    parts.push(`Characters: ${characterTraits.join('; ')}.`)
  }

  parts.push(sceneDescription)
  parts.push('High quality illustration, detailed, professional book illustration.')

  return parts.join(' ')
}
