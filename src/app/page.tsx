import React from "react";
import { getServerSession } from "next-auth";
import Link from "next/link";
import Image from "next/image";
import {
  BookOpen,
  BookMarked,
  Feather,
  Layers,
  Search,
  LogOut,
  FileText,
  Sparkles,
  Zap,
  Shield,
  Check,
  Crown,
} from "lucide-react";
import NewProjectDialog from "@/components/NewProjectDialog";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import SignOutButton from "@/components/shared/SignOutButton";
import WorkspaceShell from "@/components/shared/WorkspaceShell";
import {
  type ProjectCardData,
} from "@/components/projects/ProjectCard";
import ProjectsBrowser from "@/components/projects/ProjectsBrowser";
import ResumePanel from "@/components/projects/ResumePanel";
import { FadeUp, FadeUpLarge, FadeIn, ScrollFadeUp, ScrollFadeIn, AnimatedBar } from "@/components/shared/Animations";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";
const HERO_URL = "/images/hero-landing.webp";

const BOOK_COLORS = [
  { color: "#2D5016", accent: "#4a7a2e", spine: "#1e3a0e" },
  { color: "#5C3D1E", accent: "#8a6a3e", spine: "#3d2810" },
  { color: "#1E3A5C", accent: "#3a6a9c", spine: "#122840" },
  { color: "#3D1E5C", accent: "#6a3e8a", spine: "#2a1040" },
  { color: "#5C1E2D", accent: "#8a3e4d", spine: "#40101e" },
  { color: "#3D3D1E", accent: "#6a6a3e", spine: "#2a2a10" },
];

const STATUS_LABELS: Record<string, string> = {
  onboarding: "Hazırlanıyor",
  roadmap: "Yol haritası",
  sources: "Kaynaklar",
  writing: "Yazım",
  completed: "Tamamlandı",
};

function getStatusProgress(status: string): number {
  const map: Record<string, number> = {
    roadmap: 30,
    sources: 50,
    writing: 70,
    completed: 100,
  };
  return map[status] ?? 0;
}

