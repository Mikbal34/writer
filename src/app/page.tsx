import React from "react";
import { getServerSession } from "next-auth";
import Link from "next/link";
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
import { FadeUp, FadeUpLarge, FadeIn, ScrollFadeUp, ScrollFadeIn, AnimatedBar } from "@/components/shared/Animations";

const TEXTURE_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/book-texture-bg-hJmgUJE5GQFpbmBrLLMri5.webp";
const HERO_URL =
  "https://d2xsxph8kpxj0f.cloudfront.net/310419663027387604/L3DyhJpdXQXWDPUTXv57iD/hero-landing-V9FtUjiUc3qbRwK6G95Ujs.webp";

const BOOK_COLORS = [
  { color: "#2D5016", accent: "#4a7a2e", spine: "#1e3a0e" },
  { color: "#5C3D1E", accent: "#8a6a3e", spine: "#3d2810" },
  { color: "#1E3A5C", accent: "#3a6a9c", spine: "#122840" },
  { color: "#3D1E5C", accent: "#6a3e8a", spine: "#2a1040" },
  { color: "#5C1E2D", accent: "#8a3e4d", spine: "#40101e" },
  { color: "#3D3D1E", accent: "#6a6a3e", spine: "#2a2a10" },
];

const STATUS_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  roadmap: "Roadmap",
  sources: "Sources",
  writing: "Writing",
  completed: "Completed",
};

