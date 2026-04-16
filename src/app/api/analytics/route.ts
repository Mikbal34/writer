import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, AdminAuthError } from '@/lib/admin-auth'
import { prisma } from '@/lib/db'

// Real USD costs per million tokens
const USD_PER_MILLION: Record<string, { input: number; output: number }> = {
  sonnet: { input: 3.0, output: 15.0 },
  haiku: { input: 0.25, output: 1.25 },
  imagen: { input: 0, output: 0 }, // flat cost per image
}
const IMAGE_USD_COST = 0.03 // ~$0.03 per image generation

export async function GET(req: NextRequest) {
  try {
    await requireAdmin()

    const url = new URL(req.url)
    const targetUserId = url.searchParams.get('userId')
    const days = parseInt(url.searchParams.get('days') ?? '30', 10)

    const since = new Date()
    since.setDate(since.getDate() - days)

    // Fetch transactions — scoped to target user, or platform-wide
    const transactions = await prisma.creditTransaction.findMany({
      where: {
        createdAt: { gte: since },
        ...(targetUserId ? { userId: targetUserId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    })

    // Balance + memberSince (per-user view) or aggregate (platform view)
    let balance = 0
    let memberSince: Date | null = null
    if (targetUserId) {
      const user = await prisma.user.findUnique({
        where: { id: targetUserId },
        select: { creditBalance: true, createdAt: true },
      })
      balance = user?.creditBalance ?? 0
      memberSince = user?.createdAt ?? null
    } else {
      const agg = await prisma.user.aggregate({ _sum: { creditBalance: true } })
      balance = agg._sum.creditBalance ?? 0
    }

    // --- Aggregations ---

    const aiOps = transactions.filter((t) => t.type === 'ai_operation')
    const totalCreditsSpent = aiOps.reduce((sum, t) => sum + (t.creditsUsed ?? 0), 0)
    const totalInputTokens = aiOps.reduce((sum, t) => sum + (t.inputTokens ?? 0), 0)
    const totalOutputTokens = aiOps.reduce((sum, t) => sum + (t.outputTokens ?? 0), 0)

    const byOperation: Record<string, { count: number; credits: number; inputTokens: number; outputTokens: number }> = {}
    for (const t of aiOps) {
      const op = t.operation ?? 'unknown'
      if (!byOperation[op]) byOperation[op] = { count: 0, credits: 0, inputTokens: 0, outputTokens: 0 }
      byOperation[op].count++
      byOperation[op].credits += t.creditsUsed ?? 0
      byOperation[op].inputTokens += t.inputTokens ?? 0
      byOperation[op].outputTokens += t.outputTokens ?? 0
    }

    const byModel: Record<string, { count: number; credits: number; inputTokens: number; outputTokens: number; estimatedUSD: number }> = {}
    for (const t of aiOps) {
      const model = t.model ?? 'unknown'
      if (!byModel[model]) byModel[model] = { count: 0, credits: 0, inputTokens: 0, outputTokens: 0, estimatedUSD: 0 }
      byModel[model].count++
      byModel[model].credits += t.creditsUsed ?? 0
      byModel[model].inputTokens += t.inputTokens ?? 0
      byModel[model].outputTokens += t.outputTokens ?? 0

      if (model === 'imagen') {
        byModel[model].estimatedUSD += IMAGE_USD_COST
      } else {
        const rates = USD_PER_MILLION[model]
        if (rates) {
          byModel[model].estimatedUSD +=
            ((t.inputTokens ?? 0) / 1_000_000) * rates.input +
            ((t.outputTokens ?? 0) / 1_000_000) * rates.output
        }
      }
    }

    const totalEstimatedUSD = Object.values(byModel).reduce((sum, m) => sum + m.estimatedUSD, 0)

    // Daily usage
    const dailyMap: Record<string, { credits: number; operations: number; inputTokens: number; outputTokens: number }> = {}
    for (const t of aiOps) {
      const day = t.createdAt.toISOString().slice(0, 10)
      if (!dailyMap[day]) dailyMap[day] = { credits: 0, operations: 0, inputTokens: 0, outputTokens: 0 }
      dailyMap[day].credits += t.creditsUsed ?? 0
      dailyMap[day].operations++
      dailyMap[day].inputTokens += t.inputTokens ?? 0
      dailyMap[day].outputTokens += t.outputTokens ?? 0
    }

    const daily: Array<{ date: string; credits: number; operations: number; inputTokens: number; outputTokens: number }> = []
    const cursor = new Date(since)
    const today = new Date()
    while (cursor <= today) {
      const day = cursor.toISOString().slice(0, 10)
      daily.push({
        date: day,
        ...(dailyMap[day] ?? { credits: 0, operations: 0, inputTokens: 0, outputTokens: 0 }),
      })
      cursor.setDate(cursor.getDate() + 1)
    }

    // Per-project breakdown
    const byProject: Record<string, { name: string; credits: number; count: number }> = {}
    for (const t of aiOps) {
      const meta = t.metadata as Record<string, unknown> | null
      const projectId = meta?.projectId as string | undefined
      if (projectId) {
        if (!byProject[projectId]) byProject[projectId] = { name: projectId, credits: 0, count: 0 }
        byProject[projectId].credits += t.creditsUsed ?? 0
        byProject[projectId].count++
      }
    }

    const projectIds = Object.keys(byProject)
    if (projectIds.length > 0) {
      const projects = await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, title: true },
      })
      for (const p of projects) {
        if (byProject[p.id]) byProject[p.id].name = p.title
      }
    }

    const recent = transactions.slice(-50).reverse()

    const allUsers = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        creditBalance: true,
        createdAt: true,
        _count: { select: { projects: true } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // Per-user transaction counts within the selected period
    const periodTxGroups = await prisma.creditTransaction.groupBy({
      by: ['userId'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
    })
    const periodTxByUser = new Map(periodTxGroups.map((g) => [g.userId, g._count._all]))

    // Platform totals for the selected period
    const platformPeriodGranted = await prisma.creditTransaction.aggregate({
      where: { amount: { gt: 0 }, createdAt: { gte: since } },
      _sum: { amount: true },
    })
    const platformPeriodSpent = await prisma.creditTransaction.aggregate({
      where: { type: 'ai_operation', createdAt: { gte: since } },
      _sum: { creditsUsed: true },
    })

    return NextResponse.json({
      balance,
      memberSince,
      viewingUserId: targetUserId,
      period: { days, since: since.toISOString() },
      totals: {
        creditsSpent: totalCreditsSpent,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        operations: aiOps.length,
        estimatedUSD: Math.round(totalEstimatedUSD * 100) / 100,
      },
      byOperation: Object.entries(byOperation)
        .map(([op, data]) => ({ operation: op, ...data }))
        .sort((a, b) => b.credits - a.credits),
      byModel: Object.entries(byModel)
        .map(([model, data]) => ({ model, ...data, estimatedUSD: Math.round(data.estimatedUSD * 100) / 100 }))
        .sort((a, b) => b.credits - a.credits),
      byProject: Object.entries(byProject)
        .map(([id, data]) => ({ projectId: id, ...data }))
        .sort((a, b) => b.credits - a.credits),
      daily,
      recent: recent.map((t) => ({
        id: t.id,
        type: t.type,
        operation: t.operation,
        amount: t.amount,
        balance: t.balance,
        creditsUsed: t.creditsUsed,
        inputTokens: t.inputTokens,
        outputTokens: t.outputTokens,
        model: t.model,
        createdAt: t.createdAt,
      })),
      platform: {
        totalUsers: allUsers.length,
        totalCreditsGranted: platformPeriodGranted._sum.amount ?? 0,
        totalCreditsSpent: platformPeriodSpent._sum.creditsUsed ?? 0,
        users: allUsers.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          creditBalance: u.creditBalance,
          projects: u._count.projects,
          transactions: periodTxByUser.get(u.id) ?? 0,
          joinedAt: u.createdAt,
        })),
      },
    })
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    console.error('[GET /api/analytics]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
