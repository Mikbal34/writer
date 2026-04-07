import { prisma } from '@/lib/db'

// Model cost multipliers relative to Haiku input ($0.25/M = 1x base)
export const MODEL_MULTIPLIERS = {
  sonnet: { input: 12, output: 60 },  // $3/M input, $15/M output
  haiku:  { input: 1,  output: 5 },   // $0.25/M input, $1.25/M output
} as const

export type ModelType = keyof typeof MODEL_MULTIPLIERS

// 1 credit = 1000 weighted tokens (at Haiku input rate)
export function tokensToCredits(
  inputTokens: number,
  outputTokens: number,
  model: ModelType = 'sonnet'
): number {
  const m = MODEL_MULTIPLIERS[model]
  return Math.ceil((inputTokens * m.input + outputTokens * m.output) / 1000)
}

// Estimated costs for pre-checks (based on real API test results)
export const ESTIMATED_COSTS: Record<string, number> = {
  write_subsection: 300,
  write_subsection_alt: 300,
  roadmap_generate: 400,
  roadmap_chat: 200,
  roadmap_chat_create_low: 600,
  roadmap_chat_create_normal: 1000,
  roadmap_chat_create_high: 1400,
  roadmap_chat_create_no_sources: 400,
  style_analyze: 5,
  style_interview: 5,
  bibliography_enrich: 3,
  source_upload_extract: 5,
  preview_chat: 10,
  design_chat: 10,
  generate_image: 150,
  generate_portrait: 150,
  generate_cover: 150,
  regenerate_image: 150,
  research_ai_search: 5,
}

export const IMAGE_CREDIT_COST = 150

export async function checkImageCredits(
  userId: string
): Promise<{ allowed: boolean; balance: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  })
  const balance = user?.creditBalance ?? 0
  return { allowed: balance >= IMAGE_CREDIT_COST, balance }
}

export async function deductImageCredits(
  userId: string,
  operation: string,
  metadata?: Record<string, unknown>
): Promise<{ newBalance: number; creditsUsed: number }> {
  const creditsUsed = IMAGE_CREDIT_COST

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })

    const currentBalance = user?.creditBalance ?? 0
    if (currentBalance < creditsUsed) {
      throw new InsufficientCreditsError(currentBalance, creditsUsed)
    }

    const newBalance = currentBalance - creditsUsed

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    })

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -creditsUsed,
        balance: newBalance,
        type: 'ai_operation',
        operation,
        inputTokens: 0,
        outputTokens: 0,
        creditsUsed,
        model: 'imagen',
        metadata: metadata as object ?? undefined,
      },
    })

    return { newBalance, creditsUsed }
  })

  return result
}

export class InsufficientCreditsError extends Error {
  balance: number
  estimatedCost: number

  constructor(balance: number, estimatedCost: number) {
    super(`Insufficient credits: balance=${balance}, cost=${estimatedCost}`)
    this.name = 'InsufficientCreditsError'
    this.balance = balance
    this.estimatedCost = estimatedCost
  }
}

export async function checkCredits(
  userId: string,
  operation: string
): Promise<{ allowed: boolean; balance: number; estimatedCost: number }> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  })

  const balance = user?.creditBalance ?? 0
  const estimatedCost = ESTIMATED_COSTS[operation] ?? 50

  return {
    allowed: balance >= estimatedCost,
    balance,
    estimatedCost,
  }
}

export async function deductCredits(
  userId: string,
  operation: string,
  inputTokens: number,
  outputTokens: number,
  model?: ModelType,
  metadata?: Record<string, unknown>
): Promise<{ newBalance: number; creditsUsed: number }> {
  const creditsUsed = tokensToCredits(inputTokens, outputTokens, model)

  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })

    const currentBalance = user?.creditBalance ?? 0
    const newBalance = Math.max(0, currentBalance - creditsUsed)

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    })

    await tx.creditTransaction.create({
      data: {
        userId,
        amount: -creditsUsed,
        balance: newBalance,
        type: 'ai_operation',
        operation,
        inputTokens,
        outputTokens,
        creditsUsed,
        model: model ?? null,
        metadata: metadata as object ?? undefined,
      },
    })

    return { newBalance, creditsUsed }
  })

  return result
}

export async function grantCredits(
  userId: string,
  amount: number,
  type: 'initial_grant' | 'admin_grant' | 'purchase' | 'refund',
  metadata?: Record<string, unknown>
): Promise<{ newBalance: number }> {
  const result = await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { creditBalance: true },
    })

    const currentBalance = user?.creditBalance ?? 0
    const newBalance = currentBalance + amount

    await tx.user.update({
      where: { id: userId },
      data: { creditBalance: newBalance },
    })

    await tx.creditTransaction.create({
      data: {
        userId,
        amount,
        balance: newBalance,
        type,
        metadata: metadata as object ?? undefined,
      },
    })

    return { newBalance }
  })

  return result
}

export async function getBalance(userId: string): Promise<number> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { creditBalance: true },
  })
  return user?.creditBalance ?? 0
}
