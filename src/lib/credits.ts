import { prisma } from '@/lib/db'

// Output tokens are 5x more expensive than input tokens ($15/M vs $3/M)
export function tokensToCredits(inputTokens: number, outputTokens: number): number {
  return Math.ceil((inputTokens + outputTokens * 5) / 1000)
}

export const ESTIMATED_COSTS: Record<string, number> = {
  write_subsection: 12,
  write_subsection_alt: 12,
  roadmap_generate: 15,
  roadmap_chat: 6,
  style_analyze: 2,
  style_interview: 2,
  bibliography_enrich: 2,
  source_upload_extract: 2,
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
  const estimatedCost = ESTIMATED_COSTS[operation] ?? 5

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
  metadata?: Record<string, unknown>
): Promise<{ newBalance: number; creditsUsed: number }> {
  const creditsUsed = tokensToCredits(inputTokens, outputTokens)

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
