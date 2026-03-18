import { getServerSession } from "next-auth";
import Link from "next/link";
import {
 BookOpen,
 ArrowRight,
 Sparkles,
 FileText,
 Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
 Card,
 CardContent,
 CardFooter,
 CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ProgressBar from "@/components/shared/ProgressBar";
import NewProjectDialog from "@/components/NewProjectDialog";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { formatDistanceToNow } from "@/lib/dateUtils";

const STATUS_LABELS: Record<string, string> = {
 onboarding: "Onboarding",
 roadmap: "Roadmap",
 sources: "Sources",
 writing: "Writing",
 completed: "Completed",
};

const STATUS_COLORS: Record<
 string,
 "default" | "secondary" | "destructive" | "outline"
> = {
 onboarding: "secondary",
 roadmap: "secondary",
 sources: "secondary",
 writing: "default",
 completed: "default",
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

 return (
  <div className="min-h-screen bg-background">
   <div className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-10">
    <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
     <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
       <BookOpen className="h-4 w-4 text-primary-foreground" />
      </div>
      <span className="font-semibold text-foreground">Writer Agent</span>
     </div>
     <div className="flex items-center gap-3">
      <Link href="/library">
       <Button variant="ghost" size="sm" className="gap-1.5">
        <BookOpen className="h-3.5 w-3.5" />
        Kütüphanem
       </Button>
      </Link>
      <span className="text-sm text-muted-foreground hidden sm:block">
       {session.user.email}
      </span>
      <Link href="/api/auth/signout">
       <Button variant="ghost" size="sm">
        Sign out
       </Button>
      </Link>
     </div>
    </div>
   </div>

   <main className="max-w-6xl mx-auto px-6 py-10">
    <div className="flex items-center justify-between mb-8">
     <div>
      <h1 className="text-xl font-medium tracking-tight">Your Books</h1>
      <p className="text-muted-foreground text-sm mt-1">
       {projects.length === 0
        ? "Create your first book project to get started."
        : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
      </p>
     </div>
     <NewProjectDialog />
    </div>

    {projects.length === 0 ? (
     <EmptyState />
    ) : (
     <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
      {projects.map((project) => {
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
         : 0;

       return (
        <Link
         key={project.id}
         href={`/projects/${project.id}`}
         className="group"
        >
         <Card className="h-full transition-all duration-200 hover:border-foreground/20 cursor-pointer">
          <CardHeader className="pb-3">
           <div className="flex items-start justify-between gap-2">
            <h2 className="font-semibold text-base leading-tight line-clamp-2 transition-colors">
             {project.title}
            </h2>
            <Badge
             variant={STATUS_COLORS[project.status] ?? "secondary"}
             className="shrink-0"
            >
             {STATUS_LABELS[project.status] ?? project.status}
            </Badge>
           </div>
           {project.description && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
             {project.description}
            </p>
           )}
          </CardHeader>
          <CardContent className="pb-3">
           <ProgressBar
            value={getStatusProgress(project.status)}
            showPercentage
            size="sm"
           />
           <p className="text-xs text-muted-foreground mt-3">
            {chapterCount} chapters · {allSubsections.length} sections · {totalWordCount > 999 ? `${(totalWordCount / 1000).toFixed(1)}k` : totalWordCount} words
           </p>
          </CardContent>
          <CardFooter className="pt-0">
           <p className="text-xs text-muted-foreground">
            Updated{" "}
            {formatDistanceToNow(new Date(project.updatedAt))} ago
           </p>
          </CardFooter>
         </Card>
        </Link>
       );
      })}
     </div>
    )}
   </main>
  </div>
 );
}

function EmptyState() {
 return (
  <div className="flex flex-col items-center justify-center py-24 text-center">
   <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-5">
    <BookOpen className="h-8 w-8 text-muted-foreground" />
   </div>
   <h2 className="text-xl font-semibold mb-2">No projects yet</h2>
   <p className="text-muted-foreground max-w-xs mb-6 text-sm">
    Start your first book project. Define your style, generate a roadmap,
    and write with AI assistance.
   </p>
   <NewProjectDialog variant="empty" />
  </div>
 );
}

function LandingPage() {
 return (
  <div className="min-h-screen bg-background">
   <header className="border-b border-border">
    <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
     <div className="flex items-center gap-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
       <BookOpen className="h-4 w-4 text-primary-foreground" />
      </div>
      <span className="font-semibold text-foreground">Writer Agent</span>
     </div>
     <Link href="/api/auth/signin">
      <Button variant="outline" size="sm">
       Sign in
      </Button>
     </Link>
    </div>
   </header>

   <main>
    <section className="max-w-4xl mx-auto px-6 pt-32 pb-24 text-center">
     <div className="inline-flex items-center gap-2 rounded-full border border-border bg-muted px-4 py-1.5 text-sm text-muted-foreground mb-8">
      <Sparkles className="h-3.5 w-3.5" />
      AI-powered book writing assistant
     </div>
     <h1 className="text-5xl md:text-6xl font-semibold tracking-tight mb-6 leading-tight">
      Create Your Book{" "}
      <span className="italic font-normal">with AI</span>
     </h1>
     <p className="text-xl text-muted-foreground mb-10 max-w-2xl mx-auto leading-relaxed">
      Define your writing style, generate a structured roadmap, upload
      your sources, and write chapters with intelligent AI assistance
      — all in one place.
     </p>
     <div className="flex flex-col sm:flex-row gap-3 justify-center">
      <Link href="/api/auth/signin">
       <Button
        size="lg"
        className="gap-2 px-8"
       >
        Get started free
        <ArrowRight className="h-4 w-4" />
       </Button>
      </Link>
     </div>
    </section>

    <section className="max-w-5xl mx-auto px-6 pb-32">
     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <FeatureCard
       icon={<Brain className="h-5 w-5 text-muted-foreground" />}
       title="Style Learning"
       description="Upload sample text or chat with AI to capture your unique writing voice and style."
      />
      <FeatureCard
       icon={<FileText className="h-5 w-5 text-muted-foreground" />}
       title="Smart Roadmap"
       description="AI generates a detailed chapter-by-chapter structure with sections and subsections."
      />
      <FeatureCard
       icon={<Sparkles className="h-5 w-5 text-muted-foreground" />}
       title="AI Writing"
       description="Write each subsection with AI that knows your style, sources, and position in the book."
      />
     </div>
    </section>
   </main>
  </div>
 );
}

function FeatureCard({
 icon,
 title,
 description,
}: {
 icon: React.ReactNode;
 title: string;
 description: string;
}) {
 return (
  <Card className="p-8">
   <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted mb-4">
    {icon}
   </div>
   <h3 className="font-semibold mb-2">{title}</h3>
   <p className="text-sm text-muted-foreground leading-relaxed">
    {description}
   </p>
  </Card>
 );
}
