"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import {
  BookMarked,
  BookOpen,
  Feather,
  BarChart3,
  TrendingDown,
  Coins,
  Cpu,
  ImageIcon,
  MessageSquare,
  PenTool,
  Palette,
  Layers,
  ArrowLeft,
  Calendar,
  DollarSign,
  Zap,
  FileText,
  Users,
  ShieldCheck,
  ChevronDown,
} from "lucide-react"
import SignOutButton from "@/components/shared/SignOutButton"

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AnalyticsData {
  balance: number
  memberSince: string
  period: { days: number; since: string }
  totals: {
    creditsSpent: number
    inputTokens: number
    outputTokens: number
    operations: number
    estimatedUSD: number
  }
  byOperation: Array<{
    operation: string
    count: number
    credits: number
    inputTokens: number
    outputTokens: number
  }>
  byModel: Array<{
    model: string
    count: number
    credits: number
    inputTokens: number
    outputTokens: number
    estimatedUSD: number
  }>
  byProject: Array<{
    projectId: string
    name: string
    credits: number
    count: number
  }>
  daily: Array<{
    date: string
    credits: number
    operations: number
    inputTokens: number
    outputTokens: number
  }>
  recent: Array<{
    id: string
    type: string
    operation: string | null
    amount: number
    balance: number
    creditsUsed: number | null
    inputTokens: number | null
    outputTokens: number | null
    model: string | null
    createdAt: string
  }>
  viewingUserId: string
  platform: {
    totalUsers: number
    totalCreditsGranted: number
    totalCreditsSpent: number
    users: Array<{
      id: string
      name: string | null
      email: string | null
      creditBalance: number
      projects: number
      transactions: number
      joinedAt: string
    }>
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString()
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

const OPERATION_LABELS: Record<string, { label: string; icon: typeof Cpu }> = {
  write_subsection: { label: "Writing", icon: PenTool },
  write_subsection_alt: { label: "Writing", icon: PenTool },
  roadmap_chat: { label: "Roadmap Chat", icon: MessageSquare },
  roadmap_chat_create_low: { label: "Roadmap Create (Low)", icon: Layers },
  roadmap_chat_create_normal: { label: "Roadmap Create", icon: Layers },
  roadmap_chat_create_high: { label: "Roadmap Create (High)", icon: Layers },
  roadmap_chat_create_no_sources: { label: "Roadmap Create (No Src)", icon: Layers },
  style_analyze: { label: "Style Analyze", icon: Feather },
  style_interview: { label: "Style Interview", icon: Feather },
  preview_chat: { label: "Illustration Chat", icon: ImageIcon },
  design_chat: { label: "Design Chat", icon: Palette },
  generate_image: { label: "Image Generation", icon: ImageIcon },
  generate_portrait: { label: "Portrait Generation", icon: ImageIcon },
  generate_cover: { label: "Cover Generation", icon: ImageIcon },
  regenerate_image: { label: "Image Regeneration", icon: ImageIcon },
  bibliography_enrich: { label: "Bibliography Enrich", icon: FileText },
  source_upload_extract: { label: "Source Extract", icon: FileText },
}

const MODEL_COLORS: Record<string, string> = {
  sonnet: "#C9A84C",
  haiku: "#6b8e6b",
  imagen: "#8b6bb0",
  unknown: "#888",
}

function OrnamentDots() {
  return (
    <div className="flex items-center justify-center gap-2 my-3" aria-hidden="true">
      <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60" />
      <div className="w-2 h-2 rounded-full bg-[#C9A84C]" />
      <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60" />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini bar chart (pure CSS, no chart library)
// ---------------------------------------------------------------------------
function MiniBarChart({ data, maxHeight = 120 }: { data: Array<{ date: string; value: number }>; maxHeight?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const barWidth = Math.max(4, Math.min(12, Math.floor(600 / data.length) - 2))

  return (
    <div className="flex items-end gap-[2px] justify-center" style={{ height: maxHeight }}>
      {data.map((d, i) => {
        const h = Math.max(2, (d.value / max) * maxHeight)
        const isToday = i === data.length - 1
        return (
          <div key={d.date} className="group relative flex flex-col items-center">
            <div
              className="rounded-t-sm transition-all duration-200 group-hover:opacity-80"
              style={{
                width: barWidth,
                height: h,
                backgroundColor: isToday ? "#C9A84C" : "rgba(201,168,76,0.45)",
              }}
            />
            {/* Tooltip */}
            <div className="absolute bottom-full mb-2 hidden group-hover:block z-10">
              <div
                className="px-2 py-1 rounded text-xs whitespace-nowrap font-ui"
                style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}
              >
                {d.date.slice(5)}: {formatNumber(d.value)} credits
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Horizontal bar for breakdowns
// ---------------------------------------------------------------------------
function HorizontalBar({ label, value, maxValue, color, suffix }: { label: string; value: number; maxValue: number; color: string; suffix?: string }) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0
  return (
    <div className="flex items-center gap-3 group">
      <span className="font-ui text-xs w-[140px] truncate" style={{ color: "#6b5a45" }}>
        {label}
      </span>
      <div className="flex-1 h-5 rounded-sm overflow-hidden" style={{ backgroundColor: "rgba(201,168,76,0.10)" }}>
        <div
          className="h-full rounded-sm transition-all duration-500"
          style={{ width: `${Math.max(1, pct)}%`, backgroundColor: color }}
        />
      </div>
      <span className="font-ui text-xs font-medium w-[80px] text-right" style={{ color: "#2D1F0E" }}>
        {formatNumber(value)}{suffix ? ` ${suffix}` : ""}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function AnalyticsPage() {
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [days, setDays] = useState(30)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(days) })
      if (selectedUserId) params.set("userId", selectedUserId)
      const res = await fetch(`/api/analytics?${params}`)
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (res.ok) {
        setData(await res.json())
      }
    } catch (err) {
      console.error("Failed to fetch analytics:", err)
    } finally {
      setLoading(false)
    }
  }, [days, selectedUserId])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (forbidden) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundImage: `url(${TEXTURE_URL})`, backgroundSize: "cover", backgroundColor: "#F5F0E6" }}
      >
        <div className="text-center">
          <ShieldCheck className="h-12 w-12 mx-auto mb-4" style={{ color: "#C9A84C" }} />
          <h1 className="font-display text-2xl font-bold mb-2" style={{ color: "#2D1F0E" }}>Admin Only</h1>
          <p className="font-body text-sm mb-6" style={{ color: "#6b5a45" }}>This page is restricted to administrators.</p>
          <Link href="/" className="font-ui text-sm px-4 py-2 rounded-sm" style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}>
            Back to Home
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
        backgroundColor: "#F5F0E6",
      }}
    >
      {/* Navbar */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{
          backgroundColor: "rgba(26,15,5,0.95)",
          backdropFilter: "blur(12px)",
          borderColor: "rgba(201,168,76,0.20)",
        }}
      >
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <Link href="/">
              <img
                src="/images/quilpen-logo-horizontal.png"
                alt="Quilpen"
                className="h-20"
                style={{ filter: "brightness(0) invert(1)" }}
              />
            </Link>
          </div>
          <div className="flex items-center gap-1">
            <Link
              href="/"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.70)" }}
            >
              <BookMarked className="h-3.5 w-3.5" />
              <span className="hidden sm:block">My Books</span>
            </Link>
            <Link
              href="/library"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.70)" }}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:block">Library</span>
            </Link>
            <Link
              href="/analytics"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,1)" }}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden sm:block">Analytics</span>
            </Link>
            <SignOutButton
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.55)" }}
            />
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-3" aria-hidden="true">
            <div className="h-px flex-1 max-w-[120px]" style={{ background: "linear-gradient(to right, transparent, #C9A84C)" }} />
            <BarChart3 className="h-5 w-5" style={{ color: "#C9A84C" }} />
            <div className="h-px flex-1 max-w-[120px]" style={{ background: "linear-gradient(to left, transparent, #C9A84C)" }} />
          </div>
          <h1 className="font-display text-3xl font-bold mb-1" style={{ color: "#2D1F0E" }}>
            Usage Analytics
          </h1>
          <p className="font-body text-sm" style={{ color: "#6b5a45" }}>
            Credit usage, token consumption, and cost breakdown
          </p>
          <OrnamentDots />
        </div>

        {/* Period selector */}
        <div className="flex justify-center gap-2 mb-8">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className="px-4 py-1.5 rounded-sm text-sm font-ui transition-all duration-150"
              style={{
                backgroundColor: days === d ? "#2D1F0E" : "rgba(45,31,14,0.06)",
                color: days === d ? "#FAF7F0" : "#6b5a45",
              }}
            >
              {d}d
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="flex items-center gap-3" style={{ color: "#6b5a45" }}>
              <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              <span className="font-ui text-sm">Loading analytics...</span>
            </div>
          </div>
        ) : data ? (
          <div className="space-y-8">
            {/* Platform overview (admin sees all users) */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: "rgba(45,31,14,0.04)", border: "1px solid rgba(201,168,76,0.20)" }}
            >
              <div className="flex items-center gap-2 mb-4">
                <Users className="h-4 w-4" style={{ color: "#C9A84C" }} />
                <h2 className="font-display text-lg font-semibold" style={{ color: "#2D1F0E" }}>
                  Platform Overview
                </h2>
              </div>
              <div className="grid grid-cols-3 gap-4 mb-5">
                <div>
                  <p className="font-ui text-xs" style={{ color: "#6b5a45" }}>Total Users</p>
                  <p className="font-display text-xl font-bold" style={{ color: "#2D1F0E" }}>{data.platform.totalUsers}</p>
                </div>
                <div>
                  <p className="font-ui text-xs" style={{ color: "#6b5a45" }}>Credits Granted</p>
                  <p className="font-display text-xl font-bold" style={{ color: "#2D8B4E" }}>{formatNumber(data.platform.totalCreditsGranted)}</p>
                </div>
                <div>
                  <p className="font-ui text-xs" style={{ color: "#6b5a45" }}>Credits Consumed</p>
                  <p className="font-display text-xl font-bold" style={{ color: "#c44" }}>{formatNumber(data.platform.totalCreditsSpent)}</p>
                </div>
              </div>

              {/* User selector */}
              <div className="border-t pt-4" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
                <p className="font-ui text-xs mb-2" style={{ color: "#6b5a45" }}>View analytics for:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedUserId(null)}
                    className="px-3 py-1.5 rounded-sm text-xs font-ui transition-all"
                    style={{
                      backgroundColor: !selectedUserId ? "#2D1F0E" : "rgba(45,31,14,0.06)",
                      color: !selectedUserId ? "#FAF7F0" : "#6b5a45",
                    }}
                  >
                    Myself
                  </button>
                  {data.platform.users.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => setSelectedUserId(u.id)}
                      className="px-3 py-1.5 rounded-sm text-xs font-ui transition-all"
                      style={{
                        backgroundColor: selectedUserId === u.id ? "#2D1F0E" : "rgba(45,31,14,0.06)",
                        color: selectedUserId === u.id ? "#FAF7F0" : "#6b5a45",
                      }}
                    >
                      {u.name ?? u.email ?? u.id.slice(0, 8)}
                      <span className="ml-1 opacity-60">({formatNumber(u.creditBalance)} cr)</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* User table */}
              <div className="border-t mt-4 pt-4 overflow-x-auto" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
                <table className="w-full">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "rgba(201,168,76,0.15)" }}>
                      <th className="text-left font-ui text-[10px] font-medium py-1.5 px-2" style={{ color: "#9a8a72" }}>User</th>
                      <th className="text-right font-ui text-[10px] font-medium py-1.5 px-2" style={{ color: "#9a8a72" }}>Balance</th>
                      <th className="text-right font-ui text-[10px] font-medium py-1.5 px-2" style={{ color: "#9a8a72" }}>Projects</th>
                      <th className="text-right font-ui text-[10px] font-medium py-1.5 px-2" style={{ color: "#9a8a72" }}>Txns</th>
                      <th className="text-right font-ui text-[10px] font-medium py-1.5 px-2" style={{ color: "#9a8a72" }}>Joined</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.platform.users.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b last:border-0 cursor-pointer hover:bg-[#C9A84C]/5 transition-colors"
                        style={{ borderColor: "rgba(201,168,76,0.08)" }}
                        onClick={() => setSelectedUserId(u.id)}
                      >
                        <td className="font-ui text-xs py-1.5 px-2" style={{ color: "#2D1F0E" }}>
                          {u.name ?? u.email?.split("@")[0] ?? "Unknown"}
                          <span className="ml-1 text-[10px]" style={{ color: "#9a8a72" }}>{u.email}</span>
                        </td>
                        <td className="font-ui text-xs py-1.5 px-2 text-right tabular-nums" style={{ color: "#2D1F0E" }}>
                          {formatNumber(u.creditBalance)}
                        </td>
                        <td className="font-ui text-xs py-1.5 px-2 text-right tabular-nums" style={{ color: "#6b5a45" }}>
                          {u.projects}
                        </td>
                        <td className="font-ui text-xs py-1.5 px-2 text-right tabular-nums" style={{ color: "#6b5a45" }}>
                          {u.transactions}
                        </td>
                        <td className="font-ui text-xs py-1.5 px-2 text-right" style={{ color: "#9a8a72" }}>
                          {new Date(u.joinedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Summary cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <SummaryCard
                icon={Coins}
                label="Credits Remaining"
                value={formatNumber(data.balance)}
                sub="current balance"
                color="#C9A84C"
              />
              <SummaryCard
                icon={TrendingDown}
                label="Credits Spent"
                value={formatNumber(data.totals.creditsSpent)}
                sub={`${data.totals.operations} operations`}
                color="#c44"
              />
              <SummaryCard
                icon={DollarSign}
                label="Estimated Cost"
                value={`$${data.totals.estimatedUSD.toFixed(2)}`}
                sub={`last ${days} days`}
                color="#2D8B4E"
              />
              <SummaryCard
                icon={Zap}
                label="Tokens Used"
                value={formatTokens(data.totals.inputTokens + data.totals.outputTokens)}
                sub={`${formatTokens(data.totals.inputTokens)} in / ${formatTokens(data.totals.outputTokens)} out`}
                color="#5c7cfa"
              />
            </div>

            {/* Daily usage chart */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
            >
              <h2 className="font-display text-lg font-semibold mb-1" style={{ color: "#2D1F0E" }}>
                Daily Credit Usage
              </h2>
              <p className="font-body text-xs mb-4" style={{ color: "#6b5a45" }}>
                Credits consumed per day over the last {days} days
              </p>
              {data.daily.length > 0 ? (
                <MiniBarChart data={data.daily.map((d) => ({ date: d.date, value: d.credits }))} maxHeight={140} />
              ) : (
                <p className="text-center py-8 font-ui text-sm" style={{ color: "#9a8a72" }}>No data yet</p>
              )}
              {/* X-axis labels */}
              <div className="flex justify-between mt-2 px-1">
                <span className="font-ui text-[10px]" style={{ color: "#9a8a72" }}>
                  {data.daily[0]?.date.slice(5) ?? ""}
                </span>
                <span className="font-ui text-[10px]" style={{ color: "#9a8a72" }}>
                  {data.daily[Math.floor(data.daily.length / 2)]?.date.slice(5) ?? ""}
                </span>
                <span className="font-ui text-[10px]" style={{ color: "#9a8a72" }}>
                  {data.daily[data.daily.length - 1]?.date.slice(5) ?? ""}
                </span>
              </div>
            </div>

            {/* Two-column layout */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* By Operation */}
              <div
                className="rounded-lg p-6"
                style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
              >
                <h2 className="font-display text-lg font-semibold mb-4" style={{ color: "#2D1F0E" }}>
                  By Operation
                </h2>
                <div className="space-y-2.5">
                  {data.byOperation.length > 0 ? (
                    data.byOperation.map((op) => {
                      const info = OPERATION_LABELS[op.operation] ?? { label: op.operation, icon: Cpu }
                      return (
                        <HorizontalBar
                          key={op.operation}
                          label={`${info.label} (${op.count}x)`}
                          value={op.credits}
                          maxValue={data.byOperation[0].credits}
                          color="#C9A84C"
                          suffix="cr"
                        />
                      )
                    })
                  ) : (
                    <p className="font-ui text-sm" style={{ color: "#9a8a72" }}>No operations yet</p>
                  )}
                </div>
              </div>

              {/* By Model */}
              <div
                className="rounded-lg p-6"
                style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
              >
                <h2 className="font-display text-lg font-semibold mb-4" style={{ color: "#2D1F0E" }}>
                  By Model
                </h2>
                <div className="space-y-4">
                  {data.byModel.map((m) => (
                    <div key={m.model} className="space-y-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: MODEL_COLORS[m.model] ?? "#888" }} />
                          <span className="font-ui text-sm font-medium capitalize" style={{ color: "#2D1F0E" }}>
                            {m.model}
                          </span>
                        </div>
                        <span className="font-ui text-xs" style={{ color: "#6b5a45" }}>
                          ${m.estimatedUSD.toFixed(2)} USD
                        </span>
                      </div>
                      <HorizontalBar
                        label={`${m.count} calls`}
                        value={m.credits}
                        maxValue={data.byModel[0]?.credits ?? 1}
                        color={MODEL_COLORS[m.model] ?? "#888"}
                        suffix="cr"
                      />
                      <div className="flex gap-4 pl-[152px]">
                        <span className="font-ui text-[10px]" style={{ color: "#9a8a72" }}>
                          {formatTokens(m.inputTokens)} input
                        </span>
                        <span className="font-ui text-[10px]" style={{ color: "#9a8a72" }}>
                          {formatTokens(m.outputTokens)} output
                        </span>
                      </div>
                    </div>
                  ))}
                  {data.byModel.length === 0 && (
                    <p className="font-ui text-sm" style={{ color: "#9a8a72" }}>No data yet</p>
                  )}
                </div>
              </div>
            </div>

            {/* By Project */}
            {data.byProject.length > 0 && (
              <div
                className="rounded-lg p-6"
                style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
              >
                <h2 className="font-display text-lg font-semibold mb-4" style={{ color: "#2D1F0E" }}>
                  By Project
                </h2>
                <div className="space-y-2.5">
                  {data.byProject.map((p) => (
                    <HorizontalBar
                      key={p.projectId}
                      label={`${p.name} (${p.count}x)`}
                      value={p.credits}
                      maxValue={data.byProject[0].credits}
                      color="#C9A84C"
                      suffix="cr"
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Recent transactions */}
            <div
              className="rounded-lg p-6"
              style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
            >
              <h2 className="font-display text-lg font-semibold mb-4" style={{ color: "#2D1F0E" }}>
                Recent Transactions
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b" style={{ borderColor: "rgba(201,168,76,0.20)" }}>
                      <th className="text-left font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Date</th>
                      <th className="text-left font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Operation</th>
                      <th className="text-left font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Model</th>
                      <th className="text-right font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Tokens</th>
                      <th className="text-right font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Credits</th>
                      <th className="text-right font-ui text-xs font-medium py-2 px-2" style={{ color: "#6b5a45" }}>Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent.map((t) => {
                      const info = OPERATION_LABELS[t.operation ?? ""] ?? { label: t.operation ?? t.type }
                      const isGrant = t.amount > 0
                      return (
                        <tr
                          key={t.id}
                          className="border-b last:border-0 hover:bg-[#C9A84C]/5 transition-colors"
                          style={{ borderColor: "rgba(201,168,76,0.10)" }}
                        >
                          <td className="font-ui text-xs py-2 px-2" style={{ color: "#6b5a45" }}>
                            {new Date(t.createdAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                            {" "}
                            <span style={{ color: "#9a8a72" }}>
                              {new Date(t.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </td>
                          <td className="font-ui text-xs py-2 px-2" style={{ color: "#2D1F0E" }}>
                            {info.label}
                          </td>
                          <td className="font-ui text-xs py-2 px-2 capitalize" style={{ color: "#6b5a45" }}>
                            {t.model ?? "-"}
                          </td>
                          <td className="font-ui text-xs py-2 px-2 text-right tabular-nums" style={{ color: "#6b5a45" }}>
                            {t.inputTokens || t.outputTokens
                              ? `${formatTokens(t.inputTokens ?? 0)} / ${formatTokens(t.outputTokens ?? 0)}`
                              : "-"}
                          </td>
                          <td
                            className="font-ui text-xs font-medium py-2 px-2 text-right tabular-nums"
                            style={{ color: isGrant ? "#2D8B4E" : "#c44" }}
                          >
                            {isGrant ? "+" : "-"}{Math.abs(t.creditsUsed ?? t.amount)}
                          </td>
                          <td className="font-ui text-xs py-2 px-2 text-right tabular-nums" style={{ color: "#2D1F0E" }}>
                            {formatNumber(t.balance)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {data.recent.length === 0 && (
                  <p className="text-center py-6 font-ui text-sm" style={{ color: "#9a8a72" }}>No transactions yet</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-20">
            <p className="font-ui text-sm" style={{ color: "#9a8a72" }}>Failed to load analytics data.</p>
          </div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary Card
// ---------------------------------------------------------------------------
function SummaryCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: typeof Coins
  label: string
  value: string
  sub: string
  color: string
}) {
  return (
    <div
      className="rounded-lg p-5"
      style={{ backgroundColor: "rgba(250,247,240,0.85)", border: "1px solid rgba(201,168,76,0.15)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div className="p-1.5 rounded-sm" style={{ backgroundColor: `${color}15` }}>
          <Icon className="h-4 w-4" style={{ color }} />
        </div>
        <span className="font-ui text-xs" style={{ color: "#6b5a45" }}>
          {label}
        </span>
      </div>
      <p className="font-display text-2xl font-bold" style={{ color: "#2D1F0E" }}>
        {value}
      </p>
      <p className="font-ui text-[11px] mt-0.5" style={{ color: "#9a8a72" }}>
        {sub}
      </p>
    </div>
  )
}
