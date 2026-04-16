"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  BarChart3,
  DollarSign,
  Users,
  FolderOpen,
  Clock,
  ArrowLeft,
  LogOut,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  AlertTriangle,
} from "lucide-react"

const LOW_BALANCE_THRESHOLD = 50

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface AnalyticsData {
  balance: number
  memberSince: string | null
  viewingUserId: string | null
  period: { days: number; since: string }
  totals: {
    creditsSpent: number
    inputTokens: number
    outputTokens: number
    operations: number
    estimatedUSD: number
    creditsGranted: number
    creditsPurchased: number
    creditsRefunded: number
  }
  byOperation: Array<{ operation: string; count: number; credits: number; inputTokens: number; outputTokens: number }>
  byModel: Array<{ model: string; count: number; credits: number; inputTokens: number; outputTokens: number; estimatedUSD: number }>
  byProject: Array<{ projectId: string; name: string; credits: number; count: number }>
  daily: Array<{ date: string; credits: number; operations: number; inputTokens: number; outputTokens: number }>
  recent: Array<{
    id: string; type: string; operation: string | null; amount: number; balance: number
    creditsUsed: number | null; inputTokens: number | null; outputTokens: number | null
    model: string | null; createdAt: string
  }>
  platform: {
    totalUsers: number
    totalCreditsGranted: number
    totalCreditsPurchased: number
    totalCreditsRefunded: number
    totalCreditsSpent: number
    users: Array<{
      id: string; name: string | null; email: string | null
      creditBalance: number; projects: number; transactions: number; joinedAt: string
    }>
  }
}

type Tab = "genel" | "kullanicilar" | "islemler" | "harcama"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toLocaleString("tr-TR")
}

function fmtToken(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M"
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K"
  return n.toString()
}

function downloadCsv(filename: string, rows: Array<Array<string | number | null | undefined>>) {
  const escape = (v: string | number | null | undefined): string => {
    const s = v == null ? "" : String(v)
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
    return s
  }
  const csv = rows.map((r) => r.map(escape).join(",")).join("\n")
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const OP_LABELS: Record<string, string> = {
  write_subsection: "Yazim",
  write_subsection_alt: "Yazim",
  roadmap_chat: "Yol Haritasi Chat",
  roadmap_chat_create_low: "Yol Haritasi Olusturma (Az)",
  roadmap_chat_create_normal: "Yol Haritasi Olusturma",
  roadmap_chat_create_high: "Yol Haritasi Olusturma (Cok)",
  roadmap_chat_create_no_sources: "Yol Haritasi (Kaynaksiz)",
  style_analyze: "Stil Analizi",
  style_interview: "Stil Mulakati",
  preview_chat: "Illustrasyon Chat",
  design_chat: "Tasarim Chat",
  generate_image: "Gorsel Uretimi",
  generate_portrait: "Portre Uretimi",
  generate_cover: "Kapak Uretimi",
  regenerate_image: "Gorsel Yenileme",
  bibliography_enrich: "Kaynak Zenginlestirme",
  source_upload_extract: "Kaynak Cikarma",
}

const MODEL_COLORS: Record<string, string> = {
  sonnet: "#C9A84C",
  haiku: "#6b8e6b",
  imagen: "#8b6bb0",
  unknown: "#888",
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------
function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0
  return (
    <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${color}18` }}>
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(1, pct)}%`, backgroundColor: color }} />
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-lg p-4" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
      <p className="font-ui text-[11px] mb-1" style={{ color: "#8a7a65" }}>{label}</p>
      <p className="font-display text-2xl font-bold tabular-nums" style={{ color }}>{value}</p>
      <p className="font-ui text-[10px] mt-0.5" style={{ color: "#a89a82" }}>{sub}</p>
    </div>
  )
}