function getStatusProgress(status: string): number {
  const map: Record<string, number> = {
    onboarding: 10,
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
      <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60" />
      <div className="w-2 h-2 rounded-full bg-[#C9A84C]" />
      <div className="w-1.5 h-1.5 rounded-full bg-[#C9A84C]/60" />
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

  const totalWords = projects.reduce((acc, project) => {
    const words = project.chapters
      .flatMap((c) => c.sections.flatMap((s) => s.subsections))
      .reduce((a, s) => a + s.wordCount, 0);
    return acc + words;
  }, 0);

  const completedCount = projects.filter((p) => p.status === "completed").length;

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
            <img src="/images/quillon-logo-horizontal.png" alt="Quillon" className="h-20 animate-logo-in" style={{ filter: "brightness(0) invert(1)" }} />
          </div>

          <div className="flex items-center gap-1">
            <Link
              href="/library"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.70)" }}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:block">My Library</span>
            </Link>
            <Link
              href="/style"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.70)" }}
            >
              <Feather className="h-3.5 w-3.5" />
              <span className="hidden sm:block">Writing Twin</span>
            </Link>
            <SignOutButton
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-sm font-ui transition-colors duration-150"
              style={{ color: "rgba(250,247,240,0.55)" }}
            />
          </div>
        </div>
      </nav>

      <main className="max-w-6xl mx-auto px-6 py-10">
        {/* Page header */}
        <FadeUp className="text-center mb-10">
          <div className="flex items-center justify-center gap-3 mb-3" aria-hidden="true">
            <div
              className="h-px flex-1 max-w-[120px]"
              style={{
                background:
                  "linear-gradient(to right, transparent, #C9A84C)",
              }}
            />
            <BookMarked className="h-5 w-5" style={{ color: "#C9A84C" }} />
            <div
              className="h-px flex-1 max-w-[120px]"
              style={{
                background:
                  "linear-gradient(to left, transparent, #C9A84C)",
              }}
            />
          </div>
          <h1
            className="font-display text-3xl font-bold mb-1"
            style={{ color: "#2D1F0E" }}
          >
            My Books
          </h1>
          <p className="font-body text-sm" style={{ color: "#6b5a45" }}>
            {projects.length === 0
              ? "Create your first book project."
              : `${projects.length} project${projects.length !== 1 ? 's' : ''}`}
          </p>
        </FadeUp>

        {/* Stats banner */}
        {projects.length > 0 && (
          <div
            className="rounded-sm border mb-8 grid grid-cols-3 divide-x"
            style={{
              backgroundColor: "rgba(45,31,14,0.70)",
              borderColor: "rgba(201,168,76,0.20)",
            }}
          >
            {[
              {
                label: "Total Books",
                value: projects.length,
                icon: <BookOpen className="h-4 w-4" />,
              },
              {
                label: "Completed",
                value: completedCount,
                icon: <Layers className="h-4 w-4" />,
              },
              {
                label: "Total Words",
                value:
                  totalWords > 999
                    ? `${(totalWords / 1000).toFixed(1)}k`
                    : totalWords,
                icon: <Feather className="h-4 w-4" />,
              },
            ].map(({ label, value, icon }) => (
              <div key={label} className="flex flex-col items-center py-4 gap-1">
                <span style={{ color: "#C9A84C" }}>{icon}</span>
                <span
                  className="font-display text-xl font-bold"
                  style={{ color: "#FAF7F0" }}
                >
                  {value}
                </span>
                <span
                  className="font-ui text-xs"
                  style={{ color: "rgba(250,247,240,0.50)" }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Action row */}
        <div className="flex items-center justify-between gap-4 mb-6">
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-sm border flex-1 max-w-xs"
            style={{
              backgroundColor: "rgba(45,31,14,0.60)",
              borderColor: "rgba(201,168,76,0.20)",
            }}
          >
            <Search className="h-3.5 w-3.5 shrink-0" style={{ color: "rgba(250,247,240,0.40)" }} />
            <span
              className="font-ui text-sm"
              style={{ color: "rgba(250,247,240,0.35)" }}
            >
              Search books...
            </span>
          </div>
          <NewProjectDialog />
        </div>

        {/* Shelf divider */}
        <div className="flex items-center gap-3 mb-7" aria-hidden="true">
          <div
            className="h-px flex-1"
            style={{
              background:
                "linear-gradient(to right, transparent, #C9A84C55, #C9A84C, #C9A84C55, transparent)",
            }}
          />
          <BookMarked className="h-4 w-4" style={{ color: "#C9A84C" }} />
          <div
            className="h-px flex-1"
            style={{
              background:
                "linear-gradient(to right, transparent, #C9A84C55, #C9A84C, #C9A84C55, transparent)",
            }}
          />
        </div>

        {/* Books grid */}
        {projects.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {projects.map((project, index) => {
              const colorScheme = BOOK_COLORS[index % BOOK_COLORS.length];
              const allSubsections = project.chapters.flatMap((c) =>
                c.sections.flatMap((s) => s.subsections)
              );
              const completedSubsections = allSubsections.filter(
                (s) => s.status === "completed"
              ).length;
              const totalWordCount = allSubsections.reduce(
                (acc, s) => acc + s.wordCount,
                0
              );
              const chapterCount = project.chapters.length;
              const completionPct =
                allSubsections.length > 0
                  ? Math.round(
                      (completedSubsections / allSubsections.length) * 100
                    )
                  : getStatusProgress(project.status);
              const completedChapters = project.chapters.filter((c) =>
                c.sections.every((s) =>
                  s.subsections.every((sub) => sub.status === "completed")
                )
              ).length;

              return (
                <FadeUpLarge key={project.id} delay={index * 0.08}>
                <Link
                  href={`/projects/${project.id}`}
                  className="group block"
                  style={{ perspective: "800px" }}
                  aria-label={`Go to ${project.title}`}
                >
                  <article className="book-card relative overflow-hidden rounded-sm">
                    {/* Spine */}
                    <div
                      className="absolute left-0 top-0 bottom-0 w-5 z-10"
                      style={{
                        background: `linear-gradient(to right, ${colorScheme.spine}, ${colorScheme.color})`,
                      }}
                    >
                      {/* Gold decorative lines on spine */}
                      <div className="absolute top-3 left-1/2 -translate-x-1/2 w-2.5 h-px" style={{ backgroundColor: "#C9A84C" }} />
                      <div className="absolute top-5 left-1/2 -translate-x-1/2 w-1.5 h-px" style={{ backgroundColor: "rgba(201,168,76,0.6)" }} />
                      <div className="absolute bottom-5 left-1/2 -translate-x-1/2 w-1.5 h-px" style={{ backgroundColor: "rgba(201,168,76,0.6)" }} />
                      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 w-2.5 h-px" style={{ backgroundColor: "#C9A84C" }} />
                    </div>

                    {/* Cover */}
                    <div
                      className="relative pl-5 flex flex-col min-h-[220px]"
                      style={{
                        background: `linear-gradient(160deg, ${colorScheme.color} 0%, ${colorScheme.accent} 100%)`,
                      }}
                    >
                      {/* Completion badge */}
                      <div
                        className="absolute top-2.5 right-2.5 px-1.5 py-0.5 rounded-sm text-[10px] font-ui font-medium z-10"
                        style={{
                          backgroundColor: "rgba(0,0,0,0.35)",
                          color: "rgba(250,247,240,0.85)",
                          backdropFilter: "blur(4px)",
                        }}
                      >
                        {completedChapters}/{chapterCount}
                      </div>

                      {/* Title area */}
                      <div className="flex-1 flex items-center px-4 py-6">
                        <h2
                          className="font-display text-lg font-bold leading-snug line-clamp-3"
                          style={{
                            color: "rgba(250,247,240,0.95)",
                            textShadow: "0 1px 3px rgba(0,0,0,0.3)",
                          }}
                        >
                          {project.title}
                        </h2>
                      </div>

                      {/* Bottom strip — parchment tone */}
                      <div
                        className="px-4 py-2.5"
                        style={{
                          backgroundColor: "rgba(250,240,220,0.12)",
                          borderTop: "1px solid rgba(201,168,76,0.20)",
                        }}
                      >
                        {/* Progress bar */}
                        <div className="mb-2">
                          <div
                            className="h-[3px] rounded-full overflow-hidden"
                            style={{ backgroundColor: "rgba(250,247,240,0.12)" }}
                          >
                            <AnimatedBar
                              percentage={completionPct}
                              delay={0.4 + index * 0.08}
                              className="h-full rounded-full"
                              style={{
                                background: `linear-gradient(to right, #C9A84C, #e8c96a)`,
                              }}
                            />
                          </div>
                        </div>

                        {/* Stats row */}
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className="font-ui text-[10px]"
                            style={{ color: "rgba(250,247,240,0.55)" }}
                          >
                            <Layers className="inline h-2.5 w-2.5 mr-0.5" />
                            {chapterCount} ch.
                          </span>
                          <span
                            className="font-ui text-[10px]"
                            style={{ color: "rgba(250,247,240,0.55)" }}
                          >
                            <Feather className="inline h-2.5 w-2.5 mr-0.5" />
                            {totalWordCount > 999
                              ? `${(totalWordCount / 1000).toFixed(1)}k`
                              : totalWordCount}
                          </span>
                          <span
                            className="font-ui text-[10px]"
                            style={{ color: "rgba(250,247,240,0.40)" }}
                          >
                            {completionPct}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </article>
                </Link>
                </FadeUpLarge>
              );
            })}
          </div>
        )}

        {/* Page number */}
        {projects.length > 0 && (
          <div className="text-center mt-12">
            <span
              className="font-body text-xs italic"
              style={{ color: "rgba(201,168,76,0.45)" }}
            >
              — {projects.length} —
            </span>
          </div>
        )}
      </main>
    </div>
  );
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
      <nav className="fixed top-0 left-0 right-0 z-50 bg-[#1a0f05]/60 backdrop-blur-md border-b border-[#C9A84C]/15">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <img src="/images/quillon-logo-horizontal.png" alt="Quillon" className="h-20 animate-logo-in" style={{ filter: "brightness(0) invert(1)" }} />
          </Link>
          <div className="flex items-center gap-6">
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm text-[#e8dfd0]/70 hover:text-[#FAF7F0] transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/api/auth/signin"
              className="font-ui text-sm font-medium px-4 py-2 bg-[#C9A84C] text-[#1a0f05] rounded-sm hover:bg-[#d4b85a] transition-colors"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative min-h-[85vh] flex items-center overflow-hidden pt-16">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${HERO_URL})` }}
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#1a0f05]/85 via-[#1a0f05]/70 to-[#1a0f05]/30" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#1a0f05]/60 via-transparent to-transparent" />

        <div className="relative z-10 max-w-6xl mx-auto px-6 py-20">
          <FadeUpLarge className="max-w-2xl">
            <div className="flex items-center gap-3 mb-6">
              <div className="h-px w-8 bg-[#C9A84C]" />
              <span className="font-ui text-xs text-[#C9A84C] tracking-[0.2em] uppercase">
                AI-Powered Book Writing
              </span>
            </div>

            <h1 className="font-display text-5xl md:text-6xl lg:text-7xl font-bold text-[#FAF7F0] leading-[1.1] mb-6">
              Write Your
              <br />
              <em className="text-[#C9A84C] not-italic">Book.</em>
            </h1>

            <p className="font-body text-xl text-[#e8dfd0]/90 leading-relaxed mb-8 max-w-lg">
              An AI-powered writing experience from roadmap to final page.
              Designed for academic books, research works, and long-form content.
            </p>

            <div className="flex flex-wrap gap-4">
              <Link
                href="/api/auth/signin"
                className="flex items-center gap-2 font-ui text-sm font-semibold px-6 py-3 bg-[#C9A84C] text-[#1a0f05] rounded-sm hover:bg-[#d4b85a] transition-all duration-200 group"
              >
                Start Free
                <BookOpen className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/api/auth/signin"
                className="flex items-center gap-2 font-ui text-sm font-medium px-6 py-3 border border-[#FAF7F0]/40 text-[#FAF7F0] rounded-sm hover:bg-[#FAF7F0]/10 transition-all duration-200"
              >
                Sign In
              </Link>
            </div>

            {/* Social proof */}
            <div className="flex items-center gap-6 mt-10 pt-8 border-t border-[#FAF7F0]/20">
              {[
                { value: "2,400+", label: "Active Writers" },
                { value: "18,000+", label: "Pages Written" },
                { value: "340+", label: "Books Completed" },
              ].map((stat, i) => (
                <div key={i} className="text-center">
                  <p className="font-display text-2xl font-bold text-[#C9A84C]">{stat.value}</p>
                  <p className="font-ui text-xs text-[#e8dfd0]/70 mt-0.5">{stat.label}</p>
                </div>
              ))}
            </div>
          </FadeUpLarge>
        </div>

        {/* Bottom fade to parchment */}
        <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#FAF7F0] to-transparent" />
      </section>

      {/* Features — light parchment section */}
      <section className="py-20 px-6">
        <div className="max-w-6xl mx-auto">
          <ScrollFadeUp className="text-center mb-14">
            <svg viewBox="0 0 120 20" className="w-24 mx-auto text-[#C9A84C] mb-6 opacity-60" fill="currentColor">
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
                className="bg-[#FAF7F0]/70 border border-[#d4c9b5]/60 rounded-sm p-6 hover:shadow-md hover:border-[#C9A84C]/40 transition-all duration-300 group"
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
      <section className="py-20 px-6 bg-[#2D1F0E]/5">
        <div className="max-w-4xl mx-auto">
          <ScrollFadeIn className="text-center mb-14">
            <h2 className="font-display text-4xl font-bold text-ink mb-4">How It Works</h2>
            <p className="font-body text-lg text-ink-light">Start writing your book in three steps.</p>
          </ScrollFadeIn>

          <div className="relative">
            {/* Connecting line */}
            <div className="absolute left-1/2 top-8 bottom-8 w-px bg-gradient-to-b from-[#C9A84C]/40 via-[#C9A84C]/20 to-transparent hidden md:block" />

            <div className="space-y-8">
              {LANDING_HOW_IT_WORKS.map((item, i) => (
                <ScrollFadeUp
                  key={item.step}
                  delay={i * 0.15}
                  className={`flex items-start gap-6 ${i % 2 === 1 ? "md:flex-row-reverse md:text-right" : ""}`}
                >
                  <div className="shrink-0 w-16 h-16 rounded-sm bg-[#FAF7F0] border border-[#d4c9b5]/60 flex items-center justify-center shadow-sm">
                    <span className="font-display text-xl font-bold text-[#C9A84C]">{item.step}</span>
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
                className="bg-[#FAF7F0]/70 border border-[#d4c9b5]/60 rounded-sm p-6"
              >
                <div className="text-[#C9A84C] text-4xl font-display leading-none mb-4">&ldquo;</div>
                <p className="font-body text-ink leading-relaxed mb-6 italic">{t.quote}</p>
                <div className="border-t border-[#d4c9b5]/40 pt-4">
                  <p className="font-display text-sm font-semibold text-ink">{t.author}</p>
                  <p className="font-ui text-xs text-muted-foreground mt-0.5">{t.role}</p>
                </div>
              </ScrollFadeUp>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 bg-[#2D1F0E]/5">
        <div className="max-w-5xl mx-auto">
          <ScrollFadeIn className="text-center mb-14">
            <svg viewBox="0 0 120 20" className="w-24 mx-auto text-[#C9A84C] mb-6 opacity-60" fill="currentColor">
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
                    ? "bg-[#2D1F0E] border-2 border-[#C9A84C]/60 shadow-lg"
                    : "bg-[#FAF7F0]/70 border border-[#d4c9b5]/60"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 bg-[#C9A84C] rounded-sm">
                    <Crown className="w-3 h-3 text-[#1a0f05]" />
                    <span className="font-ui text-[10px] font-bold text-[#1a0f05] uppercase tracking-wider">
                      Popular
                    </span>
                  </div>
                )}

                <div className="mb-5">
                  <h3 className={`font-display text-lg font-bold mb-1 ${
                    plan.popular ? "text-[#FAF7F0]" : "text-ink"
                  }`}>
                    {plan.name}
                  </h3>
                  <p className={`font-body text-xs ${
                    plan.popular ? "text-[#e8dfd0]/60" : "text-ink-light"
                  }`}>
                    {plan.tagline}
                  </p>
                </div>

                <div className="mb-5">
                  <div className="flex items-baseline gap-1">
                    <span className={`font-display text-3xl font-bold ${
                      plan.popular ? "text-[#C9A84C]" : "text-ink"
                    }`}>
                      {plan.price === 0 ? "Free" : `$${plan.price}`}
                    </span>
                    {plan.price > 0 && (
                      <span className={`font-ui text-xs ${
                        plan.popular ? "text-[#e8dfd0]/50" : "text-ink-light"
                      }`}>
                        one-time
                      </span>
                    )}
                  </div>
                  <p className={`font-ui text-xs mt-1 ${
                    plan.popular ? "text-[#C9A84C]/80" : "text-[#C9A84C]"
                  }`}>
                    {plan.credits.toLocaleString()} credits
                  </p>
                </div>

                <ul className="space-y-2.5 mb-6 flex-1">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
                        plan.popular ? "text-[#C9A84C]" : "text-forest"
                      }`} />
                      <span className={`font-ui text-xs leading-relaxed ${
                        plan.popular ? "text-[#e8dfd0]/80" : "text-ink-light"
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
                      ? "bg-[#C9A84C] text-[#1a0f05] hover:bg-[#d4b85a]"
                      : "border border-[#d4c9b5]/60 text-ink hover:border-[#C9A84C]/60 hover:bg-[#C9A84C]/5"
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
          <ScrollFadeUp className="bg-[#2D1F0E] rounded-sm p-12 text-center relative overflow-hidden">
            {/* Decorative corners */}
            <div className="absolute top-4 left-4 w-8 h-8 border-t border-l border-[#C9A84C]/40" />
            <div className="absolute top-4 right-4 w-8 h-8 border-t border-r border-[#C9A84C]/40" />
            <div className="absolute bottom-4 left-4 w-8 h-8 border-b border-l border-[#C9A84C]/40" />
            <div className="absolute bottom-4 right-4 w-8 h-8 border-b border-r border-[#C9A84C]/40" />

            <h2 className="font-display text-4xl font-bold text-[#FAF7F0] mb-4">
              Ready to Write Your Book?
            </h2>
            <p className="font-body text-lg text-[#e8dfd0]/80 mb-8 leading-relaxed">
              Start for free. No credit card required.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center gap-2 font-ui text-sm font-semibold px-8 py-3.5 bg-[#C9A84C] text-[#1a0f05] rounded-sm hover:bg-[#d4b85a] transition-all group"
              >
                Start Now
                <BookOpen className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <Link
                href="/api/auth/signin"
                className="flex items-center justify-center gap-2 font-ui text-sm font-medium px-8 py-3.5 border border-[#FAF7F0]/30 text-[#FAF7F0] rounded-sm hover:bg-[#FAF7F0]/10 transition-all"
              >
                Sign In
              </Link>
            </div>
            <div className="flex items-center justify-center gap-6 mt-8 flex-wrap">
              {["Free plan available", "AI-powered", "DOCX & PDF export"].map((item, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5 text-[#C9A84C]" />
                  <span className="font-ui text-xs text-[#e8dfd0]/70">{item}</span>
                </div>
              ))}
            </div>
          </ScrollFadeUp>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#d4c9b5]/40 py-8 px-6">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img src="/images/quillon-logo-horizontal.png" alt="Quillon" className="h-14" />
          </div>
          <p className="font-ui text-xs text-muted-foreground">
            © {new Date().getFullYear()} Quillon. All rights reserved.
          </p>
          <div className="flex gap-4">
            {["Privacy", "Terms of Use", "Contact"].map((item) => (
              <span key={item} className="font-ui text-xs text-muted-foreground hover:text-ink cursor-pointer transition-colors">
                {item}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