// Ornamental dots divider
function OrnamentDots() {
  return (
    <div className="flex items-center justify-center gap-2 my-3" aria-hidden="true">
      <div className="w-1.5 h-1.5 rounded-full bg-gold/60" />
      <div className="w-2 h-2 rounded-full bg-gold" />
      <div className="w-1.5 h-1.5 rounded-full bg-gold/60" />
    </div>
  );
}

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return <LandingPage />;
  }

  const projects = await prisma.project.findMany({
    where: { userId: session.user.id as string },
    include: {
      chapters: {
        include: {
          sections: {
            include: {
              subsections: {
                select: { status: true, wordCount: true },
              },
            },
          },
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  // Pull the user's series so we can group multi-volume works together.
  // Series with no projects are still listed (they may be newly created
  // and waiting for their first volume).
  const seriesList = await prisma.series.findMany({
    where: { userId: session.user.id as string },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, description: true },
  });

  const standaloneProjects = projects.filter((p) => !p.seriesId);
  const projectsBySeries = new Map<string, typeof projects>();
  for (const p of projects) {
    if (!p.seriesId) continue;
    const arr = projectsBySeries.get(p.seriesId) ?? [];
    arr.push(p);
    projectsBySeries.set(p.seriesId, arr);
  }
  // Sort each series' volumes by seriesOrder asc (cilt 1, 2, 3...)
  for (const [, arr] of projectsBySeries) {
    arr.sort((a, b) => (a.seriesOrder ?? 0) - (b.seriesOrder ?? 0));
  }

  // ── Card data computation ───────────────────────────────────────
  // Project rows include the full chapter→section→subsection tree; we
  // collapse each into a ProjectCardData shape so the card component
  // stays presentational. Cover colours cycle through BOOK_COLORS by
  // index in the displayed list (active section first, then done).

  const allProjectsCardData: Array<{
    raw: (typeof projects)[number];
    data: ProjectCardData;
  }> = projects.map((project, idx) => {
    const colorScheme = BOOK_COLORS[idx % BOOK_COLORS.length];
    const allSubsections = project.chapters.flatMap((c) =>
      c.sections.flatMap((s) => s.subsections),
    );
    const completedSubs = allSubsections.filter(
      (s) => s.status === "completed",
    ).length;
    const totalWords = allSubsections.reduce(
      (acc, s) => acc + s.wordCount,
      0,
    );
    const chaptersTotal = project.chapters.length;
    const chaptersDone = project.chapters.filter((c) =>
      c.sections.every((s) =>
        s.subsections.every((sub) => sub.status === "completed"),
      ),
    ).length;
    const fallbackPct = getStatusProgress(project.status);
    const isCompleted = project.status === "completed";
    const flag: "active" | "done" | null = isCompleted
      ? "done"
      : project.status === "writing" || project.status === "sources"
        ? "active"
        : null;
    const stage = isCompleted
      ? "Tamamlandı"
      : project.status === "writing"
        ? chaptersTotal > 0
          ? `Taslak · Bölüm ${Math.min(chaptersDone + 1, chaptersTotal)}`
          : "Taslak"
        : (STATUS_LABELS[project.status] ?? project.status);

    return {
      raw: project,
      data: {
        id: project.id,
        title: project.title,
        stage,
        // The Project schema carries description/topic/purpose; pick
        // whichever has content so the card always has a subtitle.
        tagline:
          (project as { description?: string | null }).description ??
          (project as { topic?: string | null }).topic ??
          null,
        chaptersDone,
        chaptersTotal: Math.max(chaptersTotal, 1),
        words: totalWords,
        wordsTarget: null,
        lastEdit: formatRelativeTurkish(project.updatedAt),
        coverColor: colorScheme.color,
        coverAccent: colorScheme.accent,
        flag,
        volumeNumber: project.seriesOrder ?? null,
        fallbackPct,
      } satisfies ProjectCardData,
    };
  });

  const activeCards = allProjectsCardData.filter(
    (p) => p.raw.status !== "completed",
  );
  const doneCards = allProjectsCardData.filter(
    (p) => p.raw.status === "completed",
  );

  // ── Stats ───────────────────────────────────────────────────────
  const totalWords = allProjectsCardData.reduce(
    (acc, p) => acc + p.data.words,
    0,
  );
  const completedCount = doneCards.length;
  const activeCount = activeCards.length;

  // ── Resume target ───────────────────────────────────────────────
  // Prefer the user's most recent WritingSession — that's the actual
  // last spot the cursor was. Falls back to the most-recently-updated
  // non-completed project when no AI write history exists.
  const lastWritingSession = await prisma.writingSession.findFirst({
    where: {
      subsection: {
        section: { chapter: { project: { userId: session.user.id as string } } },
      },
    },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      subsection: {
        select: {
          id: true,
          title: true,
          content: true,
          wordCount: true,
          subsectionId: true,
          section: {
            select: {
              title: true,
              chapter: {
                select: {
                  number: true,
                  title: true,
                  project: {
                    select: { id: true, title: true, updatedAt: true },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  let resume: {
    id: string;
    title: string;
    context: string;
    preview: string | null;
    totalWords: number;
    lastEdit: string;
  } | null = null;

  // ── Weekly stats (last 7 days) ─────────────────────────────────
  // Real numbers from WritingSession. Word totals are approximated from
  // the subsection's wordCount snapshot (no per-session delta stored),
  // so the figure tracks "words sitting in subsections that you touched
  // this week" — directional, not exact.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const recentSessions = await prisma.writingSession.findMany({
    where: {
      createdAt: { gte: sevenDaysAgo },
      subsection: {
        section: { chapter: { project: { userId: session.user.id as string } } },
      },
    },
    orderBy: { createdAt: "asc" },
    select: {
      createdAt: true,
      subsection: { select: { id: true, wordCount: true } },
    },
  });

  // Distinct active days across the week.
  const activeDays = new Set(
    recentSessions.map((s) => s.createdAt.toISOString().slice(0, 10)),
  );

  // Total words across the subsections touched this week (deduped by
  // subsection id so a 5-call session on the same paragraph doesn't
  // 5x the wordcount).
  const touchedSubs = new Map<string, number>();
  for (const s of recentSessions) {
    if (!touchedSubs.has(s.subsection.id)) {
      touchedSubs.set(s.subsection.id, s.subsection.wordCount);
    }
  }
  const wordsThisWeek = Array.from(touchedSubs.values()).reduce(
    (acc, w) => acc + w,
    0,
  );

  // Longest contiguous burst (same-day, gaps <30 min). Cheap proxy for
  // "en uzun seri" without a real per-session duration field.
  let longestRunMins = 0;
  let curRunStart: number | null = null;
  let lastTs: number | null = null;
  for (const s of recentSessions) {
    const ts = s.createdAt.getTime();
    if (curRunStart === null || lastTs === null || ts - lastTs > 30 * 60 * 1000) {
      curRunStart = ts;
    }
    lastTs = ts;
    const runMins = Math.round(((lastTs ?? ts) - (curRunStart ?? ts)) / 60000);
    if (runMins > longestRunMins) longestRunMins = runMins;
  }

  // Intensity per weekday slot (last 7 calendar days, today last).
  const streakDays: Array<{ label: string; intensity: number; date: string }> = [];
  const WEEKDAY_LABELS = ["P", "P", "S", "Ç", "P", "C", "C"]; // Su,Mo,Tu,We,Th,Fr,Sa (Turkish)
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 24 * 60 * 60 * 1000);
    const key = d.toISOString().slice(0, 10);
    const count = recentSessions.filter(
      (s) => s.createdAt.toISOString().slice(0, 10) === key,
    ).length;
    streakDays.push({
      label: WEEKDAY_LABELS[d.getDay()] ?? "·",
      intensity: count, // raw, normalised in the component
      date: key,
    });
  }

  const weeklyStats =
    recentSessions.length > 0
      ? {
          wordsWritten: wordsThisWeek,
          activeDays: { done: activeDays.size, total: 7 },
          longestSessionMins: longestRunMins,
          assistantCalls: recentSessions.length,
          streakDays,
        }
      : null;

  if (lastWritingSession?.subsection) {
    const sub = lastWritingSession.subsection;
    const proj = sub.section.chapter.project;
    const previewBody = stripPreview(sub.content ?? "");
    resume = {
      id: proj.id,
      title: proj.title,
      context: `Bölüm ${sub.section.chapter.number} · ${sub.subsectionId} ${sub.title}`,
      preview: previewBody || null,
      totalWords: sub.wordCount,
      lastEdit: formatRelativeTurkish(lastWritingSession.createdAt),
    };
  } else {
    // No AI write history — fall back to the most-recently-updated
    // non-completed project and derive a coarse summary.
    const fallback =
      projects.find((p) => p.status !== "completed") ?? projects[0] ?? null;
    if (fallback) {
      const allSubs = fallback.chapters.flatMap((c) =>
        c.sections.flatMap((s) => s.subsections),
      );
      resume = {
        id: fallback.id,
        title: fallback.title,
        context:
          fallback.chapters.length === 0
            ? "Yol haritası aşaması"
            : `${fallback.chapters.length} bölüm · ${allSubs.length} alt-bölüm`,
        preview: null,
        totalWords: allSubs.reduce((acc, s) => acc + s.wordCount, 0),
        lastEdit: formatRelativeTurkish(fallback.updatedAt),
      };
    }
  }

  return (
    <WorkspaceShell fullHeight bareMain>
      <div className="flex flex-1 min-h-0 gap-3.5 bg-page">
        {/* === MAIN === */}
        <main className="flex-1 min-w-0 flex flex-col rounded-2xl bg-elevated overflow-hidden">
          <div className="flex-1 overflow-y-auto">
            {/* Dark forest hero band */}
            <section
              className="relative overflow-hidden px-12 pt-9 pb-8 text-gold-soft"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-forest-deep) 0%, #1a2818 100%)",
              }}
            >
              {/* Decorative italic Q */}
              <div
                aria-hidden
                className="pointer-events-none absolute right-8 top-4 select-none"
                style={{
                  fontFamily: "var(--font-display)",
                  fontStyle: "italic",
                  fontSize: 140,
                  lineHeight: 1,
                  color: "var(--color-gold-soft)",
                  opacity: 0.18,
                }}
              >
                Q
              </div>

              <div className="font-ui text-[10px] uppercase tracking-[0.16em] text-gold-soft/65 mb-1">
                Yazım atölyesi
              </div>
              <h1 className="font-display italic font-medium text-[48px] leading-none tracking-tight text-white">
                Kitaplarım
              </h1>
              <p className="mt-3 font-body text-sm leading-relaxed text-gold-soft/85 max-w-[560px]">
                Yazdığın ve yazmakta olduğun kitap projeleri. Bir taneye
                tıkla — bölümler, taslaklar ve yazım yardımcısı açılır.
              </p>

              {/* Stats inline */}
              <div className="mt-7 flex items-end gap-9 flex-wrap">
                <HeroStat num={String(projects.length)} label="kitap" />
                <HeroDivider />
                <HeroStat
                  num={String(activeCount)}
                  suffix={projects.length ? `/${projects.length}` : undefined}
                  label="aktif"
                />
                <HeroDivider />
                <HeroStat
                  num={
                    totalWords > 999
                      ? `${(totalWords / 1000).toFixed(1)}k`
                      : String(totalWords)
                  }
                  label="toplam kelime"
                />
                <HeroDivider />
                <HeroStat num={String(completedCount)} label="tamamlanan" />
                <span className="flex-1" />
                <div className="self-end">
                  <NewProjectDialog />
                </div>
              </div>
            </section>

            {/* Toolbar + grid (interactive search/filter live in client) */}
            {projects.length === 0 ? (
              <div className="px-9 py-12">
                <EmptyState />
              </div>
            ) : (
              <>
                <ProjectsBrowser
                  cards={allProjectsCardData.map((p) => ({
                    data: p.data,
                    status: p.raw.status,
                  }))}
                  activeCount={activeCount}
                  doneCount={completedCount}
                />

                {/* Series notice — surfaces series with no volumes yet */}
                {seriesList.some(
                  (s) => (projectsBySeries.get(s.id) ?? []).length === 0,
                ) && (
                  <div className="mx-9 mb-11 rounded-md border border-dashed border-sandy/70 bg-panel px-4 py-3 font-body text-xs text-ink-light">
                    Boş serilerin var. Yeni proje oluştururken bir seriye
                    cilt ekleyebilirsin.
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* === RIGHT RAIL === */}
        <aside className="w-[290px] shrink-0 rounded-2xl bg-elevated overflow-hidden hidden lg:block">
          <ResumePanel resume={resume} weeklyStats={weeklyStats} />
        </aside>
      </div>
    </WorkspaceShell>
  );
}

// ── V6 helpers ───────────────────────────────────────────────────

function HeroStat({
  num,
  suffix,
  label,
}: {
  num: string;
  suffix?: string;
  label: string;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-0.5 font-display font-medium text-[38px] leading-none tracking-tight text-white">
        {num}
        {suffix && (
          <span className="text-[22px] text-gold-soft/60">{suffix}</span>
        )}
      </div>
      <div className="mt-1 font-ui text-[11px] uppercase tracking-[0.1em] text-gold-soft/70">
        {label}
      </div>
    </div>
  );
}

function HeroDivider() {
  return (
    <span
      aria-hidden
      className="w-px h-9 self-center"
      style={{ background: "rgba(232,212,154,0.25)" }}
    />
  );
}

// Strip a subsection's rich-text content down to a 1-line plain text
// preview. Drops markdown markers and excess whitespace, then truncates
// to ~180 chars so the right-rail card stays compact.
function stripPreview(raw: string): string {
  if (!raw) return "";
  const flat = raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_>`~]+/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  if (flat.length <= 180) return flat;
  return flat.slice(0, 180).trimEnd() + "…";
}

// Simple Turkish-locale relative time. Tolerates server-side rendering
// (UTC-based math). For dates older than a week, falls back to a short
// day/month format.
function formatRelativeTurkish(date: Date): string {
  const diffMs = Date.now() - new Date(date).getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "az önce";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} dakika önce`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} saat önce`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "dün";
  if (day < 7) return `${day} gün önce`;
  return new Date(date).toLocaleDateString("tr-TR", {
    day: "numeric",
    month: "long",
  });
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-sm border mb-5"
        style={{
          backgroundColor: "rgba(201,168,76,0.10)",
          borderColor: "rgba(201,168,76,0.25)",
        }}
      >
        <BookOpen className="h-8 w-8" style={{ color: "#C9A84C" }} />
      </div>
      <OrnamentDots />
      <h2
        className="font-display text-xl font-semibold mb-2 mt-2"
        style={{ color: "#2D1F0E" }}
      >
        No books yet
      </h2>
      <p
        className="font-body text-sm max-w-xs mb-6"
        style={{ color: "rgba(250,247,240,0.55)" }}
      >
        Start your first book project. Define your writing style, create a roadmap, and write with AI assistance.
      </p>
      <NewProjectDialog variant="empty" />
    </div>
  );
}

// ─── Landing Page ────────────────────────────────────────────────────────────

const LANDING_FEATURES = [
  {
    icon: FileText,
    title: "AI-Powered Roadmap",
    desc: "Plan your book's chapter and section structure with AI. Build your roadmap through conversation.",
  },
  {
    icon: Layers,
    title: "Source Library",
    desc: "Manage all your references in one place. BibTeX import, Zotero integration, and automatic citation support.",
  },
  {
    icon: Feather,
    title: "Focused Writing Space",
    desc: "Distraction-free, section-based editor. Add sources instantly, track your progress.",
  },
  {
    icon: Zap,
    title: "Professional Export",
    desc: "Export your finished writing as DOCX or PDF. Bibliography is automatically included.",
  },
  {
    icon: Sparkles,
    title: "AI Writing Assistant",
    desc: "Your AI assistant by your side in every section. Draft creation, expansion, and editing suggestions.",
  },
  {
    icon: BookOpen,
    title: "Book Layout",
    desc: "View your writing process like a real book. Table of contents, page numbers, and chapter structure.",
  },
];

const LANDING_HOW_IT_WORKS = [
  {
    step: "01",
    title: "Create Your Roadmap",
    desc: "Plan your book's chapter and section structure by chatting with AI. Define your audience, source types, and page count.",
  },
  {
    step: "02",
    title: "Add Your Sources",
    desc: "Upload PDFs, import BibTeX, or sync from Zotero. All your references are just a click away while writing.",
  },
  {
    step: "03",
    title: "Write & Export",
    desc: "Write with focus in the section-based editor. When done, export professionally as DOCX or PDF.",
  },
];

const LANDING_TESTIMONIALS = [
  {
    quote: "Writing my academic book has never been this organized. The roadmap feature was a game changer.",
    author: "Dr. Ayşe Kaya",
    role: "History Professor",
  },
  {
    quote: "The integration of source management and writing space is excellent. I no longer waste time searching for references.",
    author: "Mehmet Yılmaz",
    role: "Research Writer",
  },
  {
    quote: "The AI-powered roadmap feature made an incredible contribution to clarifying my book's structure.",
    author: "Zeynep Arslan",
    role: "Academic",
  },
];

const PRICING_PLANS = [
  {
    name: "Free",
    tagline: "Try it out",
    price: 0,
    credits: 1500,
    popular: false,
    features: [
      "Full roadmap + ~4-8 sections of writing",
      "Full roadmap planning",
      "Source library access",
      "DOCX & PDF export",
    ],
  },
  {
    name: "Starter",
    tagline: "For a single book",
    price: 10,
    credits: 7000,
    popular: false,
    features: [
      "~150 pages of AI writing",
      "Everything in Free",
      "Style profile analysis",
      "Priority generation",
    ],
  },
  {
    name: "Pro",
    tagline: "For serious authors",
    price: 20,
    credits: 18000,
    popular: true,
    features: [
      "~400 pages of AI writing",
      "Everything in Starter",
      "Multiple book projects",
      "Advanced RAG retrieval",
    ],
  },
  {
    name: "Academic",
    tagline: "For prolific writers",
    price: 59,
    credits: 60000,
    popular: false,
    features: [
      "~1,300 pages of AI writing",
      "Everything in Pro",
      "Bulk chapter generation",
      "Volume discount pricing",
    ],
  },
];

function LandingPage() {
  return (
    <div
      className="min-h-screen"
      style={{
        backgroundImage: `url(${TEXTURE_URL})`,
        backgroundSize: "cover",
        backgroundAttachment: "fixed",
      }}
    >
      {/* Navbar */}
      <nav className="fixed top-0 left-0 right-0 z-50 bg-ink/60 backdrop-blur-md border-b border-gold/15">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-20 animate-logo-in" style={{ filter: "brightness(0) invert(1)" }} />
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/pricing"
              className="font-ui text-sm text-sandy-soft/70 hover:text-page transition-colors"
            >
              Pricing
            </Link>
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm text-sandy-soft/70 hover:text-page transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm font-medium px-4 py-2 bg-gold text-ink rounded-sm hover:bg-gold-hover transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden pt-16">
        <Image
          src={HERO_URL}
          alt=""
          fill
          priority
          fetchPriority="high"
          quality={82}
          sizes="100vw"
          className="object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-ink/85 via-ink/70 to-ink/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-ink/60 via-transparent to-transparent" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">
          <FadeUpLarge className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8 bg-gold" />
              <span className="font-ui text-xs text-gold tracking-[0.2em] uppercase">
                AI-Powered Book Writing
              </span>
            </div>

            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold text-page leading-[1.1] mb-6">
              Write Your
              <br />
              <em className="text-gold not-italic">Book.</em>
            </h1>

            <p className="font-body text-xl text-sandy-soft/90 leading-relaxed mb-8 max-w-lg">
              An AI-powered writing experience from roadmap to final page.
              Designed for academic books, research works, and long-form content.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href="/api/auth/signin"
                className="flex items-center gap-2 font-ui text-sm font-semibold px-6 py-3 bg-gold text-ink rounded-sm hover:bg-gold-hover transition-all duration-200 group"
              >
                Start Free
                <BookOpen className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/api/auth/signin"
                className="flex items-center gap-2 font-ui text-sm font-medium px-6 py-3 border border-page/40 text-page rounded-sm hover:bg-page/10 transition-all duration-200"
              >
                Sign In
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-6 mt-10 pt-8 border-t border-page/20">
              {[
                { value: "2,400+", label: "Active Writers" },
                { value: "18,000+", label: "Pages Written" },
                { value: "340+", label: "Books Completed" },
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <p className="font-display text-2xl font-bold text-gold">{stat.value}</p>
                  <p className="font-ui text-xs text-sandy-soft/70 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </FadeUpLarge>
        </div>

        {/* Bottom fade to parchment */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-page to-transparent" />
      </section>

      {/* Features — light parchment section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollFadeUp className="text-center mb-14">
            <svg viewBox="0 0 120 20" className="w-24 mx-auto text-gold mb-6 opacity-60" fill="currentColor">
              <path d="M0 10 Q30 2 60 10 Q90 18 120 10" stroke="currentColor" strokeWidth="1" fill="none" />
              <circle cx="60" cy="10" r="3" />
              <circle cx="20" cy="8" r="1.5" />
              <circle cx="100" cy="12" r="1.5" />
            </svg>
            <h2 className="font-display text-4xl font-bold text-ink mb-4">
              All in One
            </h2>
            <p className="font-body text-lg text-ink-light max-w-xl mx-auto leading-relaxed">
              Manage all stages of book writing on a single platform.
              Planning, research, writing, and publishing.
            </p>
          </ScrollFadeUp>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {LANDING_FEATURES.map(({ icon: Icon, title, desc }, i) => (
              <ScrollFadeUp
                key={title}
                delay={i * 0.1}
                className="bg-page/70 border border-sandy/60 rounded-sm p-6 hover:shadow-md hover:border-gold/40 transition-all duration-300 group"
              >
                <div className="w-10 h-10 rounded-sm bg-forest/8 flex items-center justify-center mb-4 group-hover:bg-forest/15 transition-colors">
                  <Icon className="w-5 h-5 text-forest" />
                </div>
                <h3 className="font-display text-lg font-semibold text-ink mb-2">{title}</h3>
                <p className="font-body text-sm text-ink-light leading-relaxed">{desc}</p>
              </ScrollFadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* How it works — subtle tinted section */}
      <section className="py-20 px-6 bg-ink/5">
        <div className="max-w-4xl mx-auto">
          <ScrollFadeIn className="text-center mb-14">
            <h2 className="font-display text-4xl font-bold text-ink mb-4">How It Works</h2>
            <p className="font-body text-lg text-ink-light">Start writing your book in three steps.</p>
          </ScrollFadeIn>

          <div className="relative">
            {/* Connecting line */}
            <div className="absolute left-1/2 top-8 bottom-8 w-px bg-gradient-to-b from-gold/40 via-gold/20 to-transparent hidden md:block" />

            <div className="space-y-8">
              {LANDING_HOW_IT_WORKS.map((item, i) => (
                <ScrollFadeUp
                  key={item.step}
                  delay={i * 0.15}
                  className={`flex items-start gap-6 ${i % 2 === 1 ? "md:flex-row-reverse md:text-right" : ""}`}
                >
                  <div className="shrink-0 w-16 h-16 rounded-sm bg-page border border-sandy/60 flex items-center justify-center shadow-sm">
                    <span className="font-display text-xl font-bold text-gold">{item.step}</span>
                  </div>
                  <div className="flex-1 pt-2">
                    <h3 className="font-display text-xl font-semibold text-ink mb-2">{item.title}</h3>
                    <p className="font-body text-ink-light leading-relaxed">{item.desc}</p>
                  </div>
                </ScrollFadeUp>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <ScrollFadeIn className="text-center mb-12">
            <h2 className="font-display text-4xl font-bold text-ink">What Writers Say</h2>
          </ScrollFadeIn>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {LANDING_TESTIMONIALS.map((t, i) => (
              <ScrollFadeUp
                key={t.author}
                delay={i * 0.1}
                className="bg-page/70 border border-sandy/60 rounded-sm p-6"
              >
                <div className="text-gold text-4xl font-display leading-none mb-4">&ldquo;</div>
                <p className="font-body text-ink leading-relaxed mb-6 italic">{t.quote}</p>
                <div className="border-t border-sandy/40 pt-4">
                  <p className="font-display text-sm font-semibold text-ink">{t.author}</p>
                  <p className="font-ui text-xs text-muted-foreground mt-0.5">{t.role}</p>
                </div>
              </ScrollFadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 bg-ink/5">
        <div className="max-w-5xl mx-auto">
          <ScrollFadeIn className="text-center mb-14">
            <svg viewBox="0 0 120 20" className="w-24 mx-auto text-gold mb-6 opacity-60" fill="currentColor">
              <path d="M0 10 Q30 2 60 10 Q90 18 120 10" stroke="currentColor" strokeWidth="1" fill="none" />
              <circle cx="60" cy="10" r="3" />
              <circle cx="20" cy="8" r="1.5" />
              <circle cx="100" cy="12" r="1.5" />
            </svg>
            <h2 className="font-display text-4xl font-bold text-ink mb-4">
              Simple Pricing
            </h2>
            <p className="font-body text-lg text-ink-light max-w-xl mx-auto leading-relaxed">
              Pay for what you use. Every plan includes all features.
            </p>
          </ScrollFadeIn>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {PRICING_PLANS.map((plan, i) => (
              <ScrollFadeUp
                key={plan.name}
                delay={i * 0.1}
                className={`relative rounded-sm p-6 flex flex-col ${
                  plan.popular
                    ? "bg-ink border-2 border-gold/60 shadow-lg"
                    : "bg-page/70 border border-sandy/60"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 bg-gold rounded-sm">
                    <Crown className="w-3 h-3 text-ink" />
                    <span className="font-ui text-[10px] font-bold text-ink uppercase tracking-wider">
                      Popular
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <h3 className={`font-display text-lg font-bold mb-1 ${
                    plan.popular ? "text-page" : "text-ink"
                  }`}>
                    {plan.name}
                  </h3>
                  <p className={`font-body text-xs ${
                    plan.popular ? "text-sandy-soft/60" : "text-ink-light"
                  }`}>
                    {plan.tagline}
                  </p>
                </div>

                <div className="mb-5">
                  <div className="flex items-baseline gap-1">
                    <span className={`font-display text-3xl font-bold ${
                      plan.popular ? "text-gold" : "text-ink"
                    }`}>
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </span>
                    {plan.price > 0 && (
                      <span className={`font-ui text-xs ${
                        plan.popular ? "text-sandy-soft/50" : "text-ink-light"
                      }`}>
                        one-time
                      </span>
                    )}
                  </div>
                  <p className={`font-ui text-xs mt-1 ${
                    plan.popular ? "text-gold/80" : "text-gold"
                  }`}>
                    {plan.credits.toLocaleString()} credits
                  </p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                        plan.popular ? "text-gold" : "text-forest"
                      }`} />
                      <span className={`font-ui text-xs leading-relaxed ${
                        plan.popular ? "text-sandy-soft/80" : "text-ink-light"
                      }`}>
                        {feature}
                      </span>
                    </li>
                  ))}
                </ul>

                <Link
                  href="/api/auth/signin"
                  className={`flex items-center justify-center gap-2 font-ui text-sm font-semibold px-4 py-2.5 rounded-sm transition-all duration-200 ${
                    plan.popular
                      ? "bg-gold text-ink hover:bg-gold-hover"
                      : "border border-sandy/60 text-ink hover:border-gold/60 hover:bg-gold/5"
                  }`}
                >
                  {plan.price === 0 ? "Start Free" : "Get Started"}
                </Link>
              </ScrollFadeUp>
            ))}
          </div>

          <ScrollFadeIn className="text-center mt-8">
            <p className="font-body text-sm text-ink-light">
              All plans include every feature. Credits never expire.
            </p>
          </ScrollFadeIn>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6">
        <div className="max-w-3xl mx-auto">
          <ScrollFadeUp className="bg-ink rounded-sm p-12 text-center relative overflow-hidden">
            {/* Decorative corners */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t border-l border-gold/40" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t border-r border-gold/40" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b border-l border-gold/40" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b border-r border-gold/40" />

            <h2 className="font-display text-4xl font-bold text-page mb-4">
              Ready to Write Your Book?
            </h2>
            <p className="font-body text-lg text-sandy-soft/80 mb-8 leading-relaxed">
              Start for free. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center gap-2 font-ui text-sm font-semibold px-8 py-3.5 bg-gold text-ink rounded-sm hover:bg-gold-hover transition-all group"
              >
                Start Now
                <BookOpen className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center gap-2 font-ui text-sm font-medium px-8 py-3.5 border border-page/30 text-page rounded-sm hover:bg-page/10 transition-all"
              >
                Sign In
              </Link>
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 flex-wrap">
              {["Free plan available", "AI-powered", "DOCX & PDF export"].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-gold" />
                  <span className="font-ui text-xs text-sandy-soft/70">{item}</span>
                </div>
              ))}
            </div>
          </ScrollFadeUp>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sandy/40 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/quilpen-logo-horizontal.png" alt="Quilpen" className="h-14" />
          </div>
          <p className="font-ui text-xs text-muted-foreground">
            © {new Date().getFullYear()} Quilpen. All rights reserved.
          </p>
          <div className="flex gap-4">
            <Link href="/pricing" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Pricing
            </Link>
            <Link href="/privacy" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Privacy
            </Link>
            <Link href="/terms" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Terms
            </Link>
            <Link href="/refund" className="font-ui text-xs text-muted-foreground hover:text-ink transition-colors">
              Refund
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
