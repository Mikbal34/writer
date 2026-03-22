import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
  Check,
  Clock,
  ArrowRight,
  FileText,
  PenLine,
  Map,
  Download,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/dateUtils";
import { Ornament, PageNumber, SectionTitle, SpineShadow } from "@/components/shared/BookElements";
import { FadeUp, FadeIn, FadeRight, StaggerItem, AnimatedBar } from "@/components/shared/Animations";

interface ProjectPageProps {
  params: Promise<{ id: string }>;
}

const STATUS_LABELS: Record<string, string> = {
  onboarding: "Onboarding",
  roadmap: "Building Roadmap",
  sources: "Adding Sources",
  writing: "Writing",
  completed: "Completed",
};

interface SubsectionSummary {
  id: string;
  title: string;
  status: string;
  wordCount: number;
}

interface SectionSummary {
  id: string;
  subsections: SubsectionSummary[];
}

interface ChapterSummary {
  id: string;
  number: number;
  title: string;
  estimatedPages: number | null;
  sections: SectionSummary[];
}

interface SourceSummary {
  id: string;
  processed: boolean;
}

interface ProjectData {
  id: string;
  title: string;
  description: string | null;
  status: string;
  createdAt: Date;
  chapters: ChapterSummary[];
  sources: SourceSummary[];
  _count: { bibliography: number };
}

function BookmarkProgress({ percentage }: { percentage: number }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative w-16 h-24">
        <svg viewBox="0 0 64 96" className="w-full h-full drop-shadow-md">
          <defs>
            <linearGradient id="bookmarkGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2D5016" />
              <stop offset="100%" stopColor="#1a3a0a" />
            </linearGradient>
          </defs>
          <path d="M4 0 H60 Q64 0 64 4 V88 L32 72 L0 88 V4 Q0 0 4 0Z" fill="url(#bookmarkGrad)" />
          <path d="M8 4 H56 V80 L32 66 L8 80Z" fill="none" stroke="#C9A84C" strokeWidth="0.8" opacity="0.6" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pt-1">
          <span className="font-display text-2xl font-bold text-[#F5EDE0] leading-none">{percentage}</span>
          <span className="font-ui text-[10px] text-[#C9A84C] tracking-wider">%</span>
        </div>
      </div>
      <span className="font-ui text-xs text-ink-light tracking-widest uppercase">Completed</span>
    </div>
  );
}

