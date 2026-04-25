"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, GraduationCap, Loader2, Save } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { FadeUp } from "@/components/shared/Animations"
import {
  emptyMetaFor,
  isAcademicFormat,
  parseAcademicMeta,
  type AcademicFormat,
  type AcademicMeta,
} from "@/lib/academic-meta"
import MetaFormRouter, {
  type AiHandlers,
} from "@/components/academic-meta/MetaFormRouter"

type GeneratingFlags = NonNullable<AiHandlers["generating"]>

export default function AcademicSettingsPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string

  const [projectTitle, setProjectTitle] = useState<string>("")
  const [citationFormat, setCitationFormat] = useState<AcademicFormat | null>(null)
  const [meta, setMeta] = useState<AcademicMeta | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [generating, setGenerating] = useState<GeneratingFlags>({})

  useEffect(() => {
    (async () => {
      try {
        const projRes = await fetch(`/api/projects/${projectId}`)
        if (!projRes.ok) {
          router.push("/")
          return
        }
        const proj = await projRes.json()
        setProjectTitle(proj.title ?? "")

        const fmt = proj.citationFormat as string | undefined
        if (!fmt || !isAcademicFormat(fmt as never)) {
          setCitationFormat(null)
          return
        }
        setCitationFormat(fmt as AcademicFormat)

        const metaRes = await fetch(`/api/projects/${projectId}/academic-meta`)
        if (!metaRes.ok) {
          setMeta(emptyMetaFor(fmt as AcademicFormat))
          return
        }
        const body = await metaRes.json()
        const parsed = parseAcademicMeta(body.meta)
        setMeta(parsed.ok ? parsed.data : emptyMetaFor(fmt as AcademicFormat))
      } finally {
        setLoading(false)
      }
    })()
  }, [projectId, router])

  const save = useCallback(async () => {
    if (!meta) return
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/academic-meta`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(meta),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Save failed" }))
        throw new Error(body.error ?? "Save failed")
      }
      toast.success("Academic metadata saved")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }, [meta, projectId])

  // -----------------------------------------------------------------
  //  AI generation — placeholder implementation.
  //  Concrete target + API wiring lands in the generate-abstract endpoint
  //  task; this shell just toggles the loading state so the UI is live.
  // -----------------------------------------------------------------
  const generate = useCallback(
    async (
      target: keyof GeneratingFlags,
      apply: (meta: AcademicMeta, result: unknown) => AcademicMeta
    ) => {
      if (!meta) return
      setGenerating((g) => ({ ...g, [target]: true }))
      try {
        const res = await fetch(
          `/api/projects/${projectId}/academic-meta/generate-abstract`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target }),
          }
        )
        if (!res.ok) throw new Error("Generation failed")
        const body = await res.json()
        setMeta((m) => (m ? apply(m, body.result) : m))
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Generation failed")
      } finally {
        setGenerating((g) => ({ ...g, [target]: false }))
      }
    },
    [meta, projectId]
  )

  const handlers = useMemo<AiHandlers>(
    () => ({
      generating,
      onGenerateAbstract: () =>
        generate("abstract", (m, r) => ({ ...m, abstract: String(r ?? "") })),
      onGenerateKeywords: () =>
        generate("keywords", (m, r) => ({
          ...m,
          keywords: Array.isArray(r) ? (r as string[]) : [],
        })),
      onGenerateIndexTerms: () =>
        generate("indexTerms", (m, r) => {
          if (m.format !== "IEEE") return m
          const next: AcademicMeta = {
            ...m,
            indexTerms: Array.isArray(r) ? (r as string[]) : [],
          }
          return next
        }),
      onGenerateStructuredAbstract: () =>
        generate("structuredAbstract", (m, r) => {
          const patch = r as Record<string, string | null>
          if (m.format === "VANCOUVER") {
            const next: AcademicMeta = {
              ...m,
              structuredAbstract: { ...m.structuredAbstract, ...patch },
            }
            return next
          }
          if (m.format === "AMA") {
            const next: AcademicMeta = {
              ...m,
              structuredAbstract: { ...m.structuredAbstract, ...patch },
            }
            return next
          }
          return m
        }),
      onGenerateKeyPoints: () =>
        generate("keyPoints", (m, r) => {
          if (m.format !== "AMA") return m
          const patch = r as Record<string, string | null>
          const next: AcademicMeta = {
            ...m,
            keyPoints: { ...m.keyPoints, ...patch },
          }
          return next
        }),
      onGenerateAbstractTr: () =>
        generate("abstractTr", (m, r) => {
          if (m.format !== "ISNAD") return m
          const next: AcademicMeta = { ...m, abstractTr: String(r ?? "") }
          return next
        }),
      onGenerateAbstractEn: () =>
        generate("abstractEn", (m, r) => {
          if (m.format !== "ISNAD") return m
          const next: AcademicMeta = { ...m, abstractEn: String(r ?? "") }
          return next
        }),
      onGenerateKeywordsTr: () =>
        generate("keywordsTr", (m, r) => {
          if (m.format !== "ISNAD") return m
          const next: AcademicMeta = {
            ...m,
            keywordsTr: Array.isArray(r) ? (r as string[]) : [],
          }
          return next
        }),
      onGenerateKeywordsEn: () =>
        generate("keywordsEn", (m, r) => {
          if (m.format !== "ISNAD") return m
          const next: AcademicMeta = {
            ...m,
            keywordsEn: Array.isArray(r) ? (r as string[]) : [],
          }
          return next
        }),
    }),
    [generate, generating]
  )

  if (loading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ backgroundColor: "#F5F0E6" }}
      >
        <Loader2 className="h-6 w-6 animate-spin text-[#2C5F2E]" />
      </div>
    )
  }

  if (!citationFormat) {
    return (
      <div className="min-h-screen" style={{ backgroundColor: "#F5F0E6" }}>
        <div className="max-w-3xl mx-auto px-6 py-8">
          <Link
            href={`/projects/${projectId}/export`}
            className="inline-flex items-center gap-1.5 text-sm text-[#8a7a65] hover:text-[#2D1F0E] mb-6"
          >
            <ChevronLeft className="h-4 w-4" /> Back to export
          </Link>
          <p className="font-body text-[#6b5a45]">
            Academic metadata applies only to projects that use an academic
            citation format (APA, MLA, Chicago, Turabian, Harvard, IEEE,
            Vancouver, AMA, ISNAD).
          </p>
        </div>
      </div>
    )
  }

  if (!meta) return null

  return (
    <div className="min-h-screen" style={{ backgroundColor: "#F5F0E6" }}>
      <div className="max-w-3xl mx-auto px-6 py-8">
        <Link
          href={`/projects/${projectId}/export`}
          className="inline-flex items-center gap-1.5 text-sm text-[#8a7a65] hover:text-[#2D1F0E] mb-6"
        >
          <ChevronLeft className="h-4 w-4" /> Back to export
        </Link>

        <FadeUp>
          <div className="flex items-center gap-3 mb-2">
            <GraduationCap className="h-6 w-6 text-[#8a5a1a]" />
            <h1 className="font-display text-2xl font-bold text-[#2D1F0E]">
              Academic metadata · {citationFormat}
            </h1>
          </div>
          <p className="font-body text-sm text-[#6b5a45] mb-8">
            These fields populate the title page, abstract, running head, and
            other structural parts of the export. {projectTitle}.
          </p>
        </FadeUp>

        <div className="bg-[#FAF7F0] border border-[#d4c9b5] rounded-sm p-6">
          <MetaFormRouter meta={meta} onChange={setMeta} {...handlers} />

          <div className="flex justify-end pt-6 mt-6 border-t border-[#d4c9b5]">
            <Button onClick={save} disabled={saving} className="gap-2">
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              {saving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
