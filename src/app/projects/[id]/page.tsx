import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { getServerSession } from "next-auth";
import {
 BookOpen,
 Layers,
 FileText,
 Hash,
 ArrowRight,
 PenLine,
 Map,
 Download,
 Library,
} from "lucide-react";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import ProgressBar from "@/components/shared/ProgressBar";
import { formatDate } from "@/lib/dateUtils";

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
  <div className="max-w-5xl mx-auto px-6 py-8">
   {/* Header */}
   <div className="mb-8">
    <div className="flex items-start justify-between gap-4 flex-wrap">
     <div>
      <h1 className="text-2xl font-bold tracking-tight">{project.title}</h1>
      {project.description && (
       <p className="text-muted-foreground mt-1 text-sm">
        {project.description}
       </p>
      )}
      <div className="flex items-center gap-2 mt-2">
       <Badge variant="secondary">
        {STATUS_LABELS[project.status] ?? project.status}
       </Badge>
       <span className="text-xs text-muted-foreground">
        Created {formatDate(new Date(project.createdAt))}
       </span>
      </div>
     </div>
     <div className="flex gap-2 flex-wrap">
     </div>
    </div>

    <div className="mt-5">
     <ProgressBar
      value={completionPct}
      label="Overall completion"
      showPercentage
      size="md"
     />
    </div>
   </div>

   {/* Stats */}
   <div className="flex items-center gap-6 mb-8 text-sm text-muted-foreground flex-wrap">
    <span><strong className="text-foreground tabular-nums">{project.chapters.length}</strong> chapters</span>
    <span className="text-border">·</span>
    <span><strong className="text-foreground tabular-nums">{allSections.length}</strong> sections</span>
    <span className="text-border">·</span>
    <span><strong className="text-foreground tabular-nums">{allSubsections.length}</strong> subsections</span>
    <span className="text-border">·</span>
    <span><strong className="text-foreground tabular-nums">{totalWordCount > 999 ? `${(totalWordCount / 1000).toFixed(1)}k` : totalWordCount}</strong> words</span>
    <span className="text-border">·</span>
    <span><strong className="text-foreground tabular-nums">{project._count.bibliography}</strong> references</span>
   </div>

   <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
    {/* Progress breakdown */}
    <Card className="lg:col-span-2">
     <CardHeader className="pb-3">
      <CardTitle className="text-base font-semibold">
       Writing Progress
      </CardTitle>
     </CardHeader>
     <CardContent className="space-y-3">
      {allSubsections.length === 0 ? (
       <div className="py-6 text-center">
        <p className="text-sm text-muted-foreground">
         No subsections yet.{" "}
         <Link
          href={`/projects/${id}/roadmap`}
          className="text-primary hover:underline"
         >
          Generate a roadmap
         </Link>{" "}
         to get started.
        </p>
       </div>
      ) : (
       <>
        <div className="flex gap-4 text-sm">
         <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          <span className="text-muted-foreground">
           Completed ({completedCount})
          </span>
         </div>
         <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-primary" />
          <span className="text-muted-foreground">
           In progress ({inProgressCount})
          </span>
         </div>
         <div className="flex items-center gap-1.5">
          <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
          <span className="text-muted-foreground">
           Pending (
           {allSubsections.length - completedCount - inProgressCount}
           )
          </span>
         </div>
        </div>
        <Separator />
        {project.chapters.slice(0, 5).map((chapter) => {
         const chapterSubsections = chapter.sections.flatMap(
          (s) => s.subsections
         );
         const chapterCompleted = chapterSubsections.filter(
          (s) => s.status === "completed"
         ).length;
         const pct =
          chapterSubsections.length > 0
           ? Math.round(
             (chapterCompleted / chapterSubsections.length) * 100
            )
           : 0;

         return (
          <div key={chapter.id} className="space-y-1">
           <div className="flex items-center justify-between text-xs">
            <span className="text-foreground font-medium truncate max-w-[70%]">
             Ch. {chapter.number}: {chapter.title}
            </span>
            <span className="text-muted-foreground tabular-nums">
             {chapterCompleted}/{chapterSubsections.length}
            </span>
           </div>
           <ProgressBar value={pct} size="sm" />
          </div>
         );
        })}
        {project.chapters.length > 5 && (
         <p className="text-xs text-muted-foreground">
          +{project.chapters.length - 5} more chapters
         </p>
        )}
       </>
      )}
     </CardContent>
    </Card>

    {/* Quick actions + activity */}
    <div className="space-y-4">
     <Card>
      <CardHeader className="pb-3">
       <CardTitle className="text-base font-semibold">
        Quick Actions
       </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
       <QuickActionLink
        href={`/projects/${id}/roadmap`}
        icon={<Map className="h-4 w-4" />}
        label="View Roadmap"
       />
       <QuickActionLink
        href={`/projects/${id}/sources`}
        icon={<FileText className="h-4 w-4" />}
        label={`Sources (${processedSources}/${project.sources.length})`}
       />
       <QuickActionLink
        href={`/projects/${id}/write`}
        icon={<PenLine className="h-4 w-4" />}
        label="Writing Workspace"
       />
       <QuickActionLink
        href={`/projects/${id}/export`}
        icon={<Download className="h-4 w-4" />}
        label="Export DOCX"
       />
      </CardContent>
     </Card>

     {recentSubsections.length > 0 && (
      <Card>
       <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold">
         Recent Activity
        </CardTitle>
       </CardHeader>
       <CardContent className="space-y-3">
        {recentSubsections.map((sub) => (
         <div key={sub.id} className="flex items-start gap-2.5">
          <div className="h-3.5 w-3.5 rounded-full mt-0.5 shrink-0 flex items-center justify-center">
           <div className="h-2 w-2 rounded-full bg-primary" />
          </div>
          <div className="min-w-0">
           <p className="text-xs font-medium truncate">{sub.title}</p>
           <div className="flex items-center gap-1.5 mt-0.5">
            <SubStatusBadge status={sub.status} />
            {sub.wordCount > 0 && (
             <span className="text-xs text-muted-foreground tabular-nums">
              {sub.wordCount}w
             </span>
            )}
           </div>
          </div>
         </div>
        ))}
       </CardContent>
      </Card>
     )}
    </div>
   </div>
  </div>
 );
}

function QuickActionLink({
 href,
 icon,
 label,
}: {
 href: string;
 icon: React.ReactNode;
 label: string;
}) {
 return (
  <Link
   href={href}
   className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm hover:bg-muted transition-colors group"
  >
   <div className="flex items-center gap-2.5 text-muted-foreground group-hover:text-foreground transition-colors">
    {icon}
    {label}
   </div>
   <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/50 group-hover:text-muted-foreground transition-colors" />
  </Link>
 );
}

function SubStatusBadge({ status }: { status: string }) {
 const variants: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-muted text-muted-foreground" },
  in_progress: {
   label: "In Progress",
   className: "bg-accent text-foreground",
  },
  draft: {
   label: "Draft",
   className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  review: {
   label: "Review",
   className: "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  },
  completed: {
   label: "Done",
   className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  },
 };

 const v = variants[status] ?? variants.pending;

 return (
  <span
   className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${v.className}`}
  >
   {v.label}
  </span>
 );
}
