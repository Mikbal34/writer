import { GoogleGenAI } from '@google/genai'

const genai = new GoogleGenAI({ apiKey: process.env.GOOGLE_AI_API_KEY! })

export type AspectRatio = '1:1' | '3:4' | '4:3' | '9:16' | '16:9'

export interface GenerateImageOptions {
  prompt: string
  aspectRatio?: AspectRatio
  numberOfImages?: number
}

export interface GeneratedImage {
  imageData: Buffer
  mimeType: string
}

/**
 * Generate images using Google Imagen 4
 */
export async function generateImage(options: GenerateImageOptions): Promise<GeneratedImage[]> {
  const { prompt, aspectRatio = '4:3', numberOfImages = 1 } = options

  const response = await genai.models.generateImages({
    model: 'imagen-4.0-generate-001',
    prompt,
    config: {
      numberOfImages,
      aspectRatio,
    },
  })

  if (!response.generatedImages || response.generatedImages.length === 0) {
    throw new Error('No images generated')
  }

  return response.generatedImages.map((img) => ({
    imageData: Buffer.from(img.image!.imageBytes as string, 'base64'),
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