export default async function ProjectDashboardPage({
  params,
}: ProjectPageProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const projectRaw = await prisma.project.findFirst({
    where: { id, userId: session.user.id as string },
    include: {
      chapters: {
        include: {
          sections: {
            include: {
              subsections: {
                select: {
                  id: true,
                  title: true,
                  status: true,
                  wordCount: true,
                },
                orderBy: { sortOrder: "asc" },
              },
            },
            orderBy: { sortOrder: "asc" },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      sources: {
        select: { id: true, processed: true },
      },
      _count: {
        select: { bibliography: true },
      },
    },
  });

  if (!projectRaw) {
    notFound();
  }

  // Cast to our known shape
  const project = projectRaw as unknown as ProjectData;

  // Compute stats
  const allSections = project.chapters.flatMap((c) => c.sections);
  const allSubsections = allSections.flatMap((s) => s.subsections);
  const completedCount = allSubsections.filter(
    (s) => s.status === "completed"
  ).length;
  const inProgressCount = allSubsections.filter(
    (s) => s.status === "in_progress" || s.status === "draft"
  ).length;
  const totalWordCount = allSubsections.reduce(
    (acc, s) => acc + s.wordCount,
    0
  );
  const completionPct =
    allSubsections.length > 0
      ? Math.round((completedCount / allSubsections.length) * 100)
      : 0;

  // Recent activity — subsections that have content (in_progress, draft, completed)
  const recentSubsections = allSubsections
    .filter((s) => s.status !== "pending")
    .slice(0, 5);

  const processedSources = project.sources.filter((s) => s.processed).length;

  return (
    <div className="flex-1 flex flex-col lg:flex-row">
      {/* LEFT PAGE */}
      <div className="flex-1 p-6 md:p-8 lg:p-10 flex flex-col overflow-y-auto min-h-0">
        {/* Header: title, status badge, date */}
        <FadeIn delay={0.2}>
          <header className="mb-6">
            <h1 className="font-display text-3xl md:text-4xl font-bold text-ink tracking-tight leading-tight">
              {project.title}
            </h1>
            {project.description && (
              <p className="font-body text-sm text-muted-foreground mt-1">{project.description}</p>
            )}
            <span className="font-ui text-xs text-muted-foreground mt-2 block">
              {formatDate(new Date(project.createdAt))}
            </span>
          </header>
        </FadeIn>

        {/* Stats row */}
        <FadeUp delay={0.3} className="flex flex-wrap gap-x-6 gap-y-2 mb-6 pb-5 border-b border-[#d4c9b5]/50">
          {[
            { value: project.chapters.length, label: "chapters" },
            { value: allSections.length, label: "sections" },
            { value: allSubsections.length, label: "subsections" },
            { value: totalWordCount > 999 ? `${(totalWordCount / 1000).toFixed(1)}k` : totalWordCount, label: "words" },
            { value: project._count.bibliography, label: "references" },
          ].map((stat, i) => (
            <div key={i} className="flex items-baseline gap-1.5">
              <span className="font-display text-xl font-bold text-ink">{stat.value}</span>
              <span className="font-ui text-xs text-muted-foreground">{stat.label}</span>
            </div>
          ))}
        </FadeUp>

        {/* Progress bar */}
        <FadeIn delay={0.35} className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="font-ui text-xs text-muted-foreground tracking-wide uppercase">Overall Progress</span>
            <span className="font-display text-sm font-semibold text-forest">{completionPct}%</span>
          </div>
          <div className="h-1.5 bg-[#e8dfd0] rounded-full overflow-hidden">
            <AnimatedBar
              percentage={completionPct}
              delay={0.5}
              className="h-full bg-gradient-to-r from-forest to-forest-light rounded-full"
            />
          </div>
        </FadeIn>

        <Ornament className="w-48 mx-auto text-[#c9bfad] mb-6" />

        {/* Table of Contents */}
        <div className="flex-1">
          <SectionTitle className="mb-4">Contents</SectionTitle>
          {allSubsections.length === 0 ? (
            <div className="py-6 text-center">
              <p className="font-body text-sm text-muted-foreground">
                No subsections yet.{" "}
                <Link href={`/projects/${id}/roadmap`} className="text-forest hover:underline">
                  Generate a roadmap
                </Link>{" "}
                to get started.
              </p>
            </div>
          ) : (
            <div className="space-y-0">
              {project.chapters.map((chapter, i) => {
                const chapterSubsections = chapter.sections.flatMap(s => s.subsections);
                const chapterCompleted = chapterSubsections.filter(s => s.status === "completed").length;
                const isComplete = chapterCompleted === chapterSubsections.length && chapterSubsections.length > 0;
                return (
                  <StaggerItem key={chapter.id} index={i} baseDelay={0.3} stagger={0.1} className="group">
                    <div className="flex items-baseline justify-between py-3 border-b border-dashed border-[#d4c9b5]">
                      <div className="flex items-baseline gap-3 flex-1 min-w-0">
                        <span className="font-display text-sm text-ink-light italic shrink-0">
                          {String(chapter.number).padStart(2, "0")}.
                        </span>
                        <span className="font-body text-[15px] text-ink truncate group-hover:text-forest transition-colors duration-300">
                          {chapter.title}
                        </span>
                        <span className="flex-1 border-b border-dotted border-[#c9bfad] mx-2 translate-y-[-4px]" />
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="font-ui text-xs text-muted-foreground">
                          {chapter.estimatedPages ? `~${chapter.estimatedPages}pp` : ""}
                        </span>
                        <div className="flex items-center gap-1">
                          {isComplete ? (
                            <Check className="w-3.5 h-3.5 text-forest" />
                          ) : (
                            <Clock className="w-3.5 h-3.5 text-gold-dark" />
                          )}
                          <span className="font-ui text-xs font-medium text-ink-light">
                            {chapterCompleted}/{chapterSubsections.length}
                          </span>
                        </div>
                      </div>
                    </div>
                  </StaggerItem>
                );
              })}
            </div>
          )}
        </div>
        <PageNumber number="i" />
      </div>

      <SpineShadow />

      {/* RIGHT PAGE */}
      <div className="flex-1 p-6 md:p-8 lg:p-10 flex flex-col overflow-y-auto min-h-0 border-t lg:border-t-0 border-[#d4c9b5]/40">
        {/* Bookmark Progress */}
        <FadeUp delay={0.4} className="flex justify-center mb-8">
          <BookmarkProgress percentage={completionPct} />
        </FadeUp>

        <Ornament className="w-40 mx-auto text-[#c9bfad] mb-8" />

        {/* Quick Actions */}
        <FadeRight delay={0.5} className="mb-8">
          <SectionTitle className="mb-4">Quick Actions</SectionTitle>
          <div className="space-y-1">
            {[
              { icon: Map, label: "View Roadmap", href: `/projects/${id}/roadmap` },
              { icon: FileText, label: `Sources (${processedSources}/${project.sources.length})`, href: `/projects/${id}/sources` },
              { icon: PenLine, label: "Writing Workspace", href: `/projects/${id}/write` },
              { icon: Download, label: "Export DOCX", href: `/projects/${id}/export` },
            ].map((action, i) => {
              const Icon = action.icon;
              return (
                <Link key={i} href={action.href} className="w-full flex items-center gap-3 px-4 py-2.5 rounded-sm hover:bg-[#e8dfd0]/40 transition-all duration-200 group no-underline">
                  <Icon className="w-4 h-4 text-ink-light group-hover:text-forest transition-colors" />
                  <span className="font-body text-sm text-ink group-hover:text-forest transition-colors">{action.label}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-[#c9bfad] ml-auto group-hover:text-forest group-hover:translate-x-0.5 transition-all" />
                </Link>
              );
            })}
          </div>
        </FadeRight>

        <div className="border-t border-[#d4c9b5]/40 mb-8" />

        {/* Recent Activity */}
        {recentSubsections.length > 0 && (
          <FadeRight delay={0.6} className="flex-1">
            <SectionTitle className="mb-4">Recent Activity</SectionTitle>
            <div className="space-y-3">
              {recentSubsections.map((sub) => (
                <StaggerItem key={sub.id} index={recentSubsections.indexOf(sub)} baseDelay={0.7} stagger={0.08} className="flex items-start gap-3">
                  <div className="mt-1.5 w-2 h-2 rounded-full bg-forest/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-sm text-ink leading-snug truncate">{sub.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`font-ui text-[10px] px-1.5 py-0.5 rounded-sm ${
                        sub.status === "completed"
                          ? "bg-forest/10 text-forest"
                          : sub.status === "in_progress" || sub.status === "draft"
                          ? "bg-[#e8dfd0] text-ink-light"
                          : "bg-[#e8dfd0]/50 text-muted-foreground"
                      }`}>
                        {sub.status === "completed" ? "Done" : sub.status === "in_progress" ? "In Progress" : sub.status === "draft" ? "Draft" : "Pending"}
                      </span>
                      {sub.wordCount > 0 && (
                        <span className="font-ui text-[10px] text-muted-foreground">{sub.wordCount}w</span>
                      )}
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </div>
          </FadeRight>
        )}

        {/* Legend */}
        <FadeIn delay={0.8} className="mt-6 pt-4 border-t border-[#d4c9b5]/40">
          <div className="flex items-center gap-4 justify-center">
            {[
              { color: "bg-forest", label: `Completed (${completedCount})` },
              { color: "bg-ink", label: `In Progress (${inProgressCount})` },
              { color: "bg-[#c9bfad]", label: `Pending (${allSubsections.length - completedCount - inProgressCount})` },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${item.color}`} />
                <span className="font-ui text-[10px] text-muted-foreground">{item.label}</span>
              </div>
            ))}
          </div>
        </FadeIn>
        <PageNumber number="ii" />
      </div>
    </div>
  );
}
