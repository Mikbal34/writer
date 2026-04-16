"use client"

import { useState, FormEvent } from "react"
import { useRouter } from "next/navigation"
import { ShieldCheck, Loader2 } from "lucide-react"

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp"

export default function AdminLoginPage() {
  const router = useRouter()
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error ?? "Giris basarisiz")
        return
      }
      router.replace("/analytics")
      router.refresh()
    } catch {
      setError("Baglanti hatasi")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-6"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundColor: "#1A0F05",
      }}
    >
      <div
        className="w-full max-w-sm rounded-sm shadow-[0_4px_30px_rgba(0,0,0,0.4)] p-8"
        style={{ backgroundColor: "#FAF7F0", border: "1px solid #d4c9b5" }}
      >
        <div className="flex flex-col items-center mb-6">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center mb-3"
            style={{ backgroundColor: "rgba(201,168,76,0.15)" }}
          >
            <ShieldCheck className="h-5 w-5" style={{ color: "#C9A84C" }} />
          </div>
          <h1 className="font-display text-xl font-bold" style={{ color: "#2D1F0E" }}>
            Admin Panel
          </h1>
          <p className="font-ui text-[11px] mt-1" style={{ color: "#8a7a65" }}>
            Devam etmek icin giris yapin
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label
              htmlFor="username"
              className="font-ui text-[11px] font-medium block mb-1"
              style={{ color: "#6b5a45" }}
            >
              Kullanici Adi
            </label>
            <input
              id="username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              className="w-full px-3 py-2 font-ui text-sm rounded-sm outline-none focus:ring-2"
              style={{
                backgroundColor: "#fff",
                border: "1px solid #d4c9b5",
                color: "#2D1F0E",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="password"
              className="font-ui text-[11px] font-medium block mb-1"
              style={{ color: "#6b5a45" }}
            >
              Sifre
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 font-ui text-sm rounded-sm outline-none focus:ring-2"
              style={{
                backgroundColor: "#fff",
                border: "1px solid #d4c9b5",
                color: "#2D1F0E",
              }}
            />
          </div>

          {error && (
            <p
              className="font-ui text-xs rounded-sm px-3 py-2"
              style={{ backgroundColor: "rgba(196,68,68,0.08)", color: "#c44" }}
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-sm font-ui text-sm font-medium transition-opacity disabled:opacity-60"
            style={{ backgroundColor: "#2D1F0E", color: "#FAF7F0" }}
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Giris yapiliyor..." : "Giris Yap"}
          </button>
        </form>
      </div>
    </div>
  )
}