function MiniChart({ data, height = 100 }: { data: Array<{ date: string; value: number }>; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const w = Math.max(3, Math.min(10, Math.floor(500 / data.length) - 1))
  return (
    <div className="flex items-end gap-px justify-center" style={{ height }}>
      {data.map((d, i) => {
        const h = Math.max(1, (d.value / max) * height)
        return (
          <div key={d.date} className="group relative">
            <div
              className="rounded-t-sm transition-all hover:opacity-70"
              style={{ width: w, height: h, backgroundColor: i === data.length - 1 ? "#C9A84C" : "#C9A84C60" }}
            />
            <div className="absolute bottom-full mb-1.5 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 pointer-events-none">
              <div className="px-1.5 py-0.5 rounded text-[10px] whitespace-nowrap font-ui" style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}>
                {d.date.slice(5)}: {fmt(d.value)}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
type UserSortKey = "name" | "email" | "creditBalance" | "projects" | "transactions" | "joinedAt"
type SortDir = "asc" | "desc"
const PAGE_SIZE = 50

export default function AdminPanel() {
  const router = useRouter()
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [days, setDays] = useState(30)
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>("genel")

  // Users tab: search + sort + low-balance filter
  const [userSearch, setUserSearch] = useState("")
  const [userSortKey, setUserSortKey] = useState<UserSortKey>("transactions")
  const [userSortDir, setUserSortDir] = useState<SortDir>("desc")
  const [onlyLowBalance, setOnlyLowBalance] = useState(false)

  // Transactions tab: operation filter + pagination
  const [opFilter, setOpFilter] = useState<string>("all")
  const [txPage, setTxPage] = useState(1)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ days: String(days) })
      if (selectedUserId) params.set("userId", selectedUserId)
      const res = await fetch(`/api/analytics?${params}`)
      if (res.status === 401) {
        router.replace("/analytics/login")
        return
      }
      if (res.ok) setData(await res.json())
    } catch (err) {
      console.error("Analytics fetch failed:", err)
    } finally {
      setLoading(false)
    }
  }, [days, selectedUserId, router])

  useEffect(() => { fetchData() }, [fetchData])

  // Reset pagination when underlying dataset changes
  useEffect(() => { setTxPage(1) }, [days, selectedUserId, opFilter])

  // ---- Derived data (users tab) ----
  const filteredSortedUsers = useMemo(() => {
    if (!data) return []
    const q = userSearch.trim().toLowerCase()
    const list = data.platform.users.filter((u) => {
      if (onlyLowBalance && u.creditBalance >= LOW_BALANCE_THRESHOLD) return false
      if (!q) return true
      return (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q)
    })
    const dir = userSortDir === "asc" ? 1 : -1
    const getVal = (u: AnalyticsData["platform"]["users"][number]): string | number => {
      switch (userSortKey) {
        case "name": return (u.name ?? "").toLowerCase()
        case "email": return (u.email ?? "").toLowerCase()
        case "creditBalance": return u.creditBalance
        case "projects": return u.projects
        case "transactions": return u.transactions
        case "joinedAt": return new Date(u.joinedAt).getTime()
      }
    }
    return list.sort((a, b) => {
      const av = getVal(a), bv = getVal(b)
      if (av < bv) return -1 * dir
      if (av > bv) return 1 * dir
      return 0
    })
  }, [data, userSearch, userSortKey, userSortDir, onlyLowBalance])

  const lowBalanceCount = useMemo(() => {
    if (!data) return 0
    return data.platform.users.filter((u) => u.creditBalance < LOW_BALANCE_THRESHOLD).length
  }, [data])

  // ---- Derived data (transactions tab) ----
  const filteredRecent = useMemo(() => {
    if (!data) return []
    if (opFilter === "all") return data.recent
    return data.recent.filter((t) => (t.operation ?? "") === opFilter)
  }, [data, opFilter])

  const availableOps = useMemo(() => {
    if (!data) return [] as string[]
    const set = new Set<string>()
    for (const t of data.recent) if (t.operation) set.add(t.operation)
    return Array.from(set).sort()
  }, [data])

  const txPageCount = Math.max(1, Math.ceil(filteredRecent.length / PAGE_SIZE))
  const currentTxPage = Math.min(txPage, txPageCount)
  const paginatedRecent = filteredRecent.slice((currentTxPage - 1) * PAGE_SIZE, currentTxPage * PAGE_SIZE)

  function exportUsersCsv() {
    const header = ["Kullanici", "E-posta", "Bakiye", "Projeler", `Islem (son ${days}g)`, "Katilim"]
    const rows = filteredSortedUsers.map((u) => [
      u.name ?? "",
      u.email ?? "",
      u.creditBalance,
      u.projects,
      u.transactions,
      new Date(u.joinedAt).toISOString().slice(0, 10),
    ])
    downloadCsv(`kullanicilar-${days}g-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows])
  }

  function exportTransactionsCsv() {
    const header = ["Tarih", "Islem", "Tip", "Model", "Giris Token", "Cikis Token", "Kredi", "Bakiye"]
    const rows = filteredRecent.map((t) => [
      new Date(t.createdAt).toISOString(),
      OP_LABELS[t.operation ?? ""] ?? t.operation ?? "",
      t.type,
      t.model ?? "",
      t.inputTokens ?? "",
      t.outputTokens ?? "",
      t.amount > 0 ? t.amount : -(t.creditsUsed ?? Math.abs(t.amount)),
      t.balance,
    ])
    const scope = selectedUserId ? `user-${selectedUserId.slice(0, 8)}` : "platform"
    const op = opFilter === "all" ? "tum" : opFilter
    downloadCsv(`islemler-${scope}-${op}-${days}g-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...rows])
  }

  function toggleUserSort(key: UserSortKey) {
    if (userSortKey === key) {
      setUserSortDir(userSortDir === "asc" ? "desc" : "asc")
    } else {
      setUserSortKey(key)
      setUserSortDir(key === "name" || key === "email" ? "asc" : "desc")
    }
  }

  async function handleLogout() {
    await fetch("/api/admin/logout", { method: "POST" })
    router.replace("/analytics/login")
    router.refresh()
  }

  const tabs: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
    { id: "genel", label: "Genel Bakis", icon: BarChart3 },
    { id: "kullanicilar", label: "Kullanicilar", icon: Users },
    { id: "islemler", label: "Islem Gecmisi", icon: Clock },
    { id: "harcama", label: "Maliyet Analizi", icon: DollarSign },
  ]

  const selectedUser = data?.platform.users.find((u) => u.id === selectedUserId)
  const viewLabel = selectedUser
    ? selectedUser.name ?? selectedUser.email?.split("@")[0] ?? "Kullanici"
    : "Tum Platform"

  return (
    <div className="min-h-screen flex" style={{ backgroundColor: "#F5F0E6" }}>
      {/* Sidebar */}
      <aside
        className="w-60 min-h-screen flex flex-col shrink-0 border-r sticky top-0 h-screen"
        style={{ backgroundColor: "#1A0F05", borderColor: "rgba(201,168,76,0.15)" }}
      >
        {/* Logo */}
        <div className="px-5 py-4 border-b" style={{ borderColor: "rgba(201,168,76,0.12)" }}>
          <Link href="/">
            <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-14" style={{ filter: "brightness(0) invert(1)" }} />
          </Link>
          <p className="font-ui text-[10px] mt-1 tracking-wider uppercase" style={{ color: "#C9A84C" }}>
            Admin Panel
          </p>
        </div>

        {/* Nav tabs */}
        <nav className="flex-1 py-3 px-3 space-y-0.5">
          {tabs.map((t) => {
            const active = tab === t.id
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-left font-ui text-sm transition-all"
                style={{
                  backgroundColor: active ? "rgba(201,168,76,0.12)" : "transparent",
                  color: active ? "#FAF7F0" : "rgba(250,247,240,0.50)",
                }}
              >
                <t.icon className="h-4 w-4 shrink-0" />
                {t.label}
              </button>
            )
          })}
        </nav>

        {/* Period selector */}
        <div className="px-3 pb-2">
          <p className="font-ui text-[10px] mb-1.5 px-3" style={{ color: "rgba(250,247,240,0.35)" }}>Zaman Araligi</p>
          <div className="flex gap-1 px-2">
            {([7, 30, 90] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className="flex-1 py-1 rounded text-xs font-ui transition-all"
                style={{
                  backgroundColor: days === d ? "rgba(201,168,76,0.20)" : "transparent",
                  color: days === d ? "#C9A84C" : "rgba(250,247,240,0.35)",
                }}
              >
                {d} gun
              </button>
            ))}
          </div>
        </div>

        {/* User filter */}
        {data && (
          <div className="px-3 pb-4 border-t mt-2 pt-3" style={{ borderColor: "rgba(201,168,76,0.10)" }}>
            <p className="font-ui text-[10px] mb-1.5 px-3" style={{ color: "rgba(250,247,240,0.35)" }}>Kullanici Filtresi</p>
            <button
              onClick={() => { setSelectedUserId(null); setTab("genel") }}
              className="w-full flex items-center gap-2 px-3 py-1.5 rounded text-xs font-ui transition-all text-left"
              style={{
                backgroundColor: !selectedUserId ? "rgba(201,168,76,0.15)" : "transparent",
                color: !selectedUserId ? "#C9A84C" : "rgba(250,247,240,0.45)",
              }}
            >
              <Users className="h-3 w-3 shrink-0" />
              Tum Kullanicilar
            </button>
            {data.platform.users.map((u) => {
              const low = u.creditBalance < LOW_BALANCE_THRESHOLD
              return (
                <button
                  key={u.id}
                  onClick={() => { setSelectedUserId(u.id); setTab("genel") }}
                  className="w-full flex items-center justify-between px-3 py-1.5 rounded text-xs font-ui transition-all text-left"
                  style={{
                    backgroundColor: selectedUserId === u.id ? "rgba(201,168,76,0.15)" : "transparent",
                    color: selectedUserId === u.id ? "#C9A84C" : "rgba(250,247,240,0.45)",
                  }}
                >
                  <span className="truncate flex items-center gap-1.5">
                    {low && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: "#c44" }} />}
                    {u.name ?? u.email?.split("@")[0] ?? "?"}
                  </span>
                  <span className="shrink-0 tabular-nums opacity-60">{fmt(u.creditBalance)}</span>
                </button>
              )
            })}
          </div>
        )}

        {/* Back + Logout */}
        <div className="px-3 pb-4 space-y-0.5">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded text-xs font-ui transition-all hover:opacity-80"
            style={{ color: "rgba(250,247,240,0.40)" }}
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Ana Sayfaya Don
          </Link>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs font-ui transition-all hover:opacity-80 text-left"
            style={{ color: "rgba(250,247,240,0.40)" }}
          >
            <LogOut className="h-3.5 w-3.5" />
            Cikis Yap
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 min-h-screen overflow-auto">
        {/* Top bar */}
        <div
          className="sticky top-0 z-10 px-8 py-3 border-b flex items-center justify-between"
          style={{ backgroundColor: "rgba(245,240,230,0.95)", backdropFilter: "blur(8px)", borderColor: "#e8e2d8" }}
        >
          <div>
            <h1 className="font-display text-lg font-bold" style={{ color: "#2D1F0E" }}>
              {tabs.find((t) => t.id === tab)?.label}
            </h1>
            <p className="font-ui text-[11px]" style={{ color: "#8a7a65" }}>
              {viewLabel} — son {days} gun
            </p>
          </div>
          {loading && (
            <div className="w-4 h-4 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
          )}
        </div>

        <div className="p-8">
          {loading && !data ? (
            <div className="flex justify-center py-20">
              <div className="flex items-center gap-3" style={{ color: "#8a7a65" }}>
                <div className="w-5 h-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                <span className="font-ui text-sm">Yukleniyor...</span>
              </div>
            </div>
          ) : data ? (
            <>
              {/* ====== GENEL BAKIS ====== */}
              {tab === "genel" && (
                <div className="space-y-6">
                  {/* Platform stats */}
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    <StatCard label="Toplam Kullanici" value={String(data.platform.totalUsers)} sub="kayitli hesap" color="#2D1F0E" />
                    <StatCard
                      label={selectedUserId ? "Kredi Bakiye" : "Toplam Bakiye"}
                      value={fmt(data.balance)}
                      sub={selectedUserId ? "mevcut bakiye" : "tum kullanicilar"}
                      color="#C9A84C"
                    />
                    <StatCard label="Harcanan Kredi" value={fmt(data.totals.creditsSpent)} sub={`${data.totals.operations} islem`} color="#c44" />
                    <StatCard label="Tahmini Maliyet" value={`$${data.totals.estimatedUSD.toFixed(2)}`} sub={`son ${days} gun`} color="#2D8B4E" />
                    <StatCard label="Token Kullanimi" value={fmtToken(data.totals.inputTokens + data.totals.outputTokens)} sub={`${fmtToken(data.totals.inputTokens)} giris / ${fmtToken(data.totals.outputTokens)} cikis`} color="#5c7cfa" />
                  </div>

                  {/* Daily chart */}
                  <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                    <h3 className="font-display text-sm font-semibold mb-0.5" style={{ color: "#2D1F0E" }}>Gunluk Kredi Kullanimi</h3>
                    <p className="font-ui text-[10px] mb-4" style={{ color: "#a89a82" }}>Son {days} gunde gunluk harcanan kredi</p>
                    {data.daily.length > 0 ? (
                      <>
                        <MiniChart data={data.daily.map((d) => ({ date: d.date, value: d.credits }))} height={120} />
                        <div className="flex justify-between mt-1.5 px-0.5">
                          <span className="font-ui text-[9px]" style={{ color: "#a89a82" }}>{data.daily[0]?.date.slice(5)}</span>
                          <span className="font-ui text-[9px]" style={{ color: "#a89a82" }}>{data.daily[data.daily.length - 1]?.date.slice(5)}</span>
                        </div>
                      </>
                    ) : (
                      <p className="text-center py-8 font-ui text-sm" style={{ color: "#a89a82" }}>Henuz veri yok</p>
                    )}
                  </div>

                  {/* Two-column: Operation + Model */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* By operation */}
                    <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                      <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "#2D1F0E" }}>Islem Bazinda</h3>
                      <div className="space-y-2">
                        {data.byOperation.length > 0 ? data.byOperation.map((op) => (
                          <div key={op.operation} className="flex items-center gap-2">
                            <span className="font-ui text-[11px] w-[130px] truncate" style={{ color: "#6b5a45" }}>
                              {OP_LABELS[op.operation] ?? op.operation}
                            </span>
                            <Bar value={op.credits} max={data.byOperation[0].credits} color="#C9A84C" />
                            <span className="font-ui text-[11px] tabular-nums w-[60px] text-right" style={{ color: "#2D1F0E" }}>
                              {fmt(op.credits)}
                            </span>
                            <span className="font-ui text-[9px] w-[30px] text-right" style={{ color: "#a89a82" }}>
                              {op.count}x
                            </span>
                          </div>
                        )) : (
                          <p className="font-ui text-xs" style={{ color: "#a89a82" }}>Henuz islem yok</p>
                        )}
                      </div>
                    </div>

                    {/* By model */}
                    <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                      <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "#2D1F0E" }}>Model Bazinda</h3>
                      <div className="space-y-3">
                        {data.byModel.map((m) => (
                          <div key={m.model}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: MODEL_COLORS[m.model] ?? "#888" }} />
                                <span className="font-ui text-xs font-medium capitalize" style={{ color: "#2D1F0E" }}>{m.model}</span>
                                <span className="font-ui text-[10px]" style={{ color: "#a89a82" }}>{m.count} cagri</span>
                              </div>
                              <span className="font-ui text-xs font-medium" style={{ color: "#2D8B4E" }}>${m.estimatedUSD.toFixed(2)}</span>
                            </div>
                            <Bar value={m.credits} max={data.byModel[0]?.credits ?? 1} color={MODEL_COLORS[m.model] ?? "#888"} />
                            <div className="flex gap-3 mt-0.5">
                              <span className="font-ui text-[9px]" style={{ color: "#a89a82" }}>{fmtToken(m.inputTokens)} giris</span>
                              <span className="font-ui text-[9px]" style={{ color: "#a89a82" }}>{fmtToken(m.outputTokens)} cikis</span>
                              <span className="font-ui text-[9px] font-medium" style={{ color: "#6b5a45" }}>{fmt(m.credits)} kredi</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* By project */}
                  {data.byProject.length > 0 && (
                    <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                      <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "#2D1F0E" }}>Proje Bazinda</h3>
                      <div className="space-y-2">
                        {data.byProject.map((p) => (
                          <div key={p.projectId} className="flex items-center gap-2">
                            <FolderOpen className="h-3 w-3 shrink-0" style={{ color: "#a89a82" }} />
                            <span className="font-ui text-[11px] w-[160px] truncate" style={{ color: "#6b5a45" }}>{p.name}</span>
                            <Bar value={p.credits} max={data.byProject[0].credits} color="#C9A84C" />
                            <span className="font-ui text-[11px] tabular-nums w-[60px] text-right" style={{ color: "#2D1F0E" }}>{fmt(p.credits)}</span>
                            <span className="font-ui text-[9px] w-[30px] text-right" style={{ color: "#a89a82" }}>{p.count}x</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ====== KULLANICILAR ====== */}
              {tab === "kullanicilar" && (
                <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: "#e8e2d8" }}>
                    <div>
                      <h3 className="font-display text-sm font-semibold" style={{ color: "#2D1F0E" }}>Kayitli Kullanicilar</h3>
                      <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>
                        Toplam {data.platform.totalUsers} kullanici · son {days} gunde {fmt(data.platform.totalCreditsPurchased)} satis, {fmt(data.platform.totalCreditsGranted)} bonus, {fmt(data.platform.totalCreditsSpent)} harcandi
                        {userSearch && <> · {filteredSortedUsers.length} sonuc</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setOnlyLowBalance((v) => !v)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs transition-all"
                        style={{
                          backgroundColor: onlyLowBalance ? "rgba(196,68,68,0.10)" : "#F5F0E6",
                          border: `1px solid ${onlyLowBalance ? "rgba(196,68,68,0.35)" : "#e8e2d8"}`,
                          color: onlyLowBalance ? "#c44" : "#6b5a45",
                        }}
                        title={`< ${LOW_BALANCE_THRESHOLD} kredi`}
                      >
                        <AlertTriangle className="h-3 w-3" />
                        Dusuk bakiye
                        {lowBalanceCount > 0 && (
                          <span
                            className="tabular-nums px-1.5 rounded-full text-[10px]"
                            style={{
                              backgroundColor: onlyLowBalance ? "rgba(196,68,68,0.20)" : "rgba(196,68,68,0.12)",
                              color: "#c44",
                            }}
                          >
                            {lowBalanceCount}
                          </span>
                        )}
                      </button>
                      <div
                        className="flex items-center gap-2 px-3 py-1.5 rounded-sm"
                        style={{ backgroundColor: "#F5F0E6", border: "1px solid #e8e2d8" }}
                      >
                        <Search className="h-3.5 w-3.5" style={{ color: "#a89a82" }} />
                        <input
                          type="text"
                          value={userSearch}
                          onChange={(e) => setUserSearch(e.target.value)}
                          placeholder="Isim veya e-posta ara..."
                          className="bg-transparent outline-none font-ui text-xs w-56"
                          style={{ color: "#2D1F0E" }}
                        />
                      </div>
                      <button
                        onClick={exportUsersCsv}
                        disabled={filteredSortedUsers.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs transition-opacity disabled:opacity-40 hover:opacity-80"
                        style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}
                        title="CSV olarak indir"
                      >
                        <Download className="h-3 w-3" />
                        CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ backgroundColor: "rgba(201,168,76,0.05)" }}>
                          {([
                            { key: "name", label: "Kullanici", align: "left" },
                            { key: "email", label: "E-posta", align: "left" },
                            { key: "creditBalance", label: "Bakiye", align: "right" },
                            { key: "projects", label: "Projeler", align: "right" },
                            { key: "transactions", label: `Islem (${days}g)`, align: "right" },
                            { key: "joinedAt", label: "Katilim", align: "right" },
                          ] as Array<{ key: UserSortKey; label: string; align: "left" | "right" }>).map((col) => {
                            const active = userSortKey === col.key
                            return (
                              <th
                                key={col.key}
                                onClick={() => toggleUserSort(col.key)}
                                className={`text-${col.align} font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider cursor-pointer select-none hover:bg-[#C9A84C]/[0.08] transition-colors`}
                                style={{ color: active ? "#2D1F0E" : "#8a7a65" }}
                              >
                                <span className={`inline-flex items-center gap-1 ${col.align === "right" ? "justify-end w-full" : ""}`}>
                                  {col.label}
                                  {active ? (
                                    <span className="text-[8px]">{userSortDir === "asc" ? "↑" : "↓"}</span>
                                  ) : (
                                    <ArrowUpDown className="h-2.5 w-2.5 opacity-40" />
                                  )}
                                </span>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredSortedUsers.map((u) => (
                          <tr
                            key={u.id}
                            className="border-t cursor-pointer hover:bg-[#C9A84C]/[0.03] transition-colors"
                            style={{ borderColor: "#f0ebe2" }}
                            onClick={() => { setSelectedUserId(u.id); setTab("genel") }}
                          >
                            <td className="font-ui text-xs py-3 px-4 font-medium" style={{ color: "#2D1F0E" }}>
                              {u.name ?? "Isimsiz"}
                            </td>
                            <td className="font-ui text-xs py-3 px-4" style={{ color: "#8a7a65" }}>{u.email ?? "-"}</td>
                            <td className="font-ui text-xs py-3 px-4 text-right tabular-nums font-medium" style={{ color: u.creditBalance < LOW_BALANCE_THRESHOLD ? "#c44" : "#2D8B4E" }}>
                              <span className="inline-flex items-center gap-1 justify-end">
                                {u.creditBalance < LOW_BALANCE_THRESHOLD && (
                                  <AlertTriangle className="h-3 w-3" aria-label="Dusuk bakiye" />
                                )}
                                {fmt(u.creditBalance)}
                              </span>
                            </td>
                            <td className="font-ui text-xs py-3 px-4 text-right tabular-nums" style={{ color: "#6b5a45" }}>{u.projects}</td>
                            <td className="font-ui text-xs py-3 px-4 text-right tabular-nums" style={{ color: "#6b5a45" }}>{u.transactions}</td>
                            <td className="font-ui text-xs py-3 px-4 text-right" style={{ color: "#a89a82" }}>
                              {new Date(u.joinedAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "2-digit" })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {filteredSortedUsers.length === 0 && (
                      <p className="text-center py-10 font-ui text-sm" style={{ color: "#a89a82" }}>
                        {userSearch ? `"${userSearch}" icin sonuc yok` : "Henuz kullanici yok"}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* ====== ISLEM GECMISI ====== */}
              {tab === "islemler" && (
                <div className="rounded-lg overflow-hidden" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                  <div className="px-5 py-4 border-b flex items-center justify-between gap-4 flex-wrap" style={{ borderColor: "#e8e2d8" }}>
                    <div>
                      <h3 className="font-display text-sm font-semibold" style={{ color: "#2D1F0E" }}>Islem Gecmisi</h3>
                      <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>
                        {filteredRecent.length} islem · son {days} gun — {viewLabel}
                        {opFilter !== "all" && <> · {OP_LABELS[opFilter] ?? opFilter}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={opFilter}
                        onChange={(e) => setOpFilter(e.target.value)}
                        className="px-3 py-1.5 rounded-sm font-ui text-xs outline-none cursor-pointer"
                        style={{ backgroundColor: "#F5F0E6", border: "1px solid #e8e2d8", color: "#2D1F0E" }}
                      >
                        <option value="all">Tum islemler</option>
                        {availableOps.map((op) => (
                          <option key={op} value={op}>{OP_LABELS[op] ?? op}</option>
                        ))}
                      </select>
                      <button
                        onClick={exportTransactionsCsv}
                        disabled={filteredRecent.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm font-ui text-xs transition-opacity disabled:opacity-40 hover:opacity-80"
                        style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}
                        title="CSV olarak indir"
                      >
                        <Download className="h-3 w-3" />
                        CSV
                      </button>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr style={{ backgroundColor: "rgba(201,168,76,0.05)" }}>
                          <th className="text-left font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Tarih</th>
                          <th className="text-left font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Islem</th>
                          <th className="text-left font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Model</th>
                          <th className="text-right font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Token (Giris/Cikis)</th>
                          <th className="text-right font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Kredi</th>
                          <th className="text-right font-ui text-[10px] font-semibold py-2.5 px-4 uppercase tracking-wider" style={{ color: "#8a7a65" }}>Bakiye</th>
                        </tr>
                      </thead>
                      <tbody>
                        {paginatedRecent.map((t) => {
                          const isGrant = t.amount > 0
                          return (
                            <tr key={t.id} className="border-t hover:bg-[#C9A84C]/[0.03] transition-colors" style={{ borderColor: "#f0ebe2" }}>
                              <td className="font-ui text-xs py-2.5 px-4" style={{ color: "#6b5a45" }}>
                                {new Date(t.createdAt).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" })}
                                {" "}
                                <span style={{ color: "#a89a82" }}>
                                  {new Date(t.createdAt).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </td>
                              <td className="font-ui text-xs py-2.5 px-4" style={{ color: "#2D1F0E" }}>
                                {OP_LABELS[t.operation ?? ""] ?? t.operation ?? t.type}
                              </td>
                              <td className="font-ui text-xs py-2.5 px-4 capitalize" style={{ color: "#8a7a65" }}>{t.model ?? "-"}</td>
                              <td className="font-ui text-xs py-2.5 px-4 text-right tabular-nums" style={{ color: "#8a7a65" }}>
                                {t.inputTokens || t.outputTokens
                                  ? `${fmtToken(t.inputTokens ?? 0)} / ${fmtToken(t.outputTokens ?? 0)}`
                                  : "-"}
                              </td>
                              <td className="font-ui text-xs font-medium py-2.5 px-4 text-right tabular-nums" style={{ color: isGrant ? "#2D8B4E" : "#c44" }}>
                                {isGrant ? "+" : "-"}{Math.abs(t.creditsUsed ?? t.amount)}
                              </td>
                              <td className="font-ui text-xs py-2.5 px-4 text-right tabular-nums" style={{ color: "#2D1F0E" }}>
                                {fmt(t.balance)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    {filteredRecent.length === 0 && (
                      <p className="text-center py-10 font-ui text-sm" style={{ color: "#a89a82" }}>
                        {opFilter !== "all" ? "Bu islem tipinde kayit yok" : "Henuz islem yok"}
                      </p>
                    )}
                  </div>

                  {/* Pagination */}
                  {filteredRecent.length > PAGE_SIZE && (
                    <div className="px-5 py-3 border-t flex items-center justify-between" style={{ borderColor: "#e8e2d8" }}>
                      <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>
                        {(currentTxPage - 1) * PAGE_SIZE + 1}–{Math.min(currentTxPage * PAGE_SIZE, filteredRecent.length)} / {filteredRecent.length}
                      </p>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                          disabled={currentTxPage <= 1}
                          className="p-1 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#C9A84C]/10 transition-colors"
                          style={{ color: "#6b5a45" }}
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </button>
                        <span className="font-ui text-xs tabular-nums px-2" style={{ color: "#2D1F0E" }}>
                          {currentTxPage} / {txPageCount}
                        </span>
                        <button
                          onClick={() => setTxPage((p) => Math.min(txPageCount, p + 1))}
                          disabled={currentTxPage >= txPageCount}
                          className="p-1 rounded disabled:opacity-30 disabled:cursor-not-allowed hover:bg-[#C9A84C]/10 transition-colors"
                          style={{ color: "#6b5a45" }}
                        >
                          <ChevronRight className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ====== MALIYET ANALIZI ====== */}
              {tab === "harcama" && (
                <div className="space-y-6">
                  {/* Kredi Akisi (grant vs purchase vs refund vs spend) */}
                  <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-display text-sm font-semibold" style={{ color: "#2D1F0E" }}>Kredi Akisi</h3>
                        <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>
                          Son {days} gun — {viewLabel}
                        </p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="rounded p-3" style={{ backgroundColor: "rgba(45,139,78,0.05)", border: "1px solid rgba(45,139,78,0.15)" }}>
                        <p className="font-ui text-[10px] mb-1" style={{ color: "#5a7a5f" }}>Satin Alinan</p>
                        <p className="font-display text-2xl font-bold tabular-nums" style={{ color: "#2D8B4E" }}>{fmt(data.totals.creditsPurchased)}</p>
                        <p className="font-ui text-[9px] mt-0.5" style={{ color: "#a89a82" }}>kredi (gelir)</p>
                      </div>
                      <div className="rounded p-3" style={{ backgroundColor: "rgba(201,168,76,0.05)", border: "1px solid rgba(201,168,76,0.15)" }}>
                        <p className="font-ui text-[10px] mb-1" style={{ color: "#8a7a65" }}>Bonus (Grant)</p>
                        <p className="font-display text-2xl font-bold tabular-nums" style={{ color: "#C9A84C" }}>{fmt(data.totals.creditsGranted)}</p>
                        <p className="font-ui text-[9px] mt-0.5" style={{ color: "#a89a82" }}>hediye + admin</p>
                      </div>
                      <div className="rounded p-3" style={{ backgroundColor: "rgba(92,124,250,0.05)", border: "1px solid rgba(92,124,250,0.15)" }}>
                        <p className="font-ui text-[10px] mb-1" style={{ color: "#6b7aa8" }}>Iade</p>
                        <p className="font-display text-2xl font-bold tabular-nums" style={{ color: "#5c7cfa" }}>{fmt(data.totals.creditsRefunded)}</p>
                        <p className="font-ui text-[9px] mt-0.5" style={{ color: "#a89a82" }}>refund</p>
                      </div>
                      <div className="rounded p-3" style={{ backgroundColor: "rgba(196,68,68,0.05)", border: "1px solid rgba(196,68,68,0.15)" }}>
                        <p className="font-ui text-[10px] mb-1" style={{ color: "#a05555" }}>Harcanan</p>
                        <p className="font-display text-2xl font-bold tabular-nums" style={{ color: "#c44" }}>{fmt(data.totals.creditsSpent)}</p>
                        <p className="font-ui text-[9px] mt-0.5" style={{ color: "#a89a82" }}>{data.totals.operations} islem</p>
                      </div>
                    </div>
                  </div>

                  {/* USD cost per model */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {data.byModel.map((m) => (
                      <div key={m.model} className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: MODEL_COLORS[m.model] ?? "#888" }} />
                          <span className="font-display text-sm font-semibold capitalize" style={{ color: "#2D1F0E" }}>{m.model}</span>
                        </div>
                        <p className="font-display text-3xl font-bold mb-1" style={{ color: "#2D8B4E" }}>${m.estimatedUSD.toFixed(2)}</p>
                        <div className="space-y-1 mt-3">
                          <div className="flex justify-between">
                            <span className="font-ui text-[10px]" style={{ color: "#a89a82" }}>API Cagri Sayisi</span>
                            <span className="font-ui text-[11px] tabular-nums" style={{ color: "#2D1F0E" }}>{m.count}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Giris Token</span>
                            <span className="font-ui text-[11px] tabular-nums" style={{ color: "#2D1F0E" }}>{fmtToken(m.inputTokens)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Cikis Token</span>
                            <span className="font-ui text-[11px] tabular-nums" style={{ color: "#2D1F0E" }}>{fmtToken(m.outputTokens)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Kredi Harcanan</span>
                            <span className="font-ui text-[11px] tabular-nums" style={{ color: "#2D1F0E" }}>{fmt(m.credits)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Summary */}
                  <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                    <h3 className="font-display text-sm font-semibold mb-4" style={{ color: "#2D1F0E" }}>Maliyet Ozeti</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                      <div>
                        <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Toplam API Maliyeti</p>
                        <p className="font-display text-2xl font-bold" style={{ color: "#2D8B4E" }}>${data.totals.estimatedUSD.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Toplam Token</p>
                        <p className="font-display text-2xl font-bold" style={{ color: "#5c7cfa" }}>
                          {fmtToken(data.totals.inputTokens + data.totals.outputTokens)}
                        </p>
                      </div>
                      <div>
                        <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Toplam Islem</p>
                        <p className="font-display text-2xl font-bold" style={{ color: "#2D1F0E" }}>{data.totals.operations}</p>
                      </div>
                      <div>
                        <p className="font-ui text-[10px]" style={{ color: "#a89a82" }}>Ort. Islem Maliyeti</p>
                        <p className="font-display text-2xl font-bold" style={{ color: "#C9A84C" }}>
                          ${data.totals.operations > 0 ? (data.totals.estimatedUSD / data.totals.operations).toFixed(4) : "0"}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Top expensive operations */}
                  <div className="rounded-lg p-5" style={{ backgroundColor: "#fff", border: "1px solid #e8e2d8" }}>
                    <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "#2D1F0E" }}>En Pahali Islemler</h3>
                    <div className="space-y-2">
                      {data.byOperation.slice(0, 8).map((op) => (
                        <div key={op.operation} className="flex items-center gap-2">
                          <span className="font-ui text-[11px] w-[160px] truncate" style={{ color: "#6b5a45" }}>
                            {OP_LABELS[op.operation] ?? op.operation}
                          </span>
                          <Bar value={op.credits} max={data.byOperation[0].credits} color="#c44" />
                          <span className="font-ui text-[11px] tabular-nums w-[70px] text-right" style={{ color: "#2D1F0E" }}>
                            {fmt(op.credits)} kr
                          </span>
                          <span className="font-ui text-[9px] w-[40px] text-right" style={{ color: "#a89a82" }}>
                            {op.count}x
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-20">
              <p className="font-ui text-sm" style={{ color: "#a89a82" }}>Veri yuklenemedi.</p>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
