import { notFound, redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/db";
import ProjectSidebar from "@/components/shared/ProjectSidebar";
import WorkspaceShell from "@/components/shared/WorkspaceShell";

interface ProjectLayoutProps {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export default async function ProjectLayout({
  children,
  params,
}: ProjectLayoutProps) {
  const { id } = await params;
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/api/auth/signin");
  }

  const project = await prisma.project.findFirst({
    where: {
      id,
      userId: session.user.id as string,
    },
    select: {
      id: true,
      title: true,
      status: true,
      projectType: true,
      seriesId: true,
      seriesOrder: true,
      series: { select: { id: true, name: true } },
    },
  });

  if (!project) {
    notFound();
  }

  // Lightweight aggregate instead of fetching all chapters/sections/subsections.
  const [totalCount, completedCount] = await Promise.all([
    prisma.subsection.count({
      where: { section: { chapter: { projectId: id } } },
    }),
    prisma.subsection.count({
      where: { section: { chapter: { projectId: id } }, status: "completed" },
    }),
  ]);
  const completionPct =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Project pages share the same WorkspaceShell as the rest of the app —
  // dark IconRail (left), ProjectSidebar in the 240-px context pane, and
  // the page's own content in the main column. fullHeight=true keeps
  // editor / chat splits scrolling inside their own panes without the
  // shell's outer scroll competing.
  return (
    <WorkspaceShell
      context={
        <ProjectSidebar
          projectId={project.id}
          projectTitle={project.title}
          projectStatus={project.status}
          projectType={project.projectType}
          completionPct={completionPct}
          seriesName={project.series?.name ?? null}
          seriesOrder={project.seriesOrder ?? null}
        />
      }
      fullHeight
    >
      {children}
    </WorkspaceShell>
  );
}
